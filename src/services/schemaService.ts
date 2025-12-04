
import { getDatabaseSchema as fetchDatabaseSchema } from './sqlService';
import { getSetting, setSetting, clearDataStores } from './cacheDbService';

const DB_SCHEMA_CACHE_KEY = 'dbSchema';

export type DbSchema = Record<string, { columns: { name: string; type: string }[] }>;

/**
 * Fetches the database schema from the local cache (IndexedDB).
 * @returns {Promise<DbSchema | undefined>} The cached schema, or undefined if not found.
 */
export async function getCachedSchema(): Promise<DbSchema | undefined> {
    return await getSetting<DbSchema>(DB_SCHEMA_CACHE_KEY);
}

/**
 * Normalizes the schema object for deterministic comparison.
 * Sorts tables and columns by name to ensure consistent JSON stringification.
 */
function normalizeSchema(schema: any): string {
    if (!schema || typeof schema !== 'object') return '';
    
    // Sort keys (Table Names)
    const sortedTables = Object.keys(schema).sort();
    
    const normalized: any = {};
    for (const table of sortedTables) {
        const tableData = schema[table];
        if (tableData && Array.isArray(tableData.columns)) {
            // Sort columns by name to ensure order independence
            normalized[table] = tableData.columns.map((c: any) => ({
                name: c.name,
                type: c.type
            })).sort((a: any, b: any) => a.name.localeCompare(b.name));
        }
    }
    return JSON.stringify(normalized);
}

/**
 * Fetches the latest database schema from the server and compares it with the
 * cached version. If there are differences, it updates the cache and clears local data.
 * This function is designed to be called on app startup.
 * @returns {Promise<boolean>} True if schema changed and cache updated, False otherwise.
 */
export async function syncAndCacheDbSchema(): Promise<boolean> {
    try {
        console.log("Checking database schema...");
        const serverSchema = await fetchDatabaseSchema();
        const cachedSchema = await getCachedSchema();

        const serverStr = normalizeSchema(serverSchema);
        const cachedStr = normalizeSchema(cachedSchema);

        // Deterministic comparison
        if (serverStr !== cachedStr) {
            console.log("Database schema has changed. Clearing local data and updating cache.");
            
            // Clear local data because schema mismatch implies potential incompatibility
            // This effectively forces a full sync on the next synchronization attempt
            await clearDataStores();
            
            await setSetting(DB_SCHEMA_CACHE_KEY, serverSchema);
            return true;
        } else {
            console.log("Database schema is up-to-date.");
            return false;
        }
    } catch (error) {
        console.error("Failed to sync and cache database schema:", error);
        // We don't re-throw here to avoid blocking app startup.
        // The app can still function with a potentially stale cache.
        return false;
    }
}
