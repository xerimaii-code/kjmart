import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, get, set, remove, onChildAdded, onChildChanged, onChildRemoved } from 'firebase/database';
import { firebaseConfig } from '../firebaseConfig';
import { Order } from '../types';

let app;
let db;
let dbInitialized = false;

export const isInitialized = () => dbInitialized;

export const initDB = (): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (dbInitialized) {
            resolve();
            return;
        }
        if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith('YOUR_')) {
            const errorMsg = "Firebase config is not set. The app will not connect to a database. Please update firebaseConfig.ts";
            console.warn(errorMsg);
            reject(new Error(errorMsg));
            return;
        }
        try {
            app = initializeApp(firebaseConfig);
            db = getDatabase(app);
            dbInitialized = true;
            console.log("Firebase initialized successfully.");
            resolve();
        } catch (e) {
            console.error("Firebase initialization failed:", e);
            reject(e as Error);
        }
    });
};

const arrayToObject = (arr: any[], keyField: string) => {
    if (!Array.isArray(arr)) return {};
    return arr.reduce((obj, item) => {
        if (item && item[keyField] !== undefined) {
             obj[item[keyField]] = item;
        }
        return obj;
    }, {});
};

// --- Listener functions for realtime updates ---
export const listenToStore = <T>(storeName: string, callback: (data: T[]) => void): (() => void) => {
    if (!dbInitialized) return () => {};
    const dataRef = ref(db, storeName);
    return onValue(dataRef, (snapshot) => {
        const data = snapshot.val();
        const dataArray = data ? Object.values(data) as T[] : [];
        callback(dataArray);
    }, (error) => {
        console.error(`Error listening to ${storeName}:`, error);
        callback([]);
    });
};

export interface OrderChangeEvent {
    type: 'added' | 'changed' | 'removed';
    order: Order;
}

/**
 * Listens for granular changes (add, change, remove) to the 'orders' collection.
 * This is more efficient than listening for 'value' on the entire collection.
 * @param callback A function to be called with the change event.
 * @returns An unsubscribe function to detach all listeners.
 */
export const listenToOrderChanges = (
    callback: (event: OrderChangeEvent) => void
): (() => void) => {
    if (!dbInitialized) return () => {};
    const ordersRef = ref(db, 'orders');

    const unsubscribers = [
        onChildAdded(ordersRef, (snapshot) => {
            const order = snapshot.val() as Order;
            if (order) callback({ type: 'added', order });
        }),
        onChildChanged(ordersRef, (snapshot) => {
            const order = snapshot.val() as Order;
            if (order) callback({ type: 'changed', order });
        }),
        onChildRemoved(ordersRef, (snapshot) => {
            const order = snapshot.val() as Order;
            if (order) callback({ type: 'removed', order });
        })
    ];
    
    return () => unsubscribers.forEach(unsub => unsub());
};

export const listenToSetting = <T>(key: string, callback: (data: T | null) => void): (() => void) => {
     if (!dbInitialized) return () => {};
    const settingRef = ref(db, `settings/${key}`);
    return onValue(settingRef, (snapshot) => {
        const data = snapshot.val();
        callback(data ? data.value : null);
    }, (error) => {
        console.error(`Error listening to setting ${key}:`, error);
        callback(null);
    });
};

export const listenToValue = <T>(path: string, callback: (data: T | null) => void): (() => void) => {
     if (!dbInitialized) return () => {};
    const dataRef = ref(db, path);
    return onValue(dataRef, (snapshot) => {
        const data = snapshot.val();
        callback(data);
    }, (error) => {
        console.error(`Error listening to ${path}:`, error);
        callback(null);
    });
};

// --- Functions matching the old dbService API ---
export const getAll = async <T>(storeName: string): Promise<T[]> => {
    if (!dbInitialized) return [];
    const snapshot = await get(ref(db, storeName));
    const data = snapshot.val();
    return data ? Object.values(data) as T[] : [];
};

