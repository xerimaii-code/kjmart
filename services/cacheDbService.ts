import { Customer, Product } from '../types';

const DB_NAME = 'KJMartCacheDB';
const DB_VERSION = 1;
const CUSTOMERS_STORE = 'customers';
const PRODUCTS_STORE = 'products';

type StoreName = typeof CUSTOMERS_STORE | typeof PRODUCTS_STORE;

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
                // keyPath must match the unique identifier of the Customer interface
                db.createObjectStore(CUSTOMERS_STORE, { keyPath: 'comcode' });
            }
            if (!db.objectStoreNames.contains(PRODUCTS_STORE)) {
                // keyPath must match the unique identifier of the Product interface
                db.createObjectStore(PRODUCTS_STORE, { keyPath: 'barcode' });
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

export async function setCachedData(storeName: StoreName, data: Customer[] | Product[]): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        
        // Clear old data first
        const clearRequest = store.clear();
        clearRequest.onerror = () => {
             console.error(`Error clearing cache for ${storeName}:`, clearRequest.error);
             reject(clearRequest.error);
        }
        
        // Add new data
        data.forEach(item => {
            const addRequest = store.put(item);
            addRequest.onerror = () => {
                 console.error(`Error adding item to cache for ${storeName}:`, addRequest.error);
                 // Don't reject here, try to add as many as possible
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
