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
        
        // NOTE: The call to setPersistenceEnabled was removed. For the modern Firebase JS SDK,
        // offline persistence for the Realtime Database is handled automatically and does not
        // require an explicit function call to be enabled. Attempting to call the old function
        // was causing the entire initialization process to fail.
        
        db = app.database();
        auth = app.auth();
        isFirebaseInitialized = true;
        console.log("Firebase initialized successfully. Offline persistence is active by default.");
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

export const addOrderWithItems = (
    orderData: Omit<Order, 'id' | 'date' | 'createdAt' | 'updatedAt' | 'completedAt' | 'completionDetails' | 'itemCount' | 'items'>, 
    items: OrderItem[]
): Promise<number> => {
    if (!isFirebaseInitialized || !db) return Promise.reject(DB_UNINITIALIZED_ERROR);
    
    const newOrderId = Date.now();
    const now = new Date().toISOString();

    const newOrder: Omit<Order, 'items'> = {
        ...orderData,
        id: newOrderId,
        date: now,
        createdAt: now,
        updatedAt: now,
        itemCount: items.length,
        completedAt: null,
        completionDetails: null,
    };

    const updates: { [key: string]: any } = {};
    updates[`/orders/${newOrderId}`] = newOrder;
    updates[`/order-items/${newOrderId}`] = items;

    db.ref().update(updates).catch(err => {
        console.error("Firebase background update failed for addOrderWithItems:", err);
    });

    return Promise.resolve(newOrderId);
};

export const updateOrderAndItems = (order: Omit<Order, 'items'>, items: OrderItem[]): Promise<void> => {
    if (!isFirebaseInitialized || !db) return Promise.reject(DB_UNINITIALIZED_ERROR);
    
    const now = new Date().toISOString();
    const updatedOrderData = { ...order, itemCount: items.length, updatedAt: now, date: now };
    
    const updates: { [key: string]: any } = {};
    updates[`/orders/${order.id}`] = updatedOrderData;
    updates[`/order-items/${order.id}`] = items;
    
    db.ref().update(updates).catch(err => {
        console.error("Firebase background update failed for updateOrderAndItems:", err);
    });
    
    return Promise.resolve();
};

export const updateOrderStatus = (
    orderId: number, 
    completionDetails: Order['completionDetails']
): Promise<void> => {
    if (!isFirebaseInitialized || !db) return Promise.reject(DB_UNINITIALIZED_ERROR);
    
    const now = new Date().toISOString();
    const completedAt = completionDetails ? now : null;
    const updates: { [key: string]: any } = {
        [`/orders/${orderId}/completedAt`]: completedAt,
        [`/orders/${orderId}/completionDetails`]: completionDetails,
        [`/orders/${orderId}/updatedAt`]: now,
        [`/orders/${orderId}/date`]: now,
    };

    db.ref().update(updates).catch(err => {
        console.error("Firebase background update failed for updateOrderStatus:", err);
    });
    
    return Promise.resolve();
};

export const deleteOrderAndItems = (orderId: number): Promise<void> => {
    if (!isFirebaseInitialized || !db) return Promise.reject(DB_UNINITIALIZED_ERROR);
    
    const updates: { [key: string]: null } = {};
    updates[`/orders/${orderId}`] = null;
    updates[`/order-items/${orderId}`] = null;
    
    db.ref().update(updates).catch(err => {
        console.error("Firebase background update failed for deleteOrderAndItems:", err);
    });
    
    return Promise.resolve();
};

export const replaceAll = async <T>(storeName: string, items: T[] | null): Promise<void> => {
    if (!isFirebaseInitialized || !db) throw DB_UNINITIALIZED_ERROR;
    
    let dataToSet: any = items;
    if (items) {
        let keyField = '';
        if (storeName === 'customers') keyField = 'comcode';
        else if (storeName === 'products') keyField = 'barcode';
        dataToSet = keyField ? arrayToObject(items, keyField) : items;
    }

    await db.ref(storeName).set(dataToSet);
};


