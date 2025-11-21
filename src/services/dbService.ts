// src/services/dbService.ts
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, User } from 'firebase/auth';
import { 
    getDatabase, Database, ref, get, set, update, push,
    query, orderByChild, endAt, startAt, onChildAdded, onChildChanged, onChildRemoved,
    serverTimestamp, limitToLast, orderByKey, onValue
} from 'firebase/database';

import { firebaseConfig } from '../firebaseConfig';
import { Order, OrderItem, Customer, Product, SyncLog, DeviceSettings } from '../types';

// Fix: Export firebase db functions for use in other components like SqlRunnerPage
export { getDatabase, ref, push, update, set };

export type FirebaseUser = User;

// --- Eager Initialization ---
let app: FirebaseApp | null = null;
export let auth: Auth | null = null;
export let db: Database | null = null;
let dbReady = false;
export let isFirebaseInitialized = false;

try {
    // This top-level block initializes Firebase services as soon as this module is loaded.
    if (firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("YOUR_")) {
        app = initializeApp(firebaseConfig);
        isFirebaseInitialized = true; // App initialization was successful
        
        try {
            auth = getAuth(app);
            console.log("Firebase Auth service initialized eagerly.");
        } catch (e) {
            console.error("Firebase Auth eager initialization failed:", e);
            auth = null; // Ensure auth is null on failure
        }

        try {
            db = getDatabase(app);
            dbReady = true; // Database service was successfully retrieved
            console.log("Firebase Realtime Database service initialized eagerly.");
        } catch (e) {
            console.error("Firebase Realtime Database eager initialization failed:", e);
            db = null; // Ensure db is null on failure
            dbReady = false;
        }
        
    } else {
        console.warn("Firebase config is not set. The app will not connect to Firebase.");
    }
} catch (e) {
    console.error("Firebase App initialization failed catastrophically:", e);
    isFirebaseInitialized = false;
}

/** Checks if the database service is ready for use. */
export const isDbReady = () => dbReady;

// This function is kept for legacy checks, but isDbReady is more specific for DB operations.
export const isInitialized = () => isFirebaseInitialized;

const arrayToObject = (arr: any[], keyField: string) => {
    if (!Array.isArray(arr)) return {};
    return arr.reduce((obj, item) => {
        if (item && item[keyField] !== undefined) {
             obj[item[keyField]] = item;
        }
        return obj;
    }, {});
};

// --- Error Constants for Functions ---
const DB_UNAVAILABLE_ERROR = new Error("Database service is not available.");

// --- Device Settings ---
export const getDeviceSettings = async (deviceId: string): Promise<Partial<DeviceSettings>> => {
    if (!db) return {}; // Return empty object if DB not ready
    const settingsRef = ref(db, `settings/devices/${deviceId}`);
    const snapshot = await get(settingsRef);
    const settings = snapshot.val() || {};
    if (!settings.scanSettings) settings.scanSettings = {};
    if (!settings.googleDriveSyncSettings) settings.googleDriveSyncSettings = {};
    return settings;
};

export const setDeviceSetting = async (deviceId: string, key: string, value: any): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    await set(ref(db, `settings/devices/${deviceId}/${key}`), value);
};

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
    if (!db) {
        console.warn("listenToOrderChangesByDateRange: DB not ready.");
        return () => {};
    }
    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);
    let ordersQuery = query(ref(db, 'orders'), orderByChild('date'), endAt(endOfDay.toISOString()));
    
    if (startDate) {
        const startOfDay = new Date(startDate);
        startOfDay.setHours(0,0,0,0);
        ordersQuery = query(ref(db, 'orders'), orderByChild('date'), startAt(startOfDay.toISOString()), endAt(endOfDay.toISOString()));
    }

    const unsubs = [
        onChildAdded(ordersQuery, (snapshot) => {
            const order = snapshot.val() as Order;
            if (order) callbacks.onAdd(order);
        }),
        onChildChanged(ordersQuery, (snapshot) => {
            const order = snapshot.val() as Order;
            if (order) callbacks.onChange(order);
        }),
        onChildRemoved(ordersQuery, (snapshot) => {
            const order = snapshot.val() as Order;
            if (order) callbacks.onRemove(order);
        })
    ];
    
    return () => unsubs.forEach(unsub => unsub());
};

