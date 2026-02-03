
import { ReceivingBatch } from '../types';

const DB_NAME = 'KJMartReceivingDB';
const DB_VERSION = 1;
const STORE_NAME = 'receivingBatches';

let db: IDBDatabase;

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (db) return resolve(db);

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error("IndexedDB error:", request.error);
            reject(new Error("IndexedDB 'Receiving' database error"));
        };

        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                // Index on status for efficient querying of 'draft' items
                store.createIndex('status', 'status', { unique: false });
            }
        };
    });
}

export async function saveOrUpdateBatch(batch: ReceivingBatch): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(batch);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export async function getBatch(id: number): Promise<ReceivingBatch | undefined> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function getAllBatches(): Promise<ReceivingBatch[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result.sort((a,b) => b.id - a.id)); // Sort descending by ID (date)
        request.onerror = () => reject(request.error);
    });
}

export async function getDraftBatchesCount(): Promise<number> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('status');
        const request = index.count('draft');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function deleteBatch(id: number): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export async function clearAllBatches(): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export async function cleanupOldLocalBatches(daysToKeep: number = 2): Promise<void> {
    const db = await openDB();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffTimestamp = cutoffDate.getTime();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        // IDBKeyRange.upperBound includes everything up to cutoffTimestamp
        const range = IDBKeyRange.upperBound(cutoffTimestamp);
        const request = store.openCursor(range);

        request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
            if (cursor) {
                const batch = cursor.value as ReceivingBatch;
                // STRICT RULE: Only delete if status is 'sent'
                if (batch.status === 'sent') {
                    cursor.delete();
                }
                cursor.continue();
            } else {
                resolve();
            }
        };
        request.onerror = () => reject(request.error);
    });
}
