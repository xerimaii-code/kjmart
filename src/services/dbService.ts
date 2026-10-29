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

const cleanForFirebase = <T>(obj: T): T => {
    return JSON.parse(JSON.stringify(obj));
};

/**
 * 네트워크 불안정 시 Firebase Realtime Database의 set/update Promise가 서버 ACK를 기다리며
 * 무한 대기(UI 먹통)하는 현상을 방지하기 위한 타임아웃 래퍼.
 * Firebase SDK는 set/update 호출 즉시 내부 전송 큐에 작업을 등록하므로,
 * 일정 시간(timeoutMs) 내 ACK가 오지 않더라도 UI 블로킹을 해제하고 연결 복구 시 자동 반영되도록 처리합니다.
 */
const withFirebaseWriteTimeout = <T>(promise: Promise<T>, timeoutMs: number = 2500, fallbackValue?: T): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                resolve(fallbackValue as T);
            }
        }, timeoutMs);

        promise.then((res) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(res);
            }
        }).catch((err) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(err);
            } else {
                console.warn("Deferred Firebase write error after timeout:", err);
            }
        });
    });
};

// 중복 저장 방지를 위한 최근 전송 지문(Fingerprint) 캐시
const recentOrderFingerprints = new Map<string, { id: number; timestamp: number }>();
const recentReceivingFingerprints = new Map<string, { id: number; timestamp: number }>();
const DEDUP_WINDOW_MS = 20000; // 20초 내 동일 데이터 중복 생성 원천 차단

const buildOrderFingerprint = (customerComcode: string, total: number, items: OrderItem[]): string => {
    const itemsKey = items.map(i => `${i.barcode}:${i.quantity}:${i.unit}:${i.memo || ''}`).join(',');
    return `${customerComcode}|${total}|${itemsKey}`;
};

const buildReceivingFingerprint = (batch: ReceivingBatch): string => {
    const itemsKey = (batch.items || []).map(i => `${i.barcode}:${i.quantity}:${i.costPrice}`).join(',');
    return `${batch.supplier?.comcode || ''}|${batch.date || ''}|${batch.status || 'draft'}|${batch.totalAmount}|${itemsKey}`;
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
    await withFirebaseWriteTimeout(set(ref(db, `settings/devices/${deviceId}`), cleanForFirebase(settings)), 2500);
};

export const setDeviceSetting = async (deviceId: string, key: keyof DeviceSettings, value: any): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    await withFirebaseWriteTimeout(set(ref(db, `settings/devices/${deviceId}/${key}`), value === undefined ? null : value), 2500);
};