export const put = async (storeName: string, item: any): Promise<void> => {
    if (!dbInitialized) return Promise.resolve();
    let key;
    if (storeName === 'customers') key = item.comcode;
    else if (storeName === 'products') key = item.barcode;
    else if (storeName === 'orders') key = item.id;
    else if (storeName === 'settings') key = item.key;

    if (!key) throw new Error(`Could not determine key for item in store ${storeName}`);
    
    return set(ref(db, `${storeName}/${key}`), item);
};

export const deleteByKey = (storeName: string, key: IDBValidKey): Promise<void> => {
    if (!dbInitialized) return Promise.resolve();
    return remove(ref(db, `${storeName}/${key}`));
};

export const replaceAll = <T>(storeName: string, items: T[]): Promise<void> => {
    if (!dbInitialized) return Promise.resolve();
    let keyField = '';
    if (storeName === 'customers') keyField = 'comcode';
    else if (storeName === 'products') keyField = 'barcode';
    else if (storeName === 'orders') keyField = 'id';
    
    if (!keyField) return set(ref(db, storeName), items);

    const itemsObject = arrayToObject(items, keyField);
    return set(ref(db, storeName), itemsObject);
};

export const getSetting = async <T>(key: string, defaultValue: T): Promise<T> => {
    if (!dbInitialized) return defaultValue;
    const snapshot = await get(ref(db, `settings/${key}`));
    const data = snapshot.val();
    return data ? data.value : defaultValue;
};

export const setSetting = (key: string, value: any): Promise<void> => {
    return put('settings', { key, value });
};

export const getValue = async <T>(path: string, defaultValue: T): Promise<T> => {
    if (!dbInitialized) return defaultValue;
    const snapshot = await get(ref(db, path));
    const data = snapshot.val();
    return data ?? defaultValue;
};

export const setValue = (path: string, value: any): Promise<void> => {
    if (!dbInitialized) return Promise.resolve();
    return set(ref(db, path), value);
};


// --- Backup & Restore & Data Management ---

export const createBackup = async (): Promise<string> => {
    if (!dbInitialized) throw new Error("데이터베이스에 연결되지 않았습니다.");
    const snapshot = await get(ref(db));
    const backupData = snapshot.val() || {};
    backupData.backupDate = new Date().toISOString();
    return JSON.stringify(backupData, null, 2);
};

export const createOrdersBackup = async (): Promise<string> => {
    if (!dbInitialized) throw new Error("데이터베이스에 연결되지 않았습니다.");
    const snapshot = await get(ref(db, 'orders'));
    const ordersData = snapshot.val() || {};
    const backupData = { 
        orders: ordersData,
        backupDate: new Date().toISOString()
    };
    return JSON.stringify(backupData, null, 2);
};

export const restoreFromBackup = (jsonString: string): Promise<void> => {
    if (!dbInitialized) throw new Error("데이터베이스에 연결되지 않았습니다.");
    const backupData = JSON.parse(jsonString);
    if (backupData.backupDate) {
        delete backupData.backupDate; // Don't restore the backup date itself
    }
    return set(ref(db), backupData);
};

export const restoreOrdersFromBackup = (jsonString: string): Promise<void> => {
    if (!dbInitialized) throw new Error("데이터베이스에 연결되지 않았습니다.");
    const backupData = JSON.parse(jsonString);
    if (backupData.orders === undefined) {
        throw new Error("유효하지 않은 발주 내역 백업 파일 형식입니다.");
    }
    return set(ref(db, 'orders'), backupData.orders);
};

export const clearAllData = (): Promise<void> => {
    if (!dbInitialized) return Promise.resolve();
    return remove(ref(db));
};

export const clearOrders = (): Promise<void> => {
    if (!dbInitialized) return Promise.resolve();
    return remove(ref(db, 'orders'));
};

export const hasData = async (): Promise<boolean> => {
    if (!dbInitialized) return false;
    const snapshot = await get(ref(db));
    return snapshot.exists() && snapshot.hasChildren();
};