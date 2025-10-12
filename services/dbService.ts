import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, get, set, remove, query, orderByChild, startAt, endAt, update } from 'firebase/database';
import { firebaseConfig } from '../firebaseConfig';
import { Order, OrderItem } from '../types';

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

/**
 * To ensure date-range queries perform well, you must add an index to your Firebase
 * Realtime Database rules for the 'orders' path. Add the following to your rules file:
 * {
 *   "rules": {
 *     // ... your existing rules
 *     "orders": {
 *       ".indexOn": "date"
 *     }
 *   }
 * }
 */
export const listenToOrdersByDateRange = (
    startDate: Date,
    endDate: Date,
    callback: (orders: Order[]) => void
): (() => void) => {
    if (!dbInitialized) return () => {};

    // Create a new Date object for the end of the day to avoid mutating the original `endDate` object.
    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);

    const ordersQuery = query(
        ref(db, 'orders'),
        orderByChild('date'),
        startAt(startDate.toISOString()),
        endAt(endOfDay.toISOString())
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
    if (!dbInitialized) return () => {};
    const itemsRef = ref(db, `order-items/${orderId}`);
    return onValue(itemsRef, (snapshot) => {
        const data = snapshot.val();
        callback(data || []);
    }, (error) => {
        console.error(`Error listening to order items for order ${orderId}:`, error);
        callback([]);
    });
};

export const listenToStore = <T>(storeName: string, callback: (data: T[]) => void): (() => void) => {
    if (!dbInitialized) return () => {};
    const dataRef = ref(db, storeName);
    return onValue(dataRef, (snapshot) => {
        const data = snapshot.val();
        const dataArray = data ? Object.values(data) as T[] : [];
        callback(dataArray);
    }, (error) => {
        console.error(`Error listening to ${storeName}:`, error);
        callback([] as T[]);
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

// --- Data Fetching ---
export const getValue = async <T>(path: string, defaultValue: T): Promise<T> => {
    if (!dbInitialized) return defaultValue;
    const snapshot = await get(ref(db, path));
    const data = snapshot.val();
    return data ?? defaultValue;
};

export const getOrderItems = async (orderId: number): Promise<OrderItem[]> => {
    if (!dbInitialized) return [];

    // First, try the new path /order-items/{orderId}
    let snapshot = await get(ref(db, `order-items/${orderId}`));
    let data = snapshot.val();

    // If not found, try the legacy path /orders/{orderId}/items for backward compatibility
    if (!data) {
        snapshot = await get(ref(db, `orders/${orderId}/items`));
        data = snapshot.val();
    }

    if (!data) {
        return [];
    }

    // Firebase can return an object for array-like data (if keys are sparse)
    // or an array that contains `null` values for deleted indices.
    // This logic handles both cases and ensures we return a clean array of valid items.
    const itemsArray = Array.isArray(data) ? data : Object.values(data);
    
    // Filter out any null or undefined entries to prevent downstream errors.
    return itemsArray.filter(item => item != null);
};


// --- Data Modification ---

export const addOrderWithItems = async (
    orderData: Omit<Order, 'id' | 'date' | 'createdAt' | 'completedAt' | 'completionDetails' | 'itemCount' | 'items'>, 
    items: OrderItem[]
): Promise<number> => {
    if (!dbInitialized) throw new Error("Database not initialized");
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
    if (!dbInitialized) throw new Error("Database not initialized");
    
    const updatedOrderData = {
        ...order,
        itemCount: items.length,
    };
    
    const updates: { [key: string]: any } = {};
    updates[`/orders/${order.id}`] = updatedOrderData;
    updates[`/order-items/${order.id}`] = items;
    
    return update(ref(db), updates);
};

export const updateOrderStatus = async (
    orderId: number, 
    completionDetails: Order['completionDetails']
): Promise<void> => {
    if (!dbInitialized) throw new Error("Database not initialized");
    const completedAt = completionDetails ? new Date().toISOString() : null;
    const updates: { [key: string]: any } = {
        [`/orders/${orderId}/completedAt`]: completedAt,
        [`/orders/${orderId}/completionDetails`]: completionDetails,
    };
    return update(ref(db), updates);
};


export const deleteOrderAndItems = (orderId: number): Promise<void> => {
    if (!dbInitialized) return Promise.resolve();
    const updates: { [key: string]: null } = {};
    updates[`/orders/${orderId}`] = null;
    updates[`/order-items/${orderId}`] = null;
    return update(ref(db), updates);
};

export const replaceAll = <T>(storeName: string, items: T[]): Promise<void> => {
    if (!dbInitialized) return Promise.resolve();
    let keyField = '';
    if (storeName === 'customers') keyField = 'comcode';
    else if (storeName === 'products') keyField = 'barcode';
    
    if (!keyField) return set(ref(db, storeName), items);

    const itemsObject = arrayToObject(items, keyField);
    return set(ref(db, storeName), itemsObject);
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

export const restoreFromBackup = (jsonString: string): Promise<void> => {
    if (!dbInitialized) throw new Error("데이터베이스에 연결되지 않았습니다.");
    const backupData = JSON.parse(jsonString);
    if (backupData.backupDate) {
        delete backupData.backupDate; // Don't restore the backup date itself
    }
    return set(ref(db), backupData);
};

export const clearOrders = (): Promise<void> => {
    if (!dbInitialized) return Promise.resolve();
    const updates: { [key: string]: null } = {
        '/orders': null,
        '/order-items': null,
    };
    return update(ref(db), updates);
};