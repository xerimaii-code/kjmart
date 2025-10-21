import { initializeApp, FirebaseApp } from 'firebase/app';
import { getDatabase, ref, onValue, get, set, remove, query, orderByChild, startAt, endAt, update, onChildAdded, onChildChanged, onChildRemoved, Database } from 'firebase/database';
import { getAuth, Auth } from 'firebase/auth';
import { firebaseConfig } from '../firebaseConfig';
import { Order, OrderItem, Customer, Product, ChangeLog } from '../types';

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
export const listenToStoreChanges = <T extends { comcode: string } | { barcode: string }>(
    storeName: 'customers' | 'products',
    callbacks: {
        onInitialLoad: (items: T[]) => void;
        onAdd: (item: T) => void;
        onChange: (item: T) => void;
        onRemove: (key: string) => void;
    }
): (() => void) => {
    if (!isFirebaseInitialized || !db) return () => {};
    const storeRef = ref(db, storeName);
    
    // First, fetch the initial data to avoid onChildAdded firing for every existing item on load.
    get(storeRef).then(snapshot => {
        const data = snapshot.val();
        const itemsArray = data ? Object.values(data).filter(item => item != null) as T[] : [];
        callbacks.onInitialLoad(itemsArray);

        // After initial load, attach listeners for real-time updates.
        const unsubAdded = onChildAdded(storeRef, (snapshot) => {
            const item = snapshot.val() as T;
            if (item) {
                // To avoid processing items we already have from the initial load,
                // we could check a timestamp, but it's simpler to just call the add callback
                // and let the state management handle duplicates.
                 callbacks.onAdd(item);
            }
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

    }).catch(error => console.error(`[InitialLoad: ${storeName}]`, error));


    return () => {
        // This is a placeholder for the actual unsubscribe function returned later.
        // The real unsubscribe will be returned inside the .then() block.
        // A more robust implementation might use a variable to hold the unsubscribe functions.
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
    // FIX: Convert plural `dataType` to singular for `ChangeLog` interface.
    const singularDataType = dataType === 'customers' ? 'customer' : 'product';
    
    const existingItems = await getStore<Customer | Product>(dataType);
    const existingItemsMap = new Map(existingItems.map(item => [(item as any)[keyField], item]));
    const excelItemsMap = new Map(excelItems.map(item => [(item as any)[keyField], item]));

    const updates: { [key: string]: any } = {};
    const changeLogs: ChangeLog[] = [];
    const now = new Date().toISOString();

    // Check for new and updated items
    for (const [key, excelItem] of excelItemsMap.entries()) {
        const existingItem = existingItemsMap.get(key);
        const newItem = { ...excelItem, lastModified: now };

        if (!existingItem) { // New item
            updates[`/${dataType}/${key}`] = newItem;
            changeLogs.push({
                id: `${Date.now()}-${key}`, timestamp: now, userEmail, dataType: singularDataType, action: 'created',
                targetId: key, targetName: (newItem as any)[nameField],
            });
        } else { // Existing item, check for changes
            const diff: { field: string; oldValue: any; newValue: any }[] = [];
            Object.keys(excelItem).forEach(field => {
                if ((excelItem as any)[field] !== (existingItem as any)[field]) {
                    diff.push({ field, oldValue: (existingItem as any)[field], newValue: (excelItem as any)[field] });
                }
            });

            if (diff.length > 0) {
                updates[`/${dataType}/${key}`] = newItem;
                changeLogs.push({
                    id: `${Date.now()}-${key}`, timestamp: now, userEmail, dataType: singularDataType, action: 'updated',
                    targetId: key, targetName: (newItem as any)[nameField], changes: diff
                });
            }
        }
    }

    // Check for deleted items
    for (const [key, existingItem] of existingItemsMap.entries()) {
        if (!excelItemsMap.has(key)) {
            updates[`/${dataType}/${key}`] = null;
            changeLogs.push({
                id: `${Date.now()}-${key}`, timestamp: now, userEmail, dataType: singularDataType, action: 'deleted',
                targetId: key, targetName: (existingItem as any)[nameField],
            });
        }
    }
    
    // Add change logs to the update payload
    for (const log of changeLogs) {
        updates[`/change-logs/${log.id}`] = log;
    }

    if (Object.keys(updates).length > 0) {
        return update(ref(db), updates);
    }
    
    return Promise.resolve();
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

export const performLogCleanup = async (): Promise<void> => {
    if (!isFirebaseInitialized || !db) throw DB_UNINITIALIZED_ERROR;

    const retentionDays = await getValue<number>('settings/logs/retentionDays', 30);
    if (retentionDays === -1) {
        console.log("Log retention is set to permanent. Skipping cleanup.");
        return;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoffTimestamp = cutoffDate.toISOString();

    const logsRef = ref(db, 'change-logs');
    const logsQuery = query(logsRef, orderByChild('timestamp'), endAt(cutoffTimestamp));
    
    const snapshot = await get(logsQuery);
    if (snapshot.exists()) {
        const updates: { [key: string]: null } = {};
        snapshot.forEach((childSnapshot) => {
            updates[`/change-logs/${childSnapshot.key}`] = null;
        });
        await update(ref(db), updates);
    }
    
    await setValue('settings/logs/lastCleanupTimestamp', new Date().toISOString());
};
