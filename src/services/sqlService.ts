// src/services/sqlService.ts

const API_ENDPOINT = '/src/api/sql';

async function fetchApi(body: object, signal?: AbortSignal) {
    const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.details || data.error || 'API 요청에 실패했습니다.');
    }

    return data;
}

export async function checkSqlConnection(): Promise<{ success: boolean; message: string }> {
    return fetchApi({ type: 'connect' });
}

export async function getSqlTables(): Promise<string[]> {
    return fetchApi({ type: 'getTables' });
}

export async function querySql(query: string, signal: AbortSignal): Promise<{ recordset: any[], rowsAffected: number }> {
    return fetchApi({ type: 'query', query }, signal);
}

export async function naturalLanguageToSql(naturalLanguagePrompt: string, selectedTables: string[]): Promise<{ sql: string }> {
    return fetchApi({ type: 'naturalLanguageToSql', naturalLanguagePrompt, selectedTables });
}