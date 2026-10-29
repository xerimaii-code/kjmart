// src/services/sqlService.ts
import { DbSchema } from './schemaService';

// [중요] APK/웹앱 빌드 시 배포된 서버 주소
const API_ENDPOINT = 'https://kjmart.vercel.app/api/sql'; 
const DEFAULT_TIMEOUT_MS = 30000;

async function fetchApi(body: object, signal?: AbortSignal, customTimeoutMs?: number) {
    let timeoutId: any = null;
    let effectiveSignal = signal;

    if (!effectiveSignal) {
        const controller = new AbortController();
        effectiveSignal = controller.signal;
        const effectiveTimeout = customTimeoutMs || DEFAULT_TIMEOUT_MS;
        timeoutId = setTimeout(() => {
            controller.abort(new Error(`서버 응답 시간이 초과되었습니다 (${Math.round(effectiveTimeout / 1000)}초).`));
        }, effectiveTimeout);
    }

    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: effectiveSignal,
        });

        if (!response.ok) {
            let errorDetails = `Server responded with status ${response.status}`;
            try {
                const errorData = await response.json();
                errorDetails = errorData.details || errorData.error || errorDetails;
            } catch (e) {
                try {
                    errorDetails = await response.text();
                } catch (textErr) {}
            }
            throw new Error(errorDetails);
        }
        
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            return await response.json();
        } else {
            return { success: true, message: await response.text() };
        }

    } catch (err: any) {
        if (err.name === 'AbortError') {
            if (signal?.aborted) throw signal.reason || new Error('API 요청이 중단되었습니다.');
            else throw new Error('서버 응답 시간이 초과되었습니다. 연결을 확인해주세요.');
        }
        if (err instanceof SyntaxError) throw new Error(`응답 해석 실패 (JSON 아님): ${err.message}`);
        if (err.message === 'Failed to fetch') throw new Error('서버에 연결할 수 없습니다. 인터넷 연결과 서버 주소 설정을 확인해주세요.');
        throw new Error(err.message || 'API 요청에 실패했습니다.');
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

/**
 * 쿼리 결과물을 100% 동일하게 유지하면서 인덱스(SARGable)를 타도록 동적 쿼리를 최적화합니다.
 * 1) LTRIM(RTRIM(col.junno)) = ... -> col.junno = ... (SQL Server '=' 연산자는 후행 공백을 자동 무시하며 인덱스를 사용함)
 * 2) LEFT(i.day1, 10) >= @startDate AND LEFT(i.day1, 10) <= @endDate -> i.day1 >= @startDate AND i.day1 <= @endDate + ' 23:59:59'
 */
export const optimizeDynamicSqlQuery = (rawSql: string): string => {
    if (!rawSql) return rawSql;
    let optimized = rawSql;

    // 1. junno 컬럼 좌변 함수 제거 (인덱스 Seek 활성화)
    optimized = optimized.replace(
        /LTRIM\s*\(\s*RTRIM\s*\(\s*([a-zA-Z0-9_.]*junno)\s*\)\s*\)\s*(=|<>)/gi,
        '$1 $2'
    );

    // 2. day1 컬럼 LEFT(day1, 10) 범위 조건 SARGable 변환 (인덱스 Range Seek 활성화)
    optimized = optimized.replace(
        /LEFT\s*\(\s*([a-zA-Z0-9_.]*day1)\s*,\s*10\s*\)\s*>=\s*(@[a-zA-Z0-9_가-힣]+)\s+AND\s+LEFT\s*\(\s*\1\s*,\s*10\s*\)\s*<=\s*(@[a-zA-Z0-9_가-힣]+)/gi,
        "$1 >= $2 AND $1 <= ($3 + ' 23:59:59')"
    );

    return optimized;
};

/**
 * 쿼리 텍스트 내의 @변수명을 찾아 실제 전달할 파라미터만 걸러냅니다.
 * 대소문자를 무시하고 매칭하여 안정성을 높입니다.
 */
export const extractParamsForQuery = (queryText: string, sourceParams: Record<string, any>): Record<string, any> => {
    const sqlWithoutComments = queryText.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    
    const matches = Array.from(sqlWithoutComments.matchAll(/@([a-zA-Z0-9_가-힣]+)/g), m => m[1]);
    const uniqueVars = [...new Set(matches)];
    
    const lookup: Record<string, any> = {};
    Object.keys(sourceParams).forEach(k => {
        lookup[k.toLowerCase()] = sourceParams[k];
    });

    const finalParams: Record<string, any> = {};
    uniqueVars.forEach(variableNameInQuery => {
        const lowerVarName = variableNameInQuery.toLowerCase();
        if (lookup[lowerVarName] !== undefined) {
            finalParams[variableNameInQuery] = lookup[lowerVarName];
        }
    });
    
    return finalParams;
};


export async function checkSqlConnection(): Promise<{ success: boolean; message: string }> {
    const controller = new AbortController();
    const timeout = 10000; 
    const timeoutId = setTimeout(() => {
        const error = new Error(`서버 연결 확인 시간이 초과되었습니다 (${timeout / 1000}초).`);
        error.name = 'TimeoutError';
        controller.abort(error);
    }, timeout);

    try {
        return await fetchApi({ type: 'connect' }, controller.signal);
    } catch (err: any) {
        if (controller.signal.reason && (controller.signal.reason as Error).name === 'TimeoutError') throw controller.signal.reason;
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function getDatabaseSchema(): Promise<DbSchema> {
    return await fetchApi({ type: 'getDatabaseSchema' });
}

export interface QuerySqlResponse {
    recordset?: any[];
    rowsAffected?: number;
    answer?: string;
}

export async function querySql(query: string, signal: AbortSignal, confirmed?: boolean, allowDestructive?: boolean): Promise<QuerySqlResponse> {
    return await fetchApi({ type: 'query', query, confirmed, allowDestructive }, signal);
}

export async function naturalLanguageToSql(naturalLanguagePrompt: string, schema: DbSchema, context: string): Promise<{ sql: string }> {
    return await fetchApi({ type: 'naturalLanguageToSql', naturalLanguagePrompt, schema, context });
}

export async function aiChat(naturalLanguagePrompt: string, schema: DbSchema, context: string, userCurrentDate?: string): Promise<{ answer: string }> {
    return await fetchApi({ type: 'aiChat', naturalLanguagePrompt, schema, context, userCurrentDate });
}

export async function syncCustomersAndProductsFromDb(): Promise<{ customers: any[], products: any[], bom: any[], gubun1: any[], gubun2: any[], gubun3: any[] }> {
    const result = await fetchApi({ type: 'syncCustomersAndProducts' });
    return {
        customers: result.customers?.recordset || [],
        products: result.products?.recordset || [],
        bom: result.bom?.recordset || [],
        gubun1: result.gubun1?.recordset || [],
        gubun2: result.gubun2?.recordset || [],
        gubun3: result.gubun3?.recordset || [],
    };
}

export async function syncCustomersFromDb(): Promise<any[]> {
    const result = await fetchApi({ type: 'syncCustomers' });
    return result?.recordset || [];
}

export async function syncProductsIncrementally(lastSyncDate: string | null): Promise<any[]> {
    const result = await fetchApi({ type: 'syncProductsIncrementally', lastSyncDate });
    return result?.recordset || [];
}

export async function syncBOMFromDb(): Promise<any[]> {
    const result = await fetchApi({ type: 'syncBOM' });
    return result?.recordset || [];
}

export async function syncCategoriesFromDb(): Promise<{ gubun1: any[], gubun2: any[], gubun3: any[] }> {
    const result = await fetchApi({ type: 'syncCategories' });
    return {
        gubun1: result.gubun1?.recordset || [],
        gubun2: result.gubun2?.recordset || [],
        gubun3: result.gubun3?.recordset || [],
    };
}

export async function searchProductsOnline(searchTerm: string, limit: number = 100): Promise<any[]> {
    const result = await fetchApi({ type: 'searchProductsOnline', searchTerm, limit }, undefined, 8000);
    return result?.recordset || [];
}

export async function searchProductsForEdit(searchTerm: string): Promise<any[]> {
    const result = await fetchApi({ type: 'searchProductsForEdit', searchTerm });
    return result?.recordset || [];
}

export async function executeUserQuery(name: string, params: Record<string, any> = {}, userQuery?: string): Promise<any[]> {
    const optimizedQuery = userQuery ? optimizeDynamicSqlQuery(userQuery) : undefined;
    const activeParams = optimizedQuery ? extractParamsForQuery(optimizedQuery, params) : params;
    const body: { [key: string]: any } = { type: 'executeUserQuery', name, params: activeParams };
    if (optimizedQuery) body.userQuery = optimizedQuery;
    const isQuickLookup = name === '실시간재고확인' || name.includes('상품조회');
    const result = await fetchApi(body, undefined, isQuickLookup ? 8000 : DEFAULT_TIMEOUT_MS);
    return result?.recordset || [];
}
