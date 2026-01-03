
import { NewOrderDraft, EditedOrderDraft, ReceivingDraft, InventoryAuditDraft, EventRegistrationDraft } from '../types';

const DB_NAME = 'KJMartDraftsDB';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';

// FIX: Added InventoryAuditDraft and EventRegistrationDraft to the Draft union type to satisfy the generic constraint in the useDraft hook.
export type Draft = NewOrderDraft | EditedOrderDraft | ReceivingDraft | InventoryAuditDraft | EventRegistrationDraft;

let db: IDBDatabase;

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (db) {
            return resolve(db);
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error("IndexedDB error:", request.error);
            reject("IndexedDB error");
        };

        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
}

export async function getDraft<T extends Draft>(id: string | number): Promise<T | null> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => {
            resolve(request.result ? (request.result.data as T) : null);
        };
        request.onerror = () => {
            console.error('Error getting draft:', request.error);
            reject(request.error);
        };
    });
}

export async function getAllDraftKeys(): Promise<(string | number)[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAllKeys();

        request.onsuccess = () => {
            resolve(request.result as (string | number)[]);
        };
        request.onerror = () => {
            console.error('Error getting all draft keys:', request.error);
            reject(request.error);
        };
    });
}


export async function saveDraft(id: string | number, data: Draft): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put({ id, data });

        request.onsuccess = () => {
            resolve();
        };
        request.onerror = () => {
            console.error('Error saving draft:', request.error);
            reject(request.error);
        };
    });
}

export async function deleteDraft(id: string | number): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => {
            resolve();
        };
        request.onerror = () => {
            console.error('Error deleting draft:', request.error);
            reject(request.error);
        };
    });
}
