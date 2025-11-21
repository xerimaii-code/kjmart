// api/sql.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from 'mssql';
import { GoogleGenAI } from '@google/genai';
import { getDatabase, ref, get } from 'firebase/database';
// FIX: The 'App' type is not exported from 'firebase/app'. Use 'FirebaseApp' instead.
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
// FIX: The 'App' type is not exported from 'firebase/app'. Use 'FirebaseApp' instead.
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

// Helper to get DB Schema for AI context
async function getDbSchema(pool: sql.ConnectionPool, tables: string[] = []): Promise<string> {
    let schema = 'Database Schema:\n';
    let tablesToQuery = tables;

    if (tablesToQuery.length === 0) {
        const tableResult = await pool.request().query(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'`);
        tablesToQuery = tableResult.recordset.map((row: any) => row.TABLE_NAME);
    }

    for (const tableName of tablesToQuery) {
        try {
            const columnResult = await pool.request().query(`
                SELECT COLUMN_NAME, DATA_TYPE 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = '${tableName}'
            `);
            schema += `Table: ${tableName}\nColumns:\n`;
            columnResult.recordset.forEach((col: any) => {
                schema += `  - ${col.COLUMN_NAME} (${col.DATA_TYPE})\n`;
            });
        } catch (err) {
            console.warn(`Could not get schema for table ${tableName}:`, err);
        }
    }
    return schema;
}

// Main API handler
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { type, query, naturalLanguagePrompt, selectedTables, context } = req.body;
  let pool: sql.ConnectionPool | undefined;
  
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

      case 'naturalLanguageToSql':
        if (!naturalLanguagePrompt) {
          return res.status(400).json({ error: 'Natural language prompt is required' });
        }
        
        // Fetch schema and learning context
        const schema = await getDbSchema(pool, selectedTables);
        
        let learningContext = 'No additional context provided.';
        try {
          const snapshot = await get(ref(firebaseDb, 'learning/sqlContext'));
          if (snapshot.exists()) {
            learningContext = snapshot.val();
          }
        } catch (fbError) {
          console.warn('Could not fetch learning context from Firebase:', fbError);
        }

        const prompt = `
          You are an expert T-SQL assistant. Based on the provided database schema and additional context, convert the user's natural language request into a valid T-SQL query.

          **Database Schema:**
          ${schema}

          **Additional Context/Instructions:**
          ${learningContext}
          
          **User's Request:**
          "${naturalLanguagePrompt}"

          **Instructions:**
          1.  Generate ONLY the T-SQL query. Do not include any explanation, comments, or markdown formatting.
          2.  If the user's request is ambiguous, make a reasonable assumption based on the schema and context.
          3.  If a query cannot be formed, return an empty response.
          4.  If specific tables are mentioned in the schema, prioritize using them in your query.
        `;

        const geminiResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
        });

        const generatedSql = geminiResponse.text?.trim() || '';
        res.status(200).json({ sql: generatedSql });
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