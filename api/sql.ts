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

// --- SQL Queries ---
const customerQuery = `
SELECT
    comp.comcode AS 거래처코드,
    comp.comname AS 거래처명
FROM
    comp
WHERE
    comp.isuse <> '0';
`;

const fullProductSyncQuery = `
SELECT * FROM (
    SELECT
        comp.comname AS 거래처명,
        parts.barcode AS 바코드,
        (CASE WHEN parts.spec IS NOT NULL AND parts.spec <> '' THEN parts.descr + ' [' + parts.spec + ']' ELSE parts.descr END) AS 상품명,
        parts.money0vat AS 매입가,
        parts.money1 AS 판매가,
        parts.salemoney0 AS 행사매입가,
        sr.salemoney1 AS 행사판매가,
        sr.startday AS 행사시작일,
        parts.saleendday AS 행사종료일,
        parts.upday1,
        parts.isuse
    FROM
        comp
    INNER JOIN
        parts ON comp.comcode = parts.comcode
    LEFT JOIN
        dbo.sale_ready AS sr ON parts.barcode = sr.barcode AND parts.comcode = sr.comcode
        AND sr.isappl = 'Y'
        AND CONVERT(VARCHAR(10), GETDATE(), 121) BETWEEN sr.startday AND sr.endday
) AS ProductData
WHERE
    (
        (
            ProductData.거래처명 NOT LIKE N'%야채%' AND
            ProductData.거래처명 NOT LIKE N'%과일%' AND
            ProductData.거래처명 NOT LIKE N'%생선%' AND
            ProductData.거래처명 NOT LIKE N'%정육%' AND
            ProductData.거래처명 NOT LIKE N'%식품%' AND
            ProductData.거래처명 NOT LIKE N'%비식품%' AND
            ProductData.거래처명 NOT LIKE N'%기획%' AND
            ProductData.거래처명 NOT LIKE N'%경진청과%'
        )
        AND ProductData.바코드 IS NOT NULL
        AND ProductData.상품명 NOT LIKE N'%*---*%'
        AND ProductData.매입가 <> 0
        AND ProductData.isuse <> '0'
    )
    OR (ProductData.바코드 NOT LIKE '0000000%')
ORDER BY
    ProductData.상품명;
`;

