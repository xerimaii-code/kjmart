// api/sql.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from 'mssql';
import { GoogleGenAI } from '@google/genai';
import { getDatabase, ref, get } from 'firebase/database';
import { initializeApp, getApp, FirebaseApp } from 'firebase/app';

// Firebase config (should be same as frontend)
const firebaseConfig = {
  apiKey: "AIzaSyAsfRMNBfG4GRVnQBdonpP2N2ykCZIDGtg",
  authDomain: "kjmart-8ff85.firebaseapp.com",
  databaseURL: "https://kjmart-8ff85-default-rtdb.firebaseio.com",
  projectId: "kjmart-8ff85",
  storageBucket: "kjmart-8ff85.appspot.com",
  messagingSenderId: "694281067109",
  appId: "1:694281067109:web:420c066bda06fe6c10c48c"
};

// Initialize Firebase App
let firebaseApp: FirebaseApp;
try {
  firebaseApp = getApp();
} catch (e) {
  firebaseApp = initializeApp(firebaseConfig);
}
const firebaseDb = getDatabase(firebaseApp);

// MS SQL Server Configuration from environment variables
const config: sql.config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER || 'localhost',
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: true,
  },
  connectionTimeout: 15000,
  requestTimeout: 30000,
};

// Gemini AI Configuration
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- Connection Pooling ---
let pool: sql.ConnectionPool | undefined;

async function getPool(): Promise<sql.ConnectionPool> {
    if (pool && pool.connected) {
        return pool;
    }
    try {
        console.log('Creating new SQL Connection Pool...');
        pool = new sql.ConnectionPool(config);
        await pool.connect();
        console.log("SQL Connection Pool created and connected.");
        return pool;
    } catch (err) {
        console.error('SQL Connection Error on getPool:', err);
        pool = undefined; // Reset on error
        throw err;
    }
}

