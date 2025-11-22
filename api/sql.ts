// api/sql.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from 'mssql';

// NOTE: All complex functionalities (Firebase, AI, complex queries) are temporarily disabled
// to diagnose the Vercel build issue. The goal is to get a minimal server running.

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

let pool: sql.ConnectionPool | undefined;
async function getPool(): Promise<sql.ConnectionPool> {
    if (pool && pool.connected) {
        return pool;
    }
    try {
        pool = new sql.ConnectionPool(config);
        await pool.connect();
        return pool;
    } catch (err) {
        pool = undefined; // Reset on failure
        throw err;
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { type } = req.body;
  
  try {
    switch (type) {
      case 'connect':
        // Attempt to get a connection to test credentials and connectivity.
        // This will throw if it fails, which will be caught below.
        await getPool();
        res.status(200).json({ success: true, message: 'Connection successful' });
        break;

      default:
        // For any other request type during this diagnostic phase, return a clear message.
        res.status(404).json({ error: `Request type '${type}' is temporarily disabled for diagnostics.` });
        break;
    }
  } catch (err: any) {
    // This will catch connection errors from getPool() in the 'connect' case.
    console.error(`Error processing request type "${type}":`, err);
    res.status(500).json({ error: 'An internal server error occurred', details: err.message });
  }
}