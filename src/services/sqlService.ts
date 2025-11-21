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
                errorDetails = await response.text();
            }
            throw new Error(errorDetails);
        }

        return await response.json();
    } catch (err: any) {
        // Re-throw network errors or errors from the above block
        throw new Error(err.message || 'API 요청에 실패했습니다.');
    }
}


export async function checkSqlConnection(): Promise<{ success: boolean; message: string }> {
    return fetchApi({ type: 'connect' });
}

export async function getDatabaseSchema(): Promise<DbSchema> {
    return fetchApi({ type: 'getDatabaseSchema' });
}

export async function querySql(query: string, signal: AbortSignal): Promise<{ recordset: any[], rowsAffected: number }> {
    return fetchApi({ type: 'query', query }, signal);
}

export async function naturalLanguageToSql(naturalLanguagePrompt: string, schema: DbSchema, context: string): Promise<{ sql: string }> {
    return fetchApi({ 
        type: 'naturalLanguageToSql', 
        naturalLanguagePrompt,
        schema,
        context
    });
}