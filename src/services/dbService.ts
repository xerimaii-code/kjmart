
// src/services/dbService.ts
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, User } from 'firebase/auth';
import { 
    getDatabase, Database, ref, get, set, update, push,
    query, orderByChild, endAt, startAt, onChildAdded, onChildChanged, onChildRemoved,
    onValue,
    limitToLast,
    orderByKey
} from 'firebase/database';

import { firebaseConfig } from '../firebaseConfig';
import { Order, OrderItem, Customer, Product, DeviceSettings, SyncLog, UserQuery, ReceivingBatch, LearningItem } from '../types';

export { getDatabase, ref, push, update, set };

export type FirebaseUser = User;

let app: FirebaseApp | null = null;

export let auth: Auth | null = null;
export let db: Database | null = null;

let dbReady = false;
export let isFirebaseInitialized = false;

try {
    // 1. Primary Firebase Initialization
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
            console.log("Firebase Realtime Database (Primary) initialized.");
        } catch (e) {
            console.error("Firebase Realtime Database (Primary) initialization failed:", e);
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

// Helper to remove undefined fields which Firebase rejects
const cleanForFirebase = <T>(obj: T): T => {
    return JSON.parse(JSON.stringify(obj));
};

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
    await set(ref(db, `settings/devices/${deviceId}`), cleanForFirebase(settings));
};

export const setDeviceSetting = async (deviceId: string, key: keyof DeviceSettings, value: any): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    await set(ref(db, `settings/devices/${deviceId}/${key}`), value === undefined ? null : value);
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
    
    return () => unsubs.forEach(u => u());
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

// Legacy subscription (batch download)
export const subscribeToReceivingBatches = (callback: (batches: ReceivingBatch[]) => void): (() => void) => {
    if (!db) {
        callback([]);
        return () => {};
    }
    // Limit to the last 100 entries to prevent performance issues
    const q = query(ref(db, 'receiving-batches'), limitToLast(100));
    return onValue(q, (snapshot) => {
        const data = snapshot.val();
        const batches = data ? Object.values(data) : [];
        callback(batches as ReceivingBatch[]);
    });
};

// Real-time listener for receiving batches (granular events)
export const listenToReceivingBatchChanges = (
    callbacks: {
        onAdd: (batch: ReceivingBatch) => void;
        onChange: (batch: ReceivingBatch) => void;
        onRemove: (batchId: string) => void;
    }
): (() => void) => {
    if (!db) return () => {};
    // Listen to the last 100 items. This matches the legacy limit logic.
    const q = query(ref(db, 'receiving-batches'), limitToLast(100));

    const unsubs = [
        onChildAdded(q, (snapshot) => callbacks.onAdd(snapshot.val())),
        onChildChanged(q, (snapshot) => callbacks.onChange(snapshot.val())),
        onChildRemoved(q, (snapshot) => callbacks.onRemove(snapshot.key!))
    ];
    
    return () => unsubs.forEach(u => u());
};

// --- Cleanup Function ---
export const cleanupOldReceivingBatches = async (daysToKeep: number = 2): Promise<void> => {
    if (!db) return;
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffTimestamp = cutoffDate.getTime();

    // Receiving batches ID is essentially a timestamp
    const batchRef = ref(db, 'receiving-batches');
    const oldBatchesQuery = query(batchRef, orderByKey(), endAt(String(cutoffTimestamp)));

    try {
        const snapshot = await get(oldBatchesQuery);
        if (snapshot.exists()) {
            const updates: { [key: string]: null } = {};
            let count = 0;
            snapshot.forEach((child) => {
                const batch = child.val() as ReceivingBatch;
                // STRICTLY check: Only delete if 'sent'. Drafts are preserved.
                if (batch.status === 'sent') {
                    updates[child.key!] = null;
                    count++;
                }
            });
            
            if (Object.keys(updates).length > 0) {
                await update(batchRef, updates);
                console.log(`Cleaned up ${count} old sent receiving batches from Server.`);
            }
        }
    } catch (e) {
        console.error("Failed to cleanup old batches:", e);
    }
};

// --- Data Fetching ---
export const getStore = async <T>(storeName: string): Promise<T[]> => {
    if (!db) return [];
    
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

export const getOrder = async (orderId: number): Promise<Order | null> => {
    if (!db) return null;
    try {
        const orderRef = ref(db, `orders/${orderId}`);
        const itemsRef = ref(db, `order-items/${orderId}`);

        const [orderSnap, itemsSnap] = await Promise.all([
            get(orderRef),
            get(itemsRef)
        ]);

        if (!orderSnap.exists()) {
            return null;
        }

        const orderData = orderSnap.val() as Order;
        const itemsData = itemsSnap.val();
        
        let items: OrderItem[] = [];
        if (itemsData) {
            items = Array.isArray(itemsData) 
                ? itemsData 
                : Object.values(itemsData);
        }
        
        // Filter out any potential null/undefined values from Firebase arrays
        const cleanedItems = items.filter(item => item != null);

        return { ...orderData, items: cleanedItems };
    } catch (error) {
        console.error(`Error fetching order ${orderId}:`, error);
        throw error;
    }
};

// --- Data Modification ---
export const addOrder = async (
    orderData: Omit<Order, 'id' | 'date' | 'createdAt' | 'updatedAt' | 'itemCount' | 'completedAt' | 'completionDetails' | 'items'>, 
    items: OrderItem[]
): Promise<number> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    const newOrderId = Date.now();
    const now = new Date().toISOString();
    
    // items 배열을 제거한 순수 주문 객체 생성 (any 타입 캐스팅을 통해 삭제 허용)
    const newOrder: any = {
        ...orderData, id: newOrderId, date: now, createdAt: now, updatedAt: now,
        itemCount: items.length, completedAt: null, completionDetails: null,
    };
    delete newOrder.items; // 중복 저장 방지를 위해 명시적 삭제

    const updates: { [key: string]: any } = {};
    updates[`/orders/${newOrderId}`] = cleanForFirebase(newOrder);
    updates[`/order-items/${newOrderId}`] = cleanForFirebase(items);
    await update(ref(db), updates);
    return newOrderId;
};