// --- Listener functions for realtime updates (Optimized for multi-user broadcast without N-item re-render lag) ---
export const listenToOrderChangesByDateRange = (
    endDate: Date,
    callbacks: {
        onAdd: (order: Order) => void;
        onChange: (order: Order) => void;
        onRemove: (order: Order) => void;
        onSnapshot?: (orders: Order[]) => void;
    },
    startDate?: Date,
): (() => void) => {
    if (!db) {
        console.warn("listenToOrderChangesByDateRange: DB not ready.");
        if (callbacks.onSnapshot) callbacks.onSnapshot([]);
        return () => {};
    }
    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);
    let ordersQuery = query(ref(db, 'orders'), orderByChild('date'), endAt(endOfDay.toISOString()));
    
    if (startDate) {
        const startOfDay = new Date(startDate);
        startOfDay.setHours(0, 0, 0, 0);
        ordersQuery = query(ref(db, 'orders'), orderByChild('date'), startAt(startOfDay.toISOString()), endAt(endOfDay.toISOString()));
    }

    // onSnapshot이 제공된 경우 단일 onValue 리스너로 초기 로딩 지연 제거 및 다중 사용자 실시간 브로드캐스트 일괄 반영
    if (callbacks.onSnapshot) {
        return onValue(ordersQuery, (snapshot) => {
            const list: Order[] = [];
            if (snapshot.exists()) {
                snapshot.forEach((child) => {
                    const val = child.val() as Order;
                    if (val) list.push(val);
                });
            }
            list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            callbacks.onSnapshot!(list);
        }, (error) => {
            console.error("Error in orders real-time listener:", error);
            callbacks.onSnapshot!([]);
        });
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

export const subscribeToReceivingBatches = (callback: (batches: ReceivingBatch[]) => void): (() => void) => {
    if (!db) {
        callback([]);
        return () => {};
    }
    const q = query(ref(db, 'receiving-batches'), limitToLast(100));
    return onValue(q, (snapshot) => {
        const data = snapshot.val();
        const batches = data ? Object.values(data) : [];
        callback(batches as ReceivingBatch[]);
    });
};

export const listenToReceivingBatchChanges = (
    callbacks: {
        onAdd: (batch: ReceivingBatch) => void;
        onChange: (batch: ReceivingBatch) => void;
        onRemove: (batchId: string) => void;
    }
): (() => void) => {
    if (!db) return () => {};
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

    const batchRef = ref(db, 'receiving-batches');
    const oldBatchesQuery = query(batchRef, orderByKey(), endAt(String(cutoffTimestamp)));

    try {
        const snapshot = await get(oldBatchesQuery);
        if (snapshot.exists()) {
            const updates: { [key: string]: null } = {};
            let count = 0;
            snapshot.forEach((child) => {
                const batch = child.val() as ReceivingBatch;
                if (batch.status === 'sent') {
                    updates[child.key!] = null;
                    count++;
                }
            });
            
            if (Object.keys(updates).length > 0) {
                await withFirebaseWriteTimeout(update(batchRef, updates), 2500);
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
    let snapshot = await withFirebaseWriteTimeout(get(ref(db, `order-items/${orderId}`)), 4000, null as any);
    let data = snapshot?.val?.();
    if (!data) {
        snapshot = await withFirebaseWriteTimeout(get(ref(db, `orders/${orderId}/items`)), 4000, null as any);
        data = snapshot?.val?.();
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

    const nowTs = Date.now();
    const fp = buildOrderFingerprint(orderData.customer?.comcode || '', orderData.total, items);
    const existing = recentOrderFingerprints.get(fp);

    // 20초 내 동일한 발주 데이터가 다시 요청된 경우 새 ID를 만들지 않고 기존 ID를 재사용(멱등성 보장)
    const newOrderId = (existing && (nowTs - existing.timestamp) < DEDUP_WINDOW_MS)
        ? existing.id
        : ((orderData as any).id || nowTs);

    recentOrderFingerprints.set(fp, { id: newOrderId, timestamp: nowTs });
    if (recentOrderFingerprints.size > 50) {
        for (const [k, v] of recentOrderFingerprints.entries()) {
            if (nowTs - v.timestamp > DEDUP_WINDOW_MS) recentOrderFingerprints.delete(k);
        }
    }

    const now = new Date().toISOString();
    
    const newOrder: any = {
        ...orderData, id: newOrderId, date: now, createdAt: now, updatedAt: now,
        itemCount: items.length, completedAt: null, completionDetails: null,
    };
    delete newOrder.items;

    const updates: { [key: string]: any } = {};
    updates[`/orders/${newOrderId}`] = cleanForFirebase(newOrder);
    updates[`/order-items/${newOrderId}`] = cleanForFirebase(items);
    await withFirebaseWriteTimeout(update(ref(db), updates), 3000);
    return newOrderId;
};

export const updateOrder = (order: Order, items: OrderItem[]): Promise<void> => {
    if (!db) return Promise.reject(DB_UNAVAILABLE_ERROR);
    const now = new Date().toISOString();
    const updatedOrderData = { ...order, itemCount: items.length, updatedAt: now, date: now };
    delete updatedOrderData.items;
    const updates: { [key: string]: any } = {};
    updates[`/orders/${order.id}`] = cleanForFirebase(updatedOrderData);
    updates[`/order-items/${order.id}`] = cleanForFirebase(items);
    return withFirebaseWriteTimeout(update(ref(db), updates), 3000);
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
    return withFirebaseWriteTimeout(update(ref(db), updates), 2500);
};

export const deleteOrder = (orderId: number): Promise<void> => {
    if (!db) return Promise.reject(DB_UNAVAILABLE_ERROR);
    const updates: { [key: string]: null } = {};
    updates[`/orders/${orderId}`] = null;
    updates[`/order-items/${orderId}`] = null;
    return withFirebaseWriteTimeout(update(ref(db), updates), 2500);
};

export const clearOrders = async (): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    const updates: { [key: string]: null } = { '/orders': null, '/order-items': null };
    await withFirebaseWriteTimeout(update(ref(db), updates), 3000);
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
    if (Object.keys(updates).length > 0) await withFirebaseWriteTimeout(update(ref(db), updates), 3000);
    return deletedCount;
};

export const setValue = async (path: string, value: any): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    await withFirebaseWriteTimeout(set(ref(db, path), cleanForFirebase(value)), 2500);
};

export const subscribeToUserQueries = (callback: (queries: UserQuery[]) => void): (() => void) => {
    if (!db) {
        callback([]);
        return () => {};
    }
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
    await withFirebaseWriteTimeout(set(newQueryRef, cleanForFirebase(queryData)), 2500);
    return newQueryRef.key!;
};

export const updateUserQuery = async (id: string, updates: Partial<UserQuery>): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    const queryRef = ref(db, `saved-queries/${id}`);
    await withFirebaseWriteTimeout(update(queryRef, cleanForFirebase(updates)), 2500);
};

export const deleteUserQuery = async (id: string): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    const queryRef = ref(db, `saved-queries/${id}`);
    await withFirebaseWriteTimeout(set(queryRef, null), 2500);
};

export const addReceivingBatch = async (batch: ReceivingBatch): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;

    const nowTs = Date.now();
    const fp = buildReceivingFingerprint(batch);
    const existing = recentReceivingFingerprints.get(fp);

    // 20초 내 동일한 입고 데이터가 중복 요청된 경우 기존 ID를 그대로 사용하여 중복 레코드 생성 차단
    const targetId = (existing && (nowTs - existing.timestamp) < DEDUP_WINDOW_MS)
        ? existing.id
        : batch.id;

    recentReceivingFingerprints.set(fp, { id: targetId, timestamp: nowTs });
    if (recentReceivingFingerprints.size > 50) {
        for (const [k, v] of recentReceivingFingerprints.entries()) {
            if (nowTs - v.timestamp > DEDUP_WINDOW_MS) recentReceivingFingerprints.delete(k);
        }
    }

    const cleanBatch = cleanForFirebase({ ...batch, id: targetId });
    await withFirebaseWriteTimeout(set(ref(db, `receiving-batches/${targetId}`), cleanBatch), 2000);
};