export const listenToOrderItems = (orderId: number, callback: (items: OrderItem[]) => void): (() => void) => {
    if (!db) {
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

// --- Data Fetching ---
export const getStore = async <T>(storeName: string): Promise<T[]> => {
    if (!db) return [];
    try {
        const snapshot = await get(ref(db, storeName));
        const data = snapshot.val();
        if (!data) return [];

        const values = Object.values(data).filter(item => item != null);
        if (storeName === 'customers') return values.filter(item => (item as Customer).comcode) as T[];
        if (storeName === 'products') return values.filter(item => (item as Product).barcode) as T[];
        return values as T[];
    } catch (error) {
        console.error(`Error getting store ${storeName}:`, error);
        return [];
    }
};

export const getValue = async <T>(path: string, defaultValue: T): Promise<T> => {
    if (!db) return defaultValue;
    try {
        const snapshot = await get(ref(db, path));
        return snapshot.val() ?? defaultValue;
    } catch(err) {
        console.error(`Error getting value from ${path}:`, err);
        return defaultValue;
    }
};

export const getOrderItems = async (orderId: number): Promise<OrderItem[]> => {
    if (!db) return [];
    let snapshot = await get(ref(db, `order-items/${orderId}`));
    let data = snapshot.val();
    if (!data) {
        snapshot = await get(ref(db, `orders/${orderId}/items`));
        data = snapshot.val();
    }
    if (!data) return [];
    
    const itemsArray = Array.isArray(data) ? data : Object.values(data);
    return itemsArray.filter(item => item != null);
};

// --- Data Modification ---
export const addOrder = async (
    orderData: Omit<Order, 'id' | 'date' | 'createdAt' | 'updatedAt' | 'completedAt' | 'completionDetails' | 'itemCount' | 'items'>, 
    items: OrderItem[]
): Promise<number> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    const newOrderId = Date.now();
    const now = new Date().toISOString();
    const newOrder: Omit<Order, 'items'> = {
        ...orderData, id: newOrderId, date: now, createdAt: now, updatedAt: now,
        itemCount: items.length, completedAt: null, completionDetails: null,
    };
    const updates: { [key: string]: any } = {};
    updates[`/orders/${newOrderId}`] = newOrder;
    updates[`/order-items/${newOrderId}`] = items;
    await update(ref(db), updates);
    return newOrderId;
};

export const updateOrder = (order: Order, items: OrderItem[]): Promise<void> => {
    if (!db) return Promise.reject(DB_UNAVAILABLE_ERROR);
    const now = new Date().toISOString();
    const updatedOrderData = { ...order, itemCount: items.length, updatedAt: now, date: now };
    delete updatedOrderData.items; // Don't store items inside the main order object
    const updates: { [key: string]: any } = {};
    updates[`/orders/${order.id}`] = updatedOrderData;
    updates[`/order-items/${order.id}`] = items;
    return update(ref(db), updates);
};

export const updateOrderStatus = (
    orderId: number, 
    completionDetails: Order['completionDetails']
): Promise<void> => {
    if (!db) return Promise.reject(DB_UNAVAILABLE_ERROR);
    const now = new Date().toISOString();
    const completedAt = completionDetails ? now : null;
    const updates: { [key: string]: any } = {
        [`/orders/${orderId}/completedAt`]: completedAt,
        [`/orders/${orderId}/completionDetails`]: completionDetails,
        [`/orders/${orderId}/updatedAt`]: now,
        [`/orders/${orderId}/date`]: now,
    };
    return update(ref(db), updates);
};

export const deleteOrder = (orderId: number): Promise<void> => {
    if (!db) return Promise.reject(DB_UNAVAILABLE_ERROR);
    const updates: { [key: string]: null } = {};
    updates[`/orders/${orderId}`] = null;
    updates[`/order-items/${orderId}`] = null;
    return update(ref(db), updates);
};

export const clearOrders = async (): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    const updates: { [key: string]: null } = { '/orders': null, '/order-items': null };
    await update(ref(db), updates);
};

