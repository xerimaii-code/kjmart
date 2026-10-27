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

    const { type, name, query, params, userQuery, naturalLanguagePrompt, lastSyncDate, schema, context, userCurrentDate, searchTerm, limit } = req.body;

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

        if (type === 'syncCategories') {
            const [r1, r2, r3] = await Promise.all([
                activePool.request().query("SELECT gubun1, gubun1x FROM gubun1 WITH(NOLOCK) WHERE isuse <> '0'"),
                activePool.request().query("SELECT gubun1, gubun2, gubun2x FROM gubun2 WITH(NOLOCK) WHERE isuse <> '0'"),
                activePool.request().query("SELECT gubun1, gubun2, gubun3, gubun3x FROM gubun3 WITH(NOLOCK) WHERE isuse <> '0'"),
            ]);
            return res.status(200).json({
                gubun1: { recordset: r1.recordset },
                gubun2: { recordset: r2.recordset },
                gubun3: { recordset: r3.recordset },
            });
        }

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
        } else if (type === 'syncCustomers' || (type === 'executeUserQuery' && !finalQuery && name === 'getSuppliers')) {
            finalQuery = "SELECT comcode, comname FROM comp WITH(NOLOCK) WHERE isuse <> '0'";
        } else if (type === 'syncBOM') {
            finalQuery = "SELECT parebar AS pcode, childbar AS ccode, childcount AS qty, childcount FROM bom WITH(NOLOCK)";
        } else if (type === 'syncProductsIncrementally') {
            request.input('lastDate', sql.VarChar, lastSyncDate || '1900-01-01');
            // [단일화된 통합 상품 마스터 동기화 쿼리 - OUTER APPLY 인덱스 최적화]
            // 온라인 조회(searchProductsOnline)와 100% 동일한 스키마로 반환하며,
            // 중복 행사 등록 시에도 상품당 1행만 보장하고 인덱스 Seek로 빠르게 조회합니다.
            finalQuery = `
                DECLARE @Today VARCHAR(10) = CONVERT(VARCHAR(10), GETDATE(), 120);

                SELECT
                      p.barcode AS [바코드],
                      p.descr AS [상품명],
                      p.spec AS [규격],
                      p.isvat AS [과세여부],
                      p.money0vat AS [매입가],
                      p.money1 AS [판매가],
                      ISNULL(p.curjago, 0) AS [재고수량],
                      CASE WHEN p.ispack = '1' THEN '묶음' ELSE '일반' END AS [BOM여부],
                      CASE WHEN ev.junno IS NOT NULL THEN 'Y' ELSE 'N' END AS [행사유무],
                      ISNULL(ev.salemoney0, 0) AS [행사매입가],
                      ISNULL(ev.salemoney1, 0) AS [행사판매가],
                      ISNULL(ev.salename, '') AS [행사명],
                      ev.startday AS [행사시작일],
                      ev.endday AS [행사종료일],
                      p.comcode AS [거래처코드],
                      ISNULL(c.comname, '') AS [거래처명],
                      p.gubun1,
                      p.gubun2,
                      p.gubun3,
                      p.isuse AS [사용유무],
                      p.ispoint AS [포인트적립],
                      p.isjago AS [재고관리],
                      p.ispack,
                      p.upday1
                FROM parts AS p WITH(NOLOCK)
                LEFT JOIN comp AS c WITH(NOLOCK) ON p.comcode = c.comcode
                OUTER APPLY (
                    SELECT TOP 1
                        s.salemoney0,
                        s.salemoney1,
                        m.junno,
                        m.salename,
                        m.startday,
                        m.endday
                    FROM sale_ready AS s WITH(NOLOCK)
                    INNER JOIN sale_mast AS m WITH(NOLOCK) ON s.junno = m.junno
                    WHERE s.barcode = p.barcode
                      AND s.isappl = '1'
                      AND m.isappl = '1'
                      AND (@Today BETWEEN m.startday AND m.endday)
                    ORDER BY m.endday DESC, m.startday DESC, m.junno DESC
                ) AS ev
                WHERE (@lastDate = '1900-01-01' AND p.isuse <> '0')
                   OR (@lastDate <> '1900-01-01' AND (
                        p.upday1 >= @lastDate
                        OR EXISTS (
                            SELECT 1
                            FROM sale_ready AS s2 WITH(NOLOCK)
                            INNER JOIN sale_mast AS m2 WITH(NOLOCK) ON s2.junno = m2.junno
                            WHERE s2.barcode = p.barcode
                              AND (m2.startday >= @lastDate OR s2.inpday >= @lastDate)
                        )
                   ))
            `;
        } else if (type === 'searchProductsOnline' || type === 'searchProductsForEdit') {
            const kw = searchTerm || '';
            const topLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
            request.input('kw', sql.NVarChar, kw);
            request.input('kwLike', sql.NVarChar, `%${kw}%`);
            
            // [통합 상품조회 쿼리 - OUTER APPLY 인덱스 최적화]
            // 전체 sale_ready 테이블 조인 대신 검색된 상위 50개 상품에 대해서만 인덱스로 최신 진행 행사를 즉시 결합합니다.
            finalQuery = `
                DECLARE @Today VARCHAR(10) = CONVERT(VARCHAR(10), GETDATE(), 120);

                SELECT TOP (${topLimit})
                      p.barcode AS [바코드],
                      p.descr AS [상품명],
                      p.spec AS [규격],
                      p.isvat AS [과세여부],
                      p.money0vat AS [매입가],
                      p.money1 AS [판매가],
                      ISNULL(p.curjago, 0) AS [재고수량],
                      CASE WHEN p.ispack = '1' THEN '묶음' ELSE '일반' END AS [BOM여부],
                      CASE WHEN ev.junno IS NOT NULL THEN 'Y' ELSE 'N' END AS [행사유무],
                      ISNULL(ev.salemoney0, 0) AS [행사매입가],
                      ISNULL(ev.salemoney1, 0) AS [행사판매가],
                      ISNULL(ev.salename, '') AS [행사명],
                      ev.startday AS [행사시작일],
                      ev.endday AS [행사종료일],
                      p.comcode AS [거래처코드],
                      ISNULL(c.comname, '') AS [거래처명],
                      p.gubun1,
                      p.gubun2,
                      p.gubun3,
                      p.isuse AS [사용유무],
                      p.ispoint AS [포인트적립],
                      p.isjago AS [재고관리],
                      p.ispack,
                      p.upday1
                FROM parts AS p WITH(NOLOCK)
                LEFT JOIN comp AS c WITH(NOLOCK) ON p.comcode = c.comcode
                OUTER APPLY (
                    SELECT TOP 1
                        s.salemoney0,
                        s.salemoney1,
                        m.junno,
                        m.salename,
                        m.startday,
                        m.endday
                    FROM sale_ready AS s WITH(NOLOCK)
                    INNER JOIN sale_mast AS m WITH(NOLOCK) ON s.junno = m.junno
                    WHERE s.barcode = p.barcode
                      AND s.isappl = '1'
                      AND m.isappl = '1'
                      AND (@Today BETWEEN m.startday AND m.endday)
                    ORDER BY m.endday DESC, m.startday DESC, m.junno DESC
                ) AS ev
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
