// api/sql.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from 'mssql';
import { GoogleGenAI } from '@google/genai';
import { getDatabase, ref, get } from 'firebase/database';
import { initializeApp, getApp, FirebaseApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: "AIzaSyAsfRMNBfG4GRVnQBdonpP2N2ykCZIDGtg",
  authDomain: "kjmart-8ff85.firebaseapp.com",
  databaseURL: "https://kjmart-8ff85-default-rtdb.firebaseio.com",
  projectId: "kjmart-8ff85",
  storageBucket: "kjmart-8ff85.appspot.com",
  messagingSenderId: "694281067109",
  appId: "1:694281067109:web:420c066bda06fe6c10c48c"
};

let firebaseApp: FirebaseApp;
try {
  firebaseApp = getApp();
} catch (e) {
  firebaseApp = initializeApp(firebaseConfig);
}
const firebaseDb = getDatabase(firebaseApp);

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

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

async function getFullDbSchema(pool: sql.ConnectionPool): Promise<Record<string, { columns: { name: string; type: string }[] }>> {
    const schema: Record<string, { columns: { name: string; type: string }[] }> = {};
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { type, query, naturalLanguagePrompt, schema: clientSchema, context: clientContext, lastSyncDate } = req.body;
  
  let pool: sql.ConnectionPool | undefined;

  try {
    pool = new sql.ConnectionPool(config);
    await pool.connect();
    
    switch (type) {
      case 'connect': {
        res.status(200).json({ success: true, message: 'Connection successful' });
        break;
      }

      case 'getDatabaseSchema': {
        const schema = await getFullDbSchema(pool);
        res.status(200).json(schema);
        break;
      }

      case 'getTables': {
        const tablesResult = await pool.request().query(`
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_TYPE = 'BASE TABLE' 
            ORDER BY TABLE_NAME
        `);
        res.status(200).json(tablesResult.recordset.map((row: any) => row.TABLE_NAME));
        break;
      }
      
      case 'query': {
        if (!query) {
            res.status(400).json({ error: 'Query is required' });
            return;
        }
        const result = await pool.request().query(query);
        res.status(200).json({ recordset: result.recordset, rowsAffected: result.rowsAffected[0] });
        break;
      }
      
      case 'naturalLanguageToSql': {
        if (!naturalLanguagePrompt || !clientSchema) {
          res.status(400).json({ error: 'Prompt and schema are required' });
          return;
        }
        const schemaString = formatSchemaForAI(clientSchema);
        const learningContext = clientContext || await getLearningContextFromFirebase();

        const model = 'gemini-3-pro-preview';
        const fullPrompt = `Based on the database schema below, and the provided context, convert the following natural language query into a single, executable MS SQL query. Only return the SQL query. Do not add any explanation or markdown formatting.\n\n${schemaString}\n\nContext:\n${learningContext}\n\nNatural Language Query: "${naturalLanguagePrompt}"\n\nSQL Query:`;
        
        const response = await ai.models.generateContent({ model, contents: fullPrompt });
        const sqlQuery = response.text?.trim().replace(/```sql|```/g, '').trim() || '';
        res.status(200).json({ sql: sqlQuery });
        break;
      }

      case 'aiChat': {
         if (!naturalLanguagePrompt || !clientSchema) {
          res.status(400).json({ error: 'Prompt and schema are required' });
          return;
        }
        const chatSchemaString = formatSchemaForAI(clientSchema);
        const chatLearningContext = clientContext || await getLearningContextFromFirebase();
        const chatModel = 'gemini-3-pro-preview';
        const chatPrompt = `You are a helpful assistant for a database. Based on the provided schema and context, answer the user's question. If you need to query the database to answer, formulate the SQL query. Otherwise, answer directly. \n\n${chatSchemaString}\n\nContext:\n${chatLearningContext}\n\nQuestion: "${naturalLanguagePrompt}"\n\nAnswer:`;
        
        const chatResponse = await ai.models.generateContent({ model: chatModel, contents: chatPrompt });
        res.status(200).json({ answer: chatResponse.text });
        break;
      }

      case 'syncCustomersAndProducts': {
        const [custRes, prodRes] = await Promise.all([
          pool.request().query(`
            SELECT
              comp.comcode,
              comp.comname
            FROM comp
            WHERE
              comp.isuse <> '0'
            ORDER BY
              comp.comname;
          `),
          pool.request().query(`
            SELECT 
                p.barcode,
                IIF(p.spec IS NOT NULL AND p.spec <> '', CONCAT(p.descr, ' [', p.spec, ']'), p.descr) as name,
                p.cost AS costPrice, 
                p.price AS sellingPrice,
                p.saleprice AS salePrice, 
                p.saleend AS saleEndDate,
                c.comname
            FROM parts AS p
            LEFT JOIN comp AS c ON p.comcode = c.comcode
            WHERE p.isuse <> '0'
            ORDER BY p.descr;
          `)
        ]);
        res.status(200).json({
          customers: { recordset: custRes.recordset },
          products: { recordset: prodRes.recordset }
        });
        break;
      }

      case 'syncCustomers': {
        const customersResult = await pool.request().query(`
          SELECT
            comp.comcode,
            comp.comname
          FROM comp
          WHERE
            comp.isuse <> '0';
        `);
        res.status(200).json({ recordset: customersResult.recordset });
        break;
      }

      case 'syncProductsIncrementally': {
        const request = pool.request();
        if (lastSyncDate) {
            request.input('lastSyncDate', sql.Date, new Date(lastSyncDate));
        }
        const incrementalQuery = `
          SELECT 
              p.barcode,
              IIF(p.spec IS NOT NULL AND p.spec <> '', CONCAT(p.descr, ' [', p.spec, ']'), p.descr) as name,
              p.cost AS costPrice, 
              p.price AS sellingPrice,
              p.saleprice AS salePrice, 
              p.saleend AS saleEndDate,
              c.comname,
              p.isuse
          FROM parts AS p
          LEFT JOIN comp AS c ON p.comcode = c.comcode
          ${lastSyncDate ? 'WHERE p.upday1 >= @lastSyncDate' : ''}
          ORDER BY p.upday1;
        `;
        const incResult = await request.query(incrementalQuery);
        res.status(200).json({ recordset: incResult.recordset });
        break;
      }

      default: {
        res.status(400).json({ error: 'Invalid request type' });
        break;
      }
    }
  } catch (err: any) {
    console.error(`Error processing request type "${type}":`, err);
    res.status(500).json({ error: 'An internal server error occurred', details: err.message });
  } finally {
    if (pool) {
        try {
            await pool.close();
        } catch (e) {
            console.error("Error closing SQL pool", e);
        }
    }
  }
}
