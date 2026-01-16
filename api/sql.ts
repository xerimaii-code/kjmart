
// api/sql.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from 'mssql';
import { GoogleGenAI } from '@google/genai';

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
  connectionTimeout: 30000,
  requestTimeout: 30000,
};

let pool: sql.ConnectionPool | undefined;
let connectingPromise: Promise<sql.ConnectionPool> | null = null;

async function getPool(): Promise<sql.ConnectionPool> {
    if (pool && pool.connected) return pool;
    if (connectingPromise) return connectingPromise;

    connectingPromise = (async () => {
        try {
            if (pool) await pool.close();
            const newPool = new sql.ConnectionPool(config);
            await newPool.connect();
            pool = newPool;
            connectingPromise = null;
            return pool;
        } catch (err) {
            connectingPromise = null;
            throw err;
        }
    })();
    return connectingPromise;
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { type, query, params, userQuery, naturalLanguagePrompt, lastSyncDate, schema, context, userCurrentDate, searchTerm, limit } = req.body;

    try {
        if (type === 'connect') {
            await getPool();
            return res.status(200).json({ success: true, message: 'Connected.' });
        }

        if (type === 'naturalLanguageToSql') {
            const prompt = `Based on the following MS-SQL schema and context, write a T-SQL query. Current Date: ${userCurrentDate}. Schema: ${JSON.stringify(schema)}. Context: ${context}. Request: "${naturalLanguagePrompt}". Respond with raw SQL only.`;
            const response = await ai.models.generateContent({ model: 'gemini-3-pro-preview', contents: prompt });
            return res.status(200).json({ sql: response.text?.replace(/```sql|```/g, '').trim() });
        }

        if (type === 'aiChat') {
            const prompt = `You are a helpful database assistant for KJ Mart. Current Date: ${userCurrentDate}. Schema: ${JSON.stringify(schema)}. Context: ${context}. User Request: "${naturalLanguagePrompt}". Provide a clear and concise explanation or answer based on the data structure provided.`;
            const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt });
            return res.status(200).json({ answer: response.text });
        }

        const activePool = await getPool();
        const request = activePool.request();

        if (params && typeof params === 'object') {
            for (const key in params) {
                const val = params[key];
                if (typeof val === 'number') {
                    if (Number.isInteger(val)) request.input(key, sql.Int, val);
                    else request.input(key, sql.Decimal(18, 4), val);
                } else if (val instanceof Date) {
                    request.input(key, sql.DateTime, val);
                } else if (typeof val === 'string') {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) request.input(key, sql.VarChar(10), val);
                    else request.input(key, sql.NVarChar, val);
                } else {
                    request.input(key, sql.NVarChar, val);
                }
            }
        }

        let finalQuery = userQuery || query;
        
        if (type === 'getDatabaseSchema') {
            finalQuery = "SELECT t.TABLE_NAME as tableName, c.COLUMN_NAME as columnName, c.DATA_TYPE as dataType FROM INFORMATION_SCHEMA.TABLES t JOIN INFORMATION_SCHEMA.COLUMNS c ON t.TABLE_NAME = c.TABLE_NAME WHERE t.TABLE_TYPE = 'BASE TABLE' ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION";
        } else if (type === 'syncCustomers') {
            finalQuery = "SELECT comcode, comname FROM comp WITH(NOLOCK) WHERE isuse <> '0'";
        } else if (type === 'syncProductsIncrementally') {
            request.input('lastDate', sql.VarChar, lastSyncDate || '1900-01-01');
            finalQuery = "SELECT barcode, descr, spec, money0vat, money1, comcode, gubun1, gubun2, gubun3, curjago AS [재고수량], isuse, ispack, upday1 FROM parts WITH(NOLOCK) WHERE upday1 >= @lastDate";
        } else if (type === 'searchProductsOnline' || type === 'searchProductsForEdit') {
            const kw = searchTerm || '';
            request.input('kw', sql.NVarChar, kw);
            request.input('kwLike', sql.NVarChar, `%${kw}%`);
            
            // [통합 상품조회 쿼리 - 행사정보 sale_ready 조인 포함]
            // 모든 필요 필드 (대분류, 과세, 사용유무 등)를 명시적으로 SELECT
            // 중요: 매퍼가 인식할 수 있도록 gubun1, gubun2 등을 별칭 없이(또는 영문으로) 반환해야 함.
            finalQuery = `
                DECLARE @Today VARCHAR(10) = CONVERT(VARCHAR(10), GETDATE(), 120);

                SELECT TOP 50
                      p.barcode AS [바코드],
                      p.descr AS [상품명],
                      p.spec AS [규격],
                      p.isvat AS [과세여부],
                      p.money0vat AS [매입가],
                      p.money1 AS [판매가],
                      ISNULL(p.curjago, 0) AS [재고수량],
                      CASE WHEN p.ispack = '1' THEN '묶음' ELSE '일반' END AS [BOM여부],
                      CASE WHEN s.barcode IS NOT NULL THEN 'Y' ELSE 'N' END AS [행사유무],
                      ISNULL(s.salemoney0, 0) AS [행사매입가],
                      ISNULL(s.salemoney1, 0) AS [행사판매가],
                      ISNULL(m.salename, '') AS [행사명],
                      m.startday AS [행사시작일],
                      m.endday AS [행사종료일],
                      p.comcode AS [거래처코드],
                      ISNULL(c.comname, '') AS [거래처명],
                      p.gubun1,
                      p.gubun2,
                      p.gubun3,
                      p.isuse AS [사용유무],
                      p.ispoint AS [포인트적립],
                      p.isjago AS [재고관리],
                      p.ispack
                FROM parts AS p WITH(NOLOCK)
                LEFT JOIN comp AS c WITH(NOLOCK) ON p.comcode = c.comcode
                LEFT JOIN sale_ready AS s WITH(NOLOCK) ON p.barcode = s.barcode AND s.isappl = '1'
                LEFT JOIN sale_mast AS m WITH(NOLOCK) ON s.junno = m.junno AND m.isappl = '1' AND (@Today BETWEEN m.startday AND m.endday)
                WHERE p.barcode = @kw OR p.descr LIKE @kwLike
                ORDER BY (CASE WHEN p.barcode = @kw THEN 0 ELSE 1 END), p.descr
            `;
        }

        if (!finalQuery) return res.status(400).json({ error: 'No query provided' });

        const result = await request.query(finalQuery);
        return res.status(200).json({ recordset: result.recordset, rowsAffected: result.rowsAffected });

    } catch (err: any) {
        console.error('[API_ERROR]', err.message);
        res.status(500).json({ error: err.message });
    }
}
