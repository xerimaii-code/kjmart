import { getDatabaseSchema as fetchDatabaseSchema } from './sqlService';
import { getSetting, setSetting } from './cacheDbService';

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
 * Fetches the latest database schema from the server and compares it with the
 * cached version. If there are differences, it updates the cache.
 * This function is designed to be called on app startup.
 * @returns {Promise<void>}
 */
export async function syncAndCacheDbSchema(): Promise<void> {
    try {
        console.log("Syncing database schema...");
        const serverSchema = await fetchDatabaseSchema();
        const cachedSchema = await getCachedSchema();

        // Simple JSON string comparison to check for any changes.
        if (JSON.stringify(serverSchema) !== JSON.stringify(cachedSchema)) {
            console.log("Database schema has changed. Updating cache.");
            await setSetting(DB_SCHEMA_CACHE_KEY, serverSchema);
        } else {
            console.log("Database schema is up-to-date.");
        }
    } catch (error) {
        console.error("Failed to sync and cache database schema:", error);
        // We don't re-throw here to avoid blocking app startup.
        // The app can still function with a potentially stale cache.
    }
}
