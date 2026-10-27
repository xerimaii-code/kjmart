import { Customer, Product, BOM, Category } from '../types';

const DB_NAME = 'KJMartCacheDB';
const DB_VERSION = 4;
const CUSTOMERS_STORE = 'customers';
const PRODUCTS_STORE = 'products';
const BOM_STORE = 'bom';
const CATEGORIES_STORE = 'categories';
const SETTINGS_STORE = 'settings';

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

export async function resetAllSyncFlags(): Promise<void> {
    const stores = [CUSTOMERS_STORE, PRODUCTS_STORE, BOM_STORE, CATEGORIES_STORE];
    for (const store of stores) {
        await setSyncFlag(store, false);
    }
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

/**
 * 전체 데이터를 단일 원자적 트랜잭션(Single Atomic Transaction)으로 교체합니다.
 * clear()와 put()을 별도 트랜잭션으로 분리하거나 setTimeout 지연을 두지 않으므로,
 * 저장 도중 앱이 백그라운드로 전환되거나 강제 종료되면 IndexedDB가 트랜잭션 전체를 자동 롤백(Rollback)하여
 * 기존 로컬 데이터가 깨지거나 증발하는 현상을 원천적으로 방지합니다.
 */
export async function setCachedData(storeName: StoreName, data: any[], onProgress?: (progress: number) => void): Promise<void> {
    await setSyncFlag(storeName, true);
    const db = await openDB();

    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);

            store.clear();

            if (data && data.length > 0) {
                const total = data.length;
                const step = Math.max(1, Math.floor(total / 10));

                for (let i = 0; i < total; i++) {
                    const req = store.put(data[i]);
                    if (onProgress && ((i + 1) % step === 0 || i === total - 1)) {
                        const currentIdx = i + 1;
                        req.onsuccess = () => {
                            onProgress(Math.round((currentIdx / total) * 100));
                        };
                    }
                }
            }

            transaction.oncomplete = () => {
                if (onProgress) onProgress(100);
                resolve();
            };

            transaction.onerror = () => {
                console.error(`Atomic transaction failed for ${storeName}:`, transaction.error);
                reject(transaction.error);
            };

            transaction.onabort = () => {
                console.warn(`Atomic transaction aborted for ${storeName} (rolled back safely).`);
                reject(transaction.error || new Error(`Transaction aborted for ${storeName}`));
            };
        });

        await setSyncFlag(storeName, false);
    } catch (e) {
        console.error(`Sync failed for ${storeName}:`, e);
        throw e;
    }
}

/**
 * 증분 동기화 전용: 기존 스토어를 clear()하지 않고 변경된 항목만 단일 원자적 트랜잭션으로 Upsert(추가/수정) 및 삭제합니다.
 * 백그라운드 전환 시에도 기존 로컬 상품 데이터는 절대 손실되지 않습니다.
 */
export async function upsertCachedItems(storeName: StoreName, itemsToPut: any[], keysToDelete: string[] = []): Promise<void> {
    if ((!itemsToPut || itemsToPut.length === 0) && (!keysToDelete || keysToDelete.length === 0)) {
        return;
    }
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);

        for (const key of keysToDelete) {
            if (key) store.delete(key);
        }
        for (const item of itemsToPut) {
            store.put(item);
        }

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => {
            console.error(`Error upserting items in ${storeName}:`, transaction.error);
            reject(transaction.error);
        };
        transaction.onabort = () => {
            reject(transaction.error || new Error(`Upsert transaction aborted for ${storeName}`));
        };
    });
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
            store.clear();
            
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
        await setSyncFlag(storeName, false);
    }
}
