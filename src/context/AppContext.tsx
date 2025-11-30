
import React, { createContext, useState, useCallback, useEffect, ReactNode, useContext, useMemo, useRef } from 'react';
import { Customer, Product, Order, OrderItem, ScannerContext as ScannerContextType, DeviceSettings, SyncSettings } from '../types';
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
import { mapSqlResultToProduct } from '../utils/mapper';

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
    verifySqlPassword: (password: string) => Promise<boolean>;
    changeSqlPassword: (oldPass: string, newPass: string) => Promise<{ success: boolean; message: string }>;
}
const DeviceSettingsContext = createContext<(DeviceSettings & DeviceSettingsActions) | undefined>(undefined);
interface SyncState {
    isSyncing: boolean;
    syncProgress: number;
    syncStatusText: string;
    syncDataType: 'customers' | 'products' | 'full' | 'background' | null;
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
interface PWAInstallState { isInstallPromptAvailable: boolean; triggerInstallPrompt: () => void; }
const AlertContext = createContext<((message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string, onCancel?: () => void, cancelText?: string, onClose?: () => void) => void) | undefined>(undefined);
const ToastContext = createContext<((message: string, type: 'success' | 'error') => void) | undefined>(undefined);
const ModalsContext = createContext<(ModalsState & ModalsActions) | undefined>(undefined);
const MiscUIContext = createContext<(MiscUIState & MiscUIActions) | undefined>(undefined);
const ScannerContext = createContext<(ScannerState & ScannerActions & { selectedCameraId: string | null; scanSettings: DeviceSettings['scanSettings'] }) | undefined>(undefined);
const PWAInstallContext = createContext<PWAInstallState | undefined>(undefined);

const initialModalsState: ModalsState = { isDetailModalOpen: false, editingOrder: null, isDeliveryModalOpen: false, orderToExport: null, addItemModalProps: null, editItemModalProps: null, isClearHistoryModalOpen: false, };
const defaultSettings: DeviceSettings = {
    selectedCameraId: null,
    scanSettings: { vibrateOnScan: true, soundOnScan: true, },
    logRetentionDays: 30,
    googleDriveSyncSettings: { customers: null, products: null, },
    dataSourceSettings: { newOrder: 'online', productInquiry: 'online', autoSwitch: true, },
    allowDestructiveQueries: false,
};

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const productsRef = useRef(products);
    useEffect(() => {
        productsRef.current = products;
    }, [products]);