// Helper to get structured DB Schema for caching
async function getFullDbSchema(pool: sql.ConnectionPool): Promise<Record<string, { columns: { name: string; type: string }[] }>> {
    const schema: Record<string, { columns: { name: string; type: string }[] }>> = {};
    const tableResult = await pool.request().query(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'`);
    const tablesToQuery = tableResult.recordset.map((row: any) => row.TABLE_NAME);

    for (const tableName of tablesToQuery) {
        try {
            const columnResult = await pool.request().query(`
                SELECT COLUMN_NAME, DATA_TYPE 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = N'${tableName}'
            `);
            schema[tableName] = {
                columns: columnResult.recordset.map((col: any) => ({ name: col.COLUMN_NAME, type: col.DATA_TYPE }))
            };
        } catch (err) {
            console.warn(`Could not get schema for table ${tableName}:`, err);
        }
    }
    return schema;
}

// Helper to format a structured schema object into a string for the AI prompt
function formatSchemaForAI(schema: Record<string, any>): string {
    let schemaString = 'Database Schema:\n';
    for (const tableName in schema) {
        if (schema[tableName] && schema[tableName].columns) {
            schemaString += `Table: ${tableName}\nColumns:\n`;
            schema[tableName].columns.forEach((col: any) => {
                schemaString += `  - ${col.name} (${col.type})\n`;
            });
        }
    }
    return schemaString;
}

// Helper to fetch context from Firebase
async function getLearningContextFromFirebase() {
    try {
        const snapshot = await get(ref(firebaseDb, 'learning/sqlContext'));
        if (snapshot.exists()) {
            const data = snapshot.val();
            if (Array.isArray(data)) {
                return data.map((item: any) => `Title: ${item.title}\nContent: ${item.content}`).join('\n\n');
            }
            return String(data);
        }
    } catch (fbError) {
        console.warn('Could not fetch learning context from Firebase:', fbError);
    }
    return 'No additional context provided.';
}

// Main API handler
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { type, query, naturalLanguagePrompt, schema: clientSchema, context: clientContext, lastSyncDate } = req.body;
  
  let currentPool: sql.ConnectionPool;
  try {
    currentPool = await getPool();
  } catch (err: any) {
    console.error('SQL Connection Error from handler:', err);
    return res.status(500).json({ error: 'Database connection failed', details: err.message });
  }
  
  try {
    switch (type) {
      case 'connect':
        res.status(200).json({ success: true, message: 'Connection successful' });
        break;

      case 'getDatabaseSchema':
        const schema = await getFullDbSchema(currentPool);
        res.status(200).json(schema);
        break;

      case 'getTables':
        const tablesResult = await currentPool.request().query(`
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_TYPE = 'BASE TABLE' 
            ORDER BY TABLE_NAME
        `);
        res.status(200).json(tablesResult.recordset.map((row: any) => row.TABLE_NAME));
        break;
      
      case 'query':
        if (!query) return res.status(400).json({ error: 'Query is required' });
        const result = await currentPool.request().query(query);
        res.status(200).json({ recordset: result.recordset, rowsAffected: result.rowsAffected[0] });
        break;
      
      case 'naturalLanguageToSql':
        if (!naturalLanguagePrompt || !clientSchema) {
          return res.status(400).json({ error: 'Prompt and schema are required' });
        }
        const schemaString = formatSchemaForAI(clientSchema);
        const learningContext = clientContext || await getLearningContextFromFirebase();

        const model = 'gemini-3-pro-preview';
        const fullPrompt = `Based on the database schema below, and the provided context, convert the following natural language query into a single, executable MS SQL query. Only return the SQL query. Do not add any explanation or markdown formatting.\n\n${schemaString}\n\nContext:\n${learningContext}\n\nNatural Language Query: "${naturalLanguagePrompt}"\n\nSQL Query:`;
        
        const response = await ai.models.generateContent({ model, contents: fullPrompt });
        const sqlQuery = response.text?.trim().replace(/```sql|```/g, '').trim() || '';
        res.status(200).json({ sql: sqlQuery });
        break;

      case 'aiChat':
         if (!naturalLanguagePrompt || !clientSchema) {
          return res.status(400).json({ error: 'Prompt and schema are required' });
        }
        const chatSchemaString = formatSchemaForAI(clientSchema);
        const chatLearningContext = clientContext || await getLearningContextFromFirebase();
        const chatModel = 'gemini-3-pro-preview';
        const chatPrompt = `You are a helpful assistant for a database. Based on the provided schema and context, answer the user's question. If you need to query the database to answer, formulate the SQL query. Otherwise, answer directly. \n\n${chatSchemaString}\n\nContext:\n${chatLearningContext}\n\nQuestion: "${naturalLanguagePrompt}"\n\nAnswer:`;
        
        const chatResponse = await ai.models.generateContent({ model: chatModel, contents: chatPrompt });
        res.status(200).json({ answer: chatResponse.text });
        break;

      case 'syncCustomersAndProducts': {
        const productsQuery = `
SELECT
    ProductData.거래처명,
    ProductData.바코드,
    ProductData.상품명,
    ProductData.매입가가,
    ProductData.판매가,
    ProductData.행사가,
    ProductData.행사종료일,
    ProductData.upday1
FROM (
    SELECT
        comp.comname AS 거래처명,
        parts.barcode AS 바코드,
        (CASE WHEN parts.spec IS NOT NULL AND parts.spec <> '' THEN CONCAT(parts.descr, ' [', parts.spec, ']') ELSE parts.descr END) AS 상품명,
        parts.money0vat AS 매입가가,
        parts.money1 AS 판매가,
        parts.salemoney0 AS 행사가,
        parts.saleendday AS 행사종료일,
        parts.upday1,
        parts.isuse
    FROM
        comp INNER JOIN parts ON comp.comcode = parts.comcode
) AS ProductData
WHERE (
    (
        ProductData.거래처명 NOT LIKE N'%야채%' AND ProductData.거래처명 NOT LIKE N'%과일%' AND
        ProductData.거래처명 NOT LIKE N'%생선%' AND ProductData.거래처명 NOT LIKE N'%정육%' AND
        ProductData.거래처명 NOT LIKE N'%식품%' AND ProductData.거래처명 NOT LIKE N'%비식품%' AND
        ProductData.거래처명 NOT LIKE N'%기획%' AND ProductData.거래처명 NOT LIKE N'%경진청과%'
    )
    AND ProductData.바코드 IS NOT NULL
    AND ProductData.상품명 NOT LIKE N'%*---*%'
    AND ProductData.매입가가 <> 0
    AND ProductData.isuse <> '0'
) OR (ProductData.바코드 NOT LIKE '0000000%')
ORDER BY ProductData.상품명;
`;
        const customersQuery = `
SELECT
    comp.comcode AS 거래처코드,
    comp.comname AS 거래처명
FROM
    comp
WHERE
    comp.isuse <> '0';
`;

        const [custRes, prodRes] = await Promise.all([
          currentPool.request().query(customersQuery),
          currentPool.request().query(productsQuery)
        ]);
        res.status(200).json({
          customers: { recordset: custRes.recordset },
          products: { recordset: prodRes.recordset }
        });
        break;
      }

      case 'syncCustomers': {
        const syncCustomersQuery = `
SELECT
    comp.comcode AS 거래처코드,
    comp.comname AS 거래처명
FROM
    comp
WHERE
    comp.isuse <> '0';
`;
        const customersResult = await currentPool.request().query(syncCustomersQuery);
        res.status(200).json({ recordset: customersResult.recordset });
        break;
      }

      case 'syncProductsIncrementally': {
        const request = currentPool.request();
        let dateFilter = '';
        if (lastSyncDate) {
            request.input('lastSyncDate', sql.Date, new Date(lastSyncDate));
            dateFilter = `WHERE parts.upday1 >= @lastSyncDate`;
        }

        const incrementalQuery = `
SELECT
    ProductData.거래처명,
    ProductData.바코드,
    ProductData.상품명,
    ProductData.매입가가,
    ProductData.판매가,
    ProductData.행사가,
    ProductData.행사종료일,
    ProductData.upday1,
    ProductData.isuse
FROM (
    SELECT
        comp.comname AS 거래처명,
        parts.barcode AS 바코드,
        (CASE WHEN parts.spec IS NOT NULL AND parts.spec <> '' THEN CONCAT(parts.descr, ' [', parts.spec, ']') ELSE parts.descr END) AS 상품명,
        parts.money0vat AS 매입가가,
        parts.money1 AS 판매가,
        parts.salemoney0 AS 행사가,
        parts.saleendday AS 행사종료일,
        parts.upday1,
        parts.isuse
    FROM
        comp INNER JOIN parts ON comp.comcode = parts.comcode
    ${dateFilter}
) AS ProductData
WHERE
    (
        ProductData.isuse <> '0' AND
        (
            (
                (
                    ProductData.거래처명 NOT LIKE N'%야채%' AND ProductData.거래처명 NOT LIKE N'%과일%' AND
                    ProductData.거래처명 NOT LIKE N'%생선%' AND ProductData.거래처명 NOT LIKE N'%정육%' AND
                    ProductData.거래처명 NOT LIKE N'%식품%' AND ProductData.거래처명 NOT LIKE N'%비식품%' AND
                    ProductData.거래처명 NOT LIKE N'%기획%' AND ProductData.거래처명 NOT LIKE N'%경진청과%'
                )
                AND ProductData.바코드 IS NOT NULL
                AND ProductData.상품명 NOT LIKE N'%*---*%'
                AND ProductData.매입가가 <> 0
            )
            OR (ProductData.바코드 NOT LIKE '0000000%')
        )
    )
    OR (ProductData.isuse = '0')
ORDER BY ProductData.upday1;
`;
        const incResult = await request.query(incrementalQuery);
        res.status(200).json({ recordset: incResult.recordset });
        break;
      }

      default:
        res.status(400).json({ error: 'Invalid request type' });
        break;
    }
  } catch (err: any) {
    console.error(`Error processing request type "${type}":`, err);
    res.status(500).json({ error: 'An internal server error occurred', details: err.message });
  }
}