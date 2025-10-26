// FIX: Use Firebase v8 compat imports to resolve module export errors.
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/database';
import { firebaseConfig } from '../firebaseConfig';
import { Order, OrderItem, Customer, Product, SyncLog } from '../types';

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

export const fetchUpdatesSince = async <T extends Customer | Product>(storeName: string, timestamp: string | null): Promise<T[]> => {
    if (!isInitialized() || !db) return [];
    
    let query = db.ref(storeName).orderByChild('lastModified');
    if (timestamp) {
        // startAt is inclusive, so we need to handle the first item carefully if it matches the timestamp.
        // A simple way is to fetch and filter, or add a tiny bit to the timestamp string if possible,
        // but for ISO strings, direct comparison works.
        query = query.startAt(timestamp);
    }

    const snapshot = await query.get();
    if (!snapshot.exists()) return [];

    const updates: T[] = [];
    snapshot.forEach(childSnapshot => {
        const item = childSnapshot.val() as T;
        // Exclude the item that exactly matches the starting timestamp to avoid reprocessing it.
        if (item.lastModified !== timestamp) {
            updates.push(item);
        }
    });
    return updates;
};

export const listenForNewChanges = <T extends Customer | Product>(
    storeName: string, 
    timestamp: string | null,
    callbacks: { 
        onAdd: (item: T) => void, 
        onChange: (item: T) => void,
    }
): (() => void) => {
    if (!isInitialized() || !db) return () => {};

    let query = db.ref(storeName).orderByChild('lastModified');
    if (timestamp) {
        query = query.startAt(timestamp);
    }
    
    const addListener = query.on('child_added', (snapshot) => {
        const item = snapshot.val() as T;
        // FIX: Ignore the initial event for items at the exact start timestamp.
        // This prevents re-processing data that was already handled by the initial sync.
        if (item.lastModified && timestamp && item.lastModified === timestamp) {
            return;
        }
        // Only process truly new items that arrived after the initial sync.
        callbacks.onAdd(item);
    });

    const changeListener = query.on('child_changed', (snapshot) => {
        callbacks.onChange(snapshot.val() as T);
    });
    
    return () => {
        query.off('child_added', addListener);
        query.off('child_changed', changeListener);
    };
}


// --- Data Fetching ---
export const getStore = async <T>(storeName: string): Promise<T[]> => {
    if (!isFirebaseInitialized || !db) return [];
    try {
        const snapshot = await db.ref(storeName).get();
        const data = snapshot.val();
        if (!data) {
            return [];
        }

        const values = Object.values(data).filter(item => item != null);
        
        if (storeName === 'customers') {
            return values.filter(item => (item as Customer).comcode) as T[];
        }
        if (storeName === 'products') {
            return values.filter(item => (item as Product).barcode) as T[];
        }
        
        // For any other store, just return the non-null values
        return values as T[];

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
    // FIX: Use v8 compat API for set
    return db.ref(storeName).set(itemsObject);
};

export const clearOrders = (): Promise<void> => {
    if (!isFirebaseInitialized || !db) return Promise.reject(DB_UNINITIALIZED_ERROR);
    const updates: { [key: string]: null } = {};
    updates['/orders'] = null;
    updates['/order-items'] = null;
    // FIX: Use v8 compat API for update()
    return db.ref().update(updates);
};

export const clearOrdersBeforeDate = async (isoDateString: string): Promise<number> => {
    if (!isFirebaseInitialized || !db) throw DB_UNINITIALIZED_ERROR;

    const ordersQuery = db.ref('orders').orderByChild('date').endAt(isoDateString);
    const snapshot = await ordersQuery.get();

    if (!snapshot.exists()) {
        return 0; // No orders to delete
    }

    const updates: { [key: string]: null } = {};
    let deletedCount = 0;
    snapshot.forEach(childSnapshot => {
        const orderId = childSnapshot.key;
        if (orderId) {
            updates[`/orders/${orderId}`] = null;
            updates[`/order-items/${orderId}`] = null;
            deletedCount++;
        }
    });

    if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
    }
    
    return deletedCount;
};

