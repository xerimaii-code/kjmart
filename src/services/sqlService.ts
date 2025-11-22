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
                // Try to parse error response as JSON
                const errorData = await response.json();
                errorDetails = errorData.details || errorData.error || errorDetails;
            } catch (e) {
                // If not JSON, try to get text content
                try {
                    errorDetails = await response.text();
                } catch (textErr) {
                    // Fallback if text() also fails
                }
            }
            throw new Error(errorDetails);
        }
        
        // Check if response has content before trying to parse JSON
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            return await response.json();
        } else {
            // Handle cases where the server might return a non-JSON success response
            return { success: true, message: await response.text() };
        }

    } catch (err: any) {
        // Re-throw network errors or errors from the above block
        if (err instanceof SyntaxError) {
            // This happens if response.json() fails
            throw new Error(`Failed to parse server response as JSON. The server may have returned an error page. Raw message: ${err.message}`);
        }
        throw new Error(err.message || 'API 요청에 실패했습니다.');
    }
}


export async function checkSqlConnection(): Promise<{ success: boolean; message: string }> {
    return fetchApi({ type: 'connect' });
}

export async function getDatabaseSchema(): Promise<DbSchema> {
    const response = await fetchApi({ type: 'getDatabaseSchema' });
    return response as DbSchema;
}

export async function querySql(query: string, signal: AbortSignal): Promise<{ recordset: any[], rowsAffected: number }> {
    return await fetchApi({ type: 'query', query }, signal);
}

export async function naturalLanguageToSql(naturalLanguagePrompt: string, schema: DbSchema, context: string): Promise<{ sql: string }> {
    return await fetchApi({ 
        type: 'naturalLanguageToSql', 
        naturalLanguagePrompt,
        schema,
        context
    });
}

export async function aiChat(naturalLanguagePrompt: string, schema: DbSchema, context: string): Promise<{ answer: string }> {
    return await fetchApi({
        type: 'aiChat',
        naturalLanguagePrompt,
        schema,
        context
    });
}

export async function sqlToNaturalLanguage(sqlQuery: string): Promise<{ naturalLanguage: string }> {
    return await fetchApi({ type: 'sqlToNaturalLanguage', sqlQuery });
}

export async function generateQueryName(query: string, resultSummary: string): Promise<{ name: string }> {
    return await fetchApi({ type: 'generateQueryName', query, resultSummary });
}

export async function syncCustomersAndProductsFromDb(): Promise<{ customers: any[], products: any[] }> {
    const result = await fetchApi({ type: 'syncCustomersAndProducts' });
    return {
        customers: result.customers?.recordset || [],
        products: result.products?.recordset || []
    };
}

export async function syncCustomersFromDb(): Promise<any[]> {
    const result = await fetchApi({ type: 'syncCustomers' });
    // FIX: Safely access recordset from the result object.
    // This prevents a "map is not a function" error if the result is not an array.
    return result?.recordset || [];
}

export async function syncProductsIncrementally(lastSyncDate: string | null): Promise<any[]> {
    const result = await fetchApi({ type: 'syncProductsIncrementally', lastSyncDate });
    // FIX: Safely access recordset from the result object.
    // This prevents a "forEach is not a function" error if the result is not an array.
    return result?.recordset || [];
}