export const clearOrdersBeforeDate = async (isoDateString: string): Promise<number> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    const ordersQuery = query(ref(db, 'orders'), orderByChild('date'), endAt(isoDateString));
    const snapshot = await get(ordersQuery);
    if (!snapshot.exists()) return 0;

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
    if (Object.keys(updates).length > 0) await update(ref(db), updates);
    return deletedCount;
};

export const resetData = async (dataType: 'customers' | 'products') => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    await set(ref(db, dataType), null);
    await set(ref(db, `sync-logs/${dataType}`), null);
};

export const setValue = async (path: string, value: any): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    await set(ref(db, path), value);
};

// --- Saved Queries Management (Firebase) ---
export const subscribeToSavedQueries = (callback: (queries: any[]) => void) => {
    if (!db) return () => {};
    const q = query(ref(db, 'saved-queries'));
    return onValue(q, (snapshot) => {
        const data = snapshot.val();
        const queries = data ? Object.entries(data).map(([key, val]: [string, any]) => ({ ...val, id: key })) : [];
        callback(queries);
    });
};

export const addSavedQuery = async (query: Omit<any, 'id'>) => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    await push(ref(db, 'saved-queries'), query);
};

export const updateSavedQuery = async (id: string, updates: any) => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    await update(ref(db, `saved-queries/${id}`), updates);
};

export const deleteSavedQuery = async (id: string) => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    await set(ref(db, `saved-queries/${id}`), null);
};

// --- Sync Log Management ---
const createComparable = (item: any, type: 'customers' | 'products') => {
    if (type === 'products') {
        return {
            barcode: item.barcode || '', name: (item.name || '').trim(),
            costPrice: Number(item.costPrice || 0), sellingPrice: Number(item.sellingPrice || 0),
            salePrice: item.salePrice == null ? '' : String(item.salePrice).trim(),
            saleEndDate: item.saleEndDate || '', supplierName: (item.supplierName || '').trim(),
        };
    }
    return { comcode: item.comcode || '', name: (item.name || '').trim() };
};

const areObjectsEqual = (newItem: any, existingItem: any, type: 'customers' | 'products'): boolean => {
    if (!newItem || !existingItem) return false;
    return JSON.stringify(createComparable(newItem, type)) === JSON.stringify(createComparable(existingItem, type));
};

