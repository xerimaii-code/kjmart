// FIX: Use Firebase v8 compat imports to resolve module export errors.
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/database';
import { firebaseConfig } from '../firebaseConfig';
import { Order, OrderItem, Customer, Product } from '../types';

let app: firebase.app.App | null = null;
let db: firebase.database.Database | null = null;
let auth: firebase.auth.Auth | null = null;
let isFirebaseInitialized = false;

try {
    // Check if the config is populated and not using placeholder values.
    if (firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("YOUR_")) {
        // FIX: Use v8 style initialization.
        if (!firebase.apps.length) {
            app = firebase.initializeApp(firebaseConfig);
        } else {
            app = firebase.app();
        }
        db = app.database();
        auth = app.auth();
        isFirebaseInitialized = true;
        console.log("Firebase initialized successfully.");
    } else {
        console.warn("Firebase config is not set. The app will not connect to a database. Please update firebaseConfig.ts");
    }
} catch (e) {
    console.error("Firebase initialization failed:", e);
    // isFirebaseInitialized remains false, db and auth remain null.
}

export { db, auth, isFirebaseInitialized };


const arrayToObject = (arr: any[], keyField: string) => {
    if (!Array.isArray(arr)) return {};
    return arr.reduce((obj, item) => {
        if (item && item[keyField] !== undefined) {
             obj[item[keyField]] = item;
        }
        return obj;
    }, {});
};

export const isInitialized = () => isFirebaseInitialized;

// --- Listener functions for realtime updates ---
export const attachStoreListener = <T extends { comcode: string } | { barcode: string }>(
    storeName: 'customers' | 'products',
    callbacks: {
        onAdd: (item: T) => void;
        onChange: (item: T) => void;
        onRemove: (key: string) => void;
    }
): (() => void) => {
    if (!isFirebaseInitialized || !db) return () => {};
    const storeRef = db.ref(storeName);
    
    // FIX: Use v8 compat API for listeners
    const onAdd = storeRef.on('child_added', (snapshot) => {
        const item = snapshot.val() as T;
        if (item) callbacks.onAdd(item);
    });

    const onChange = storeRef.on('child_changed', (snapshot) => {
        const item = snapshot.val() as T;
        if (item) callbacks.onChange(item);
    });

    const onRemove = storeRef.on('child_removed', (snapshot) => {
        const key = snapshot.key;
        if (key) callbacks.onRemove(key);
    });

    return () => {
        storeRef.off('child_added', onAdd);
        storeRef.off('child_changed', onChange);
        storeRef.off('child_removed', onRemove);
    };
};

export const listenToStore = <T>(storeName: string, callback: (items: T[]) => void): (() => void) => {
    if (!isFirebaseInitialized || !db) {
        callback([]);
        return () => {};
    }
    const storeRef = db.ref(storeName);
    // FIX: Use v8 compat API for listeners
    const listener = storeRef.on('value', (snapshot) => {
        const data = snapshot.val();
        const itemsArray = data ? Object.values(data).filter(item => item != null) as T[] : [];
        callback(itemsArray);
    }, (error) => {
        console.error(`Error listening to store ${storeName}:`, error);
        callback([]);
    });
    // FIX: Unsubscribe using off() method
    return () => storeRef.off('value', listener);
};

export const listenToOrderChangesByDateRange = (
    endDate: Date,
    callbacks: {
        onAdd: (order: Order) => void;
        onChange: (order: Order) => void;
        onRemove: (order: Order) => void;
    },
    startDate?: Date,
): (() => void) => {
    if (!isFirebaseInitialized || !db) {
        return () => {};
    }

    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);

    // FIX: Use v8 compat API for queries
    let ordersQuery: firebase.database.Query = db.ref('orders').orderByChild('date').endAt(endOfDay.toISOString());

    if (startDate) {
        const startOfDay = new Date(startDate);
        startOfDay.setHours(0,0,0,0);
        ordersQuery = ordersQuery.startAt(startOfDay.toISOString());
    }

    // FIX: Use v8 compat API for listeners
    const onAdd = ordersQuery.on('child_added', (snapshot) => {
        const order = snapshot.val() as Order;
        if (order) callbacks.onAdd(order);
    });
    const onChange = ordersQuery.on('child_changed', (snapshot) => {
        const order = snapshot.val() as Order;
        if (order) callbacks.onChange(order);
    });
    const onRemove = ordersQuery.on('child_removed', (snapshot) => {
        const order = snapshot.val() as Order;
        if (order) callbacks.onRemove(order);
    });
    
    // FIX: Unsubscribe using off() method
    return () => {
        ordersQuery.off('child_added', onAdd);
        ordersQuery.off('child_changed', onChange);
        ordersQuery.off('child_removed', onRemove);
    };
};

