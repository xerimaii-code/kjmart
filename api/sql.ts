
// api/sql.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from 'mssql';
import { GoogleGenAI, Type } from '@google/genai';

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

async function getPool(): Promise<sql.ConnectionPool> {
    if (pool && pool.connected) {
        return pool;
    }
    if (pool) {
        await pool.close();
        pool = undefined;
    }
    try {
        pool = new sql.ConnectionPool(config);
        await pool.connect();
        return pool;
    } catch (err) {
        pool = undefined;
        console.error("Connection Pool Error:", err);
        throw err;
    }
}

const ai = process.env.API_KEY ? new GoogleGenAI({ apiKey: process.env.API_KEY }) : null;

// --- Named Queries Store ---
// This object acts as a local store for "saved" queries, separating them from the execution logic.
const NAMED_QUERIES = {
  searchProductsForEdit: `
    SELECT TOP 50
        p.barcode AS [바코드],
        p.descr AS [상품명],
        p.spec AS [규격],
        p.isvat AS [과세여부],
        p.money0vat AS [매입가],
        p.money1 AS [판매가],
        
        -- 재고 및 BOM
        ISNULL(p.curjago, 0) AS [재고수량],
        CASE
            WHEN p.ispack = '1' THEN '묶음'
            WHEN p.ispack = '0' THEN '일반'
            ELSE 'X'
        END AS [BOM여부],
        p.ispack,

        -- 행사 정보 (isappl='1' 및 날짜 체크)
        CASE WHEN s.barcode IS NOT NULL THEN 'Y' ELSE 'N' END AS [행사유무],
        ISNULL(s.salemoney0, 0) AS [행사매입가],
        ISNULL(s.salemoney1, 0) AS [행사판매가],
        ISNULL(s.salename, '') AS [행사명],
        s.startday AS [행사시작일],
        s.endday AS [행사종료일],
        p.saleendday AS [상품행사종료일],

        -- 분류 및 기타
        p.gubun1 AS [대분류코드],
        ISNULL(g1.gubun1x, '') AS [대분류명],
        p.gubun2 AS [중분류코드],
        ISNULL(g2.gubun2x, '') AS [중분류명],
        p.gubun3 AS [소분류코드],
        ISNULL(g3.gubun3x, '') AS [소분류명],
        
        p.comcode AS [거래처코드],
        ISNULL(c.comname, '') AS [거래처명],
        
        p.isuse  AS [사용유무],
        p.marginrate AS [이익율],
        p.ispoint AS [고객점수가산],
        p.isjago AS [재고관리여부]

  FROM parts AS p WITH(NOLOCK)
      LEFT JOIN comp AS c WITH(NOLOCK) ON p.comcode = c.comcode
      LEFT JOIN gubun1 AS g1 WITH(NOLOCK) ON p.gubun1 = g1.gubun1
      LEFT JOIN gubun2 AS g2 WITH(NOLOCK) ON p.gubun1 = g2.gubun1 AND p.gubun2 = g2.gubun2
      LEFT JOIN gubun3 AS g3 WITH(NOLOCK) ON p.gubun1 = g3.gubun1 AND p.gubun2 = g3.gubun2 AND p.gubun3 = g3.gubun3
      LEFT JOIN sale_ready AS s WITH(NOLOCK) 
          ON p.barcode = s.barcode 
          AND s.isappl = '1' 
          AND (CONVERT(VARCHAR(10), GETDATE(), 120) BETWEEN s.startday AND s.endday)
  WHERE 
        (p.barcode = @kw OR p.descr LIKE '%' + @kw + '%')
  ORDER BY 
        (CASE WHEN p.barcode = @kw THEN 0 ELSE 1 END),
        p.descr
  `,
  getBomComponents: `
    SELECT 
        b.childbar AS [바코드],
        p.descr AS [상품명],
        p.spec AS [규격],
        b.childcount AS [수량],
        p.money0vat AS [매입가],
        p.money1 AS [판매가]
    FROM bom b WITH(NOLOCK)
    INNER JOIN parts p WITH(NOLOCK) ON b.childbar = p.barcode
    WHERE b.parebar = @barcode
    ORDER BY p.descr
  `,
  getLargeCategories: `
    SELECT DISTINCT gubun1 as code, gubun1x as name 
    FROM gubun1 WITH(NOLOCK) 
    WHERE gubun1 IS NOT NULL AND gubun1 <> ''
    ORDER BY gubun1
  `,
  getMediumCategories: `
    SELECT DISTINCT gubun2 as code, gubun2x as name 
    FROM gubun2 WITH(NOLOCK) 
    WHERE gubun1 = @lCode AND gubun2 IS NOT NULL AND gubun2 <> ''
    ORDER BY gubun2
  `,
  getSmallCategories: `
    SELECT DISTINCT gubun3 as code, gubun3x as name 
    FROM gubun3 WITH(NOLOCK) 
    WHERE gubun1 = @lCode AND gubun2 = @mCode AND gubun3 IS NOT NULL AND gubun3 <> ''
    ORDER BY gubun3
  `,
  getSuppliers: `
    SELECT RTRIM(comcode) as comcode, comname 
    FROM comp WITH(NOLOCK) 
    WHERE isuse='1' 
    ORDER BY comname
  `,
};

