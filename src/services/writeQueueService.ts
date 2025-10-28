const DB_NAME = 'KJMartWriteQueueDB';
const DB_VERSION = 1;
const STORE_NAME = 'operations';

interface QueuedOperation {
    id: string;
    payload: any;
    timestamp: number;
}

let db: IDBDatabase;

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (db) {
            return resolve(db);
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error("WriteQueue IndexedDB error:", request.error);
            reject("WriteQueue IndexedDB error");
        };

        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });
}

export async function add(operation: QueuedOperation): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(operation);

        request.onsuccess = () => resolve();
        request.onerror = () => {
            console.error('Error adding to write queue:', request.error);
            reject(request.error);
        };
    });
}

export async function getAll(): Promise<QueuedOperation[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('timestamp');
        const request = index.getAll();

        request.onsuccess = () => {
            resolve(request.result);
        };
        request.onerror = () => {
            console.error('Error getting all from write queue:', request.error);
            reject(request.error);
        };
    });
}

export async function remove(id: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => {
            console.error('Error removing from write queue:', request.error);
            reject(request.error);
        };
    });
}
