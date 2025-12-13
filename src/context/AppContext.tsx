
import React, { createContext, useState, useCallback, useEffect, ReactNode, useContext, useMemo, useRef } from 'react';
import { Customer, Product, Order, OrderItem, ScannerContext as ScannerContextType, DeviceSettings, SyncSettings, BOM, Category, UserQuery, ScannerOptions } from '../types';
import { 
    isDbReady, getDeviceSettings as dbGetDeviceSettings, 
    addOrder as dbAddOrder, updateOrder as dbUpdateOrder, deleteOrder as dbDeleteOrder,
    updateOrderStatus as dbUpdateOrderStatus, clearOrders as dbClearOrders, 
    clearOrdersBeforeDate as dbClearOrdersBeforeDate,
    setDeviceSettings as dbSetDeviceSettings,
    getCommonSettings as dbGetCommonSettings,
    setValue as dbSetValue,
    getValue as dbGetValue
} from '../services/dbService';
import * as cache from '../services/cacheDbService';
import AlertModal from '../components/AlertModal';
import { useAuth } from './AuthContext';
import { getDeviceId } from '../services/deviceService';
import Toast, { ToastState } from '../components/Toast';
import { syncCustomersFromDb, syncProductsIncrementally, syncBOMFromDb, syncCategoriesFromDb, checkSqlConnection } from '../services/sqlService';
import { IS_DEVELOPER_MODE, DATA_SCHEMA_VERSION } from '../config';
import { mapSqlResultToProduct, mapSqlResultToCustomer, sanitizeString } from '../utils/mapper';
import { syncAndCacheDbSchema } from '../services/schemaService';
import * as db from '../services/dbService';

// --- TYPE DEFINITIONS ---
export interface AddItemModalPayload {
    product: Product;
    existingItem: OrderItem | null;
    onAdd: (details: { quantity: number; unit: '개' | '박스'; memo?: string }) => void;
    onNextScan?: () => void;
    trigger: 'scan' | 'search';
    initialSettings?: { unit: '개' | '박스' };
    timestamp?: number; // Added to force reset on same-item scan
}
export interface EditItemModalPayload {
    item: OrderItem;
    onSave: (details: { quantity: number; unit: '개' | '박스'; memo?: string; }) => void;
}
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
}
const DataStateContext = createContext<DataState | undefined>(undefined);
const DataActionsContext = createContext<DataActions | undefined>(undefined);
interface DeviceSettingsActions {
    setSelectedCameraId: (id: string | null) => Promise<void>;
    setScanSettings: (settings: Partial<DeviceSettings['scanSettings']>) => Promise<void>;
    setLogRetentionDays: (days: number) => Promise<void>;
    setGoogleDriveSyncSettings: (type: 'customers' | 'products', settings: SyncSettings | null) => Promise<void>;
    setDataSourceSettings: (settings: Partial<DeviceSettings['dataSourceSettings']>) => Promise<void>;
    setAllowDestructiveQueries: (allow: boolean) => Promise<void>;
    setUiFeedback: (settings: Partial<DeviceSettings['uiFeedback']>) => Promise<void>;
}
const DeviceSettingsContext = createContext<(DeviceSettings & DeviceSettingsActions) | undefined>(undefined);
interface SyncState {
    isSyncing: boolean;
    syncProgress: number;
    syncStatusText: string;
    syncDataType: 'customers' | 'products' | 'full' | 'background' | 'incremental' | null;
    syncSource: 'local' | 'drive' | null;
    initialSyncCompleted: boolean;
}
const SyncStateContext = createContext<SyncState | undefined>(undefined);
interface AlertState { isOpen: boolean; message: string; onConfirm?: () => void; onCancel?: () => void; confirmText?: string; confirmButtonClass?: string; cancelText?: string; onClose?: () => void; }
interface ModalsState { isDetailModalOpen: boolean; editingOrder: Order | null; isDeliveryModalOpen: boolean; orderToExport: Order | null; addItemModalProps: AddItemModalPayload | null; editItemModalProps: EditItemModalPayload | null; isClearHistoryModalOpen: boolean; }
interface ModalsActions { openDetailModal: (order: Order) => void; closeDetailModal: () => void; openDeliveryModal: (order: Order) => void; closeDeliveryModal: () => void; openAddItemModal: (props: AddItemModalPayload) => void; closeAddItemModal: () => void; openEditItemModal: (props: EditItemModalPayload) => void; closeEditItemModal: () => void; openClearHistoryModal: () => void; closeClearHistoryModal: () => void; }
type SqlServerStatus = 'unknown' | 'connected' | 'error' | 'checking';
interface MiscUIState { lastModifiedOrderId: number | null; activeMenuOrderId: number | null; sqlStatus: SqlServerStatus; }
interface MiscUIActions { setLastModifiedOrderId: React.Dispatch<React.SetStateAction<number | null>>; setActiveMenuOrderId: React.Dispatch<React.SetStateAction<number | null>>; checkSql: () => Promise<boolean>; }
interface ScannerState { isScannerOpen: boolean; scannerContext: ScannerContextType; onScanSuccess: (barcode: string) => void; options: ScannerOptions; }
interface ScannerActions { openScanner: (context: ScannerContextType, onScan: (barcode: string) => void, optionsOrContinuous: boolean | ScannerOptions) => void; closeScanner: () => void; }
interface ScannerContextValue extends ScannerState, ScannerActions {
    selectedCameraId: string | null;
    scanSettings: DeviceSettings['scanSettings'];
}
interface PWAInstallState { isInstallPromptAvailable: boolean; triggerInstallPrompt: () => void; }
const PWAInstallContext = createContext<PWAInstallState | undefined>(undefined);

