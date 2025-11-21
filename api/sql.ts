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

// Helper to get structured DB Schema for caching
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

// Helper to fetch context
async function getLearningContext(clientContext: string | undefined) {
    let learningContext = clientContext;
    // Fallback to fetch from Firebase if context is not provided by the client
    if (!learningContext) {
        try {
          const snapshot = await get(ref(firebaseDb, 'learning/sqlContext'));
          if (snapshot.exists()) {
            const data = snapshot.val();
            if (typeof data === 'string') {
                learningContext = data;
            } else if (typeof data === 'object' && data !== null) {
                // Handle new list-based learning context
                learningContext = Object.values(data).map((item: any) => `Title: ${item.title}\nContent: ${item.content}`).join('\n\n');
            }
          }
        } catch (fbError) {
          console.warn('Could not fetch learning context from Firebase:', fbError);
        }
    }
    return learningContext || 'No additional context provided.';
}


// Main API handler
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { type, query, naturalLanguagePrompt, schema: clientSchema, context: clientContext } = req.body;
  let pool: sql.ConnectionPool | undefined;
  
  // Log the connection details for debugging, excluding the password
  console.log('Attempting to connect to SQL Server with config:', {
    server: config.server,
    port: config.port,
    user: config.user,
    database: config.database,
    encrypt: config.options.encrypt
  });

  try {
    pool = new sql.ConnectionPool(config);
    await pool.connect();
  } catch (err: any) {
    console.error('SQL Connection Error:', err);
    return res.status(500).json({ error: 'Database connection failed', details: err.message });
  }
  
  try {
    switch (type) {
      case 'connect':
        res.status(200).json({ success: true, message: 'Connection successful' });
        break;

      case 'getTables':
        const tablesResult = await pool.request().query(`
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_TYPE = 'BASE TABLE' 
            ORDER BY TABLE_NAME
        `);
        res.status(200).json(tablesResult.recordset.map((row: any) => row.TABLE_NAME));
        break;

      case 'getDatabaseSchema':
        const fullSchema = await getFullDbSchema(pool);
        res.status(200).json(fullSchema);
        break;

      case 'query':
        if (!query || typeof query !== 'string') {
          return res.status(400).json({ error: 'Query is required' });
        }
        const result = await pool.request().query(query);
        res.status(200).json({
          recordset: result.recordset,
          rowsAffected: result.rowsAffected[0],
        });
        break;
      
      case 'syncAllData':
        const syncQuery = `
            SELECT
                LTRIM(RTRIM(c.comcode)) AS comcode,
                LTRIM(RTRIM(c.comname)) AS comname,
                LTRIM(RTRIM(p.barcode)) AS barcode,
                LTRIM(RTRIM(CASE WHEN p.spec IS NOT NULL AND p.spec <> '' THEN p.descr + ' ' + '[' + p.spec + ']' ELSE p.descr END)) AS name,
                p.money0vat AS costPrice,
                p.money1 AS sellingPrice,
                p.salemoney0 AS salePrice,
                p.saleendday AS saleEndDate
            FROM
                comp AS c
            INNER JOIN
                parts AS p ON c.comcode = p.comcode
            WHERE
                (
                    (
                        c.comname NOT LIKE '%야채%'
                    AND c.comname NOT LIKE '%과일%'
                    AND c.comname NOT LIKE '%생선%'
                    AND c.comname NOT LIKE '%정육%'
                    AND c.comname NOT LIKE '%식품%'
                    AND c.comname NOT LIKE '%비식품%'
                    AND c.comname NOT LIKE '%기획%'
                    AND c.comname NOT LIKE '%경진청과%'
                    )
                AND p.barcode IS NOT NULL
                AND (CASE WHEN p.spec IS NOT NULL AND p.spec <> '' THEN p.descr + ' ' + '[' + p.spec + ']' ELSE p.descr END) NOT LIKE '%---%'
                AND p.money0vat <> 0
                AND p.isuse <> '0'
                )
            OR
                (p.barcode NOT LIKE '0000000%')
            ORDER BY
                CASE WHEN p.spec IS NOT NULL AND p.spec <> '' THEN p.descr + ' ' + '[' + p.spec + ']' ELSE p.descr END;
        `;
        const syncResult = await pool.request().query(syncQuery);
        res.status(200).json(syncResult.recordset);
        break;

      case 'naturalLanguageToSql':
        if (!naturalLanguagePrompt) {
          return res.status(400).json({ error: 'Natural language prompt is required' });
        }
        
        const schemaString = formatSchemaForAI(clientSchema || {});
        const learningContext = await getLearningContext(clientContext);

        const prompt = `
          You are an expert T-SQL assistant. Based on the provided database schema and additional context, convert the user's natural language request into a valid T-SQL query.

          **Database Schema:**
          ${schemaString || 'No schema provided. Make your best guess.'}

          **Additional Context/Instructions:**
          ${learningContext}
          
          **User's Request:**
          "${naturalLanguagePrompt}"

          **Instructions:**
          1.  Generate ONLY the T-SQL query. Do not include any explanation, comments, or markdown formatting.
          2.  If the user's request is ambiguous, make a reasonable assumption based on the schema and context.
          3.  If a query cannot be formed, return an empty response.
        `;

        const geminiResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
        });

        const generatedSql = geminiResponse.text?.trim().replace(/```sql|```/g, '') || '';
        res.status(200).json({ sql: generatedSql });
        break;

      case 'aiChat':
        if (!naturalLanguagePrompt) {
          return res.status(400).json({ error: 'Prompt is required' });
        }
        const chatSchemaString = formatSchemaForAI(clientSchema || {});
        const chatContext = await getLearningContext(clientContext);
        
        const chatPrompt = `
          You are a helpful database assistant. Answer the user's question based on the provided database schema and context.
          
          **Database Schema:**
          ${chatSchemaString}
          
          **Context:**
          ${chatContext}
          
          **User Question:**
          "${naturalLanguagePrompt}"
          
          Provide a clear, concise text answer. You can explain table structures, relationships, or suggest how to query data, but provide a descriptive answer, not just code.
        `;
        
        const chatResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: chatPrompt,
        });
        
        res.status(200).json({ answer: chatResponse.text });
        break;

      default:
        res.status(400).json({ error: 'Invalid request type' });
    }
  } catch (err: any) {
    console.error('API Error:', err);
    res.status(500).json({ error: 'An error occurred while processing the request', details: err.message });
  } finally {
    if (pool) {
      await pool.close();
    }
  }
}