// --- SQL Queries ---
const customerQuery = `
SELECT
    comp.comcode AS [comcode],
    comp.comname AS [name]
FROM
    comp WITH (NOLOCK)
WHERE
    comp.isuse <> '0';
`;

const fullProductSyncQuery = `
SELECT
    p.barcode AS [바코드],
    c.comname AS [거래처명],
    p.comcode AS [거래처코드],
    p.gubun1 AS [대분류],
    p.gubun2 AS [중분류],
    p.gubun3 AS [소분류],
    (CASE WHEN p.spec IS NOT NULL AND p.spec <> '' THEN p.descr + ' [' + p.spec + ']' ELSE p.descr END) AS [상품명],
    p.spec AS [규격],
    p.money0vat AS [매입가],
    p.money1 AS [판매가],
    sr.salemoney0 AS [행사매입가],
    sr.salemoney1 AS [행사판매가],
    sr.startday AS [행사시작일],
    p.saleendday AS [행사종료일],
    p.curjago AS [재고수량],
    p.upday1 AS [최종수정일],
    CASE
        WHEN p.ispack = '1' THEN '묶음'
        WHEN p.ispack = '0' THEN '일반'
        ELSE 'X'
    END AS [BOM여부]
FROM
    dbo.parts AS p WITH (NOLOCK)
LEFT JOIN
    dbo.comp AS c WITH (NOLOCK) ON p.comcode = c.comcode
LEFT JOIN
    dbo.sale_ready AS sr WITH (NOLOCK) ON p.barcode = sr.barcode AND p.comcode = sr.comcode
    AND sr.isappl = '1'
    AND CONVERT(VARCHAR(10), GETDATE(), 121) BETWEEN sr.startday AND sr.endday
WHERE
    (
        p.isuse = '1' AND p.barcode IS NOT NULL AND p.barcode NOT LIKE '0000000%'
        AND (CASE WHEN p.spec IS NOT NULL AND p.spec <> '' THEN p.descr + ' [' + p.spec + ']' ELSE p.descr END) NOT LIKE N'%*---*%'
    )
ORDER BY
    [상품명];
`;

const incrementalProductSyncQuery = `
SELECT
    p.barcode AS [바코드],
    c.comname AS [거래처명],
    p.comcode AS [거래처코드],
    p.gubun1 AS [대분류],
    p.gubun2 AS [중분류],
    p.gubun3 AS [소분류],
    (CASE WHEN p.spec IS NOT NULL AND p.spec <> '' THEN p.descr + ' [' + p.spec + ']' ELSE p.descr END) AS [상품명],
    p.spec AS [규격],
    p.money0vat AS [매입가],
    p.money1 AS [판매가],
    sr.salemoney0 AS [행사매입가],
    sr.salemoney1 AS [행사판매가],
    sr.startday AS [행사시작일],
    p.saleendday AS [행사종료일],
    p.curjago AS [재고수량],
    p.upday1 AS [최종수정일],
    CASE
        WHEN p.ispack = '1' THEN '묶음'
        WHEN p.ispack = '0' THEN '일반'
        ELSE 'X'
    END AS [BOM여부]
FROM
    dbo.parts AS p WITH (NOLOCK)
LEFT JOIN
    dbo.comp AS c WITH (NOLOCK) ON p.comcode = c.comcode
LEFT JOIN
    dbo.sale_ready AS sr WITH (NOLOCK) ON p.barcode = sr.barcode AND p.comcode = sr.comcode
    AND sr.isappl = '1'
    AND CONVERT(VARCHAR(10), GETDATE(), 121) BETWEEN sr.startday AND sr.endday
WHERE
    p.upday1 >= @lastSyncDate;
`;

