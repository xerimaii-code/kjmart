
import React, { createContext, useState, useCallback, useEffect, ReactNode, useContext, useMemo, useRef } from 'react';
import { Customer, Product, Order, OrderItem, ScannerContext as ScannerContextType, DeviceSettings, SyncSettings, BOM, Category, UserQuery } from '../types';
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
import { syncCustomersAndProductsFromDb, syncCustomersFromDb, syncProductsIncrementally, checkSqlConnection } from '../services/sqlService';
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
interface ScannerState { isScannerOpen: boolean; scannerContext: ScannerContextType; onScanSuccess: (barcode: string) => void; continuousScan: boolean; }
interface ScannerActions { openScanner: (context: ScannerContextType, onScan: (barcode: string) => void, continuous: boolean) => void; closeScanner: () => void; }
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
    scanSettings: { vibrateOnScan: true, soundOnScan: true, },
    logRetentionDays: 30,
    googleDriveSyncSettings: { customers: null, products: null, },
    dataSourceSettings: { newOrder: 'online', productInquiry: 'online', autoSwitch: true, },
    allowDestructiveQueries: true,
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
    const [scannerState, setScannerState] = useState<ScannerState>({ isScannerOpen: false, scannerContext: null, onScanSuccess: () => {}, continuousScan: false });
    const [isInstallPromptAvailable, setInstallPromptAvailable] = useState(false);
    const deferredInstallPrompt = useRef<any>(null);
    const [sqlStatus, setSqlStatus] = useState<SqlServerStatus>('unknown');
    const isCheckingSql = useRef(false);
    const [retryCount, setRetryCount] = useState(0);

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
                
                if (!silent) setSyncStatusText('데이터 다운로드 중...');
                setSyncProgress(10);
                
                const data = await syncCustomersAndProductsFromDb();
                
                if (!silent) setSyncStatusText('거래처 저장 중...');
                setSyncProgress(30);
                
                const mappedCustomers = data.customers.map(mapSqlResultToCustomer);
                await cache.setCachedData('customers', mappedCustomers);
                
                if (!silent) setSyncStatusText('상품 저장 중...');
                setSyncProgress(50);
                await cache.setCachedData('products', data.products.map(mapSqlResultToProduct), (progress) => {
                    setSyncProgress(50 + Math.floor(progress * 0.4));
                });
                
                if (!silent) setSyncStatusText('기타 데이터 저장 중...');
                
                const bomData: BOM[] = data.bom.map((b: any) => ({
                    pcode: sanitizeString(b.pcode),
                    ccode: sanitizeString(b.ccode),
                    qty: Number(b.qty || 0),
                    id: `${sanitizeString(b.pcode)}_${sanitizeString(b.ccode)}`
                }));
                await cache.setCachedData('bom', bomData);

                const categories: Category[] = [];
                data.gubun1.forEach((g: any) => {
                    const code = sanitizeString(g.gubun1);
                    if (code) categories.push({ id: `L:${code}`, level: 1, code1: code, name: sanitizeString(g.gubun1x) });
                });
                data.gubun2.forEach((g: any) => {
                    const c1 = sanitizeString(g.gubun1);
                    const c2 = sanitizeString(g.gubun2);
                    if (c1 && c2) categories.push({ id: `M:${c1}:${c2}`, level: 2, code1: c1, code2: c2, name: sanitizeString(g.gubun2x) });
                });
                data.gubun3.forEach((g: any) => {
                    const c1 = sanitizeString(g.gubun1);
                    const c2 = sanitizeString(g.gubun2);
                    const c3 = sanitizeString(g.gubun3);
                    if (c1 && c2 && c3) categories.push({ id: `S:${c1}:${c2}:${c3}`, level: 3, code1: c1, code2: c2, code3: c3, name: sanitizeString(g.gubun3x) });
                });
                await cache.setCachedData('categories', categories);

                setCustomers(mappedCustomers);
                setProducts(data.products.map(mapSqlResultToProduct));
                
                setSyncProgress(100);
                if (!silent) showToast('전체 동기화 완료', 'success');
            } else {
                if (!silent) showToast('증분 동기화를 시작합니다.', 'success');
                if (!silent) setSyncStatusText('변경 사항 확인 중...');
                
                const customersData = await syncCustomersFromDb();
                const mappedCustomers = customersData.map(mapSqlResultToCustomer);
                
                await cache.setCachedData('customers', mappedCustomers);
                setCustomers(mappedCustomers);

                const lastProduct = productsRef.current.reduce((latest, p) => {
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
                    const productMap = new Map(productsRef.current.map(p => [p.barcode, p]));
                    newProducts.forEach(p => productMap.set(p.barcode, p));
                    const updatedProducts = Array.from(productMap.values());
                    
                    await cache.setCachedData('products', updatedProducts);
                    setProducts(updatedProducts);
                    if (!silent) showToast(`${newProducts.length}건의 상품이 업데이트되었습니다.`, 'success');
                } else {
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

    // Device Settings Actions
    const updateDeviceSetting = useCallback(async (key: keyof DeviceSettings, value: any) => {
        setSettings(prev => ({ ...prev, [key]: value }));
        const deviceId = getDeviceId();
        await dbSetDeviceSettings(deviceId, { ...settings, [key]: value });
    }, [settings]);

    const setSelectedCameraId = useCallback((id: string | null) => updateDeviceSetting('selectedCameraId', id), [updateDeviceSetting]);
    const setScanSettings = useCallback((val: Partial<DeviceSettings['scanSettings']>) => updateDeviceSetting('scanSettings', { ...settings.scanSettings, ...val }), [updateDeviceSetting, settings]);
    const setLogRetentionDays = useCallback((days: number) => updateDeviceSetting('logRetentionDays', days), [updateDeviceSetting]);
    const setGoogleDriveSyncSettings = useCallback((type: 'customers' | 'products', val: SyncSettings | null) => updateDeviceSetting('googleDriveSyncSettings', { ...settings.googleDriveSyncSettings, [type]: val }), [updateDeviceSetting, settings]);
    const setDataSourceSettings = useCallback((val: Partial<DeviceSettings['dataSourceSettings']>) => updateDeviceSetting('dataSourceSettings', { ...settings.dataSourceSettings, ...val }), [updateDeviceSetting, settings]);
    const setAllowDestructiveQueries = useCallback((allow: boolean) => updateDeviceSetting('allowDestructiveQueries', allow), [updateDeviceSetting]);

    // Modals Actions
    const openDetailModal = useCallback((order: Order) => setModalsState(prev => ({ ...prev, isDetailModalOpen: true, editingOrder: order })), []);
    const closeDetailModal = useCallback(() => setModalsState(prev => ({ ...prev, isDetailModalOpen: false, editingOrder: null })), []);
    const openDeliveryModal = useCallback((order: Order) => setModalsState(prev => ({ ...prev, isDeliveryModalOpen: true, orderToExport: order })), []);
    const closeDeliveryModal = useCallback(() => setModalsState(prev => ({ ...prev, isDeliveryModalOpen: false, orderToExport: null })), []);
    const openAddItemModal = useCallback((props: AddItemModalPayload) => setModalsState(prev => ({ ...prev, addItemModalProps: props })), []);
    const closeAddItemModal = useCallback(() => setModalsState(prev => ({ ...prev, addItemModalProps: null })), []);
    const openEditItemModal = useCallback((props: EditItemModalPayload) => setModalsState(prev => ({ ...prev, editItemModalProps: props })), []);
    const closeEditItemModal = useCallback(() => setModalsState(prev => ({ ...prev, editItemModalProps: null })), []);
    const openClearHistoryModal = useCallback(() => setModalsState(prev => ({ ...prev, isClearHistoryModalOpen: true })), []);
    const closeClearHistoryModal = useCallback(() => setModalsState(prev => ({ ...prev, isClearHistoryModalOpen: false })), []);

    // Scanner Actions
    const openScanner = useCallback((context: ScannerContextType, onScan: (barcode: string) => void, continuous: boolean) => {
        setScannerState({ isScannerOpen: true, scannerContext: context, onScanSuccess: onScan, continuousScan: continuous });
    }, []);
    const closeScanner = useCallback(() => {
        setScannerState(prev => ({ ...prev, isScannerOpen: false }));
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

    // --- NEW: Load initial data (Offline-First) ---
    useEffect(() => {
        const performBackgroundSync = async () => {
            let isSqlConnected = false;
            try {
                isSqlConnected = await checkSql();
            } catch (e) {
                console.warn("SQL Connection check failed during background sync:", e);
            }

            if (isSqlConnected) {
                let shouldFullSync = false;
                const [cachedCustomers, cachedProducts] = await Promise.all([
                    cache.getCachedData<Customer>('customers'),
                    cache.getCachedData<Product>('products')
                ]);

                if (!cachedCustomers?.length || !cachedProducts?.length) {
                    shouldFullSync = true;
                }
                
                if (!shouldFullSync) {
                    try {
                        const schemaChanged = await syncAndCacheDbSchema();
                        if (schemaChanged) shouldFullSync = true;
                    } catch (e) { console.warn("Schema check failed:", e); }
                }

                if (shouldFullSync) {
                    await syncWithDb('full', true); 
                } else {
                    await syncWithDb('incremental', true);
                }
            } else {
                 // The offline status is indicated in the MenuPage footer, so the toast is redundant.
            }
        };

        const loadInitialData = async () => {
            const deviceId = getDeviceId();
            
            try {
                // 1. Settings
                setSyncStatusText('설정 불러오는 중');
                const savedSettings = await dbGetDeviceSettings(deviceId);
                const commonSettings = await dbGetCommonSettings();
                setSettings(prev => ({ ...prev, ...savedSettings, ...commonSettings }));

                // 2. Local Cache (Customers & Products)
                setSyncStatusText('로컬 데이터 불러오는 중');
                const [cachedCustomers, cachedProducts] = await Promise.all([
                    cache.getCachedData<Customer>('customers'),
                    cache.getCachedData<Product>('products')
                ]);
                
                setCustomers(cachedCustomers || []);
                setProducts(cachedProducts || []);

                // 3. Immediately complete initial load to unblock UI
                setInitialSyncCompleted(true);
                
                // 4. Start background sync
                performBackgroundSync();

            } catch (globalError) {
                console.error("Initialization error:", globalError);
                showToast('앱 초기화 중 오류가 발생했습니다. 오프라인 모드로 진입합니다.', 'error');
                setInitialSyncCompleted(true); // Still complete to show the app
            }
        };

        if (user) {
            loadInitialData();
        }
    }, [user, checkSql, syncWithDb, showToast]);

    // --- Automatic Background Synchronization (Refined) ---
    // 앱이 포커스를 얻을 때(백그라운드 -> 포커스) 자동으로 증분 동기화를 수행합니다.
    useEffect(() => {
        if (!user || !initialSyncCompleted) return;

        const handleVisibilityChange = async () => {
            if (document.visibilityState === 'visible') {
                console.log("App returned to foreground. Checking for updates...");
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


    // --- Context Values ---
    const dataState = useMemo(() => ({ customers, products, userQueries }), [customers, products, userQueries]);
    const dataActions = useMemo(() => ({ addOrder, updateOrder, deleteOrder, updateOrderStatus, clearOrders, clearOrdersBeforeDate, syncWithDb, resetData }), [addOrder, updateOrder, deleteOrder, updateOrderStatus, clearOrders, clearOrdersBeforeDate, syncWithDb, resetData]);
    const deviceSettingsValue = useMemo(() => ({ ...settings, setSelectedCameraId, setScanSettings, setLogRetentionDays, setGoogleDriveSyncSettings, setDataSourceSettings, setAllowDestructiveQueries }), [settings, setSelectedCameraId, setScanSettings, setLogRetentionDays, setGoogleDriveSyncSettings, setDataSourceSettings, setAllowDestructiveQueries]);
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
