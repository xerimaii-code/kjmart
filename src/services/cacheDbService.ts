
import { Customer, Product, BOM, Category } from '../types';

const DB_NAME = 'KJMartCacheDB';
const DB_VERSION = 4; // 버전 오류 해결을 위해 4로 상향
const CUSTOMERS_STORE = 'customers';
const PRODUCTS_STORE = 'products';
const BOM_STORE = 'bom';
const CATEGORIES_STORE = 'categories';
const SETTINGS_STORE = 'settings'; // New store for generic key-value settings

type StoreName = typeof CUSTOMERS_STORE | typeof PRODUCTS_STORE | typeof SETTINGS_STORE | typeof BOM_STORE | typeof CATEGORIES_STORE;

let db: IDBDatabase;

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (db) {
            return resolve(db);
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error("IndexedDB cache error:", request.error);
            reject(new Error("IndexedDB cache error"));
        };

        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(CUSTOMERS_STORE)) {
                db.createObjectStore(CUSTOMERS_STORE, { keyPath: 'comcode' });
            }
            if (!db.objectStoreNames.contains(PRODUCTS_STORE)) {
                db.createObjectStore(PRODUCTS_STORE, { keyPath: 'barcode' });
            }
            if (!db.objectStoreNames.contains(BOM_STORE)) {
                // BOM needs to be queried by parent barcode (pcode) primarily
                // Composite key 'id' will be generated before saving
                const store = db.createObjectStore(BOM_STORE, { keyPath: 'id' });
                store.createIndex('pcode', 'pcode', { unique: false });
            }
            if (!db.objectStoreNames.contains(CATEGORIES_STORE)) {
                db.createObjectStore(CATEGORIES_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
                db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
            }
        };
    });
}

/**
 * Ensures the database connection is established. This should be called once on app startup.
 */
export async function initializeCacheDb(): Promise<void> {
    await openDB();
}

// --- Generic Settings Store Functions ---

export async function getSetting<T>(key: string): Promise<T | undefined> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(SETTINGS_STORE, 'readonly');
        const store = transaction.objectStore(SETTINGS_STORE);
        const request = store.get(key);

        request.onsuccess = () => {
            resolve(request.result ? request.result.value : undefined);
        };
        request.onerror = (event) => {
            console.error(`Error getting setting '${key}':`, (event.target as IDBRequest).error);
            reject((event.target as IDBRequest).error);
        };
    });
}

export async function setSetting(key: string, value: any): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(SETTINGS_STORE, 'readwrite');
        const store = transaction.objectStore(SETTINGS_STORE);
        const request = store.put({ key, value });

        request.onsuccess = () => {
            resolve();
        };
        request.onerror = (event) => {
            console.error(`Error setting '${key}':`, (event.target as IDBRequest).error);
            reject((event.target as IDBRequest).error);
        };
    });
}

// --- Sync Integrity Functions ---
const getSyncFlagKey = (storeName: string) => `sync_in_progress_${storeName}`;

async function setSyncFlag(storeName: string, inProgress: boolean): Promise<void> {
    await setSetting(getSyncFlagKey(storeName), inProgress);
}

export async function isSyncInterrupted(storeName: string): Promise<boolean> {
    const flag = await getSetting<boolean>(getSyncFlagKey(storeName));
    return !!flag;
}

// CRITICAL FIX: Reset flags on startup to prevent deadlock if app crashed during sync
export async function resetAllSyncFlags(): Promise<void> {
    const stores = [CUSTOMERS_STORE, PRODUCTS_STORE, BOM_STORE, CATEGORIES_STORE];
    for (const store of stores) {
        await setSyncFlag(store, false);
    }
    console.log("Sync locks reset.");
}

// --- Data Store Functions ---

export async function getCachedData<T>(storeName: StoreName): Promise<T[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => {
            resolve(request.result as T[]);
        };
        request.onerror = () => {
            console.error(`Error getting cached ${storeName}:`, request.error);
            reject(request.error);
        };
    });
}

export async function setCachedData(storeName: StoreName, data: any[], onProgress?: (progress: number) => void): Promise<void> {
    // 1. Set Sync Flag ON
    await setSyncFlag(storeName, true);

    const db = await openDB();
    console.log(`Starting setCachedData for ${storeName}. Items count: ${data.length}`);

    try {
        // 2. Clear the store first (Separate Transaction)
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();
            
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e) => {
                console.error(`Error clearing ${storeName}:`, transaction.error);
                reject(transaction.error);
            };
        });

        if (!data || data.length === 0) {
            console.log(`${storeName} data is empty. Cache cleared.`);
            await setSyncFlag(storeName, false); // Clear flag if empty
            return;
        }

        // 3. Insert data in chunks to prevent transaction timeouts and UI freezing
        const CHUNK_SIZE = 500;
        const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
        
        for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            const chunk = data.slice(i, i + CHUNK_SIZE);
            
            await new Promise<void>((resolve, reject) => {
                const transaction = db.transaction(storeName, 'readwrite');
                const store = transaction.objectStore(storeName);
                
                chunk.forEach(item => {
                    try {
                        store.put(item);
                    } catch (e) {
                        console.error(`Exception putting item in ${storeName}:`, item, e);
                    }
                });

                transaction.oncomplete = () => {
                    if (onProgress) {
                        const currentChunk = Math.floor(i / CHUNK_SIZE) + 1;
                        const progress = Math.round((currentChunk / totalChunks) * 100);
                        onProgress(progress);
                    }
                    resolve();
                };

                transaction.onerror = (event) => {
                    console.error(`Transaction failed for ${storeName} (chunk starting at ${i}):`, transaction.error);
                    // We allow partial failure but don't clear the sync flag so it retries later
                    reject(transaction.error); 
                };
            });
            
            // Critical: Add a small delay to let the event loop breathe and UI update
            await new Promise(r => setTimeout(r, 50));
        }
        
        // 4. Set Sync Flag OFF (Success)
        await setSyncFlag(storeName, false);
        console.log(`Successfully cached ${data.length} items for ${storeName}`);

    } catch (e) {
        console.error(`Sync failed for ${storeName}. Flag remains set for recovery.`, e);
        throw e;
    }
}

export async function addOrUpdateCachedItem(storeName: StoreName, item: any): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(item);

        request.onsuccess = () => resolve();
        request.onerror = () => {
            console.error(`Error putting item in ${storeName}:`, request.error);
            reject(request.error);
        };
    });
}

export async function removeCachedItem(storeName: StoreName, key: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(key);

        request.onsuccess = () => resolve();
        request.onerror = () => {
            console.error(`Error deleting item from ${storeName}:`, request.error);
            reject(request.error);
        };
    });
}

export async function clearDataStores(): Promise<void> {
    const db = await openDB();
    const stores = [CUSTOMERS_STORE, PRODUCTS_STORE, BOM_STORE, CATEGORIES_STORE];
    
    for (const storeName of stores) {
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();
            
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
        // Reset flags
        await setSyncFlag(storeName, false);
    }
}
