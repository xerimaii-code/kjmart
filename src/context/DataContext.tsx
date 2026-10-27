import React, { createContext, useState, useCallback, useEffect, ReactNode, useContext, useMemo, useRef } from 'react';
import { Customer, Product, Order, OrderItem, BOM, Category, UserQuery, ReceivingBatch } from '../types';
import * as db from '../services/dbService';
import * as cache from '../services/cacheDbService';
import { syncCustomersFromDb, syncProductsIncrementally, syncBOMFromDb, syncCategoriesFromDb, executeUserQuery } from '../services/sqlService';
import { mapSqlResultToProduct, mapSqlResultToCustomer, sanitizeString } from '../utils/mapper';
import { syncAndCacheDbSchema } from '../services/schemaService';
import { useAuth } from './AuthContext';
import { useAlert } from './AlertContext';
import { useSyncState, useSyncSetters } from './SyncContext';

interface DataState {
    customers: Customer[];
    products: Product[];
    userQueries: UserQuery[];
}

interface DataActions {
    addOrder: (orderData: Omit<Order, 'id' | 'date' | 'createdAt' | 'updatedAt' | 'itemCount' | 'completedAt' | 'completionDetails' | 'items'> & { items: OrderItem[] }) => Promise<number>;
    updateOrder: (order: Order) => Promise<void>;
    deleteOrder: (orderId: number) => Promise<void>;
    updateOrderStatus: (orderId: number, completionDetails: Order['completionDetails']) => Promise<void>;
    clearOrders: () => Promise<void>;
    clearOrdersBeforeDate: (date: Date) => Promise<number>;
    syncWithDb: (type: 'incremental' | 'full', silent?: boolean) => Promise<void>;
    resetData: (dataType: 'customers' | 'products') => Promise<void>;
    loadLocalData: () => Promise<void>;
    resendReceivingBatches: (batches: ReceivingBatch[]) => Promise<{ success: number; fail: number; processed: number }>;
}

export const DataStateContext = createContext<DataState | undefined>(undefined);
export const DataActionsContext = createContext<DataActions | undefined>(undefined);

