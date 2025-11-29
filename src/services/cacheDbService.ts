import { Customer, Product } from '../types';

const DB_NAME = 'KJMartCacheDB';
const DB_VERSION = 2; // Incremented version for schema change
const CUSTOMERS_STORE = 'customers';
const PRODUCTS_STORE = 'products';
const SETTINGS_STORE = 'settings'; // New store for generic key-value settings

type StoreName = typeof CUSTOMERS_STORE | typeof PRODUCTS_STORE | typeof SETTINGS_STORE;

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
            if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
                db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
            }
        };
    });
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

// --- Data Store Functions ---

export async function getCachedData<T>(storeName: 'customers' | 'products'): Promise<T[]> {
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

export async function setCachedData(storeName: 'customers' | 'products', data: Customer[] | Product[]): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        
        const clearRequest = store.clear();
        clearRequest.onerror = () => {
             console.error(`Error clearing cache for ${storeName}:`, clearRequest.error);
             reject(clearRequest.error);
        }
        
        data.forEach(item => {
            const addRequest = store.put(item);
            addRequest.onerror = () => {
                 console.error(`Error adding item to cache for ${storeName}:`, addRequest.error);
            }
        });

        transaction.oncomplete = () => {
            resolve();
        };

        transaction.onerror = () => {
            console.error(`Error setting cached ${storeName}:`, transaction.error);
            reject(transaction.error);
        };
    });
}

export async function addOrUpdateCachedItem(storeName: 'customers' | 'products', item: Customer | Product): Promise<void> {
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

export async function removeCachedItem(storeName: 'customers' | 'products', key: string): Promise<void> {
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
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CUSTOMERS_STORE, PRODUCTS_STORE], 'readwrite');
        
        transaction.oncomplete = () => {
            resolve();
        };
        transaction.onerror = () => {
            console.error(`Error clearing data stores:`, transaction.error);
            reject(transaction.error);
        };

        const customersStore = transaction.objectStore(CUSTOMERS_STORE);
        customersStore.clear();

        const productsStore = transaction.objectStore(PRODUCTS_STORE);
        productsStore.clear();
    });
}