export const clearOrders = async (): Promise<void> => {
    if (!isFirebaseInitialized || !db) throw DB_UNINITIALIZED_ERROR;

    const updates: { [key: string]: null } = {};
    updates['/orders'] = null;
    updates['/order-items'] = null;

    await db.ref().update(updates);
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


export const setValue = async (path: string, value: any): Promise<void> => {
    if (!isFirebaseInitialized || !db) throw DB_UNINITIALIZED_ERROR;
    await db.ref(path).set(value);
};

// --- Sync Log Management ---

// Helper function to create a fully normalized, comparable product object.
// This ensures that optional fields from Excel (undefined) are compared correctly against
// existing data from Firebase (which might have "" or null).
const createComparableProduct = (item: any) => ({
    barcode: item.barcode || '',
    name: (item.name || '').trim(),
    costPrice: Number(item.costPrice || 0),
    sellingPrice: Number(item.sellingPrice || 0),
    salePrice: item.salePrice == null ? '' : String(item.salePrice).trim(),
    saleEndDate: item.saleEndDate || '',
    supplierName: (item.supplierName || '').trim(),
});

// Helper for customers.
const createComparableCustomer = (item: any) => ({
    comcode: item.comcode || '',
    name: (item.name || '').trim(),
});

const areObjectsEqual = (newItem: any, existingItem: any, type: 'customers' | 'products'): boolean => {
    if (!newItem || !existingItem) return false;

    if (type === 'products') {
        return JSON.stringify(createComparableProduct(newItem)) === JSON.stringify(createComparableProduct(existingItem));
    }
    
    if (type === 'customers') {
        return JSON.stringify(createComparableCustomer(newItem)) === JSON.stringify(createComparableCustomer(existingItem));
    }

    // Fallback for any other type (should not happen)
    const { lastModified: lm1, ...rest1 } = newItem;
    const { lastModified: lm2, ...rest2 } = existingItem;
    return JSON.stringify(rest1) === JSON.stringify(rest2);
};


export const smartSyncData = async (
    storeName: 'customers' | 'products',
    newData: (Customer | Product)[],
    userEmail: string,
    onProgress: (message: string) => void,
    existingDataArray: (Customer | Product)[],
    options?: { bypassMassDeleteCheck?: boolean }
): Promise<{ additions: number; updates: number; deletions: number; }> => {
    if (!isInitialized() || !db) throw DB_UNINITIALIZED_ERROR;

    const keyField = storeName === 'customers' ? 'comcode' : 'barcode';
    
    onProgress(`기존 데이터(${existingDataArray.length}건)와 비교 시작...`);
    await new Promise(resolve => setTimeout(resolve, 0)); // Yield to main thread

    const existingDataMap = new Map(existingDataArray.map(item => [(item as any)[keyField], item]));
    const newDataMap = new Map(newData.map(item => [(item as any)[keyField], item]));
    
    const deletions = Array.from(existingDataMap.keys()).filter(key => !newDataMap.has(key));
    const numDeletions = deletions.length;
    const numExisting = existingDataMap.size;
    const numNew = newDataMap.size;

    // Safeguard against accidental mass deletion
    if (!options?.bypassMassDeleteCheck && numExisting > 100 && numDeletions > numExisting * 0.5) {
        const error = new Error("MASS_DELETION_DETECTED");
        const parsedResult = { valid: newData }; // Create a minimal structure for the proceed function
        (error as any).details = { numExisting, numNew, numDeletions, parsedResult };
        throw error;
    }

    const updates: { [key: string]: any } = {};
    const timestamp = firebase.database.ServerValue.TIMESTAMP;
    const nowISO = new Date().toISOString();
    const logUser = userEmail.split('@')[0];
    
    let additionsCount = 0;
    let updatesCount = 0;

    const totalNew = newData.length;
    let processedNew = 0;

    // Process updates and additions
    for (const [key, newItem] of newDataMap.entries()) {
        const existingItem = existingDataMap.get(key);
        
        // FIX: Normalize the new item from the Excel file before comparison and saving.
        // This ensures data consistency between the source and the database, preventing
        // false positives on subsequent syncs.
        const normalizedNewItem = storeName === 'products'
            ? createComparableProduct(newItem)
            : createComparableCustomer(newItem);

        const itemWithMeta = { ...normalizedNewItem, lastModified: nowISO };
        const logRefKey = db.ref(`/sync-logs/${storeName}`).push().key;

        if (!existingItem) {
            additionsCount++;
            if (logRefKey) {
                updates[`/${storeName}/${key}`] = itemWithMeta;
                updates[`/sync-logs/${storeName}/${logRefKey}`] = { ...itemWithMeta, timestamp, user: logUser };
            }
        } else if (!areObjectsEqual(normalizedNewItem, existingItem, storeName)) {
            updatesCount++;
            if (logRefKey) {
                updates[`/${storeName}/${key}`] = itemWithMeta;
                updates[`/sync-logs/${storeName}/${logRefKey}`] = { ...itemWithMeta, timestamp, user: logUser };
            }
        }

        processedNew++;
        if (processedNew % 100 === 0) { // Yield to main thread every 100 items
            onProgress(`변경/추가 확인 중... (${processedNew}/${totalNew})`);
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
            onProgress(`삭제 항목 확인 중... (${processedExisting}/${totalExisting})`);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    if (Object.keys(updates).length > 0) {
        onProgress('데이터베이스에 업로드 중...');
        await db.ref().update(updates);
    }

    return { additions: additionsCount, updates: updatesCount, deletions: numDeletions };
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