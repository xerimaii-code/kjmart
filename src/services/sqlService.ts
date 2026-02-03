
// src/services/sqlService.ts
import { DbSchema } from './schemaService';

// [중요] APK 빌드 시에는 아래 주소를 실제 배포된 서버 주소나 PC의 IP 주소로 변경해야 합니다.
// 예: 'https://my-kjmart-app.vercel.app/api/sql' 또는 'http://192.168.0.10:3000/api/sql'
const API_ENDPOINT = 'https://kjmart.vercel.app/api/sql'; 
const DEFAULT_TIMEOUT_MS = 30000;

async function fetchApi(body: object, signal?: AbortSignal) {
    let timeoutId: any = null;
    let effectiveSignal = signal;

    if (!effectiveSignal) {
        const controller = new AbortController();
        effectiveSignal = controller.signal;
        timeoutId = setTimeout(() => {
            controller.abort(new Error('서버 응답 시간이 초과되었습니다 (30초).'));
        }, DEFAULT_TIMEOUT_MS);
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
        // 모바일 환경에서 자주 발생하는 네트워크 오류 메시지 구체화
        if (err.message === 'Failed to fetch') throw new Error('서버에 연결할 수 없습니다. 인터넷 연결과 서버 주소 설정을 확인해주세요.');
        throw new Error(err.message || 'API 요청에 실패했습니다.');
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

/**
 * 쿼리 텍스트 내의 @변수명을 찾아 실제 전달할 파라미터만 걸러냅니다.
 * 대소문자를 무시하고 매칭하여 안정성을 높입니다.
 */
export const extractParamsForQuery = (queryText: string, sourceParams: Record<string, any>): Record<string, any> => {
    // 주석을 제외한 쿼리에서만 추출 (정밀도 향상)
    const sqlWithoutComments = queryText.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    
    // 한글 파라미터 및 언더바 포함 매칭 (@한글, @abc_123 등)
    const matches = Array.from(sqlWithoutComments.matchAll(/@([a-zA-Z0-9_가-힣]+)/g), m => m[1]);
    const uniqueVars = [...new Set(matches)];
    
    const lookup: Record<string, any> = {};
    Object.keys(sourceParams).forEach(k => {
        lookup[k.toLowerCase()] = sourceParams[k];
    });

    const finalParams: Record<string, any> = {};
    uniqueVars.forEach(variableNameInQuery => {
        const lowerVarName = variableNameInQuery.toLowerCase();
        // 대소문자 구분 없이 sourceParams에서 값을 찾아 할당
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
    const result = await fetchApi({ type: 'searchProductsOnline', searchTerm, limit });
    return result?.recordset || [];
}

export async function searchProductsForEdit(searchTerm: string): Promise<any[]> {
    const result = await fetchApi({ type: 'searchProductsForEdit', searchTerm });
    return result?.recordset || [];
}

export async function executeUserQuery(name: string, params: Record<string, any> = {}, userQuery?: string): Promise<any[]> {
    // 전달된 파라미터 중 쿼리에서 실제로 쓰이는 것만 추출 (API 최적화)
    const activeParams = userQuery ? extractParamsForQuery(userQuery, params) : params;
    const body: { [key: string]: any } = { type: 'executeUserQuery', name, params: activeParams };
    if (userQuery) body.userQuery = userQuery;
    const result = await fetchApi(body);
    return result?.recordset || [];
}
