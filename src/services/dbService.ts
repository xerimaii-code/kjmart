import { initializeApp, FirebaseApp } from 'firebase/app';
import { getDatabase, ref, onValue, get, set, remove, query, orderByChild, startAt, endAt, update, onChildAdded, onChildChanged, onChildRemoved, Database, push, limitToLast, orderByKey, limitToFirst } from 'firebase/database';
import { getAuth, Auth } from 'firebase/auth';
import { firebaseConfig } from '../firebaseConfig';
import { Order, OrderItem, Customer, Product } from '../types';

let app: FirebaseApp | null = null;
let db: Database | null = null;
let auth: Auth | null = null;
let isFirebaseInitialized = false;

try {
    // Check if the config is populated and not using placeholder values.
    if (firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("YOUR_")) {
        app = initializeApp(firebaseConfig);
        db = getDatabase(app);
        auth = getAuth(app);
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
    const storeRef = ref(db, storeName);
    
    const unsubAdded = onChildAdded(storeRef, (snapshot) => {
        const item = snapshot.val() as T;
        if (item) callbacks.onAdd(item);
    });

    const unsubChanged = onChildChanged(storeRef, (snapshot) => {
        const item = snapshot.val() as T;
        if (item) callbacks.onChange(item);
    });

    const unsubRemoved = onChildRemoved(storeRef, (snapshot) => {
        const key = snapshot.key;
        if (key) callbacks.onRemove(key);
    });

    return () => {
        unsubAdded();
        unsubChanged();
        unsubRemoved();
    };
};

export const listenToStore = <T>(storeName: string, callback: (items: T[]) => void): (() => void) => {
    if (!isFirebaseInitialized || !db) {
        callback([]);
        return () => {};
    }
    const storeRef = ref(db, storeName);
    return onValue(storeRef, (snapshot) => {
        const data = snapshot.val();
        const itemsArray = data ? Object.values(data).filter(item => item != null) as T[] : [];
        callback(itemsArray);
    }, (error) => {
        console.error(`Error listening to store ${storeName}:`, error);
        callback([]);
    });
};

export const listenToOrdersByDateRange = (
    endDate: Date,
    callback: (orders: Order[]) => void,
    startDate?: Date,
): (() => void) => {
    if (!isFirebaseInitialized || !db) {
        callback([]);
        return () => {};
    }

    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);

    const queryConstraints: any[] = [
        orderByChild('date'),
        endAt(endOfDay.toISOString())
    ];

    if (startDate) {
        const startOfDay = new Date(startDate);
        startOfDay.setHours(0,0,0,0);
        queryConstraints.push(startAt(startOfDay.toISOString()));
    }

    const ordersQuery = query(
        ref(db, 'orders'),
        ...queryConstraints
    );

    return onValue(ordersQuery, (snapshot) => {
        const data = snapshot.val();
        const ordersArray = data ? Object.values(data) as Order[] : [];
        callback(ordersArray);
    }, (error) => {
        console.error('Error listening to orders by date range:', error);
        callback([]);
    });
};

export const listenToOrderItems = (orderId: number, callback: (items: OrderItem[]) => void): (() => void) => {
    if (!isFirebaseInitialized || !db) {
        callback([]);
        return () => {};
    }
    const itemsRef = ref(db, `order-items/${orderId}`);
    return onValue(itemsRef, (snapshot) => {
        const data = snapshot.val();
        callback(data || []);
    }, (error) => {
        console.error(`Error listening to order items for order ${orderId}:`, error);
        callback([]);
    });
};

export const listenToValue = <T>(path: string, callback: (data: T | null) => void): (() => void) => {
     if (!isFirebaseInitialized || !db) {
         callback(null);
         return () => {};
     }
    const dataRef = ref(db, path);
    return onValue(dataRef, (snapshot) => {
        const data = snapshot.val();
        callback(data);
    }, (error) => {
        console.error(`Error listening to ${path}:`, error);
        callback(null);
    });
};

// --- Data Fetching ---
export const getStore = async <T>(storeName: string): Promise<T[]> => {
    if (!isFirebaseInitialized || !db) return [];
    try {
        const snapshot = await get(ref(db, storeName));
        const data = snapshot.val();
        return data ? Object.values(data) as T[] : [];
    } catch (error) {
        console.error(`Error getting store ${storeName}:`, error);
        return [];
    }
};

export const getValue = async <T>(path: string, defaultValue: T): Promise<T> => {
    if (!isFirebaseInitialized || !db) return defaultValue;
    const snapshot = await get(ref(db, path));
    const data = snapshot.val();
    return data ?? defaultValue;
};