    const [settings, setSettings] = useState<DeviceSettings>(defaultSettings);
    const [isSyncing, setIsSyncing] = useState(false);
    const isSyncingRef = useRef(false);
    const [syncProgress, setSyncProgress] = useState(0);
    const [syncStatusText, setSyncStatusText] = useState('');
    const [syncDataType, setSyncDataType] = useState<'customers' | 'products' | 'full' | 'background' | null>(null);
    const [syncSource, setSyncSource] = useState<'local' | 'drive' | null>(null);
    const [initialSyncCompleted, setInitialSyncCompleted] = useState(false);
    const [alertState, setAlertState] = useState<AlertState>({ isOpen: false, message: '' });
    const [toastState, setToastState] = useState<ToastState>({ isOpen: false, message: '', type: 'success' });
    const [modalsState, setModalsState] = useState<ModalsState>(initialModalsState);
    const [lastModifiedOrderId, setLastModifiedOrderId] = useState<number | null>(null);
    const [activeMenuOrderId, setActiveMenuOrderId] = useState<number | null>(null);
    // sqlQueryInput removed from global context for optimization
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
            await checkSqlConnection();
            setSqlStatus('connected');
            return true;
        } catch (err) {
            console.error("SQL Connection Check Failed:", err);
            setSqlStatus('error');
            return false;
        } finally {
            isCheckingSql.current = false;
        }
    }, []);

    const showAlert = useCallback((message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string, onCancel?: () => void, cancelText?: string, onClose?: () => void) => { setAlertState({ isOpen: true, message, onConfirm, confirmText, confirmButtonClass, onCancel, cancelText, onClose }); }, []);
    const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => { setToastState({ isOpen: true, message, type }); }, []);
    const closeAlert = useCallback(() => { if (alertState.onClose) { alertState.onClose(); } setAlertState({ isOpen: false, message: '' }); }, [alertState]);
    
    const syncWithDb = useCallback(async (type: 'incremental' | 'full', silent = false) => {
        if (isSyncingRef.current) {
            if (!silent) showToast("이미 다른 동기화가 진행 중입니다.", 'error');
            return;
        }
        
        isSyncingRef.current = true;
        setIsSyncing(true);
        setSyncDataType(type === 'full' ? 'full' : 'background');
        setSyncSource('drive');
        setSyncProgress(0);
        setSyncStatusText("데이터베이스 연결 중...");

        try {
            if (type === 'full') {
                const { customers: newCustomersRaw, products: newProductsRaw } = await syncCustomersAndProductsFromDb();
                setSyncStatusText("데이터 처리 중...");
                const newCustomers: Customer[] = newCustomersRaw.map(c => ({ comcode: c.거래처코드, name: c.거래처명 })).filter(c => c.comcode && c.name && !/[.#$[\]/]/.test(c.comcode));
                const newProducts: Product[] = newProductsRaw.map(mapSqlResultToProduct).filter(p => p.barcode && p.name && !/[.#$[\]/]/.test(p.barcode));
                setSyncProgress(50); setSyncStatusText("거래처 데이터 저장 중...");
                setCustomers(newCustomers); await cache.setCachedData('customers', newCustomers);
                setSyncProgress(75); setSyncStatusText("상품 데이터 저장 중...");
                setProducts(newProducts); await cache.setCachedData('products', newProducts);
                await cache.setSetting('lastProductSyncTime', new Date().toISOString());
                if (!silent) showToast("전체 동기화가 완료되었습니다.", "success");
            } else {
                setSyncStatusText("증분 동기화 시작..."); setSyncProgress(10);
                const lastProductSync = await cache.getSetting<string>('lastProductSyncTime');
                if (!lastProductSync) {
                    setIsSyncing(false); 
                    isSyncingRef.current = false;
                    showAlert("증분 동기화 이력이 없습니다. 전체 동기화를 먼저 실행합니다.", async () => { await syncWithDb('full', silent); });
                    return;
                }
                setSyncStatusText("변경사항 확인 중...");
                const [serverCustomers, serverProductsRaw]: [any[], any[]] = await Promise.all([syncCustomersFromDb(), syncProductsIncrementally(lastProductSync)]);
                setSyncProgress(30); setSyncStatusText("거래처 업데이트 중...");
                const newCustomers: Customer[] = serverCustomers.map((c: any) => ({ comcode: c.거래처코드, name: c.거래처명 })).filter(c => c.comcode && c.name && !/[.#$[\]/]/.test(c.comcode));
                await cache.setCachedData('customers', newCustomers); setCustomers(newCustomers);
                setSyncProgress(60); setSyncStatusText(`${serverProductsRaw.length}개 상품 업데이트 중...`);
                if (serverProductsRaw.length > 0) {
                    const currentProducts = productsRef.current;
                    const productMap = new Map<string, Product>(currentProducts.map(p => [p.barcode, p]));
                    const serverProducts: Product[] = serverProductsRaw.map(mapSqlResultToProduct);
                    serverProducts.forEach((product) => productMap.set(product.barcode, product));
                    const updatedProducts: Product[] = Array.from(productMap.values());
                    await cache.setCachedData('products', updatedProducts); 
                    setProducts(updatedProducts);
                }
                setSyncProgress(90);
                await cache.setSetting('lastProductSyncTime', new Date().toISOString());
                if (!silent) showToast(`증분 동기화 완료. (${serverProductsRaw.length}개 상품 업데이트)`, "success");
            }
        } catch (error: any) {
            console.error("Sync from DB failed:", error);
            if (!silent) showToast(`데이터베이스 동기화 실패: ${error.message}`, 'error');
        } finally {
            isSyncingRef.current = false;
            setIsSyncing(false); 
            setSyncDataType(null); 
            setSyncSource(null);
        }
    }, [showToast, showAlert]);
    
    const resetData = useCallback(async (dataType: 'customers' | 'products') => {
        const typeKorean = dataType === 'customers' ? '거래처' : '상품';
        try {
            if (dataType === 'customers') {
                const emptyCustomers: Customer[] = [];
                await cache.setCachedData('customers', emptyCustomers);
                setCustomers([]);
            } 
            else {
                const emptyProducts: Product[] = [];
                await cache.setCachedData('products', emptyProducts);
                setProducts([]);
            }
            showToast(`${typeKorean} 데이터가 성공적으로 초기화되었습니다.`, 'success');
        } catch (err: any) { showAlert(`${typeKorean} 데이터 초기화에 실패했습니다: ${err.message}`); }
    }, [showAlert, showToast]);
    
    const addOrder = useCallback(async (orderData: Omit<Order, 'id' | 'date' | 'createdAt' | 'updatedAt' | 'itemCount' | 'completedAt' | 'completionDetails' | 'items'> & { items: OrderItem[] }) => { return await dbAddOrder(orderData, orderData.items); }, []);
    const updateOrder = useCallback(async (order: Order) => { if (!order.items) throw new Error("Order items are missing for update."); await dbUpdateOrder(order, order.items); }, []);
    const deleteOrder = useCallback(async (orderId: number) => { await dbDeleteOrder(orderId); }, []);
    const updateOrderStatus = useCallback(async (orderId: number, completionDetails: Order['completionDetails']) => { await dbUpdateOrderStatus(orderId, completionDetails); }, []);
    const clearOrders = useCallback(async () => { await dbClearOrders(); }, []);
    const clearOrdersBeforeDate = useCallback(async (date: Date) => { return await dbClearOrdersBeforeDate(date.toISOString()); }, []);

    // --- Device-Specific Settings ---
    const updateSettings = useCallback(async (newSettings: DeviceSettings) => {
        setSettings(newSettings);
        const deviceId = getDeviceId();
        try {
            await dbSetDeviceSettings(deviceId, newSettings);
            await cache.setSetting('deviceSettings', newSettings);
        } catch (error) {
            console.error("Failed to sync device settings:", error);
            showToast('기기 설정 저장에 실패했습니다.', 'error');
        }
    }, [showToast]);

    const setSelectedCameraId = useCallback(async (id: string | null) => {
        await updateSettings({ ...settings, selectedCameraId: id });
    }, [settings, updateSettings]);

    const setScanSettings = useCallback(async (newScanSettings: Partial<DeviceSettings['scanSettings']>) => {
        await updateSettings({ ...settings, scanSettings: { ...settings.scanSettings, ...newScanSettings } });
    }, [settings, updateSettings]);
    
    const setLogRetentionDays = useCallback(async (days: number) => {
        await updateSettings({ ...settings, logRetentionDays: days });
    }, [settings, updateSettings]);

    const setGoogleDriveSyncSettings = useCallback(async (type: 'customers' | 'products', syncSettings: SyncSettings | null) => {
        await updateSettings({ ...settings, googleDriveSyncSettings: { ...settings.googleDriveSyncSettings, [type]: syncSettings } });
    }, [settings, updateSettings]);

    const setDataSourceSettings = useCallback(async (newDataSourceSettings: Partial<DeviceSettings['dataSourceSettings']>) => {
        await updateSettings({ ...settings, dataSourceSettings: { ...settings.dataSourceSettings, ...newDataSourceSettings } });
    }, [settings, updateSettings]);
    
    // --- Global Settings ---
    const setAllowDestructiveQueries = useCallback(async (allow: boolean) => {
        await dbSetValue('settings/common/allowDestructiveQueries', allow);
        // Also update local state to reflect change immediately
        setSettings(s => ({ ...s, allowDestructiveQueries: allow }));
    }, []);

    const verifySqlPassword = useCallback(async (password: string): Promise<boolean> => {
        const storedPassword = await dbGetValue<string>('settings/common/sqlPassword', '9005');
        return storedPassword === password;
    }, []);
    
    const changeSqlPassword = useCallback(async (oldPass: string, newPass: string): Promise<{ success: boolean; message: string }> => {
        const isVerified = await verifySqlPassword(oldPass);
        if (!isVerified) {
            return { success: false, message: '현재 비밀번호가 일치하지 않습니다.' };
        }
        try {
            await dbSetValue('settings/common/sqlPassword', newPass);
            return { success: true, message: '비밀번호가 성공적으로 변경되었습니다.' };
        } catch (error) {
            return { success: false, message: '비밀번호 변경 중 오류가 발생했습니다.' };
        }
    }, [verifySqlPassword]);


    const openDetailModal = useCallback((order: Order) => setModalsState(s => ({ ...s, isDetailModalOpen: true, editingOrder: order })), []);
    const closeDetailModal = useCallback(() => setModalsState(s => ({ ...s, isDetailModalOpen: false, editingOrder: null })), []);
    const openDeliveryModal = useCallback((order: Order) => setModalsState(s => ({ ...s, isDeliveryModalOpen: true, orderToExport: order })), []);
    const closeDeliveryModal = useCallback(() => setModalsState(s => ({ ...s, isDeliveryModalOpen: false, orderToExport: null })), []);
    const openAddItemModal = useCallback((props: AddItemModalPayload) => setModalsState(s => ({ ...s, addItemModalProps: props })), []);
    const closeAddItemModal = useCallback(() => setModalsState(s => ({ ...s, addItemModalProps: null })), []);
    const openEditItemModal = useCallback((props: EditItemModalPayload) => setModalsState(s => ({ ...s, editItemModalProps: props })), []);
    const closeEditItemModal = useCallback(() => setModalsState(s => ({ ...s, editItemModalProps: null })), []);
    const openClearHistoryModal = useCallback(() => setModalsState(s => ({ ...s, isClearHistoryModalOpen: true })), []);
    const closeClearHistoryModal = useCallback(() => setModalsState(s => ({ ...s, isClearHistoryModalOpen: false })), []);
    const openScanner = useCallback((context: ScannerContextType, onScan: (barcode: string) => void, continuous: boolean) => { setScannerState({ isScannerOpen: true, scannerContext: context, onScanSuccess: onScan, continuousScan: continuous }); }, []);
    const closeScanner = useCallback(() => { setScannerState(prev => ({ ...prev, isScannerOpen: false })); }, []);

    useEffect(() => { const beforeInstallPromptHandler = (e: Event) => { e.preventDefault(); deferredInstallPrompt.current = e; setInstallPromptAvailable(true); }; window.addEventListener('beforeinstallprompt', beforeInstallPromptHandler); return () => window.removeEventListener('beforeinstallprompt', beforeInstallPromptHandler); }, []);
    const triggerInstallPrompt = useCallback(() => { if (deferredInstallPrompt.current) { deferredInstallPrompt.current.prompt(); deferredInstallPrompt.current.userChoice.then((choiceResult: any) => { if (choiceResult.outcome === 'accepted') { showToast('앱이 설치되었습니다!', 'success'); } deferredInstallPrompt.current = null; setInstallPromptAvailable(false); }); } }, [showToast]);

    useEffect(() => {
        if (!user) {
            setInitialSyncCompleted(false);
            return;
        }

        const loadInitialData = async () => {
            // Data Schema Version Check
            const storedSchemaVersion = await cache.getSetting<string>('dataSchemaVersion');
            if (storedSchemaVersion !== DATA_SCHEMA_VERSION) {
                setInitialSyncCompleted(false);
                setSyncStatusText("데이터 구조 업데이트 필요");
                showAlert("앱 데이터 구조가 변경되었습니다.\n로컬 데이터를 초기화하고 서버에서 전체 데이터를 다시 동기화해야 합니다.",
                    async () => {
                        try {
                            setSyncStatusText("로컬 데이터 초기화 중...");
                            await cache.clearDataStores(); await cache.setSetting('dataSchemaVersion', DATA_SCHEMA_VERSION);
                            showToast("데이터 초기화 완료. 전체 동기화를 시작합니다.", "success");
                            window.location.reload();
                        } catch (err) { showAlert(`초기화 실패: ${(err as Error).message}`); }
                    }, "초기화 및 동기화", 'bg-blue-600',
                    () => setSyncStatusText("업데이트가 취소되었습니다. 앱을 새로고침하여 다시 시도하세요."), "나중에",
                    () => setSyncStatusText("업데이트가 취소되었습니다. 앱을 새로고침하여 다시 시도하세요.")
                );
                return;
            }

            // STEP 1: Load local cache immediately.
            setSyncStatusText("로컬 데이터 로딩 중");
            setSyncProgress(10);
            const [cachedSettings, cachedCustomers, cachedProducts] = await Promise.all([
                cache.getSetting<DeviceSettings>('deviceSettings'),
                cache.getCachedData<Customer>('customers'), cache.getCachedData<Product>('products'),
            ]);
            if (cachedSettings) setSettings(prev => ({ ...defaultSettings, ...prev, ...cachedSettings }));
            setCustomers(cachedCustomers); setProducts(cachedProducts);
            const hasCache = cachedCustomers.length > 0 || cachedProducts.length > 0;

            // STEP 2: If we have cache, let the user into the app immediately.
            if (hasCache || IS_DEVELOPER_MODE) {
                setInitialSyncCompleted(true);
            }

            // STEP 3: Try to connect to the server and sync in the background.
            try {
                setSyncStatusText("서버 연결 확인 중...");
                const deviceId = getDeviceId();
                
                const [isOnline, serverDeviceSettings, commonSettings] = await Promise.all([
                    checkSql(),
                    dbGetDeviceSettings(deviceId),
                    dbGetCommonSettings()
                ]);

                if (isOnline) {
                    // Initialize default SQL password if not set
                    if (commonSettings.sqlPassword === undefined) {
                        await dbSetValue('settings/common/sqlPassword', '9005');
                    }
                    
                    const mergedSettings: DeviceSettings = {
                        ...defaultSettings,
                        ...(serverDeviceSettings as Partial<DeviceSettings>),
                        // Global settings from 'common' override any other setting
                        allowDestructiveQueries: commonSettings.allowDestructiveQueries ?? defaultSettings.allowDestructiveQueries
                    };

                    if (JSON.stringify(settings) !== JSON.stringify(mergedSettings)) {
                        setSettings(mergedSettings); 
                        await cache.setSetting('deviceSettings', mergedSettings);
                    }

                    if (!hasCache && !IS_DEVELOPER_MODE) {
                        setInitialSyncCompleted(false);
                        setSyncStatusText("앱 최초 실행, 전체 동기화를 시작합니다...");
                        await syncWithDb('full');
                        setInitialSyncCompleted(true);
                    } else {
                        syncWithDb('incremental', true).catch(err => {
                            console.error("Background sync failed:", err);
                            showToast('백그라운드 동기화 실패.', 'error');
                        });
                    }
                } else {
                     if (!hasCache && !IS_DEVELOPER_MODE) {
                        setInitialSyncCompleted(false);
                        setSyncStatusText("연결 실패");
                        showAlert("서버에 연결할 수 없습니다. 인터넷 연결을 확인 후 다시 시도해주세요.\n오프라인 모드로 진입하시겠습니까?",
                            () => { setInitialSyncCompleted(true); }, "오프라인 진입", 'bg-gray-600',
                            () => { setRetryCount(c => c + 1); setSyncStatusText("재시도 중..."); }, "재시도"
                        );
                    } else {
                        // Load common settings into local state even if offline
                        const finalSettings = { ...settings, allowDestructiveQueries: commonSettings.allowDestructiveQueries ?? settings.allowDestructiveQueries };
                        setSettings(finalSettings);
                    }
                }
            } catch (err: any) {
                console.error("Initial sync process failed:", err);
                if (!hasCache && !IS_DEVELOPER_MODE) {
                    setInitialSyncCompleted(false);
                    setSyncStatusText("초기화 실패");
                    showAlert(`초기화 실패: ${err.message}\n\n오프라인 모드로 진입하거나 다시 시도하세요.`,
                        () => { setInitialSyncCompleted(true); }, "오프라인 진입", 'bg-gray-600',
                        () => { setRetryCount(c => c + 1); setSyncStatusText("재시도 중..."); }, "재시도"
                    );
                } else {
                    showToast(`백그라운드 연결 실패: ${err.message}`, 'error');
                }
            }
        };

        if (isDbReady()) {
            loadInitialData();
        }
    }, [user, retryCount, checkSql, syncWithDb, showAlert, showToast]);

    useEffect(() => {
        let intervalId: number | undefined;

        const isOnlinePriority = settings.dataSourceSettings.newOrder === 'online' || settings.dataSourceSettings.productInquiry === 'online';

        if (sqlStatus === 'error' && isOnlinePriority) {
            intervalId = window.setInterval(() => {
                console.log("Attempting to reconnect to SQL server...");
                checkSql(); 
            }, 30000); // Check every 30 seconds
        }

        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [sqlStatus, settings.dataSourceSettings, checkSql]);

    const dataStateValue = useMemo(() => ({ customers, products }), [customers, products]);
    const dataActionsValue = useMemo(() => ({ addOrder, updateOrder, deleteOrder, updateOrderStatus, clearOrders, clearOrdersBeforeDate, syncWithDb, resetData, }), [addOrder, updateOrder, deleteOrder, updateOrderStatus, clearOrders, clearOrdersBeforeDate, syncWithDb, resetData]);
    const deviceSettingsValue = useMemo(() => ({ ...settings, setSelectedCameraId, setScanSettings, setLogRetentionDays, setGoogleDriveSyncSettings, setDataSourceSettings, setAllowDestructiveQueries, verifySqlPassword, changeSqlPassword }), [settings, setSelectedCameraId, setScanSettings, setLogRetentionDays, setGoogleDriveSyncSettings, setDataSourceSettings, setAllowDestructiveQueries, verifySqlPassword, changeSqlPassword]);
    const syncStateValue = useMemo(() => ({ isSyncing, syncProgress, syncStatusText, syncDataType, syncSource, initialSyncCompleted, }), [isSyncing, syncProgress, syncStatusText, syncDataType, syncSource, initialSyncCompleted]);
    const modalsValue = useMemo(() => ({ ...modalsState, openDetailModal, closeDetailModal, openDeliveryModal, closeDeliveryModal, openAddItemModal, closeAddItemModal, openEditItemModal, closeEditItemModal, openClearHistoryModal, closeClearHistoryModal, }), [modalsState, openDetailModal, closeDetailModal, openDeliveryModal, closeDeliveryModal, openAddItemModal, closeAddItemModal, openEditItemModal, closeEditItemModal, openClearHistoryModal, closeClearHistoryModal]);
    const miscUIValue = useMemo(() => ({ lastModifiedOrderId, setLastModifiedOrderId, activeMenuOrderId, setActiveMenuOrderId, sqlStatus, checkSql }), [lastModifiedOrderId, activeMenuOrderId, sqlStatus, checkSql]);
    const scannerValue = useMemo(() => ({ ...scannerState, selectedCameraId: settings.selectedCameraId, scanSettings: settings.scanSettings, openScanner, closeScanner }), [scannerState, settings.selectedCameraId, settings.scanSettings, openScanner, closeScanner]);
    const pwaInstallValue = useMemo(() => ({ isInstallPromptAvailable, triggerInstallPrompt }), [isInstallPromptAvailable, triggerInstallPrompt]);

    return (
        <DataStateContext.Provider value={dataStateValue}>
            <DataActionsContext.Provider value={dataActionsValue}>
                <DeviceSettingsContext.Provider value={deviceSettingsValue}>
                    <SyncStateContext.Provider value={syncStateValue}>
                        <AlertContext.Provider value={showAlert}>
                            <ToastContext.Provider value={showToast}>
                                <ModalsContext.Provider value={modalsValue}>
                                    <MiscUIContext.Provider value={miscUIValue}>
                                        <ScannerContext.Provider value={scannerValue}>
                                            <PWAInstallContext.Provider value={pwaInstallValue}>
                                                {children}
                                                <AlertModal isOpen={alertState.isOpen} message={alertState.message} closeHandler={closeAlert} onConfirm={alertState.onConfirm} onCancel={alertState.onCancel} confirmText={alertState.confirmText} confirmButtonClass={alertState.confirmButtonClass} cancelText={alertState.cancelText} />
                                                <Toast isOpen={toastState.isOpen} message={toastState.message} type={toastState.type} onClose={() => setToastState(s => ({ ...s, isOpen: false }))} />
                                            </PWAInstallContext.Provider>
                                        </ScannerContext.Provider>
                                    </MiscUIContext.Provider>
                                </ModalsContext.Provider>
                            </ToastContext.Provider>
                        </AlertContext.Provider>
                    </SyncStateContext.Provider>
                </DeviceSettingsContext.Provider>
            </DataActionsContext.Provider>
        </DataStateContext.Provider>
    );
};

export const useDataState = () => { const context = useContext(DataStateContext); if (!context) throw new Error('useDataState must be used within an AppProvider'); return context; };
export const useDataActions = () => { const context = useContext(DataActionsContext); if (!context) throw new Error('useDataActions must be used within an AppProvider'); return context; };
export const useDeviceSettings = () => { const context = useContext(DeviceSettingsContext); if (!context) throw new Error('useDeviceSettings must be used within an AppProvider'); return context; };
export const useSyncState = () => { const context = useContext(SyncStateContext); if (!context) throw new Error('useSyncState must be used within an AppProvider'); return context; };
export const useAlert = () => { const showAlert = useContext(AlertContext); const showToast = useContext(ToastContext); if (!showAlert || !showToast) throw new Error('useAlert must be used within an AppProvider'); return { showAlert, showToast }; };
export const useModals = () => { const context = useContext(ModalsContext); if (!context) throw new Error('useModals must be used within an AppProvider'); return context; };
export const useMiscUI = () => { const context = useContext(MiscUIContext); if (!context) throw new Error('useMiscUI must be used within an AppProvider'); return context; };
export const useScanner = () => { const context = useContext(ScannerContext); if (!context) throw new Error('useScanner must be used within an AppProvider'); return context; };
export const usePWAInstall = () => { const context = useContext(PWAInstallContext); if (!context) throw new Error('usePWAInstall must be used within an AppProvider'); return context; };