export const setValue = (path: string, value: any): Promise<void> => {
    if (!isFirebaseInitialized || !db) return Promise.reject(DB_UNINITIALIZED_ERROR);
    // FIX: Use v8 compat API for set()
    return db.ref(path).set(value);
};

// --- Backup & Restore ---
export const createBackup = async (): Promise<string> => {
    if (!isFirebaseInitialized || !db) throw DB_UNINITIALIZED_ERROR;
    // FIX: Use v8 compat API for get()
    const snapshot = await db.ref().get();
    return JSON.stringify(snapshot.val(), null, 2);
};

export const restoreFromBackup = (json: string): Promise<void> => {
    if (!isFirebaseInitialized || !db) return Promise.reject(DB_UNINITIALIZED_ERROR);
    const data = JSON.parse(json);
    // FIX: Use v8 compat API for set()
    return db.ref().set(data);
};

// --- Sync Log Management ---

export const smartSyncData = async (
    storeName: 'customers' | 'products',
    newData: (Customer | Product)[],
    userEmail: string,
    onProgress?: (message: string) => void,
    options?: { bypassMassDeleteCheck?: boolean }
): Promise<void> => {
    if (!isFirebaseInitialized || !db) throw DB_UNINITIALIZED_ERROR;

    const keyField = storeName === 'customers' ? 'comcode' : 'barcode';
    
    onProgress?.('기존 데이터 로딩 중...');
    await new Promise(resolve => setTimeout(resolve, 0)); // Yield to main thread

    const existingDataArray = await getStore<Customer | Product>(storeName);
    const existingDataMap = new Map(existingDataArray.map(item => [(item as any)[keyField], item]));
    const newDataMap = new Map(newData.map(item => [(item as any)[keyField], item]));
    
    const deletions = Array.from(existingDataMap.keys()).filter(key => !newDataMap.has(key));
    const numDeletions = deletions.length;
    const numExisting = existingDataMap.size;
    const numNew = newDataMap.size;

    // Safeguard against accidental mass deletion
    if (!options?.bypassMassDeleteCheck && numExisting > 100 && numDeletions > numExisting * 0.5) {
        const error = new Error("MASS_DELETION_DETECTED");
        (error as any).details = { numExisting, numNew, numDeletions };
        throw error;
    }

    const updates: { [key: string]: any } = {};
    const timestamp = firebase.database.ServerValue.TIMESTAMP;
    const nowISO = new Date().toISOString();
    const logUser = userEmail.split('@')[0];

    const totalNew = newData.length;
    let processedNew = 0;

    // Process updates and additions
    for (const [key, newItem] of newDataMap.entries()) {
        const existingItem = existingDataMap.get(key);
        
        const { lastModified: _e, ...restExisting } = existingItem || {};
        const { lastModified: _n, ...restNew } = newItem as any;
        
        if (!existingItem || JSON.stringify(restExisting) !== JSON.stringify(restNew)) {
            const itemWithMeta = { ...newItem, lastModified: nowISO };
            const logRefKey = db.ref(`/sync-logs/${storeName}`).push().key;

            if (logRefKey) {
                updates[`/${storeName}/${key}`] = itemWithMeta;
                updates[`/sync-logs/${storeName}/${logRefKey}`] = { ...itemWithMeta, timestamp, user: logUser };
            }
        }

        processedNew++;
        if (processedNew % 100 === 0) { // Yield to main thread every 100 items
            onProgress?.(`변경/추가 확인 중... (${processedNew}/${totalNew})`);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    const totalExisting = deletions.length;
    let processedExisting = 0;
    // Process deletions
    for (const key of deletions) {
        const existingItem = existingDataMap.get(key);
        const logRefKey = db.ref(`/sync-logs/${storeName}`).push().key;
        if (logRefKey) {
            updates[`/${storeName}/${key}`] = null;
            updates[`/sync-logs/${storeName}/${logRefKey}`] = { 
                [keyField]: key, 
                name: (existingItem as any)?.name,
                _deleted: true, 
                timestamp, 
                user: logUser 
            };
        }
        processedExisting++;
        if (processedExisting % 100 === 0) {
            onProgress?.(`삭제 항목 확인 중... (${processedExisting}/${totalExisting})`);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    if (Object.keys(updates).length > 0) {
        onProgress?.('데이터베이스에 업로드 중...');
        await db.ref().update(updates);
    }
};

export const getSyncLogChanges = async (
    dataType: 'customers' | 'products',
    lastKey: string | null
): Promise<{ items: any[], newLastKey: string | null }> => {
    if (!isFirebaseInitialized || !db) return { items: [], newLastKey: lastKey };

    let query = db.ref(`sync-logs/${dataType}`).orderByKey();
    if (lastKey) {
        // 'startAfter' does not exist in the RTDB SDK. Use 'startAt' instead.
        query = query.startAt(lastKey);
    }
    
    const snapshot = await query.get();
    if (!snapshot.exists()) {
        return { items: [], newLastKey: lastKey };
    }

    const items: any[] = [];
    let processedLastKey: string | null = lastKey;
    let isFirst = true;

    snapshot.forEach(childSnapshot => {
        // If we started at a specific key (lastKey), we must skip that key itself in the results
        // because 'startAt' is inclusive.
        if (lastKey && isFirst && childSnapshot.key === lastKey) {
            isFirst = false; // Set flag so we don't skip subsequent items
            return; // Skip this item
        }
        
        isFirst = false; // Not the first item anymore
        items.push(childSnapshot.val());
        processedLastKey = childSnapshot.key;
    });

    return { items, newLastKey: processedLastKey };
};

export const getLastSyncLogKey = async (dataType: 'customers' | 'products'): Promise<string | null> => {
     if (!isFirebaseInitialized || !db) return null;
     const snapshot = await db.ref(`sync-logs/${dataType}`).orderByKey().limitToLast(1).get();
     if (snapshot.exists()) {
        const val = snapshot.val();
        const [key] = Object.keys(val);
        return key || null;
     }
     return null;
}

export const getSyncLogs = async (dataType: 'customers' | 'products', limit: number = 100): Promise<SyncLog[]> => {
    if (!isFirebaseInitialized || !db) return [];
    const snapshot = await db.ref(`sync-logs/${dataType}`).orderByKey().limitToLast(limit).get();
    if (!snapshot.exists()) return [];
    
    const logs: SyncLog[] = [];
    snapshot.forEach(child => {
        logs.push({ ...child.val(), _key: child.key });
    });
    
    return logs.reverse(); // Newest first
};

export const listenForNewLogs = (
    dataType: 'customers' | 'products',
    startKey: string | null,
    callback: (newItem: any, itemKey: string) => void
): (() => void) => {
    if (!isFirebaseInitialized || !db) return () => {};

    let query = db.ref(`sync-logs/${dataType}`).orderByKey();
    
    // The 'startAfter' method does not exist in the Realtime Database SDK.
    // The correct approach is to use 'startAt'.
    if (startKey) {
        query = query.startAt(startKey);
    } else {
        // If there is no startKey, it means we've just completed a full sync and
        // only want to listen for brand new changes from this point forward.
        // We can generate a push key for "now" and start listening from there,
        // effectively ignoring all past records. Firebase push keys are chronologically ordered.
        const nowKey = db.ref().push().key;
        if (nowKey) {
            query = query.startAt(nowKey);
        }
    }

    const listener = query.on('child_added', (snapshot) => {
        // Since startAt is inclusive, we must explicitly ignore the event for the startKey itself.
        if (snapshot.key && snapshot.key !== startKey) {
            callback(snapshot.val(), snapshot.key);
        }
    });

    return () => query.off('child_added', listener);
};

export const cleanupSyncLogs = async (dataType: 'customers' | 'products', retentionDays: number): Promise<void> => {
    if (!isFirebaseInitialized || !db || retentionDays < 0) return; // -1 means keep forever

    const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    const logRef = db.ref(`sync-logs/${dataType}`);
    
    const snapshot = await logRef.orderByChild('timestamp').endAt(cutoff).get();

    if (snapshot.exists()) {
        const updates: { [key: string]: null } = {};
        snapshot.forEach(child => {
            if (child.key) {
                updates[child.key] = null;
            }
        });
        if (Object.keys(updates).length > 0) {
            await logRef.update(updates);
            console.log(`Cleaned up ${Object.keys(updates).length} old logs for ${dataType}.`);
        }
    }
};