export const getOrderItems = async (orderId: number): Promise<OrderItem[]> => {
    if (!isFirebaseInitialized || !db) return [];

    let snapshot = await get(ref(db, `order-items/${orderId}`));
    let data = snapshot.val();

    if (!data) {
        snapshot = await get(ref(db, `orders/${orderId}/items`));
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

    await update(ref(db), updates);
    return newOrderId;
};

export const updateOrderAndItems = async (order: Omit<Order, 'items'>, items: OrderItem[]): Promise<void> => {
    if (!isFirebaseInitialized || !db) throw DB_UNINITIALIZED_ERROR;
    
    const updatedOrderData = { ...order, itemCount: items.length };
    
    const updates: { [key: string]: any } = {};
    updates[`/orders/${order.id}`] = updatedOrderData;
    updates[`/order-items/${order.id}`] = items;
    
    return update(ref(db!), updates);
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
    return update(ref(db), updates);
};

export const deleteOrderAndItems = (orderId: number): Promise<void> => {
    if (!isFirebaseInitialized || !db) return Promise.reject(DB_UNINITIALIZED_ERROR);
    const updates: { [key: string]: null } = {};
    updates[`/orders/${orderId}`] = null;
    updates[`/order-items/${orderId}`] = null;
    return update(ref(db), updates);
};

export const replaceAll = <T>(storeName: string, items: T[]): Promise<void> => {
    if (!isFirebaseInitialized || !db) return Promise.reject(DB_UNINITIALIZED_ERROR);
    let keyField = '';
    if (storeName === 'customers') keyField = 'comcode';
    else if (storeName === 'products') keyField = 'barcode';
    
    if (!keyField) return set(ref(db, storeName), items);

    const itemsObject = arrayToObject(items, keyField);
    return set(ref(db, storeName), itemsObject);
};

export const setValue = (path: string, value: any): Promise<void> => {
    if (!isFirebaseInitialized || !db) return Promise.reject(DB_UNINITIALIZED_ERROR);
    return set(ref(db, path), value);
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

    const syncLogRef = ref(db, `sync-logs/${dataType}`);

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
            await push(syncLogRef, { timestamp: now, data: newItem });
        }
    }

    // Check for deleted items
    for (const [key, existingItem] of existingItemsMap.entries()) {
        if (!excelItemsMap.has(key)) {
            updates[`/${dataType}/${key}`] = null;
            await push(syncLogRef, {
                timestamp: now,
                data: { _deleted: true, [keyField]: key, [nameField]: (existingItem as any)[nameField] }
            });
        }
    }

    if (Object.keys(updates).length > 0) {
        return update(ref(db), updates);
    }
    
    return Promise.resolve();
};

// --- Incremental Sync ---

export const getSyncLogChanges = async <T>(dataType: 'customers' | 'products', startAfterKey: string): Promise<{ items: T[], lastKey: string | null }> => {
    if (!db) return { items: [], lastKey: startAfterKey };
    
    const logsQuery = query(ref(db, `sync-logs/${dataType}`), orderByKey(), startAt(startAfterKey));
    const snapshot = await get(logsQuery);
    
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
    const logsQuery = query(ref(db, `sync-logs/${dataType}`), orderByKey(), limitToLast(1));
    const snapshot = await get(logsQuery);
    if (snapshot.exists()) {
        const [key] = Object.keys(snapshot.val());
        return key;
    }
    return null;
};

export const createSyncMarker = (dataType: 'customers' | 'products'): string | null => {
    if (!isFirebaseInitialized || !db) throw DB_UNINITIALIZED_ERROR;
    const syncLogRef = ref(db, `sync-logs/${dataType}`);
    const newLogEntryRef = push(syncLogRef, {
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
        const constraints: any[] = [orderByKey(), limitToFirst(chunkSize + 1)];
        if (startKey) {
            constraints.push(startAt(startKey));
        }

        const chunkQuery = query(ref(db, storeName), ...constraints);
        const snapshot = await get(chunkQuery);

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

            if (keys.length > chunkSize) {
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
    const snapshot = await get(ref(db));
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
    return set(ref(db), backupData);
};

export const clearOrders = (): Promise<void> => {
    if (!isFirebaseInitialized || !db) return Promise.reject(DB_UNINITIALIZED_ERROR);
    const updates: { [key: string]: null } = {
        '/orders': null,
        '/order-items': null,
    };
    return update(ref(db), updates);
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
        const logsRef = ref(db, `sync-logs/${dataType}`);
        const logsQuery = query(logsRef, orderByChild('timestamp'), endAt(cutoffTimestamp));
        
        const snapshot = await get(logsQuery);
        if (snapshot.exists()) {
            const updates: { [key: string]: null } = {};
            snapshot.forEach((childSnapshot) => {
                updates[`/sync-logs/${dataType}/${childSnapshot.key}`] = null;
            });
            await update(ref(db), updates);
            console.log(`Cleaned up sync logs for ${dataType}.`);
        }
    });

    await Promise.all(cleanupPromises);
    await setValue('settings/sync-logs/lastCleanupTimestamp', new Date().toISOString());
};