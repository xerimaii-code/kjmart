
// src/services/dbService.ts
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, User } from 'firebase/auth';
import { 
    getDatabase, Database, ref, get, set, update, push,
    query, orderByChild, endAt, startAt, onChildAdded, onChildChanged, onChildRemoved,
    onValue,
    limitToLast
} from 'firebase/database';

import { firebaseConfig } from '../firebaseConfig';
import { Order, OrderItem, Customer, Product, DeviceSettings, SyncLog, UserQuery } from '../types';

export { getDatabase, ref, push, update, set };

export type FirebaseUser = User;

let app: FirebaseApp | null = null;
export let auth: Auth | null = null;
export let db: Database | null = null;
let dbReady = false;
export let isFirebaseInitialized = false;

try {
    if (firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("YOUR_")) {
        app = initializeApp(firebaseConfig);
        isFirebaseInitialized = true;
        
        try {
            auth = getAuth(app);
            console.log("Firebase Auth service initialized eagerly.");
        } catch (e) {
            console.error("Firebase Auth eager initialization failed:", e);
            auth = null;
        }

        try {
            db = getDatabase(app);
            dbReady = true;
            console.log("Firebase Realtime Database service initialized eagerly.");
        } catch (e) {
            console.error("Firebase Realtime Database eager initialization failed:", e);
            db = null;
            dbReady = false;
        }
        
    } else {
        console.warn("Firebase config is not set. The app will not connect to Firebase.");
    }
} catch (e) {
    console.error("Firebase App initialization failed catastrophically:", e);
    isFirebaseInitialized = false;
}

export const isDbReady = () => dbReady;
export const isInitialized = () => isFirebaseInitialized;

const DB_UNAVAILABLE_ERROR = new Error("Database service is not available.");

// --- Settings ---
export const getCommonSettings = async (): Promise<Partial<DeviceSettings & { sqlPassword?: string }>> => {
    if (!db) return {};
    const settingsRef = ref(db, `settings/common`);
    const snapshot = await get(settingsRef);
    return snapshot.val() || {};
};

export const getDeviceSettings = async (deviceId: string): Promise<Partial<DeviceSettings>> => {
    if (!db) return {};
    const settingsRef = ref(db, `settings/devices/${deviceId}`);
    const snapshot = await get(settingsRef);
    return snapshot.val() || {};
};

export const setDeviceSettings = async (deviceId: string, settings: DeviceSettings): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    await set(ref(db, `settings/devices/${deviceId}`), settings);
};

export const setDeviceSetting = async (deviceId: string, key: keyof DeviceSettings, value: any): Promise<void> => {
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
    
    if (storeName === 'customers' || storeName === 'products') {
        console.warn(`Attempted to get '${storeName}' from Firebase. This data is now sourced from the POS system via SQL API and stored in local cache.`);
        return [];
    }
    
    try {
        const snapshot = await get(ref(db, storeName));
        const data = snapshot.val();
        if (!data) return [];

        const values = Object.values(data).filter(item => item != null);
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

export const getSyncLogs = async (storeName: 'customers' | 'products', limit: number): Promise<SyncLog[]> => {
    if (!db) return [];
    try {
        const logsRef = ref(db, `sync-logs/${storeName}`);
        const logsQuery = query(logsRef, orderByChild('timestamp'), limitToLast(limit));
        const snapshot = await get(logsQuery);
        if (!snapshot.exists()) return [];

        const logs: SyncLog[] = [];
        snapshot.forEach(childSnapshot => {
            logs.push({
                _key: childSnapshot.key!,
                ...childSnapshot.val()
            });
        });

        return logs.reverse();
    } catch (error) {
        console.error(`Error getting sync logs for ${storeName}:`, error);
        return [];
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
    delete updatedOrderData.items;
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

export const setValue = async (path: string, value: any): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    await set(ref(db, path), value);
};

export const subscribeToUserQueries = (callback: (queries: UserQuery[]) => void): (() => void) => {
    if (!db) {
        callback([]);
        return () => {};
    }
    // Keep 'saved-queries' path for backward compatibility
    const queriesRef = ref(db, 'saved-queries');
    const queriesQuery = query(queriesRef, orderByChild('order'));
    return onValue(queriesQuery, (snapshot) => {
        const data = snapshot.val();
        const queriesArray = data ? Object.entries(data).map(([id, value]) => ({ id, ...(value as any) })) : [];
        callback(queriesArray);
    });
};

export const addUserQuery = async (queryData: Omit<UserQuery, 'id'>): Promise<string> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    const queriesRef = ref(db, 'saved-queries');
    const newQueryRef = push(queriesRef);
    await set(newQueryRef, queryData);
    return newQueryRef.key!;
};

export const updateUserQuery = async (id: string, updates: Partial<UserQuery>): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    const queryRef = ref(db, `saved-queries/${id}`);
    await update(queryRef, updates);
};

export const deleteUserQuery = async (id: string): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    const queryRef = ref(db, `saved-queries/${id}`);
    await set(queryRef, null);
};
