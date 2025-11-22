// api/sql.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from 'mssql';

// NOTE: All complex functionalities are temporarily disabled to diagnose the Vercel build issue.
// The goal is to get a minimal server running that only tests the connection.

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
  requestTimeout: 15000, // Reduced for faster connection test feedback
};

let pool: sql.ConnectionPool | undefined;

async function getPool(): Promise<sql.ConnectionPool> {
    if (pool && pool.connected) {
        return pool;
    }
    // If a pool exists but is not connected, close it before creating a new one.
    if (pool) {
        await pool.close();
        pool = undefined;
    }
    try {
        pool = new sql.ConnectionPool(config);
        await pool.connect();
        return pool;
    } catch (err) {
        pool = undefined; // Reset on failure
        console.error("Connection Pool Error:", err);
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
        await getPool();
        res.status(200).json({ success: true, message: 'Connection successful' });
        break;

      // All other types are disabled for this diagnostic step.
      default:
        res.status(404).json({ error: `Request type '${type}' is temporarily disabled for diagnostics.` });
        break;
    }
  } catch (err: any) {
    // This will catch connection errors from getPool() in the 'connect' case.
    console.error(`Error processing request type "${type}":`, err);
    res.status(500).json({ error: 'An internal server error occurred', details: err.message });
  }
}