export const listenToOrderItems = (orderId: number, callback: (items: OrderItem[]) => void): (() => void) => {
    if (!isFirebaseInitialized || !db) {
        callback([]);
        return () => {};
    }
    const itemsRef = db.ref(`order-items/${orderId}`);
    // FIX: Use v8 compat API for listeners
    const listener = itemsRef.on('value', (snapshot) => {
        const data = snapshot.val();
        callback(data || []);
    }, (error) => {
        console.error(`Error listening to order items for order ${orderId}:`, error);
        callback([]);
    });
    // FIX: Unsubscribe using off() method
    return () => itemsRef.off('value', listener);
};

export const listenToValue = <T>(path: string, callback: (data: T | null) => void): (() => void) => {
     if (!isFirebaseInitialized || !db) {
         callback(null);
         return () => {};
     }
    const dataRef = db.ref(path);
    // FIX: Use v8 compat API for listeners
    const listener = dataRef.on('value', (snapshot) => {
        const data = snapshot.val();
        callback(data);
    }, (error) => {
        console.error(`Error listening to ${path}:`, error);
        callback(null);
    });
    // FIX: Unsubscribe using off() method
    return () => dataRef.off('value', listener);
};

// --- Data Fetching ---
export const getStore = async <T>(storeName: string): Promise<T[]> => {
    if (!isFirebaseInitialized || !db) return [];
    try {
        // FIX: Use v8 compat API for get()
        const snapshot = await db.ref(storeName).get();
        const data = snapshot.val();
        return data ? Object.values(data) as T[] : [];
    } catch (error) {
        console.error(`Error getting store ${storeName}:`, error);
        return [];
    }
};

export const getValue = async <T>(path: string, defaultValue: T): Promise<T> => {
    if (!isFirebaseInitialized || !db) return defaultValue;
    // FIX: Use v8 compat API for get()
    const snapshot = await db.ref(path).get();
    const data = snapshot.val();
    return data ?? defaultValue;
};

export const getOrderItems = async (orderId: number): Promise<OrderItem[]> => {
    if (!isFirebaseInitialized || !db) return [];

    // FIX: Use v8 compat API for get()
    let snapshot = await db.ref(`order-items/${orderId}`).get();
    let data = snapshot.val();

    if (!data) {
        // FIX: Use v8 compat API for get()
        snapshot = await db.ref(`orders/${orderId}/items`).get();
        data = snapshot.val();
    }

    if (!data) {
        return [];
    }
    
    const itemsArray = Array.isArray(data) ? data : Object.values(data);
    return itemsArray.filter(item => item != null);
};

// --- Data Modification ---
const DB_UNINITIALIZED_ERROR = new Error("Database not initialized");

export const addOrderWithItems = async (
    orderData: Omit<Order, 'id' | 'date' | 'createdAt' | 'completedAt' | 'completionDetails' | 'itemCount' | 'items'>, 
    items: OrderItem[]
): Promise<number> => {
    if (!isFirebaseInitialized || !db) throw DB_UNINITIALIZED_ERROR;
    const newOrderId = Date.now();
    const now = new Date().toISOString();

    const newOrder: Omit<Order, 'items'> = {
        ...orderData,
        id: newOrderId,
        date: now,
        createdAt: now,
        itemCount: items.length,
        completedAt: null,
        completionDetails: null,
    };

    const updates: { [key: string]: any } = {};
    updates[`/orders/${newOrderId}`] = newOrder;
    updates[`/order-items/${newOrderId}`] = items;

    // FIX: Use v8 compat API for update()
    await db.ref().update(updates);
    return newOrderId;
};

export const updateOrderAndItems = async (order: Omit<Order, 'items'>, items: OrderItem[]): Promise<void> => {
    if (!isFirebaseInitialized || !db) throw DB_UNINITIALIZED_ERROR;
    
    const updatedOrderData = { ...order, itemCount: items.length };
    
    const updates: { [key: string]: any } = {};
    updates[`/orders/${order.id}`] = updatedOrderData;
    updates[`/order-items/${order.id}`] = items;
    
    // FIX: Use v8 compat API for update()
    return db.ref().update(updates);
};

export const updateOrderStatus = async (
    orderId: number, 
    completionDetails: Order['completionDetails']
): Promise<void> => {
    if (!isFirebaseInitialized || !db) throw DB_UNINITIALIZED_ERROR;
    const completedAt = completionDetails ? new Date().toISOString() : null;
    const updates: { [key: string]: any } = {
        [`/orders/${orderId}/completedAt`]: completedAt,
        [`/orders/${orderId}/completionDetails`]: completionDetails,
    };
    // FIX: Use v8 compat API for update()
    return db.ref().update(updates);
};

