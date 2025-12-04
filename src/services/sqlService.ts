
import { DbSchema } from './schemaService';

const API_ENDPOINT = '/api/sql';

async function fetchApi(body: object, signal?: AbortSignal) {
    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal,
        });

        if (!response.ok) {
            let errorDetails = `Server responded with status ${response.status}`;
            try {
                const errorData = await response.json();
                errorDetails = errorData.details || errorData.error || errorDetails;
            } catch (e) {
                try {
                    errorDetails = await response.text();
                } catch (textErr) {
                    // Fallback
                }
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
            if (signal?.aborted) {
                // Aborted by caller, re-throw with original reason if available
                throw signal.reason || new Error('API 요청이 중단되었습니다.');
            }
        }
        if (err instanceof SyntaxError) {
            throw new Error(`Failed to parse server response as JSON. The server may have returned an error page. Raw message: ${err.message}`);
        }
        throw new Error(err.message || 'API 요청에 실패했습니다.');
    }
}


export async function checkSqlConnection(): Promise<{ success: boolean; message: string }> {
    const controller = new AbortController();
    const timeout = 10000; // 10 seconds
    const timeoutId = setTimeout(() => {
        const error = new Error(`서버 연결 확인 시간이 초과되었습니다 (${timeout / 1000}초).`);
        error.name = 'TimeoutError';
        controller.abort(error);
    }, timeout);

    try {
        const result = await fetchApi({ type: 'connect' }, controller.signal);
        return result;
    } catch (err: any) {
        // Re-throw the specific timeout error if that was the cause.
        if (controller.signal.reason && (controller.signal.reason as Error).name === 'TimeoutError') {
            throw controller.signal.reason;
        }
        // Otherwise, re-throw the original error from fetchApi.
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function getDatabaseSchema(): Promise<DbSchema> {
    const response = await fetchApi({ type: 'getDatabaseSchema' });
    return response as DbSchema;
}

export interface UpdatePreview {
    before: any[];
    after: any[];
    primaryKeys: string[];
}
  
export interface QuerySqlResponse {
    recordset?: any[];
    rowsAffected?: number;
    preview?: UpdatePreview;
    answer?: string;
}

export async function querySql(query: string, signal: AbortSignal, confirmed?: boolean, allowDestructive?: boolean): Promise<QuerySqlResponse> {
    return await fetchApi({ type: 'query', query, confirmed, allowDestructive }, signal);
}

export async function naturalLanguageToSql(naturalLanguagePrompt: string, schema: DbSchema, context: string): Promise<{ sql: string }> {
    return await fetchApi({ 
        type: 'naturalLanguageToSql', 
        naturalLanguagePrompt,
        schema,
        context
    });
}

export async function aiChat(naturalLanguagePrompt: string, schema: DbSchema, context: string, userCurrentDate?: string): Promise<{ answer: string }> {
    return await fetchApi({
        type: 'aiChat',
        naturalLanguagePrompt,
        schema,
        context,
        userCurrentDate,
    });
}

export async function generateQueryName(query: string, resultSummary: string): Promise<{ name: string }> {
    return await fetchApi({ type: 'generateQueryName', query, resultSummary });
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

export async function searchProductsOnline(searchTerm: string, limit: number = 100): Promise<any[]> {
    const result = await fetchApi({ type: 'searchProductsOnline', searchTerm, limit });
    return result?.recordset || [];
}

export async function searchProductsForEdit(searchTerm: string): Promise<any[]> {
    const result = await fetchApi({ type: 'searchProductsForEdit', searchTerm });
    return result?.recordset || [];
}

export async function executeUserQuery(name: string, params: Record<string, any> = {}, userQuery?: string): Promise<any[]> {
    const body: { [key: string]: any } = { type: 'executeUserQuery', name, params };
    if (userQuery) {
        body.userQuery = userQuery;
    }
    const result = await fetchApi(body);
    return result?.recordset || [];
}