export const smartSyncData = async (
    storeName: 'customers' | 'products', newData: (Customer | Product)[], userEmail: string,
    onProgress: (message: string) => void, existingDataArray: (Customer | Product)[],
    options?: { bypassMassDeleteCheck?: boolean }
): Promise<{ additions: number; updates: number; deletions: number; }> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    const keyField = storeName === 'customers' ? 'comcode' : 'barcode';
    onProgress(`기존 데이터(${existingDataArray.length}건)와 비교 시작...`);
    await new Promise(resolve => setTimeout(resolve, 0)); 

    const existingDataMap = new Map(existingDataArray.map(item => [(item as any)[keyField], item]));
    const newDataMap = new Map(newData.map(item => [(item as any)[keyField], item]));
    const deletions = Array.from(existingDataMap.keys()).filter(key => !newDataMap.has(key));
    if (!options?.bypassMassDeleteCheck && existingDataMap.size > 100 && deletions.length > existingDataMap.size * 0.5) {
        const error = new Error("MASS_DELETION_DETECTED");
        (error as any).details = { numExisting: existingDataMap.size, numDeletions: deletions.length, parsedResult: { valid: newData } };
        throw error;
    }

    const updates: { [key: string]: any } = {};
    const timestamp = serverTimestamp();
    const nowISO = new Date().toISOString();
    const logUser = userEmail.split('@')[0];
    let additionsCount = 0, updatesCount = 0, processed = 0;

    for (const [key, newItem] of newDataMap.entries()) {
        const existingItem = existingDataMap.get(key);
        const itemWithMeta = { ...createComparable(newItem, storeName), lastModified: nowISO };
        const logRefKey = push(ref(db, `/sync-logs/${storeName}`)).key;
        if (!existingItem) {
            additionsCount++;
            if (logRefKey) {
                updates[`/${storeName}/${key}`] = itemWithMeta;
                updates[`/sync-logs/${storeName}/${logRefKey}`] = { ...itemWithMeta, timestamp, user: logUser };
            }
        } else if (!areObjectsEqual(newItem, existingItem, storeName)) {
            updatesCount++;
            if (logRefKey) {
                updates[`/${storeName}/${key}`] = itemWithMeta;
                updates[`/sync-logs/${storeName}/${logRefKey}`] = { ...itemWithMeta, timestamp, user: logUser };
            }
        }
        processed++;
        if (processed % 100 === 0) { 
            onProgress(`변경/추가 확인 중... (${processed}/${newData.length})`);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    processed = 0;
    for (const key of deletions) {
        const existingItem = existingDataMap.get(key);
        const logRefKey = push(ref(db, `/sync-logs/${storeName}`)).key;
        if (logRefKey) {
            updates[`/${storeName}/${key}`] = null;
            updates[`/sync-logs/${storeName}/${logRefKey}`] = { [keyField]: key, name: (existingItem as any)?.name, _deleted: true, timestamp, user: logUser };
        }
        processed++;
        if (processed % 100 === 0) {
            onProgress(`삭제 항목 확인 중... (${processed}/${deletions.length})`);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    if (Object.keys(updates).length > 0) {
        onProgress('데이터베이스에 업로드 중...');
        await update(ref(db), updates);
    }
    return { additions: additionsCount, updates: updatesCount, deletions: deletions.length };
};

export const getSyncLogChanges = async (dataType: 'customers' | 'products', lastKey: string | null): Promise<{ items: any[], newLastKey: string | null }> => {
    if (!db) return { items: [], newLastKey: lastKey };
    let syncLogQuery = query(ref(db, `sync-logs/${dataType}`), orderByKey());
    if (lastKey) syncLogQuery = query(ref(db, `sync-logs/${dataType}`), orderByKey(), startAt(lastKey));
    const snapshot = await get(syncLogQuery);
    if (!snapshot.exists()) return { items: [], newLastKey: lastKey };

    const items: any[] = [];
    let processedLastKey: string | null = lastKey, isFirst = true;
    snapshot.forEach(childSnapshot => {
        if (lastKey && isFirst && childSnapshot.key === lastKey) { isFirst = false; return; }
        isFirst = false; 
        items.push(childSnapshot.val());
        processedLastKey = childSnapshot.key;
    });
    return { items, newLastKey: processedLastKey };
};

export const getLastSyncLogKey = async (dataType: 'customers' | 'products'): Promise<string | null> => {
     if (!db) return null;
     const q = query(ref(db, `sync-logs/${dataType}`), orderByKey(), limitToLast(1));
     const snapshot = await get(q);
     if (!snapshot.exists()) return null;
     const [key] = Object.keys(snapshot.val());
     return key || null;
};

export const getSyncLogs = async (dataType: 'customers' | 'products', limit = 100): Promise<SyncLog[]> => {
    if (!db) return [];
    const q = query(ref(db, `sync-logs/${dataType}`), orderByKey(), limitToLast(limit));
    const snapshot = await get(q);
    if (!snapshot.exists()) return [];
    const logs: SyncLog[] = [];
    snapshot.forEach(child => logs.push({ ...child.val(), _key: child.key }));
    return logs.reverse();
};

export const listenForNewLogs = (
    dataType: 'customers' | 'products', startKey: string | null,
    callback: (newItem: any, itemKey: string) => void
): (() => void) => {
    if (!db) return () => {};
    const logQuery = query(ref(db, `sync-logs/${dataType}`), orderByKey(), limitToLast(1));
    return onChildAdded(logQuery, (snapshot) => {
        if (snapshot.key && snapshot.key !== startKey) callback(snapshot.val(), snapshot.key);
    });
};

export const cleanupSyncLogs = async (dataType: 'customers' | 'products', retentionDays: number): Promise<void> => {
    if (!db || retentionDays < 0) return;
    const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    const logQuery = query(ref(db, `sync-logs/${dataType}`), orderByChild('timestamp'), endAt(cutoff));
    const snapshot = await get(logQuery);
    if (snapshot.exists()) {
        const updates: { [key: string]: null } = {};
        snapshot.forEach(child => { if (child.key) updates[`sync-logs/${dataType}/${child.key}`] = null; });
        if (Object.keys(updates).length > 0) {
            await update(ref(db), updates);
            console.log(`Cleaned up ${Object.keys(updates).length} old logs for ${dataType}.`);
        }
    }
};