export const deleteOrderAndItems = (orderId: number): Promise<void> => {
    if (!isFirebaseInitialized || !db) return Promise.reject(DB_UNINITIALIZED_ERROR);
    const updates: { [key: string]: null } = {};
    updates[`/orders/${orderId}`] = null;
    updates[`/order-items/${orderId}`] = null;
    // FIX: Use v8 compat API for update()
    return db.ref().update(updates);
};

export const replaceAll = <T>(storeName: string, items: T[]): Promise<void> => {
    if (!isFirebaseInitialized || !db) return Promise.reject(DB_UNINITIALIZED_ERROR);
    let keyField = '';
    if (storeName === 'customers') keyField = 'comcode';
    else if (storeName === 'products') keyField = 'barcode';
    
    // FIX: Use v8 compat API for set()
    if (!keyField) return db.ref(storeName).set(items);

    const itemsObject = arrayToObject(items, keyField);
    // FIX: Use v8 compat API for set()
    return db.ref(storeName).set(itemsObject);
};

export const setValue = (path: string, value: any): Promise<void> => {
    if (!isFirebaseInitialized || !db) return Promise.reject(DB_UNINITIALIZED_ERROR);
    // FIX: Use v8 compat API for set()
    return db.ref(path).set(value);
};

export const smartSyncData = async (dataType: 'customers' | 'products', excelItems: (Customer | Product)[], userEmail: string): Promise<void> => {
    if (!isFirebaseInitialized || !db) throw DB_UNINITIALIZED_ERROR;

    const keyField = dataType === 'customers' ? 'comcode' : 'barcode';
    const nameField = 'name';
    
    const existingItems = await getStore<Customer | Product>(dataType);
    const existingItemsMap = new Map(existingItems.map(item => [(item as any)[keyField], item]));
    const excelItemsMap = new Map(excelItems.map(item => [(item as any)[keyField], item]));

    const updates: { [key: string]: any } = {};
    const now = new Date().toISOString();

    // FIX: Use v8 compat API for ref() and push()
    const syncLogRef = db.ref(`sync-logs/${dataType}`);

    // Check for new and updated items
    for (const [key, excelItem] of excelItemsMap.entries()) {
        const existingItem = existingItemsMap.get(key);
        const newItem = { ...excelItem, lastModified: now };
        
        let isDifferent = !existingItem;
        if (existingItem) {
             isDifferent = Object.keys(excelItem).some(field => (excelItem as any)[field] !== (existingItem as any)[field]);
        }

        if (isDifferent) {
            updates[`/${dataType}/${key}`] = newItem;
            await syncLogRef.push({ timestamp: now, data: newItem });
        }
    }

    // Check for deleted items
    for (const [key, existingItem] of existingItemsMap.entries()) {
        if (!excelItemsMap.has(key)) {
            updates[`/${dataType}/${key}`] = null;
            await syncLogRef.push({
                timestamp: now,
                data: { _deleted: true, [keyField]: key, [nameField]: (existingItem as any)[nameField] }
            });
        }
    }

    if (Object.keys(updates).length > 0) {
        // FIX: Use v8 compat API for update()
        return db.ref().update(updates);
    }
    
    return Promise.resolve();
};

// --- Incremental Sync ---

export const getSyncLogChanges = async <T>(dataType: 'customers' | 'products', startAfterKey: string): Promise<{ items: T[], lastKey: string | null }> => {
    if (!db) return { items: [], lastKey: startAfterKey };
    
    // FIX: Use v8 compat API for queries
    const logsQuery = db.ref(`sync-logs/${dataType}`).orderByKey().startAt(startAfterKey);
    const snapshot = await logsQuery.get();
    
    const items: T[] = [];
    let lastKey: string | null = startAfterKey;
    
    if (snapshot.exists()) {
        snapshot.forEach(childSnapshot => {
            // startAt is inclusive, so we skip the key we started with.
            if (childSnapshot.key === startAfterKey) return;

            const logEntry = childSnapshot.val();
            items.push(logEntry.data);
            lastKey = childSnapshot.key;
        });
    }

    return { items, lastKey };
};

export const getLastSyncLogKey = async (dataType: 'customers' | 'products'): Promise<string | null> => {
    if (!db) return null;
    // FIX: Use v8 compat API for queries
    const logsQuery = db.ref(`sync-logs/${dataType}`).orderByKey().limitToLast(1);
    const snapshot = await logsQuery.get();
    if (snapshot.exists()) {
        const [key] = Object.keys(snapshot.val());
        return key;
    }
    return null;
};