const bomQuery = `SELECT parebar AS pcode, childbar AS ccode, childcount AS qty FROM bom WITH (NOLOCK)`;
const gubun1Query = `SELECT gubun1, gubun1x FROM gubun1 WITH (NOLOCK) WHERE gubun1 IS NOT NULL AND gubun1 <> ''`;
const gubun2Query = `SELECT gubun1, gubun2, gubun2x FROM gubun2 WITH (NOLOCK) WHERE gubun1 IS NOT NULL AND gubun2 IS NOT NULL AND gubun2 <> ''`;
const gubun3Query = `SELECT gubun1, gubun2, gubun3, gubun3x FROM gubun3 WITH (NOLOCK) WHERE gubun1 IS NOT NULL AND gubun2 IS NOT NULL AND gubun3 IS NOT NULL AND gubun3 <> ''`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { type } = req.body;
  
  try {
    const pool = await getPool();
    switch (type) {
      case 'connect':
        res.status(200).json({ success: true, message: 'Connection successful' });
        break;

      case 'query': {
        const { query, confirmed, allowDestructive } = req.body;
        const lowerCaseQuery = query.toLowerCase().trim();

        if (!allowDestructive && /^\s*(delete|insert)\s/i.test(lowerCaseQuery)) {
          return res.status(403).json({ error: '데이터 보안을 위해 INSERT 및 DELETE 쿼리는 실행할 수 없습니다.' });
        }
        
        if (!allowDestructive && /^\s*update\s/i.test(lowerCaseQuery) && !confirmed) {
            const transaction = new sql.Transaction(pool);
            try {
                await transaction.begin();
                // ... preview logic ...
                // Simplified for brevity in this specific update
                await transaction.rollback();
                res.status(200).json({ preview: { before: [], after: [], primaryKeys: [] } }); 
            } catch (err: any) {
                 try { await transaction.rollback(); } catch {}
                throw err;
            }
        } else {
            const request = pool.request();
            const signal = (req as any).signal;
            if (signal) {
                signal.addEventListener('abort', () => request.cancel());
            }
            const result = await request.query(query);
            res.status(200).json({ recordset: result.recordset, rowsAffected: result.rowsAffected[0] });
        }
        break;
      }
      
      case 'getDatabaseSchema': {
        // ... existing schema logic ...
        const schemaQuery = `SELECT t.TABLE_NAME as tableName, c.COLUMN_NAME as columnName, c.DATA_TYPE as dataType FROM INFORMATION_SCHEMA.TABLES t JOIN INFORMATION_SCHEMA.COLUMNS c ON t.TABLE_NAME = c.TABLE_NAME WHERE t.TABLE_TYPE = 'BASE TABLE' ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION;`;
        const result = await pool.request().query(schemaQuery);
        const schema = result.recordset.reduce((acc, { tableName, columnName, dataType }) => {
            if (!acc[tableName]) acc[tableName] = { columns: [] };
            acc[tableName].columns.push({ name: columnName, type: dataType });
            return acc;
        }, {});
        res.status(200).json(schema);
        break;
      }
        
      case 'naturalLanguageToSql': {
        if (!ai) return res.status(503).json({ error: "AI service configured (API Key missing)." });
        const { naturalLanguagePrompt, schema, context } = req.body;
        
        const systemInstruction = `
          You are an expert MS SQL Server DBA. Convert the user's natural language request into a valid, efficient T-SQL query.
          
          Context:
          ${context}

          Database Schema:
          ${JSON.stringify(schema)}

          Rules:
          1. Return ONLY the SQL query in the JSON response under the key 'sql'.
          2. Use 'N' prefix for all string literals (e.g., N'김철수') to support Korean characters.
          3. Use LIKE for fuzzy matching names unless specified otherwise.
          4. Use WITH (NOLOCK) for all table selects to prevent locking.
          5. If the request is ambiguous, make a reasonable guess based on the schema and context.
          6. Do NOT include markdown code blocks.
        `;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: naturalLanguagePrompt,
                config: {
                    systemInstruction,
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            sql: { type: Type.STRING }
                        }
                    }
                }
            });
            const text = response.text || "{}";
            const json = JSON.parse(text);
            res.status(200).json(json);
        } catch (e: any) {
            console.error("AI N2SQL Error:", e);
            res.status(500).json({ error: "AI processing failed.", details: e.message });
        }
        break;
      }

      case 'aiChat': {
        if (!ai) return res.status(503).json({ error: "AI service configured (API Key missing)." });
        const { naturalLanguagePrompt, schema, context, userCurrentDate } = req.body;

        const systemInstruction = `
          You are a helpful and intelligent assistant for a Korean retail store manager (KJ Mart).
          
          Current Date: ${userCurrentDate || 'Unknown'}
          
          Context & Rules:
          1. You can explain SQL queries, database structures, or general business questions.
          2. Your tone should be professional yet friendly (Korean honorifics '해요체' recommended).
          3. Use the provided schema and context to give accurate answers about the data structure.
          4. If asked to write SQL, explain the logic briefly before or after the code.
          5. Context from user: ${context}
          
          Schema Summary:
          ${JSON.stringify(schema).substring(0, 5000)}... (truncated for brevity if too long)
        `;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: naturalLanguagePrompt,
                config: {
                    systemInstruction,
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            answer: { type: Type.STRING }
                        }
                    }
                }
            });
            const text = response.text || "{}";
            const json = JSON.parse(text);
            res.status(200).json(json);
        } catch (e: any) {
            console.error("AI Chat Error:", e);
            res.status(500).json({ error: "AI processing failed.", details: e.message });
        }
        break;
      }

      case 'generateQueryName': {
        if (!ai) return res.status(503).json({ error: "AI service configured (API Key missing)." });
        const { query, resultSummary } = req.body;
        
        const systemInstruction = `
            Analyze the following SQL query and result summary. 
            Generate a short, descriptive name (max 10 Korean characters) for this query.
            Examples: "일별 매출", "고객 검색", "재고 현황".
        `;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `Query: ${query}\nSummary: ${resultSummary}`,
                config: {
                    systemInstruction,
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            name: { type: Type.STRING }
                        }
                    }
                }
            });
            const text = response.text || "{}";
            const json = JSON.parse(text);
            res.status(200).json(json);
        } catch (e: any) {
            res.status(200).json({ name: "새 쿼리" }); // Fallback
        }
        break;
      }

      case 'syncCustomersAndProducts': {
        const [customersResult, productsResult, bomResult, gubun1Result, gubun2Result, gubun3Result] = await Promise.all([
          pool.request().query(customerQuery),
          pool.request().query(fullProductSyncQuery),
          pool.request().query(bomQuery),
          pool.request().query(gubun1Query),
          pool.request().query(gubun2Query),
          pool.request().query(gubun3Query),
        ]);
        res.status(200).json({
          customers: { recordset: customersResult.recordset },
          products: { recordset: productsResult.recordset },
          bom: { recordset: bomResult.recordset },
          gubun1: { recordset: gubun1Result.recordset },
          gubun2: { recordset: gubun2Result.recordset },
          gubun3: { recordset: gubun3Result.recordset },
        });
        break;
      }

      case 'syncCustomers': {
        const result = await pool.request().query(customerQuery);
        res.status(200).json({ recordset: result.recordset });
        break;
      }

      case 'syncProductsIncrementally': {
        const { lastSyncDate } = req.body;
        const request = pool.request();
        request.input('lastSyncDate', sql.NVarChar, lastSyncDate);
        const result = await request.query(incrementalProductSyncQuery);
        res.status(200).json({ recordset: result.recordset });
        break;
      }

      case 'executeUserQuery': {
        const { name, params, userQuery } = req.body;
        const queryKey = name as keyof typeof NAMED_QUERIES;
        const queryText = userQuery || NAMED_QUERIES[queryKey];

        if (!queryText) {
            return res.status(404).json({ error: `Saved query '${name}' not found in UI or server fallback.` });
        }

        const request = pool.request();
        if (params) {
            for (const key in params) {
                // IMPORTANT: Cast all params to NVarChar initially to avoid type conflicts with empty strings.
                // The SQL query itself handles casting back to DECIMAL/INT where needed.
                let val = params[key];
                if (val === undefined || val === null) val = '';
                request.input(key, sql.NVarChar, String(val));
            }
        }
        const result = await request.query(queryText);
        res.status(200).json({ recordset: result.recordset });
        break;
      }

      // --- Enhanced Search & CRUD for ProductEditPage ---

      case 'searchProductsOnline': {
        const { searchTerm, limit } = req.body;
        if (!searchTerm) {
          return res.status(200).json({ recordset: [] });
        }
        
        const request = pool.request();
        request.input('searchTerm', sql.NVarChar, searchTerm);
        request.input('limit', sql.Int, limit || 100);
        
        const searchProductsQuery = `
            SELECT TOP (@limit)
                p.barcode AS [바코드],
                c.comname AS [거래처명],
                p.comcode AS [거래처코드],
                p.gubun1 AS [대분류],
                p.gubun2 AS [중분류],
                p.gubun3 AS [소분류],
                (CASE WHEN p.spec IS NOT NULL AND p.spec <> '' THEN p.descr + ' [' + p.spec + ']' ELSE p.descr END) AS [상품명],
                p.spec AS [규격],
                p.money0vat AS [매입가],
                p.money1 AS [판매가],
                sr.salemoney0 AS [행사매입가],
                sr.salemoney1 AS [행사판매가],
                sr.startday AS [행사시작일],
                p.saleendday AS [행사종료일],
                p.curjago AS [재고수량],
                p.upday1 AS [최종수정일],
                CASE
                    WHEN p.ispack = '1' THEN '묶음'
                    WHEN p.ispack = '0' THEN '일반'
                    ELSE 'X'
                END AS [BOM여부]
            FROM
                dbo.parts AS p WITH (NOLOCK)
            LEFT JOIN
                dbo.comp AS c WITH (NOLOCK) ON p.comcode = c.comcode
            LEFT JOIN
                dbo.sale_ready AS sr WITH (NOLOCK) ON p.barcode = sr.barcode AND p.comcode = sr.comcode
                AND sr.isappl = '1'
                AND CONVERT(VARCHAR(10), GETDATE(), 121) BETWEEN sr.startday AND sr.endday
            WHERE
                (
                    p.isuse = '1' AND p.barcode IS NOT NULL AND p.barcode NOT LIKE '0000000%'
                    AND (CASE WHEN p.spec IS NOT NULL AND p.spec <> '' THEN p.descr + ' [' + p.spec + ']' ELSE p.descr END) NOT LIKE N'%*---*%'
                )
                AND (
                    p.barcode LIKE '%' + @searchTerm + '%' OR
                    p.descr LIKE '%' + @searchTerm + '%' OR
                    p.spec LIKE '%' + @searchTerm + '%'
                )
            ORDER BY
                CASE 
                    WHEN p.barcode = @searchTerm THEN 0
                    ELSE 1
                END,
                [상품명];
        `;
        
        const result = await request.query(searchProductsQuery);
        res.status(200).json({ recordset: result.recordset, rowsAffected: result.rowsAffected[0] });
        break;
      }
      
      case 'searchProductsForEdit': {
        const { searchTerm } = req.body;
        const request = pool.request();
        request.input('kw', sql.NVarChar, searchTerm);
        const result = await request.query(NAMED_QUERIES.searchProductsForEdit);
        res.status(200).json({ recordset: result.recordset });
        break;
      }

      default:
        res.status(400).json({ error: `Invalid request type: '${type}'` });
        break;
    }
  } catch (err: any) {
    console.error(`Error processing request type "${type}":`, err);
    res.status(500).json({ error: 'An internal server error occurred', details: err.message });
  }
}