const ModalsContext = createContext<(ModalsState & ModalsActions) | undefined>(undefined);
const MiscUIContext = createContext<(MiscUIState & MiscUIActions) | undefined>(undefined);
const ScannerContext = createContext<ScannerContextValue | undefined>(undefined);

// AlertContext now provides an object with showAlert and showToast
interface AlertContextType {
    showAlert: (message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string, onCancel?: () => void, cancelText?: string, onClose?: () => void) => void;
    showToast: (message: string, type?: 'success' | 'error') => void;
}
const AlertContext = createContext<AlertContextType | undefined>(undefined);

const initialModalsState: ModalsState = { isDetailModalOpen: false, editingOrder: null, isDeliveryModalOpen: false, orderToExport: null, addItemModalProps: null, editItemModalProps: null, isClearHistoryModalOpen: false, };
const defaultSettings: DeviceSettings = {
    selectedCameraId: null,
    scanSettings: { vibrateOnScan: true, soundOnScan: true, useScannerButton: false },
    logRetentionDays: 30,
    googleDriveSyncSettings: { customers: null, products: null, },
    dataSourceSettings: { newOrder: 'online', productInquiry: 'online', autoSwitch: true, },
    allowDestructiveQueries: true,
    uiFeedback: { vibrateOnPress: true },
};

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [userQueries, setUserQueries] = useState<UserQuery[]>([]);
    const productsRef = useRef(products);
    useEffect(() => {
        productsRef.current = products;
    }, [products]);

    const [settings, setSettings] = useState<DeviceSettings>(defaultSettings);
    const [isSyncing, setIsSyncing] = useState(false);
    const isSyncingRef = useRef(false);
    const [syncProgress, setSyncProgress] = useState(0);
    const [syncStatusText, setSyncStatusText] = useState('');
    const [syncDataType, setSyncDataType] = useState<'customers' | 'products' | 'full' | 'background' | 'incremental' | null>(null);
    const [syncSource, setSyncSource] = useState<'local' | 'drive' | null>(null);
    const [initialSyncCompleted, setInitialSyncCompleted] = useState(false);
    const [alertState, setAlertState] = useState<AlertState>({ isOpen: false, message: '' });
    const [toastState, setToastState] = useState<ToastState>({ isOpen: false, message: '', type: 'success' });
    const [modalsState, setModalsState] = useState<ModalsState>(initialModalsState);
    const [lastModifiedOrderId, setLastModifiedOrderId] = useState<number | null>(null);
    const [activeMenuOrderId, setActiveMenuOrderId] = useState<number | null>(null);
    const [scannerState, setScannerState] = useState<ScannerState>({ 
        isScannerOpen: false, 
        scannerContext: null, 
        onScanSuccess: () => {}, 
        options: { continuous: false, useHighPrecision: false } 
    });
    const [isInstallPromptAvailable, setInstallPromptAvailable] = useState(false);
    const deferredInstallPrompt = useRef<any>(null);
    const [sqlStatus, setSqlStatus] = useState<SqlServerStatus>('unknown');
    const isCheckingSql = useRef(false);
    
    // --- History Management for Global Modals ---
    useEffect(() => {
        const handlePopState = (event: PopStateEvent) => {
            const modalState = event.state?.modal;

            // Detail Modal
            setModalsState(prev => {
                if (prev.isDetailModalOpen && modalState !== 'detail') {
                    return { ...prev, isDetailModalOpen: false, editingOrder: null };
                }
                return prev;
            });

            // Delivery Modal
            setModalsState(prev => {
                if (prev.isDeliveryModalOpen && modalState !== 'delivery') {
                    return { ...prev, isDeliveryModalOpen: false, orderToExport: null };
                }
                return prev;
            });

            // Scanner Modal
            setScannerState(prev => {
                if (prev.isScannerOpen && modalState !== 'scanner') {
                    return { ...prev, isScannerOpen: false };
                }
                return prev;
            });
            
            // Add/Edit Item Modals (Optional, if we want back button support for these too)
            setModalsState(prev => {
                if (prev.addItemModalProps && modalState !== 'addItem') {
                    return { ...prev, addItemModalProps: null };
                }
                if (prev.editItemModalProps && modalState !== 'editItem') {
                    return { ...prev, editItemModalProps: null };
                }
                return prev;
            });
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const checkSql = useCallback(async (): Promise<boolean> => {
        if (isCheckingSql.current) return false;
        isCheckingSql.current = true;
        setSqlStatus('checking');
        try {
            const result = await checkSqlConnection();
            const status = result.success ? 'connected' : 'error';
            setSqlStatus(status);
            return result.success;
        } catch (e) {
            setSqlStatus('error');
            return false;
        } finally {
            isCheckingSql.current = false;
        }
    }, []);

    useEffect(() => {
        if (user && isDbReady()) {
            const unsubscribe = db.subscribeToUserQueries(setUserQueries);
            return () => unsubscribe();
        }
    }, [user]);

    const showAlert = useCallback((message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string, onCancel?: () => void, cancelText?: string, onClose?: () => void) => {
        setAlertState({ isOpen: true, message, onConfirm, confirmText, confirmButtonClass, onCancel, cancelText, onClose });
    }, []);

    const closeAlert = useCallback(() => {
        if (alertState.onClose) alertState.onClose();
        setAlertState(prev => ({ ...prev, isOpen: false }));
    }, [alertState]);

    const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToastState({ isOpen: true, message, type });
    }, []);

    const closeToast = useCallback(() => {
        setToastState(prev => ({ ...prev, isOpen: false }));
    }, []);

    // Data Actions
    const addOrder = useCallback(async (orderData: any) => {
        const id = await dbAddOrder(orderData, orderData.items);
        return id;
    }, []);

    const updateOrder = useCallback(async (order: Order) => {
        if (!order.items) return;
        await dbUpdateOrder(order, order.items);
    }, []);

    const deleteOrder = useCallback(async (orderId: number) => {
        await dbDeleteOrder(orderId);
    }, []);

    const updateOrderStatus = useCallback(async (orderId: number, details: any) => {
        await dbUpdateOrderStatus(orderId, details);
    }, []);

    const clearOrders = useCallback(async () => {
        await dbClearOrders();
    }, []);

    const clearOrdersBeforeDate = useCallback(async (date: Date) => {
        const isoDate = date.toISOString();
        return await dbClearOrdersBeforeDate(isoDate);
    }, []);

    const syncWithDb = useCallback(async (type: 'incremental' | 'full', silent: boolean = false) => {
        if (isSyncingRef.current) return;
        setIsSyncing(true);
        isSyncingRef.current = true;
        
        let effectiveSyncType = type;

        try {
            if (type === 'full') {
                 await syncAndCacheDbSchema();
            }
        } catch (e) {
            console.error("Failed to check DB schema during sync:", e);
        }

        setSyncDataType(effectiveSyncType);
        if (!silent) setSyncStatusText('동기화 준비 중...');
        setSyncProgress(5);

        try {
            if (effectiveSyncType === 'full') {
                if (!silent) showToast('전체 동기화를 시작합니다.', 'success');
                
                // --- Step 1: Customers ---
                if (!silent) setSyncStatusText('거래처 정보 수신 중...');
                setSyncProgress(10);
                const customersData = await syncCustomersFromDb();
                const mappedCustomers = customersData.map(mapSqlResultToCustomer);
                await cache.setCachedData('customers', mappedCustomers);
                setCustomers(mappedCustomers);
                
                // --- Step 2: Products (Full Fetch via Incremental Endpoint with old date) ---
                if (!silent) setSyncStatusText('상품 정보 수신 중...');
                setSyncProgress(30);
                const allProductsRaw = await syncProductsIncrementally('1900-01-01 00:00:00');
                
                if (!silent) setSyncStatusText('상품 정보 저장 중...');
                setSyncProgress(60);
                const mappedProducts = allProductsRaw.map(mapSqlResultToProduct);
                await cache.setCachedData('products', mappedProducts, (progress) => {
                    setSyncProgress(60 + Math.floor(progress * 0.2));
                });
                setProducts(mappedProducts);

                // --- Step 3: BOM ---
                if (!silent) setSyncStatusText('BOM 데이터 수신 중...');
                setSyncProgress(85);
                const bomRaw = await syncBOMFromDb();
                const bomData: BOM[] = bomRaw.map((b: any) => ({
                    pcode: sanitizeString(b.pcode),
                    ccode: sanitizeString(b.ccode),
                    qty: Number(b.qty || 0),
                    id: `${sanitizeString(b.pcode)}_${sanitizeString(b.ccode)}`
                }));
                await cache.setCachedData('bom', bomData);

                // --- Step 4: Categories ---
                if (!silent) setSyncStatusText('분류 데이터 수신 중...');
                setSyncProgress(95);
                const categoriesData = await syncCategoriesFromDb();
                const categories: Category[] = [];
                categoriesData.gubun1.forEach((g: any) => {
                    const code = sanitizeString(g.gubun1);
                    if (code) categories.push({ id: `L:${code}`, level: 1, code1: code, name: sanitizeString(g.gubun1x) });
                });
                categoriesData.gubun2.forEach((g: any) => {
                    const c1 = sanitizeString(g.gubun1);
                    const c2 = sanitizeString(g.gubun2);
                    if (c1 && c2) categories.push({ id: `M:${c1}:${c2}`, level: 2, code1: c1, code2: c2, name: sanitizeString(g.gubun2x) });
                });
                categoriesData.gubun3.forEach((g: any) => {
                    const c1 = sanitizeString(g.gubun1);
                    const c2 = sanitizeString(g.gubun2);
                    const c3 = sanitizeString(g.gubun3);
                    if (c1 && c2 && c3) categories.push({ id: `S:${c1}:${c2}:${c3}`, level: 3, code1: c1, code2: c2, code3: c3, name: sanitizeString(g.gubun3x) });
                });
                await cache.setCachedData('categories', categories);

                setSyncProgress(100);
                if (!silent) showToast('전체 동기화 완료', 'success');
                
            } else {
                if (!silent) showToast('증분 동기화를 시작합니다.', 'success');
                if (!silent) setSyncStatusText('변경 사항 확인 중...');
                
                // [FIX START] 증분 동기화 시 메모리(Ref)가 비어있다면, 로컬 캐시에서 먼저 로드하여 데이터 유실 방지
                let baseProducts = productsRef.current;
                if (baseProducts.length === 0) {
                    const cachedProducts = await cache.getCachedData<Product>('products');
                    if (cachedProducts.length > 0) {
                        console.log("Incremental Sync: Recovered base products from cache.");
                        baseProducts = cachedProducts;
                    }
                }
                // [FIX END]

                const customersData = await syncCustomersFromDb();
                const mappedCustomers = customersData.map(mapSqlResultToCustomer);
                
                await cache.setCachedData('customers', mappedCustomers);
                setCustomers(mappedCustomers);

                const lastProduct = baseProducts.reduce((latest, p) => {
                    if (!p.lastModified) return latest;
                    const d = new Date(p.lastModified);
                    return !latest || d > latest ? d : latest;
                }, null as Date | null);
                
                const lastSyncDate = lastProduct ? lastProduct.toISOString().slice(0, 19).replace('T', ' ') : '1900-01-01 00:00:00';
                
                if (!silent) setSyncStatusText('상품 업데이트 확인 중...');
                const newProductsRaw = await syncProductsIncrementally(lastSyncDate);
                const newProducts = newProductsRaw.map(mapSqlResultToProduct);
                
                if (newProducts.length > 0) {
                    if (!silent) setSyncStatusText(`${newProducts.length}건 업데이트 중...`);
                    // Use baseProducts (recovered from cache if needed) instead of potentially empty ref
                    const productMap = new Map(baseProducts.map(p => [p.barcode, p]));
                    newProducts.forEach(p => productMap.set(p.barcode, p));
                    const updatedProducts = Array.from(productMap.values());
                    
                    await cache.setCachedData('products', updatedProducts);
                    setProducts(updatedProducts);
                    if (!silent) showToast(`${newProducts.length}건의 상품이 업데이트되었습니다.`, 'success');
                } else {
                    // Update state if it was empty but we recovered data from cache
                    if (productsRef.current.length === 0 && baseProducts.length > 0) {
                        setProducts(baseProducts);
                    }
                    if (!silent) showToast('데이터가 최신 상태입니다.', 'success');
                }
                setSyncProgress(100);
            }
        } catch (error: any) {
            console.error("Sync failed:", error);
            if (!silent) showToast(`동기화 실패: ${error.message}`, 'error');
        } finally {
            setIsSyncing(false);
            isSyncingRef.current = false;
            setSyncDataType(null);
        }
    }, [showAlert, showToast]);

    const resetData = useCallback(async (dataType: 'customers' | 'products') => {
        if (dataType === 'customers') {
            setCustomers([]);
            await cache.setCachedData('customers', [] as Customer[]);
        } else {
            setProducts([]);
            await cache.setCachedData('products', [] as Product[]);
        }
        showToast('데이터가 초기화되었습니다.', 'success');
    }, [showToast]);

    const updateDeviceSetting = useCallback(async (updater: (prev: DeviceSettings) => DeviceSettings) => {
        const deviceId = getDeviceId();
        setSettings(prevSettings => {
            const newSettings = updater(prevSettings);
            cache.setSetting('deviceSettings', newSettings);
            dbSetDeviceSettings(deviceId, newSettings).catch(err => {
                console.warn(`Failed to sync settings to Firebase:`, err);
            });
            return newSettings;
        });
    }, []);

    const setSelectedCameraId = useCallback(async (id: string | null) => {
        await updateDeviceSetting(prev => ({ ...prev, selectedCameraId: id }));
    }, [updateDeviceSetting]);
    const setScanSettings = useCallback(async (val: Partial<DeviceSettings['scanSettings']>) => {
        await updateDeviceSetting(prev => ({ ...prev, scanSettings: { ...prev.scanSettings, ...val } }));
    }, [updateDeviceSetting]);
    const setLogRetentionDays = useCallback(async (days: number) => {
        await updateDeviceSetting(prev => ({ ...prev, logRetentionDays: days }));
    }, [updateDeviceSetting]);
    const setGoogleDriveSyncSettings = useCallback(async (type: 'customers' | 'products', val: SyncSettings | null) => {
        await updateDeviceSetting(prev => ({ ...prev, googleDriveSyncSettings: { ...prev.googleDriveSyncSettings, [type]: val } }));
    }, [updateDeviceSetting]);
    const setDataSourceSettings = useCallback(async (val: Partial<DeviceSettings['dataSourceSettings']>) => {
        await updateDeviceSetting(prev => ({ ...prev, dataSourceSettings: { ...prev.dataSourceSettings, ...val } }));
    }, [updateDeviceSetting]);
    const setAllowDestructiveQueries = useCallback(async (allow: boolean) => {
        await updateDeviceSetting(prev => ({ ...prev, allowDestructiveQueries: allow }));
    }, [updateDeviceSetting]);
    const setUiFeedback = useCallback(async (val: Partial<DeviceSettings['uiFeedback']>) => {
        await updateDeviceSetting(prev => ({ ...prev, uiFeedback: { ...prev.uiFeedback, ...val } }));
    }, [updateDeviceSetting]);

    // Modals Actions (Modified to handle history)
    const openDetailModal = useCallback((order: Order) => {
        window.history.pushState({ modal: 'detail' }, '', '');
        setModalsState(prev => ({ ...prev, isDetailModalOpen: true, editingOrder: order }));
    }, []);
    const closeDetailModal = useCallback(() => {
        if (window.history.state?.modal === 'detail') {
            window.history.back();
        } else {
            setModalsState(prev => ({ ...prev, isDetailModalOpen: false, editingOrder: null }));
        }
    }, []);

    const openDeliveryModal = useCallback((order: Order) => {
        window.history.pushState({ modal: 'delivery' }, '', '');
        setModalsState(prev => ({ ...prev, isDeliveryModalOpen: true, orderToExport: order }));
    }, []);
    const closeDeliveryModal = useCallback(() => {
        if (window.history.state?.modal === 'delivery') {
            window.history.back();
        } else {
            setModalsState(prev => ({ ...prev, isDeliveryModalOpen: false, orderToExport: null }));
        }
    }, []);

    const openAddItemModal = useCallback((props: AddItemModalPayload) => {
        window.history.pushState({ modal: 'addItem' }, '', '');
        setModalsState(prev => ({ ...prev, addItemModalProps: props }));
    }, []);
    const closeAddItemModal = useCallback(() => {
        if (window.history.state?.modal === 'addItem') {
            window.history.back();
        } else {
            setModalsState(prev => ({ ...prev, addItemModalProps: null }));
        }
    }, []);

    const openEditItemModal = useCallback((props: EditItemModalPayload) => {
        window.history.pushState({ modal: 'editItem' }, '', '');
        setModalsState(prev => ({ ...prev, editItemModalProps: props }));
    }, []);
    const closeEditItemModal = useCallback(() => {
        if (window.history.state?.modal === 'editItem') {
            window.history.back();
        } else {
            setModalsState(prev => ({ ...prev, editItemModalProps: null }));
        }
    }, []);

    const openClearHistoryModal = useCallback(() => setModalsState(prev => ({ ...prev, isClearHistoryModalOpen: true })), []);
    const closeClearHistoryModal = useCallback(() => setModalsState(prev => ({ ...prev, isClearHistoryModalOpen: false })), []);

    // Scanner Actions (Modified to handle history)
    const openScanner = useCallback((context: ScannerContextType, onScan: (barcode: string) => void, optionsOrContinuous: boolean | ScannerOptions) => {
        window.history.pushState({ modal: 'scanner' }, '', '');
        const options: ScannerOptions = typeof optionsOrContinuous === 'boolean' 
            ? { continuous: optionsOrContinuous, useHighPrecision: false } 
            : optionsOrContinuous;
            
        setScannerState({ isScannerOpen: true, scannerContext: context, onScanSuccess: onScan, options });
    }, []);
    const closeScanner = useCallback(() => {
        if (window.history.state?.modal === 'scanner') {
            window.history.back();
        } else {
            setScannerState(prev => ({ ...prev, isScannerOpen: false }));
        }
    }, []);

    // PWA Install
    useEffect(() => {
        const handler = (e: any) => {
            e.preventDefault();
            deferredInstallPrompt.current = e;
            setInstallPromptAvailable(true);
        };
        window.addEventListener('beforeinstallprompt', handler);
        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    const triggerInstallPrompt = useCallback(async () => {
        if (!deferredInstallPrompt.current) return;
        deferredInstallPrompt.current.prompt();
        const { outcome } = await deferredInstallPrompt.current.userChoice;
        if (outcome === 'accepted') {
            setInstallPromptAvailable(false);
        }
        deferredInstallPrompt.current = null;
    }, []);

    useEffect(() => {
        const performBackgroundSync = async () => {
            let isSqlConnected = false;
            try {
                isSqlConnected = await checkSql();
            } catch (e) {
                console.warn("SQL Connection check failed during background sync:", e);
            }

            if (isSqlConnected) {
                let schemaChanged = false;
                try {
                    schemaChanged = await syncAndCacheDbSchema();
                } catch (e) { console.warn("Schema check failed:", e); }

                if (schemaChanged) {
                    console.log("Schema changed. Performing full sync...");
                    await syncWithDb('full', true);
                } else {
                    console.log("Performing incremental sync...");
                    await syncWithDb('incremental', true);
                }
            }
        };

        const loadInitialData = async () => {
            const deviceId = getDeviceId();
            
            // Safety Timer: Force UI to load if initialization hangs for more than 1.5s
            // This prevents "White Screen" if IndexedDB or network is unresponsive.
            const safetyTimer = setTimeout(() => {
                if (!initialSyncCompleted) {
                    console.warn("Initialization taking too long, forcing UI load.");
                    setInitialSyncCompleted(true);
                }
            }, 1500);

            try {
                // Critical: Unlock potential zombie sync flags from crashed previous session
                try { await cache.resetAllSyncFlags(); } catch (e) { console.warn("Failed to reset flags", e); }

                // 1. Load Settings (Optimistic)
                setSyncStatusText('설정 불러오는 중');
                try {
                    const cachedSettings = await cache.getSetting<DeviceSettings>('deviceSettings');
                    // Merge with defaults
                    setSettings({ ...defaultSettings, ...cachedSettings });
                } catch (e) {
                    console.warn("Failed to load cached settings, using defaults:", e);
                    setSettings(defaultSettings);
                }
                
                // 2. Load Local Data (Critical Path for Offline UI)
                setSyncStatusText('로컬 데이터 불러오는 중');
                const results = await Promise.allSettled([
                    cache.getCachedData<Customer>('customers'),
                    cache.getCachedData<Product>('products')
                ]);

                const cachedCustomers = results[0].status === 'fulfilled' ? results[0].value : [];
                const cachedProducts = results[1].status === 'fulfilled' ? results[1].value : [];

                setCustomers(cachedCustomers || []);
                setProducts(cachedProducts || []);
                
                // IMPORTANT: Mark initial sync as complete so the UI renders immediately with whatever data we have
                clearTimeout(safetyTimer); // Clear safety timer as we are about to set it true
                setInitialSyncCompleted(true);

                // 3. Check for Empty Data and Trigger appropriate sync
                const hasValidCustomers = Array.isArray(cachedCustomers) && cachedCustomers.length > 0;
                const hasValidProducts = Array.isArray(cachedProducts) && cachedProducts.length > 0;
                const isLocalDataEmpty = !hasValidCustomers || !hasValidProducts;

                if (isLocalDataEmpty) {
                    console.log("Local data empty. Forcing full sync...");
                    setSyncStatusText('초기 데이터 다운로드 중...');
                    
                    try {
                        // For empty state, we block lightly until some data arrives if connection is good
                        const isConnected = await checkSql();
                        if (isConnected) {
                            await syncWithDb('full', false);
                        } else {
                            throw new Error("서버 연결 실패");
                        }
                    } catch (e) {
                        console.error("Initial Sync Failed:", e);
                        // Even if failed, UI is already rendered (empty). Toast notifies user.
                        showToast("초기 데이터를 불러오는데 실패했습니다. 네트워크를 확인하세요.", 'error');
                    }
                } else {
                    // Data exists, proceed with background incremental sync
                    performBackgroundSync();
                }
                
                // 4. Sync Settings in Background
                const syncSettingsInBackground = async () => {
                    try {
                        const [savedSettings, commonSettings] = await Promise.all([
                            dbGetDeviceSettings(deviceId),
                            dbGetCommonSettings()
                        ]);
                        setSettings(currentSettings => {
                            const newSettings = { ...currentSettings, ...savedSettings, ...commonSettings };
                            
                            if (JSON.stringify(newSettings) !== JSON.stringify(currentSettings)) {
                                cache.setSetting('deviceSettings', newSettings);
                                return newSettings;
                            }
                            return currentSettings;
                        });
                    } catch (settingsError) {
                        console.warn("Could not sync settings from Firebase.", settingsError);
                    }
                };
                syncSettingsInBackground();

            } catch (globalError) {
                console.error("Initialization error:", globalError);
                showToast('앱 초기화 중 오류가 발생했습니다. 오프라인 모드로 진입합니다.', 'error');
                clearTimeout(safetyTimer);
                setInitialSyncCompleted(true); // Ensure UI unblocks
            }
        };

        if (user) {
            loadInitialData();
        }
    }, [user, checkSql, syncWithDb, showToast]); // Removed showAlert from deps to prevent re-trigger

    useEffect(() => {
        if (!user || !initialSyncCompleted) return;
        const handleVisibilityChange = async () => {
            if (document.visibilityState === 'visible') {
                const isConnected = await checkSql();
                if (isConnected) {
                    await syncWithDb('incremental', true);
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [user, initialSyncCompleted, checkSql, syncWithDb]);

    const dataState = useMemo(() => ({ customers, products, userQueries }), [customers, products, userQueries]);
    const dataActions = useMemo(() => ({ addOrder, updateOrder, deleteOrder, updateOrderStatus, clearOrders, clearOrdersBeforeDate, syncWithDb, resetData }), [addOrder, updateOrder, deleteOrder, updateOrderStatus, clearOrders, clearOrdersBeforeDate, syncWithDb, resetData]);
    const deviceSettingsValue = useMemo(() => ({ ...settings, setSelectedCameraId, setScanSettings, setLogRetentionDays, setGoogleDriveSyncSettings, setDataSourceSettings, setAllowDestructiveQueries, setUiFeedback }), [settings, setSelectedCameraId, setScanSettings, setLogRetentionDays, setGoogleDriveSyncSettings, setDataSourceSettings, setAllowDestructiveQueries, setUiFeedback]);
    const syncState = useMemo(() => ({ isSyncing, syncProgress, syncStatusText, syncDataType, syncSource, initialSyncCompleted }), [isSyncing, syncProgress, syncStatusText, syncDataType, syncSource, initialSyncCompleted]);
    const modalsValue = useMemo(() => ({ ...modalsState, openDetailModal, closeDetailModal, openDeliveryModal, closeDeliveryModal, openAddItemModal, closeAddItemModal, openEditItemModal, closeEditItemModal, openClearHistoryModal, closeClearHistoryModal }), [modalsState, openDetailModal, closeDetailModal, openDeliveryModal, closeDeliveryModal, openAddItemModal, closeAddItemModal, openEditItemModal, closeEditItemModal, openClearHistoryModal, closeClearHistoryModal]);
    const miscUIValue = useMemo(() => ({ lastModifiedOrderId, setLastModifiedOrderId, activeMenuOrderId, setActiveMenuOrderId, sqlStatus, checkSql }), [lastModifiedOrderId, activeMenuOrderId, sqlStatus, checkSql]);
    const scannerValue = useMemo(() => ({ ...scannerState, openScanner, closeScanner, selectedCameraId: settings.selectedCameraId, scanSettings: settings.scanSettings }), [scannerState, openScanner, closeScanner, settings.selectedCameraId, settings.scanSettings]);
    const pwaValue = useMemo(() => ({ isInstallPromptAvailable, triggerInstallPrompt }), [isInstallPromptAvailable, triggerInstallPrompt]);
    const alertValue = useMemo(() => ({ showAlert, showToast }), [showAlert, showToast]);

    return (
        <DeviceSettingsContext.Provider value={deviceSettingsValue}>
            <DataStateContext.Provider value={dataState}>
                <DataActionsContext.Provider value={dataActions}>
                    <SyncStateContext.Provider value={syncState}>
                        <ModalsContext.Provider value={modalsValue}>
                            <MiscUIContext.Provider value={miscUIValue}>
                                <ScannerContext.Provider value={scannerValue}>
                                    <PWAInstallContext.Provider value={pwaValue}>
                                        <AlertContext.Provider value={alertValue}>
                                            {children}
                                            <AlertModal
                                                isOpen={alertState.isOpen}
                                                message={alertState.message}
                                                closeHandler={closeAlert}
                                                onConfirm={alertState.onConfirm}
                                                onCancel={alertState.onCancel}
                                                confirmText={alertState.confirmText}
                                                cancelText={alertState.cancelText}
                                                confirmButtonClass={alertState.confirmButtonClass}
                                            />
                                            <Toast
                                                isOpen={toastState.isOpen}
                                                message={toastState.message}
                                                type={toastState.type}
                                                onClose={closeToast}
                                            />
                                        </AlertContext.Provider>
                                    </PWAInstallContext.Provider>
                                </ScannerContext.Provider>
                            </MiscUIContext.Provider>
                        </ModalsContext.Provider>
                    </SyncStateContext.Provider>
                </DataActionsContext.Provider>
            </DataStateContext.Provider>
        </DeviceSettingsContext.Provider>
    );
};

export const useDataState = () => {
    const context = useContext(DataStateContext);
    if (context === undefined) throw new Error('useDataState must be used within AppProvider');
    return context;
};

export const useDataActions = () => {
    const context = useContext(DataActionsContext);
    if (context === undefined) throw new Error('useDataActions must be used within AppProvider');
    return context;
};

export const useDeviceSettings = () => {
    const context = useContext(DeviceSettingsContext);
    if (context === undefined) throw new Error('useDeviceSettings must be used within AppProvider');
    return context;
};

export const useSyncState = () => {
    const context = useContext(SyncStateContext);
    if (context === undefined) throw new Error('useSyncState must be used within AppProvider');
    return context;
};

export const useAlert = () => {
    const context = useContext(AlertContext);
    if (context === undefined) throw new Error('useAlert must be used within AppProvider');
    return context;
};

export const useModals = () => {
    const context = useContext(ModalsContext);
    if (context === undefined) throw new Error('useModals must be used within AppProvider');
    return context;
};

export const useMiscUI = () => {
    const context = useContext(MiscUIContext);
    if (context === undefined) throw new Error('useMiscUI must be used within AppProvider');
    return context;
};

export const useScanner = () => {
    const context = useContext(ScannerContext);
    if (context === undefined) throw new Error('useScanner must be used within AppProvider');
    return context;
};

export const usePWAInstall = () => {
    const context = useContext(PWAInstallContext);
    if (context === undefined) throw new Error('usePWAInstall must be used within AppProvider');
    return context;
};