export const createSyncMarker = (dataType: 'customers' | 'products'): string | null => {
    if (!isFirebaseInitialized || !db) throw DB_UNINITIALIZED_ERROR;
    // FIX: Use v8 compat API for ref() and push()
    const syncLogRef = db.ref(`sync-logs/${dataType}`);
    const newLogEntryRef = syncLogRef.push({
        timestamp: new Date().toISOString(),
        data: { _marker: true, message: 'Sync baseline created' }
    });
    return newLogEntryRef.key;
};

export const getStoreByChunks = async <T>(
    storeName: 'customers' | 'products',
    chunkSize: number,
    onChunk: (chunk: T[], isFirstChunk: boolean) => Promise<void>
): Promise<void> => {
    if (!db) return;

    let startKey: string | null = null;
    let hasMore = true;
    let isFirst = true;

    while (hasMore) {
        // FIX: Use v8 compat API for queries
        let chunkQuery = db.ref(storeName).orderByKey().limitToFirst(chunkSize + 1);
        if (startKey) {
            chunkQuery = chunkQuery.startAt(startKey);
        }

        const snapshot = await chunkQuery.get();

        if (snapshot.exists()) {
            const chunkData = snapshot.val();
            const keys = Object.keys(chunkData).sort(); // Sort keys to ensure order
            let items = keys.map(key => chunkData[key]) as T[];
            
            // For subsequent chunks, the first item is an overlap from the previous query, so we remove it.
            if (!isFirst) {
                items.shift();
            }

            if (items.length === 0) {
                hasMore = false;
                continue;
            }

            if (items.length > chunkSize) {
                // We have more data. The last key is the start for the next iteration.
                startKey = keys[keys.length - 1]; 
                await onChunk(items.slice(0, chunkSize), isFirst);
            } else {
                // This is the last chunk.
                hasMore = false;
                await onChunk(items, isFirst);
            }
            isFirst = false;
        } else {
            hasMore = false;
        }
    }
};

// --- Backup & Restore & Data Management ---
export const createBackup = async (): Promise<string> => {
    if (!isFirebaseInitialized || !db) throw DB_UNINITIALIZED_ERROR;
    // FIX: Use v8 compat API for get()
    const snapshot = await db.ref().get();
    const backupData = snapshot.val() || {};
    backupData.backupDate = new Date().toISOString();
    return JSON.stringify(backupData, null, 2);
};

export const restoreFromBackup = (jsonString: string): Promise<void> => {
    if (!isFirebaseInitialized || !db) throw DB_UNINITIALIZED_ERROR;
    const backupData = JSON.parse(jsonString);
    if (backupData.backupDate) {
        delete backupData.backupDate;
    }
    // FIX: Use v8 compat API for set()
    return db.ref().set(backupData);
};

export const clearOrders = (): Promise<void> => {
    if (!isFirebaseInitialized || !db) return Promise.reject(DB_UNINITIALIZED_ERROR);
    const updates: { [key: string]: null } = {
        '/orders': null,
        '/order-items': null,
    };
    // FIX: Use v8 compat API for update()
    return db.ref().update(updates);
};

export const performSyncLogCleanup = async (): Promise<void> => {
    if (!isFirebaseInitialized || !db) throw DB_UNINITIALIZED_ERROR;

    const retentionDays = await getValue<number>('settings/sync-logs/retentionDays', 30);
    if (retentionDays === -1) {
        console.log("Sync log retention is set to permanent. Skipping cleanup.");
        return;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoffTimestamp = cutoffDate.toISOString();

    const cleanupPromises = ['customers', 'products'].map(async (dataType) => {
        // FIX: Use v8 compat API for queries
        const logsRef = db!.ref(`sync-logs/${dataType}`);
        const logsQuery = logsRef.orderByChild('timestamp').endAt(cutoffTimestamp);
        
        const snapshot = await logsQuery.get();
        if (snapshot.exists()) {
            const updates: { [key: string]: null } = {};
            snapshot.forEach((childSnapshot) => {
                updates[`/sync-logs/${dataType}/${childSnapshot.key}`] = null;
            });
            // FIX: Use v8 compat API for update()
            await db!.ref().update(updates);
            console.log(`Cleaned up sync logs for ${dataType}.`);
        }
    });

    await Promise.all(cleanupPromises);
    await setValue('settings/sync-logs/lastCleanupTimestamp', new Date().toISOString());
};