export const updateOrder = (order: Order, items: OrderItem[]): Promise<void> => {
    if (!db) return Promise.reject(DB_UNAVAILABLE_ERROR);
    const now = new Date().toISOString();
    const updatedOrderData = { ...order, itemCount: items.length, updatedAt: now, date: now };
    delete updatedOrderData.items; // 중복 저장 방지
    const updates: { [key: string]: any } = {};
    updates[`/orders/${order.id}`] = cleanForFirebase(updatedOrderData);
    updates[`/order-items/${order.id}`] = cleanForFirebase(items);
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
        [`/orders/${orderId}/completionDetails`]: cleanForFirebase(completionDetails),
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
    await set(ref(db, path), cleanForFirebase(value));
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
    await set(newQueryRef, cleanForFirebase(queryData));
    return newQueryRef.key!;
};

export const updateUserQuery = async (id: string, updates: Partial<UserQuery>): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    const queryRef = ref(db, `saved-queries/${id}`);
    await update(queryRef, cleanForFirebase(updates));
};

export const deleteUserQuery = async (id: string): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    const queryRef = ref(db, `saved-queries/${id}`);
    await set(queryRef, null);
};

export const addReceivingBatch = async (batch: ReceivingBatch): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    // Firebase does not allow 'undefined' values.
    // cleanForFirebase removes undefined properties to avoid set() failure.
    const cleanBatch = cleanForFirebase(batch);
    await set(ref(db, `receiving-batches/${batch.id}`), cleanBatch);
};

export const deleteReceivingBatch = async (batchId: number): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    await set(ref(db, `receiving-batches/${batchId}`), null);
};

export const getReceivingBatchesByDateRange = async (startDate: string, endDate: string): Promise<ReceivingBatch[]> => {
    if (!db) return [];
    
    // Parse YYYY-MM-DD explicitly as local time to avoid UTC offsets
    const s = startDate.split('-').map(Number);
    const e = endDate.split('-').map(Number);
    
    // Create Date objects for local midnight
    // Month is 0-indexed in JS Date constructor (e.g. January is 0)
    const startDt = new Date(s[0], s[1] - 1, s[2], 0, 0, 0, 0);
    const endDt = new Date(e[0], e[1] - 1, e[2], 23, 59, 59, 999);

    const startTs = startDt.getTime();
    const endTs = endDt.getTime();

    try {
        const batchesRef = ref(db, 'receiving-batches');
        // Query by key (timestamp)
        const batchesQuery = query(
            batchesRef, 
            orderByKey(), 
            startAt(String(startTs)), 
            endAt(String(endTs))
        );
        
        const snapshot = await get(batchesQuery);
        if (!snapshot.exists()) return [];

        const batches: ReceivingBatch[] = [];
        snapshot.forEach((child) => {
            batches.push(child.val());
        });
        
        // Return newest first
        return batches.reverse(); 
    } catch (error) {
        console.error("Error fetching batches by date range:", error);
        return [];
    }
};

export const clearSyncLogs = async (): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    const logsRef = ref(db, 'sync-logs');
    await set(logsRef, null);
};

// --- Learning Context ---
export const listenToLearningItems = (callback: (items: LearningItem[]) => void): (() => void) => {
  if (!db) {
    callback([]);
    return () => {};
  }
  const learningRef = ref(db, 'learning/sqlContext');
  return onValue(learningRef, (snapshot) => {
    const data = snapshot.val();
    const itemsArray = data ? Object.entries(data).map(([id, value]) => ({ id, ...(value as any) })) : [];
    callback(itemsArray);
  });
};

export const addLearningItem = async (item: Omit<LearningItem, 'id'>): Promise<string> => {
  if (!db) throw DB_UNAVAILABLE_ERROR;
  const learningRef = ref(db, 'learning/sqlContext');
  const newItemRef = push(learningRef);
  await set(newItemRef, cleanForFirebase(item));
  return newItemRef.key!;
};

export const updateLearningItem = async (id: string, updates: Partial<Omit<LearningItem, 'id'>>): Promise<void> => {
  if (!db) throw DB_UNAVAILABLE_ERROR;
  const itemRef = ref(db, `learning/sqlContext/${id}`);
  await update(itemRef, cleanForFirebase(updates));
};

export const deleteLearningItem = async (id: string): Promise<void> => {
  if (!db) throw DB_UNAVAILABLE_ERROR;
  const itemRef = ref(db, `learning/sqlContext/${id}`);
  await set(itemRef, null);
};