const toLocalYMD = (dateInput: string | Date): string | null => {
    try {
        if (typeof dateInput === 'string') {
            const trimmed = dateInput.trim();
            if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
                return trimmed.slice(0, 10);
            }
        }
        const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
        if (isNaN(d.getTime())) return null;
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    } catch {
        return null;
    }
};

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const { showToast } = useAlert();
    const { isSyncing } = useSyncState();
    const { setIsSyncing, setSyncProgress, setSyncStatusText, setSyncDataType } = useSyncSetters();

    const [customers, setCustomers] = useState<Customer[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [userQueries, setUserQueries] = useState<UserQuery[]>([]);
    
    const customersRef = useRef(customers);
    useEffect(() => { customersRef.current = customers; }, [customers]);

    const productsRef = useRef(products);
    const latestProductDateRef = useRef<string>('1900-01-01');

    useEffect(() => {
        productsRef.current = products;
        if (products.length > 0 && latestProductDateRef.current === '1900-01-01') {
            let maxDate = '1900-01-01';
            for (const p of products) {
                if (p.lastModified) {
                    const ymd = toLocalYMD(p.lastModified);
                    if (ymd && ymd > maxDate) maxDate = ymd;
                }
            }
            latestProductDateRef.current = maxDate;
        }
    }, [products]);
    
    const isSyncingRef = useRef(isSyncing);
    useEffect(() => { isSyncingRef.current = isSyncing; }, [isSyncing]);

    useEffect(() => {
        if (user && db.isDbReady()) {
            const unsubscribe = db.subscribeToUserQueries(setUserQueries);
            return () => unsubscribe();
        }
    }, [user]);

    const loadLocalData = useCallback(async () => {
        try {
            const [localCustomers, localProducts] = await Promise.all([
                cache.getCachedData<Customer>('customers'),
                cache.getCachedData<Product>('products')
            ]);
            if (localCustomers) setCustomers(localCustomers);
            if (localProducts) {
                setProducts(localProducts);
                let maxDate = '1900-01-01';
                for (const p of localProducts) {
                    if (p.lastModified) {
                        const ymd = toLocalYMD(p.lastModified);
                        if (ymd && ymd > maxDate) maxDate = ymd;
                    }
                }
                latestProductDateRef.current = maxDate;
            }
        } catch (e) {
            console.error("Local data load failed:", e);
        }
    }, []);

    const addOrder = useCallback(async (orderData: Omit<Order, 'id' | 'date' | 'createdAt' | 'updatedAt' | 'itemCount' | 'completedAt' | 'completionDetails' | 'items'> & { items: OrderItem[] }) => {
        return await db.addOrder(orderData, orderData.items);
    }, []);

    const updateOrder = useCallback(async (order: Order) => {
        if (!order.items) return;
        await db.updateOrder(order, order.items);
    }, []);

    const deleteOrder = useCallback(async (orderId: number) => {
        await db.deleteOrder(orderId);
    }, []);

    const updateOrderStatus = useCallback(async (orderId: number, details: any) => {
        await db.updateOrderStatus(orderId, details);
    }, []);

    const clearOrders = useCallback(async () => {
        await db.clearOrders();
    }, []);

    const clearOrdersBeforeDate = useCallback(async (date: Date) => {
        return await db.clearOrdersBeforeDate(date.toISOString());
    }, []);
    
    const syncWithDb = useCallback(async (type: 'incremental' | 'full', silent: boolean = false) => {
        if (isSyncingRef.current) return;
        setIsSyncing(true);
        isSyncingRef.current = true;
        
        try {
            if (type === 'full') {
                try { await syncAndCacheDbSchema(); } catch (e) { console.warn("Schema check failed during sync:", e); }
            }

            setSyncDataType(type);
            if (!silent) setSyncStatusText('동기화 준비 중...');
            setSyncProgress(5);

            if (type === 'full') {
                if (!silent) showToast('전체 동기화를 시작합니다.', 'success');
                if (!silent) setSyncStatusText('거래처 정보 수신 중...');
                setSyncProgress(10);
                const customersData = await syncCustomersFromDb();
                
                if (!silent) setSyncStatusText('상품 정보 수신 중...');
                setSyncProgress(30);
                const allProductsRaw = await syncProductsIncrementally('1900-01-01');
                
                if (!silent) setSyncStatusText('데이터 저장 중...');
                setSyncProgress(50);
                
                const mappedCustomers = customersData.map(mapSqlResultToCustomer);
                await cache.setCachedData('customers', mappedCustomers);
                setCustomers(mappedCustomers);

                const productMap = new Map<string, Product>();
                let maxDate = '1900-01-01';
                for (const raw of allProductsRaw) {
                    const p = mapSqlResultToProduct(raw);
                    if (p.barcode && p.isuse !== '0') {
                        productMap.set(p.barcode, p);
                        if (p.lastModified) {
                            const ymd = toLocalYMD(p.lastModified);
                            if (ymd && ymd > maxDate) maxDate = ymd;
                        }
                    }
                }
                latestProductDateRef.current = maxDate;
                const mappedProducts = Array.from(productMap.values());
                await cache.setCachedData('products', mappedProducts, (p) => setSyncProgress(60 + Math.floor(p * 0.3)));
                setProducts(mappedProducts);

                if (!silent) setSyncStatusText('부가 정보 수신 중...');
                setSyncProgress(90);
                
                try {
                    const bomRaw = await syncBOMFromDb();
                    const bomData: BOM[] = bomRaw.map((b: any) => ({ 
                        pcode: sanitizeString(b.pcode), 
                        ccode: sanitizeString(b.ccode), 
                        qty: Number(b.childcount || b.qty || 0), 
                        id: `${sanitizeString(b.pcode)}_${sanitizeString(b.ccode)}` 
                    }));
                    await cache.setCachedData('bom', bomData);
                } catch (bomErr) {
                    console.warn("BOM Sync failed (skipping):", bomErr);
                }

                try {
                    const categoriesData = await syncCategoriesFromDb();
                    const categories: Category[] = [];
                    categoriesData.gubun1?.forEach((g: any) => { const c = sanitizeString(g.gubun1); if (c) categories.push({ id: `L:${c}`, level: 1, code1: c, name: sanitizeString(g.gubun1x) }); });
                    categoriesData.gubun2?.forEach((g: any) => { const c1 = sanitizeString(g.gubun1), c2 = sanitizeString(g.gubun2); if (c1 && c2) categories.push({ id: `M:${c1}:${c2}`, level: 2, code1: c1, code2: c2, name: sanitizeString(g.gubun2x) }); });
                    categoriesData.gubun3?.forEach((g: any) => { const c1 = sanitizeString(g.gubun1), c2 = sanitizeString(g.gubun2), c3 = sanitizeString(g.gubun3); if (c1 && c2 && c3) categories.push({ id: `S:${c1}:${c2}:${c3}`, level: 3, code1: c1, code2: c2, code3: c3, name: sanitizeString(g.gubun3x) }); });
                    await cache.setCachedData('categories', categories);
                } catch (catErr) {
                    console.warn("Categories Sync failed (skipping):", catErr);
                }

                setSyncProgress(100);
                if (!silent) showToast('전체 동기화 완료', 'success');
            } else {
                // [최적화] 백그라운드에서 깨어날 때(silent=true) 이미 메모리에 거래처가 로드되어 있다면
                // 매번 수천 건의 거래처를 재다운로드하고 IndexedDB를 clear/rewrite하는 무거운 작업을 생략하여 깨어날 때의 버벅임을 제거합니다.
                if (!silent) showToast('증분 동기화를 시작합니다.', 'success');
                if (!silent) setSyncStatusText('변경 사항 확인 중...');
                
                if (!silent || customersRef.current.length === 0) {
                    const customersData = await syncCustomersFromDb();
                    const mappedCustomers = customersData.map(mapSqlResultToCustomer);
                    await cache.setCachedData('customers', mappedCustomers);
                    setCustomers(mappedCustomers);
                }

                const baseProducts = productsRef.current.length > 0 ? productsRef.current : await cache.getCachedData<Product>('products');
                let latestDateStr = latestProductDateRef.current;
                if (latestDateStr === '1900-01-01' && baseProducts.length > 0) {
                    for (const p of baseProducts) {
                        if (p.lastModified) {
                            const ymd = toLocalYMD(p.lastModified);
                            if (ymd && ymd > latestDateStr) latestDateStr = ymd;
                        }
                    }
                    latestProductDateRef.current = latestDateStr;
                }
                
                if (!silent) setSyncStatusText('상품 업데이트 확인 중...');
                const newProductsRaw = await syncProductsIncrementally(latestDateStr);
                const mappedNewProducts = newProductsRaw.map(mapSqlResultToProduct).filter(p => !!p.barcode);
                
                if (mappedNewProducts.length > 0) {
                    const activeUpdates: Product[] = [];
                    const deactivatedBarcodes: string[] = [];
                    let maxDate = latestDateStr;

                    for (const p of mappedNewProducts) {
                        if (p.isuse === '0') {
                            deactivatedBarcodes.push(p.barcode);
                        } else {
                            activeUpdates.push(p);
                            if (p.lastModified) {
                                const ymd = toLocalYMD(p.lastModified);
                                if (ymd && ymd > maxDate) maxDate = ymd;
                            }
                        }
                    }
                    latestProductDateRef.current = maxDate;

                    if (!silent) setSyncStatusText(`${mappedNewProducts.length}건 업데이트 중...`);
                    await cache.upsertCachedItems('products', activeUpdates, deactivatedBarcodes);

                    const productMap = new Map(baseProducts.map(p => [p.barcode, p]));
                    let hasActualDiff = false;

                    for (const code of deactivatedBarcodes) {
                        if (productMap.has(code)) {
                            productMap.delete(code);
                            hasActualDiff = true;
                        }
                    }
                    for (const p of activeUpdates) {
                        const prev = productMap.get(p.barcode);
                        if (!prev || prev.costPrice !== p.costPrice || prev.sellingPrice !== p.sellingPrice || prev.eventCostPrice !== p.eventCostPrice || prev.salePrice !== p.salePrice || prev.stockQuantity !== p.stockQuantity || prev.name !== p.name || prev.lastModified !== p.lastModified) {
                            hasActualDiff = true;
                        }
                        productMap.set(p.barcode, p);
                    }

                    // 실제 변경된 상품이 있을 때만 React 상태를 갱신하여 불필요한 전체 화면 리렌더링 방지
                    if (hasActualDiff || productsRef.current.length === 0) {
                        setProducts(Array.from(productMap.values()));
                    }
                    if (!silent) showToast(`${mappedNewProducts.length}건 업데이트 완료`, 'success');
                } else {
                    if (productsRef.current.length === 0 && baseProducts.length > 0) setProducts(baseProducts);
                    if (!silent) showToast('최신 상태입니다.', 'success');
                }
                setSyncProgress(100);
            }
        } catch (error: any) {
            console.error("Sync failed:", error);
            if (!silent) showToast(`동기화 실패: ${error.message}`, 'error');
            if (productsRef.current.length === 0) await loadLocalData();
        } finally {
            setIsSyncing(false);
            isSyncingRef.current = false;
            setSyncDataType(null);
        }
    }, [showToast, setIsSyncing, setSyncDataType, setSyncProgress, setSyncStatusText, loadLocalData]);

    const resendReceivingBatches = useCallback(async (batchesToResend: ReceivingBatch[]): Promise<{ success: number; fail: number; processed: number }> => {
        if (batchesToResend.length === 0) {
            return { success: 0, fail: 0, processed: 0 };
        }
    
        const insertQuery = `INSERT INTO dbo.dt900_ipgo (day1, dtcomcode, comcode, comname, barcode, descr, money0vat, money1, itemcount, gubun, lstmoney0vat) SELECT @time, @dtcomcode, @dtcomcode, LEFT(@comname, 10), @barcode, LEFT(ISNULL(@item_name, ''), 30), @cost, @price, @qty, CASE WHEN CAST(@qty AS INT) >= 0 THEN 'I' ELSE 'B' END, ISNULL(p.money0vat, 0) FROM (SELECT 1 AS dummy) AS t LEFT JOIN dbo.parts AS p WITH (NOLOCK) ON p.barcode = @barcode`;
        
        let success = 0;
        let fail = 0;
        const now = new Date();
        const unifiedTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:00`; 
    
        for (const batch of batchesToResend) {
            for (const item of batch.items) {
                 const params = {
                    time: `${batch.date} ${unifiedTime}`,
                    dtcomcode: batch.supplier.comcode ? batch.supplier.comcode.substring(0, 5) : '',
                    comname: batch.supplier.name ? batch.supplier.name.substring(0, 6) : '',
                    barcode: item.barcode ? item.barcode.substring(0, 14) : '',
                    qty: Number(item.quantity), 
                    cost: Number(item.costPrice), 
                    price: Number(item.sellingPrice),
                    item_name: item.name ? item.name.substring(0, 15) : ''
                };
                try {
                    await executeUserQuery('입고내역_재전송', params, insertQuery);
                    success++;
                } catch (e) {
                    console.error(`Resend failed for item ${item.barcode} in batch ${batch.id}`, e);
                    fail++;
                }
            }
        }
        return { success, fail, processed: batchesToResend.length };
    }, []);

    const resetData = useCallback(async (dataType: 'customers' | 'products') => {
        if (dataType === 'customers') {
            setCustomers([]);
            await cache.setCachedData('customers', []);
        } else {
            setProducts([]);
            latestProductDateRef.current = '1900-01-01';
            await cache.setCachedData('products', []);
        }
        showToast('데이터가 초기화되었습니다.', 'success');
    }, [showToast]);

    const dataState = useMemo(() => ({ customers, products, userQueries }), [customers, products, userQueries]);
    const dataActions = useMemo(() => ({ addOrder, updateOrder, deleteOrder, updateOrderStatus, clearOrders, clearOrdersBeforeDate, syncWithDb, resetData, loadLocalData, resendReceivingBatches }), [addOrder, updateOrder, deleteOrder, updateOrderStatus, clearOrders, clearOrdersBeforeDate, syncWithDb, resetData, loadLocalData, resendReceivingBatches]);
    
    return (
        <DataStateContext.Provider value={dataState}>
            <DataActionsContext.Provider value={dataActions}>
                {children}
            </DataActionsContext.Provider>
        </DataStateContext.Provider>
    );
};

export const useDataState = () => {
    const context = useContext(DataStateContext);
    if (context === undefined) throw new Error('useDataState must be used within a DataProvider');
    return context;
};

export const useDataActions = () => {
    const context = useContext(DataActionsContext);
    if (context === undefined) throw new Error('useDataActions must be used within a DataProvider');
    return context;
};
