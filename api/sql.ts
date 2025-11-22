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
        console.log('Creating new SQL Connection Pool with config:', {
            server: config.server,
            port: config.port,
            user: config.user,
            database: config.database,
            encrypt: config.options?.encrypt
        });
        pool = new sql.ConnectionPool(config);
        await pool.connect();
        console.log("New SQL Connection Pool created and connected.");
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

      case 'getTables':
        const tablesResult = await currentPool.request().query(`
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_TYPE = 'BASE TABLE' 
            ORDER BY TABLE_NAME
        `);
        res.status(200).json(tablesResult.recordset.map((row: any) => row.TABLE_NAME));