export const deleteReceivingBatch = async (batchId: number): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    await withFirebaseWriteTimeout(set(ref(db, `receiving-batches/${batchId}`), null), 2000);
};

export const getReceivingBatchesByDateRange = async (startDate: string, endDate: string): Promise<ReceivingBatch[]> => {
    if (!db) return [];
    
    const s = startDate.split('-').map(Number);
    const e = endDate.split('-').map(Number);
    
    const startDt = new Date(s[0], s[1] - 1, s[2], 0, 0, 0, 0);
    const endDt = new Date(e[0], e[1] - 1, e[2], 23, 59, 59, 999);

    const startTs = startDt.getTime();
    const endTs = endDt.getTime();

    try {
        const batchesRef = ref(db, 'receiving-batches');
        const batchesQuery = query(
            batchesRef, 
            orderByKey(), 
            startAt(String(startTs)), 
            endAt(String(endTs))
        );
        
        const snapshot = await withFirebaseWriteTimeout(get(batchesQuery), 5000, null as any);
        if (!snapshot || !snapshot.exists()) return [];

        const batches: ReceivingBatch[] = [];
        snapshot.forEach((child) => {
            batches.push(child.val());
        });
        
        return batches.reverse(); 
    } catch (error) {
        console.error("Error fetching batches by date range:", error);
        return [];
    }
};

export const clearSyncLogs = async (): Promise<void> => {
    if (!db) throw DB_UNAVAILABLE_ERROR;
    const logsRef = ref(db, 'sync-logs');
    await withFirebaseWriteTimeout(set(logsRef, null), 2500);
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
  await withFirebaseWriteTimeout(set(newItemRef, cleanForFirebase(item)), 2500);
  return newItemRef.key!;
};

export const updateLearningItem = async (id: string, updates: Partial<Omit<LearningItem, 'id'>>): Promise<void> => {
  if (!db) throw DB_UNAVAILABLE_ERROR;
  const itemRef = ref(db, `learning/sqlContext/${id}`);
  await withFirebaseWriteTimeout(update(itemRef, cleanForFirebase(updates)), 2500);
};

export const deleteLearningItem = async (id: string): Promise<void> => {
  if (!db) throw DB_UNAVAILABLE_ERROR;
  const itemRef = ref(db, `learning/sqlContext/${id}`);
  await withFirebaseWriteTimeout(set(itemRef, null), 2500);
};