const incrementalProductSyncQuery = `
SELECT
    comp.comname AS 거래처명,
    parts.barcode AS 바코드,
    (CASE WHEN parts.spec IS NOT NULL AND parts.spec <> '' THEN parts.descr + ' [' + parts.spec + ']' ELSE parts.descr END) AS 상품명,
    parts.money0vat AS 매입가,
    parts.money1 AS 판매가,
    parts.salemoney0 AS 행사매입가,
    sr.salemoney1 AS 행사판매가,
    sr.startday AS 행사시작일,
    parts.saleendday AS 행사종료일,
    parts.upday1,
    parts.isuse
FROM
    comp
INNER JOIN
    parts ON comp.comcode = parts.comcode
LEFT JOIN
    dbo.sale_ready AS sr ON parts.barcode = sr.barcode AND parts.comcode = sr.comcode
    AND sr.isappl = 'Y'
    AND CONVERT(VARCHAR(10), GETDATE(), 121) BETWEEN sr.startday AND sr.endday
WHERE
    parts.upday1 >= @lastSyncDate;
`;

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
        const { query, confirmed } = req.body;
        const lowerCaseQuery = query.toLowerCase().trim();

        if (/^\s*(delete|insert)\s/i.test(lowerCaseQuery)) {
          return res.status(403).json({ error: '데이터 보안을 위해 INSERT 및 DELETE 쿼리는 실행할 수 없습니다.' });
        }
        
        if (/^\s*update\s/i.test(lowerCaseQuery) && !confirmed) {
            const transaction = new sql.Transaction(pool);
            try {
                await transaction.begin();

                const tableMatch = lowerCaseQuery.match(/update\s+([a-zA-Z0-9_\[\]\.]+)/);
                const whereMatch = lowerCaseQuery.match(/\s(where\s.+)/);

                if (!tableMatch || !tableMatch[1]) {
                    throw new Error('UPDATE 문에서 테이블 이름을 찾을 수 없습니다.');
                }
                if (!whereMatch || !whereMatch[1]) {
                    throw new Error('안전 모드를 위해 WHERE 절이 없는 UPDATE는 미리보기를 지원하지 않습니다.');
                }

                const tableName = tableMatch[1];
                const whereClause = whereMatch[1];
                const selectQuery = `SELECT * FROM ${tableName} ${whereClause}`;

                const beforeResult = await transaction.request().query(selectQuery);
                await transaction.request().query(query);
                const afterResult = await transaction.request().query(selectQuery);
                
                await transaction.rollback();

                const primaryKeyResult = await pool.request().query(`
                    SELECT KU.column_name
                    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS AS TC
                    INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS KU
                        ON TC.CONSTRAINT_TYPE = 'PRIMARY KEY' 
                        AND TC.CONSTRAINT_NAME = KU.CONSTRAINT_NAME
                    WHERE KU.table_name = '${tableName.replace(/[\[\]]/g, '')}'
                `);
                const primaryKeys = primaryKeyResult.recordset.map(r => r.column_name);

                res.status(200).json({ 
                    preview: {
                        before: beforeResult.recordset,
                        after: afterResult.recordset,
                        primaryKeys,
                    }
                });

            } catch (err: any) {
                if (transaction.active) {
                    await transaction.rollback();
                }
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
        const schemaQuery = `
            SELECT 
                t.TABLE_NAME as tableName, 
                c.COLUMN_NAME as columnName, 
                c.DATA_TYPE as dataType
            FROM INFORMATION_SCHEMA.TABLES t 
            JOIN INFORMATION_SCHEMA.COLUMNS c ON t.TABLE_NAME = c.TABLE_NAME 
            WHERE t.TABLE_TYPE = 'BASE TABLE'
            ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION;
        `;
        const result = await pool.request().query(schemaQuery);
        const schema = result.recordset.reduce((acc, { tableName, columnName, dataType }) => {
            if (!acc[tableName]) {
                acc[tableName] = { columns: [] };
            }
            acc[tableName].columns.push({ name: columnName, type: dataType });
            return acc;
        }, {});
        res.status(200).json(schema);
        break;
      }
        
      case 'naturalLanguageToSql':
      case 'aiChat': {
        if (!ai) return res.status(503).json({ error: "AI service is not configured." });
        const { naturalLanguagePrompt, schema, context, userCurrentDate } = req.body;
        const schemaString = Object.entries(schema).map(([name, table]: [string, any]) => 
            `Table ${name}: columns(${table.columns.map((c: any) => `${c.name} ${c.type}`).join(', ')})`
        ).join('\n');
        
        const dateContext = userCurrentDate 
            ? ` When answering questions about dates or times, assume the user's current local date is ${userCurrentDate}.`
            : '';

        let systemInstruction = `You are a helpful assistant that converts natural language queries into SQL Server (T-SQL) queries. The user is Korean. Always respond in Korean. Use the provided schema.${dateContext} ${context ? `\n\nAdditional context and rules:\n${context}` : ''}`;
        
        if(type === 'aiChat') {
            systemInstruction = `You are a helpful assistant that answers questions based on a database schema. The user is Korean. Always respond in Korean. Do not generate SQL unless specifically asked. Use the provided schema to inform your answer.${dateContext} ${context ? `\n\nAdditional context and rules:\n${context}` : ''}`;
        }
        
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `Schema:\n${schemaString}\n\nQuestion: ${naturalLanguagePrompt}`,
          config: { systemInstruction }
        });

        if (type === 'aiChat') {
            res.status(200).json({ answer: response.text });
        } else {
            const sqlQuery = response.text?.match(/```(?:sql\n)?([\s\S]+?)```/)?.[1]?.trim() || response.text;
            res.status(200).json({ sql: sqlQuery });
        }
        break;
      }

      case 'generateQueryName': {
        if (!ai) return res.status(503).json({ error: "AI service is not configured." });
        const { query, resultSummary } = req.body;
        const systemInstruction = "You are a helpful assistant that creates a short, descriptive name in Korean for a given query and its result summary. The name should be concise and reflect the purpose of the query. Do not add any extra text, just the name.";
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ role: 'user', parts: [{ text: `Query: ${query}\nResult: ${resultSummary}\n\nGenerate a short, descriptive name for this query in Korean.` }] }],
          config: { systemInstruction }
        });
        res.status(200).json({ name: response.text?.replace(/["'“‘”’]/g, '').trim() });
        break;
      }

      case 'syncCustomersAndProducts': {
        const [customersResult, productsResult] = await Promise.all([
          pool.request().query(customerQuery),
          pool.request().query(fullProductSyncQuery)
        ]);
        res.status(200).json({
          customers: { recordset: customersResult.recordset, rowsAffected: customersResult.rowsAffected[0] },
          products: { recordset: productsResult.recordset, rowsAffected: productsResult.rowsAffected[0] }
        });
        break;
      }

      case 'syncCustomers': {
        const result = await pool.request().query(customerQuery);
        res.status(200).json({ recordset: result.recordset, rowsAffected: result.rowsAffected[0] });
        break;
      }

      case 'syncProductsIncrementally': {
        const { lastSyncDate } = req.body;
        if (!lastSyncDate) {
            return res.status(200).json({ recordset: [], rowsAffected: 0 });
        }
        const request = pool.request();
        request.input('lastSyncDate', sql.NVarChar, lastSyncDate);
        const result = await request.query(incrementalProductSyncQuery);
        res.status(200).json({ recordset: result.recordset, rowsAffected: result.rowsAffected[0] });
        break;
      }

      case 'searchProductsOnline': {
        const { searchTerm } = req.body;
        if (!searchTerm) {
          return res.status(200).json({ recordset: [], rowsAffected: 0 });
        }
        
        const request = pool.request();
        request.input('searchTerm', sql.NVarChar, `%${searchTerm}%`);
        
        const searchProductsQuery = `
          SELECT * FROM (
              SELECT
                  comp.comname AS 거래처명,
                  parts.barcode AS 바코드,
                  (CASE WHEN parts.spec IS NOT NULL AND parts.spec <> '' THEN parts.descr + ' [' + parts.spec + ']' ELSE parts.descr END) AS 상품명,
                  parts.money0vat AS 매입가,
                  parts.money1 AS 판매가,
                  parts.salemoney0 AS 행사매입가,
                  sr.salemoney1 AS 행사판매가,
                  sr.startday AS 행사시작일,
                  parts.saleendday AS 행사종료일,
                  parts.upday1,
                  parts.isuse
              FROM
                  comp
              INNER JOIN
                  parts ON comp.comcode = parts.comcode
              LEFT JOIN
                  dbo.sale_ready AS sr ON parts.barcode = sr.barcode AND parts.comcode = sr.comcode
                  AND sr.isappl = 'Y'
                  AND CONVERT(VARCHAR(10), GETDATE(), 121) BETWEEN sr.startday AND sr.endday
          ) AS ProductData
          WHERE
              (
                  (
                      (
                          ProductData.거래처명 NOT LIKE N'%야채%' AND
                          ProductData.거래처명 NOT LIKE N'%과일%' AND
                          ProductData.거래처명 NOT LIKE N'%생선%' AND
                          ProductData.거래처명 NOT LIKE N'%정육%' AND
                          ProductData.거래처명 NOT LIKE N'%식품%' AND
                          ProductData.거래처명 NOT LIKE N'%비식품%' AND
                          ProductData.거래처명 NOT LIKE N'%기획%' AND
                          ProductData.거래처명 NOT LIKE N'%경진청과%'
                      )
                      AND ProductData.바코드 IS NOT NULL
                      AND ProductData.상품명 NOT LIKE N'%*---*%'
                      AND ProductData.매입가 <> 0
                      AND ProductData.isuse <> '0'
                  )
                  OR (ProductData.바코드 NOT LIKE '0000000%')
              )
              AND (ProductData.상품명 LIKE @searchTerm OR ProductData.바코드 LIKE @searchTerm)
          ORDER BY
              ProductData.상품명;
        `;
        
        const result = await request.query(searchProductsQuery);
        res.status(200).json({ recordset: result.recordset, rowsAffected: result.rowsAffected[0] });
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