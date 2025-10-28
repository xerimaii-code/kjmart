import { Customer, Product, Order } from '../types';

const DB_NAME = 'KJMartCacheDB';
const DB_VERSION = 2; // Incremented version to trigger onupgradeneeded
const CUSTOMERS_STORE = 'customers';
const PRODUCTS_STORE = 'products';
const ORDERS_STORE = 'orders';

type StoreName = typeof CUSTOMERS_STORE | typeof PRODUCTS_STORE | typeof ORDERS_STORE;

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
            if (!db.objectStoreNames.contains(ORDERS_STORE)) {
                db.createObjectStore(ORDERS_STORE, { keyPath: 'id' });
            }
        };
    });
}

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

export async function setCachedData(storeName: StoreName, data: (Customer | Product | Order)[]): Promise<void> {
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

export async function addOrUpdateCachedItem(storeName: StoreName, item: Customer | Product): Promise<void> {
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

export async function addOrUpdateCachedOrder(order: Order): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(ORDERS_STORE, 'readwrite');
        const store = transaction.objectStore(ORDERS_STORE);
        const request = store.put(order);

        request.onsuccess = () => resolve();
        request.onerror = () => {
            console.error(`Error putting order in cache:`, request.error);
            reject(request.error);
        };
    });
}

export async function removeCachedOrder(orderId: number): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(ORDERS_STORE, 'readwrite');
        const store = transaction.objectStore(ORDERS_STORE);
        const request = store.delete(orderId);

        request.onsuccess = () => resolve();
        request.onerror = () => {
            console.error(`Error deleting order from cache:`, request.error);
            reject(request.error);
        };
    });
}

export async function clearCachedStore(storeName: StoreName): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => {
            console.error(`Error clearing store ${storeName}:`, request.error);
            reject(request.error);
        };
    });
}