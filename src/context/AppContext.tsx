import React, { createContext, useState, useCallback, useEffect, ReactNode, useContext, useMemo, useRef } from 'react';
import { Customer, Product, Order, OrderItem, ScannerContext as ScannerContextType, SyncLog, DeviceSettings, SyncSettings } from '../types';
import { 
    isInitialized, getDeviceSettings, db as firebaseDb, getStore, 
    getLastSyncLogKey, getSyncLogChanges, listenForNewLogs, cleanupSyncLogs,
    addOrder as dbAddOrder, updateOrder as dbUpdateOrder, deleteOrder as dbDeleteOrder,
    updateOrderStatus as dbUpdateOrderStatus, clearOrders as dbClearOrders, 
    clearOrdersBeforeDate as dbClearOrdersBeforeDate, resetData as dbResetData,
    smartSyncData,
    setDeviceSetting,
    setValue,
    getStoreWithLimit
} from '../services/dbService';
import * as cache from '../services/cacheDbService';
import AlertModal from '../components/AlertModal';
import { useAuth } from './AuthContext';
import * as googleDrive from '../services/googleDriveService';
import { getDeviceId } from '../services/deviceService';
import Toast, { ToastState } from '../components/Toast';
// FIX: Imported ParsedResult to resolve 'Cannot find name' error.
import { processExcelFileInWorker, ParsedResult } from '../services/dataService';
import { IS_DEVELOPER_MODE } from '../config';
import { useLocalStorage } from '../hooks/useLocalStorage';


// --- TYPE DEFINITIONS ---

// Create types for the data passed to open functions to avoid circular dependencies
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
export interface MemoModalPayload {
    initialMemo: string;
    onSave: (memo: string) => void;
}

// Data Context
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
    syncWithFile: (file: File | Blob, dataType: 'customers' | 'products', source: 'local' | 'drive') => Promise<void>;
    forceFullSync: () => Promise<void>;
    resetData: (dataType: 'customers' | 'products') => Promise<void>;
}

const DataStateContext = createContext<DataState | undefined>(undefined);
const DataActionsContext = createContext<DataActions | undefined>(undefined);

// Device Settings Context
interface DeviceSettingsActions {
    setSelectedCameraId: (id: string | null) => Promise<void>;
    setScanSettings: (settings: Partial<DeviceSettings['scanSettings']>) => Promise<void>;
    setLogRetentionDays: (days: number) => Promise<void>;
    setGoogleDriveSyncSettings: (type: 'customers' | 'products', settings: SyncSettings | null) => Promise<void>;
}

const DeviceSettingsContext = createContext<(DeviceSettings & DeviceSettingsActions) | undefined>(undefined);


// --- Sync Context ---
interface SyncState {
    isSyncing: boolean;
    syncProgress: number;
    syncStatusText: string;
    syncDataType: 'customers' | 'products' | 'full' | null;
    syncSource: 'local' | 'drive' | null;
    initialSyncCompleted: boolean;
}

const SyncStateContext = createContext<SyncState | undefined>(undefined);

// --- UI Contexts (Modals, Alerts, etc.) ---
interface AlertState {
    isOpen: boolean;
    message: string;
    onConfirm?: () => void;
    onCancel?: () => void;
    confirmText?: string;
    confirmButtonClass?: string;
}

interface ModalsState {
    isDetailModalOpen: boolean;
    editingOrder: Order | null;
    isDeliveryModalOpen: boolean;
    orderToExport: Order | null;
    addItemModalProps: AddItemModalPayload | null;
    editItemModalProps: EditItemModalPayload | null;
    memoModalProps: MemoModalPayload | null;
    isHistoryModalOpen: boolean;
    isClearHistoryModalOpen: boolean;
}

interface ModalsActions {
    openDetailModal: (order: Order) => void;
    closeDetailModal: () => void;
    openDeliveryModal: (order: Order) => void;
    closeDeliveryModal: () => void;
    openAddItemModal: (props: AddItemModalPayload) => void;
    closeAddItemModal: () => void;
    openEditItemModal: (props: EditItemModalPayload) => void;
    closeEditItemModal: () => void;
    openMemoModal: (props: MemoModalPayload) => void;
    closeMemoModal: () => void;
    openHistoryModal: () => void;
    closeHistoryModal: () => void;
    openClearHistoryModal: () => void;
    closeClearHistoryModal: () => void;
}

interface MiscUIState {
    lastModifiedOrderId: number | null;
}

interface MiscUIActions {
    setLastModifiedOrderId: (id: number | null) => void;
}

interface ScannerState {
    isScannerOpen: boolean;
    scannerContext: ScannerContextType;
    onScanSuccess: (barcode: string) => void;
    continuousScan: boolean;
}

interface ScannerActions {
    openScanner: (context: ScannerContextType, onScan: (barcode: string) => void, continuous: boolean) => void;
    closeScanner: () => void;
}

interface PWAInstallState {
    isInstallPromptAvailable: boolean;
    triggerInstallPrompt: () => void;
}

const AlertContext = createContext<((message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string, onCancel?: () => void) => void) | undefined>(undefined);
const ToastContext = createContext<((message: string, type: 'success' | 'error') => void) | undefined>(undefined);
const ModalsContext = createContext<(ModalsState & ModalsActions) | undefined>(undefined);
const MiscUIContext = createContext<(MiscUIState & MiscUIActions) | undefined>(undefined);
const ScannerContext = createContext<(ScannerState & ScannerActions) | undefined>(undefined);
const PWAInstallContext = createContext<PWAInstallState | undefined>(undefined);

// --- Initial States ---
const initialModalsState: ModalsState = {
    isDetailModalOpen: false, editingOrder: null,
    isDeliveryModalOpen: false, orderToExport: null,
    addItemModalProps: null, editItemModalProps: null,
    memoModalProps: null, isHistoryModalOpen: false,
    isClearHistoryModalOpen: false,
};

const defaultDeviceSettings: DeviceSettings = {
    selectedCameraId: null,
    scanSettings: {
        vibrateOnScan: true,
        soundOnScan: true,
    },
    logRetentionDays: 30,
    googleDriveSyncSettings: {
        customers: null,
        products: null,
    },
};


// --- AppProvider Component ---

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();

    // --- Data State ---
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [lastSyncKeys, setLastSyncKeys] = useLocalStorage<{ customers: string | null; products: string | null; }>('lastSyncKeys', { customers: null, products: null }, { deviceSpecific: true });
    const lastSyncKeysRef = useRef(lastSyncKeys);
    useEffect(() => { lastSyncKeysRef.current = lastSyncKeys; }, [lastSyncKeys]);
    const [deviceSettings, setDeviceSettings] = useState<DeviceSettings>(defaultDeviceSettings);

    // --- Sync State ---
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncProgress, setSyncProgress] = useState(0);
    const [syncStatusText, setSyncStatusText] = useState('');
    const [syncDataType, setSyncDataType] = useState<'customers' | 'products' | 'full' | null>(null);
    const [syncSource, setSyncSource] = useState<'local' | 'drive' | null>(null);
    const [initialSyncCompleted, setInitialSyncCompleted] = useState(false);

    // --- UI State ---
    const [alertState, setAlertState] = useState<AlertState>({ isOpen: false, message: '' });
    const [toastState, setToastState] = useState<ToastState>({ isOpen: false, message: '', type: 'success' });
    const [modalsState, setModalsState] = useState<ModalsState>(initialModalsState);
    const [lastModifiedOrderId, setLastModifiedOrderId] = useState<number | null>(null);
    const [scannerState, setScannerState] = useState<ScannerState>({ isScannerOpen: false, scannerContext: null, onScanSuccess: () => {}, continuousScan: false });
    const [isInstallPromptAvailable, setInstallPromptAvailable] = useState(false);
    const deferredInstallPrompt = useRef<any>(null);

    // --- Alert & Toast Actions ---
    const showAlert = useCallback((message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string, onCancel?: () => void) => {
        setAlertState({ isOpen: true, message, onConfirm, confirmText, confirmButtonClass, onCancel });
    }, []);

    const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToastState({ isOpen: true, message, type });
    }, []);

    // --- Data Actions ---
    const addOrder = useCallback(async (orderData: Omit<Order, 'id' | 'date' | 'createdAt' | 'updatedAt' | 'itemCount' | 'completedAt' | 'completionDetails' | 'items'> & { items: OrderItem[] }) => {
        if (!isInitialized() || !firebaseDb) throw new Error("Database not initialized");

        const { items, ...restOrderData } = orderData;
        const newOrderId = await dbAddOrder(restOrderData, items);
        return newOrderId;
    }, []);

    const updateOrder = useCallback(async (order: Order) => {
        if (!isInitialized() || !firebaseDb) throw new Error("Database not initialized");
        const { items, ...orderHeader } = order;
        await dbUpdateOrder(orderHeader, items || []);
    }, []);

    const deleteOrder = useCallback(async (orderId: number) => {
        if (!isInitialized() || !firebaseDb) throw new Error("Database not initialized");
        await dbDeleteOrder(orderId);
    }, []);

    const updateOrderStatus = useCallback(async (orderId: number, completionDetails: Order['completionDetails']) => {
        if (!isInitialized() || !firebaseDb) throw new Error("Database not initialized");
        await dbUpdateOrderStatus(orderId, completionDetails);
    }, []);

    const clearOrders = useCallback(async () => {
        if (!isInitialized() || !firebaseDb) throw new Error("Database not initialized");
        await dbClearOrders();
    }, []);

    const clearOrdersBeforeDate = useCallback(async (date: Date) => {
        if (!isInitialized() || !firebaseDb) throw new Error("Database not initialized");
        return await dbClearOrdersBeforeDate(date.toISOString());
    }, []);
    
    const resetData = useCallback(async (dataType: 'customers' | 'products') => {
        if (!isInitialized() || !firebaseDb) throw new Error("Database not initialized");
        try {
            await dbResetData(dataType);
            const typeKorean = dataType === 'customers' ? '거래처' : '상품';
            showToast(`${typeKorean} 데이터가 성공적으로 초기화되었습니다.`, 'success');
        } catch (e) {
            showToast('데이터 초기화에 실패했습니다.', 'error');
        }
    }, [showToast]);

    const setSyncProgressText = (text: string) => {
        setSyncStatusText(text);
        // A minimal progress increment to show activity.
        setSyncProgress(p => Math.min(99, p + 0.1));
    }

    const forceFullSync = useCallback(async (showAlerts = true) => {
        if (!isInitialized()) return;
        
        setIsSyncing(true);
        setSyncDataType('full');
        setSyncSource(null);

        const stores = ['customers', 'products'];
        let errorOccurred = false;

        for (const storeName of stores) {
            setSyncStatusText(`${storeName === 'customers' ? '거래처' : '상품'} 데이터 다운로드 중`);
            setSyncProgress(storeName === 'customers' ? 0 : 50);
            try {
                const serverData = await getStore(storeName);
                await cache.setCachedData(storeName as 'customers' | 'products', serverData as any);
                if (storeName === 'customers') {
                    setCustomers(serverData as Customer[]);
                } else {
                    setProducts(serverData as Product[]);
                }
            } catch (error) {
                console.error(`Full sync failed for ${storeName}:`, error);
                errorOccurred = true;
                break;
            }
        }
        
        if (errorOccurred) {
            if (showAlerts) showAlert("전체 데이터 동기화에 실패했습니다. 인터넷 연결을 확인해주세요.");
        } else {
            if (showAlerts) showToast('데이터 동기화가 완료되었습니다.', 'success');
             try {
                const [customersKey, productsKey] = await Promise.all([
                    getLastSyncLogKey('customers'),
                    getLastSyncLogKey('products'),
                ]);
                setLastSyncKeys({ customers: customersKey, products: productsKey });
            } catch (e) {
                console.error("Failed to update last sync keys after full sync:", e);
            }
        }

        setIsSyncing(false);
        setSyncDataType(null);
        setSyncProgress(100);
        return !errorOccurred;
    }, [showAlert, showToast, setLastSyncKeys]);
    
    const syncWithFile = useCallback(async (file: File | Blob, dataType: 'customers' | 'products', source: 'local' | 'drive') => {
        if (!isInitialized() || !user) {
            showToast("로그인이 필요합니다.", 'error');
            return;
        }

        setIsSyncing(true);
        setSyncDataType(dataType);
        setSyncSource(source);
        setSyncProgress(0);
        setSyncStatusText('파일 분석 시작...');
        const dataTypeKorean = dataType === 'customers' ? '거래처' : '상품';
        
        const proceedSync = async (parsedResult: ParsedResult<Customer | Product>, bypassMassDeleteCheck = false) => {
            setIsSyncing(true); // Ensure sync state is active for retries
            setSyncDataType(dataType);
            setSyncSource(source);
            
            try {
                const existingData = await cache.getCachedData<Customer | Product>(dataType);
                const { additions, updates, deletions } = await smartSyncData(
                    dataType,
                    parsedResult.valid,
                    user?.email || 'unknown',
                    (msg) => setSyncProgressText(msg),
                    existingData,
                    { bypassMassDeleteCheck }
                );
                
                showToast(`${dataTypeKorean} 데이터 동기화 완료: ${additions}건 추가, ${updates}건 수정, ${deletions}건 삭제`, 'success');
                // Trigger a full sync to update local caches everywhere
                forceFullSync(false); 
                
            } catch (err: any) {
                if (err.message === 'MASS_DELETION_DETECTED') {
                    const { numExisting, numDeletions } = err.details;
                    showAlert(
                        `경고: 대량 삭제가 감지되었습니다.\n\n기존 데이터: ${numExisting.toLocaleString()}건\n결과적으로 ${numDeletions.toLocaleString()}건의 데이터가 삭제됩니다. 계속하시겠습니까?`,
                        () => proceedSync(parsedResult, true),
                        '삭제 진행',
                        'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500',
                        () => showToast('동기화 작업이 취소되었습니다.', 'error')
                    );
                } else {
                    console.error("Sync error:", err);
                    showAlert(`${dataTypeKorean} 데이터 동기화 중 오류가 발생했습니다: ${err.message || '알 수 없는 오류'}`);
                }
            } finally {
                setIsSyncing(false);
                setSyncDataType(null);
                setSyncSource(null);
                setSyncProgress(100);
            }
        };

        try {
            const parsedResult = await processExcelFileInWorker<Customer | Product>(
                file, 
                dataType === 'customers' ? 'customer' : 'product',
                (message) => {
                    setSyncStatusText(message);
                    setSyncProgress(p => Math.min(99, p + 10)); // Arbitrary progress for feedback
                }
            );

            if (parsedResult.errors.length > 0) {
                const errorMsg = `파일에 ${parsedResult.errors.length}개의 오류가 있습니다. 첫 번째 오류:\n${parsedResult.errors[0]}`;
                showAlert(errorMsg);
                throw new Error("File parsing failed.");
            }
            
            await proceedSync(parsedResult);

        } catch (err: any) {
            setIsSyncing(false);
            setSyncDataType(null);
            setSyncSource(null);
            // Re-throw specific errors for the UI to handle, otherwise show a generic error.
            if (err.message === "MASS_DELETION_DETECTED") {
                // Attach the proceed function for the UI to call.
                err.details.proceed = () => proceedSync(err.details.parsedResult, true);
                throw err;
            }
            const errorMessage = err.message || '알 수 없는 오류';
            if (errorMessage !== "File parsing failed.") { // Avoid double alerts
                showAlert(`${dataTypeKorean} 데이터 동기화 중 오류가 발생했습니다: ${errorMessage}`);
            }
        }
    }, [user, showAlert, showToast, forceFullSync]);


    // --- Effect for initial data load and incremental sync ---
    useEffect(() => {
        if (!user || !isInitialized()) {
            if (user) setInitialSyncCompleted(true);
            return;
        };

        let listeners: (() => void)[] = [];
        let isCancelled = false;
        
        const performInitialLoad = async () => {
            const deviceId = getDeviceId();
            const loadedSettings = await getDeviceSettings(deviceId);
            setDeviceSettings(prev => ({ ...prev, ...loadedSettings }));

            setIsSyncing(true);
            setSyncDataType('full');
            
            setSyncStatusText('로컬 캐시 로딩 중');
            setSyncProgress(0);
            const cachedCustomers = await cache.getCachedData<Customer>('customers');
            const cachedProducts = await cache.getCachedData<Product>('products');

            if (cachedCustomers.length > 0 || cachedProducts.length > 0) {
                setCustomers(cachedCustomers);
                setProducts(cachedProducts);
                setInitialSyncCompleted(true); 
            }
            
            if (IS_DEVELOPER_MODE && (cachedCustomers.length > 0 || cachedProducts.length > 0)) {
                console.log("Developer mode: Skipping full server sync on startup, using cache.");
                setIsSyncing(false);
                setSyncDataType(null);
                setInitialSyncCompleted(true);
                return;
            }

            // ---- Full/Incremental Sync Logic ----
            const stores: ('customers' | 'products')[] = ['customers', 'products'];
            let fullSyncSuccess = true;

            for (const storeName of stores) {
                 if (isCancelled) break;

                const dataTypeKorean = storeName === 'customers' ? '거래처' : '상품';
                setSyncStatusText(`${dataTypeKorean} 데이터 동기화 중`);
                setSyncProgress(storeName === 'customers' ? 25 : 75);

                const lastKey = lastSyncKeysRef.current[storeName];

                if (lastKey) {
                    // Incremental Sync
                    try {
                        const { items, newLastKey } = await getSyncLogChanges(storeName, lastKey);
                        const addedOrUpdated = items.filter(i => !i._deleted);
                        const deletedKeys = items.filter(i => i._deleted).map(i => i.comcode || i.barcode);

                        if (addedOrUpdated.length > 0) await cache.appendCachedData(storeName, addedOrUpdated);
                        for (const key of deletedKeys) await cache.removeCachedItem(storeName, key);

                        setLastSyncKeys(prev => ({ ...prev, [storeName]: newLastKey }));
                    } catch (e) {
                        console.error(`Incremental sync for ${storeName} failed, falling back to full sync.`, e);
                        fullSyncSuccess = await forceFullSync(false); // Perform full sync on this store
                    }
                } else {
                    // Full Sync for this store
                    try {
                        const serverData = IS_DEVELOPER_MODE
                            ? await getStoreWithLimit(storeName, storeName === 'customers' ? 10 : 50)
                            : await getStore(storeName);
                        
                        if (IS_DEVELOPER_MODE) {
                            console.log(`Developer mode: Fetched ${serverData.length} items for ${storeName}.`);
                        }

                        await cache.setCachedData(storeName, serverData as any);
                        const newLastKey = await getLastSyncLogKey(storeName);
                        setLastSyncKeys(prev => ({ ...prev, [storeName]: newLastKey }));
                    } catch (e) {
                        console.error(`Full sync for ${storeName} failed.`, e);
                        fullSyncSuccess = false;
                    }
                }
            } // end for loop

            if (isCancelled) return;
            
            if (!fullSyncSuccess) {
                 showAlert('초기 데이터 동기화에 실패했습니다. 앱을 새로고침하여 다시 시도해주세요.');
                 setInitialSyncCompleted(true); // Allow app to run with potentially stale data
                 setIsSyncing(false);
                 return;
            }
            
            // Reload from cache after all syncs are done.
            const finalCustomers = await cache.getCachedData<Customer>('customers');
            const finalProducts = await cache.getCachedData<Product>('products');
            setCustomers(finalCustomers);
            setProducts(finalProducts);
            setInitialSyncCompleted(true);
            setIsSyncing(false);
            setSyncDataType(null);
            
            // Attach real-time listeners
            for (const storeName of stores) {
                const keyField = storeName === 'customers' ? 'comcode' : 'barcode';
                const listener = listenForNewLogs(storeName, lastSyncKeysRef.current[storeName], async (newItem, newKey) => {
                    if (newItem._deleted) {
                        await cache.removeCachedItem(storeName, newItem[keyField]);
                    } else {
                        await cache.addOrUpdateCachedItem(storeName, newItem);
                    }
                    const updatedData = await cache.getCachedData(storeName);
                     if (storeName === 'customers') setCustomers(updatedData as Customer[]);
                     else setProducts(updatedData as Product[]);

                    setLastSyncKeys(prev => ({...prev, [storeName]: newKey}));
                });
                listeners.push(listener);
            }
        };

        performInitialLoad();

        return () => {
            isCancelled = true;
            listeners.forEach(unsubscribe => unsubscribe());
        };
    }, [user, forceFullSync, setLastSyncKeys, showAlert]);


     // --- PWA Install Prompt ---
    useEffect(() => {
        const handler = (e: Event) => {
            e.preventDefault();
            deferredInstallPrompt.current = e;
            setInstallPromptAvailable(true);
        };
        window.addEventListener('beforeinstallprompt', handler);
        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    const triggerInstallPrompt = useCallback(() => {
        if (deferredInstallPrompt.current) {
            deferredInstallPrompt.current.prompt();
            deferredInstallPrompt.current.userChoice.then((choiceResult: { outcome: string }) => {
                if (choiceResult.outcome === 'accepted') {
                    console.log('User accepted the A2HS prompt');
                } else {
                    console.log('User dismissed the A2HS prompt');
                }
                setInstallPromptAvailable(false);
                deferredInstallPrompt.current = null;
            });
        }
    }, []);

    // --- Device Settings Actions ---
    const deviceId = useMemo(() => getDeviceId(), []);
    
    const createSettingSetter = <K extends keyof DeviceSettings>(key: K) => {
        return useCallback(async (value: DeviceSettings[K] | Partial<DeviceSettings[K]>) => {
            try {
                // For nested objects like scanSettings, merge the new partial values.
                if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
                    setDeviceSettings(prev => {
                        const newSettings = {
                            ...prev,
                            [key]: { ...prev[key], ...value }
                        };
                        setDeviceSetting(deviceId, key, newSettings[key]);
                        return newSettings;
                    });
                } else {
                    // For simple values, just set them.
                    setDeviceSettings(prev => {
                        const newSettings = { ...prev, [key]: value };
                        setDeviceSetting(deviceId, key, value);
                        return newSettings;
                    });
                }
            } catch (e) {
                console.error(`Failed to save device setting ${key}:`, e);
                showToast(`설정 저장에 실패했습니다.`, 'error');
            }
        }, [deviceId, key, showToast]);
    };

    const setSelectedCameraId = useCallback(async (id: string | null) => {
        try {
            await setDeviceSetting(deviceId, 'selectedCameraId', id);
            setDeviceSettings(prev => ({...prev, selectedCameraId: id}));
        } catch(e) { showToast('카메라 설정 저장 실패', 'error'); }
    }, [deviceId, showToast]);
    
    const setScanSettings = useCallback(async (settings: Partial<DeviceSettings['scanSettings']>) => {
        try {
            const newSettings = { ...deviceSettings.scanSettings, ...settings };
            await setDeviceSetting(deviceId, 'scanSettings', newSettings);
            setDeviceSettings(prev => ({ ...prev, scanSettings: newSettings }));
            showToast('스캔 설정이 저장되었습니다.', 'success');
        } catch(e) { showToast('스캔 설정 저장 실패', 'error'); }
    }, [deviceId, deviceSettings.scanSettings, showToast]);

    const setLogRetentionDays = useCallback(async (days: number) => {
        try {
            await setDeviceSetting(deviceId, 'logRetentionDays', days);
            setDeviceSettings(prev => ({ ...prev, logRetentionDays: days }));
        } catch(e) { showToast('로그 보관 기간 저장 실패', 'error'); }
    }, [deviceId, showToast]);
    
    const setGoogleDriveSyncSettings = useCallback(async (type: 'customers' | 'products', settings: SyncSettings | null) => {
        try {
            await setDeviceSetting(deviceId, `googleDriveSyncSettings/${type}`, settings);
            setDeviceSettings(prev => ({
                ...prev,
                googleDriveSyncSettings: {
                    ...prev.googleDriveSyncSettings,
                    [type]: settings,
                }
            }));
        } catch(e) { showToast('Google Drive 설정 저장 실패', 'error'); }
    }, [deviceId, showToast]);


    // --- Context Providers ---

    const dataStateValue = useMemo(() => ({ customers, products }), [customers, products]);
    const dataActionsValue = useMemo(() => ({ addOrder, updateOrder, deleteOrder, updateOrderStatus, clearOrders, clearOrdersBeforeDate, syncWithFile, forceFullSync, resetData }), [addOrder, updateOrder, deleteOrder, updateOrderStatus, clearOrders, clearOrdersBeforeDate, syncWithFile, forceFullSync, resetData]);
    const deviceSettingsValue = useMemo(() => ({ ...deviceSettings, setSelectedCameraId, setScanSettings, setLogRetentionDays, setGoogleDriveSyncSettings }), [deviceSettings, setSelectedCameraId, setScanSettings, setLogRetentionDays, setGoogleDriveSyncSettings]);
    const syncStateValue = useMemo(() => ({ isSyncing, syncProgress, syncStatusText, syncDataType, syncSource, initialSyncCompleted }), [isSyncing, syncProgress, syncStatusText, syncDataType, syncSource, initialSyncCompleted]);
    const pwaInstallValue = useMemo(() => ({ isInstallPromptAvailable, triggerInstallPrompt }), [isInstallPromptAvailable, triggerInstallPrompt]);

    const modalsActions = useMemo(() => ({
        openDetailModal: (order: Order) => setModalsState(s => ({...s, isDetailModalOpen: true, editingOrder: order})),
        closeDetailModal: () => setModalsState(s => ({...s, isDetailModalOpen: false, editingOrder: null})),
        openDeliveryModal: (order: Order) => setModalsState(s => ({...s, isDeliveryModalOpen: true, orderToExport: order})),
        closeDeliveryModal: () => setModalsState(s => ({...s, isDeliveryModalOpen: false, orderToExport: null})),
        openAddItemModal: (props: AddItemModalPayload) => setModalsState(s => ({...s, addItemModalProps: props})),
        closeAddItemModal: () => setModalsState(s => ({...s, addItemModalProps: null})),
        openEditItemModal: (props: EditItemModalPayload) => setModalsState(s => ({...s, editItemModalProps: props})),
        closeEditItemModal: () => setModalsState(s => ({...s, editItemModalProps: null})),
        openMemoModal: (props: MemoModalPayload) => setModalsState(s => ({...s, memoModalProps: props})),
        closeMemoModal: () => setModalsState(s => ({...s, memoModalProps: null})),
        openHistoryModal: () => setModalsState(s => ({...s, isHistoryModalOpen: true})),
        closeHistoryModal: () => setModalsState(s => ({...s, isHistoryModalOpen: false})),
        openClearHistoryModal: () => setModalsState(s => ({...s, isClearHistoryModalOpen: true})),
        closeClearHistoryModal: () => setModalsState(s => ({...s, isClearHistoryModalOpen: false})),
    }), []);

    const modalsValue = useMemo(() => ({...modalsState, ...modalsActions}), [modalsState, modalsActions]);

    const scannerActions = useMemo(() => ({
        openScanner: (context: ScannerContextType, onScan: (barcode: string) => void, continuous: boolean) => {
            setScannerState({ isScannerOpen: true, scannerContext: context, onScanSuccess: onScan, continuousScan: continuous });
        },
        closeScanner: () => {
            setScannerState(s => ({ ...s, isScannerOpen: false }));
        },
    }), []);
    
    const scannerValue = useMemo(() => ({...scannerState, ...scannerActions, ...deviceSettings}), [scannerState, scannerActions, deviceSettings]);

    return (
        <DataStateContext.Provider value={dataStateValue}>
            <DataActionsContext.Provider value={dataActionsValue}>
                <DeviceSettingsContext.Provider value={deviceSettingsValue}>
                    <SyncStateContext.Provider value={syncStateValue}>
                        <AlertContext.Provider value={showAlert}>
                            <ToastContext.Provider value={showToast}>
                                <ModalsContext.Provider value={modalsValue}>
                                     <MiscUIContext.Provider value={{ lastModifiedOrderId, setLastModifiedOrderId }}>
                                        <ScannerContext.Provider value={scannerValue}>
                                            <PWAInstallContext.Provider value={pwaInstallValue}>
                                                {children}
                                                <AlertModal {...alertState} onClose={() => setAlertState({ ...alertState, isOpen: false })} />
                                                <Toast {...toastState} onClose={() => setToastState({ ...toastState, isOpen: false })} />
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


// --- Custom Hooks for easy context access ---
// (ensuring they throw an error if used outside the provider)
function createCtxHook<T>(context: React.Context<T | undefined>, name: string) {
    return () => {
        const ctx = useContext(context);
        if (ctx === undefined) {
            throw new Error(`use${name} must be used within a AppProvider`);
        }
        return ctx;
    };
}

export const useDataState = createCtxHook(DataStateContext, 'DataState');
export const useDataActions = createCtxHook(DataActionsContext, 'DataActions');
export const useDeviceSettings = createCtxHook(DeviceSettingsContext, 'DeviceSettings');
export const useSyncState = createCtxHook(SyncStateContext, 'SyncState');
export const useAlert = () => {
    // FIX: Correctly implement useAlert to return functions from context, not hooks.
    const showAlert = useContext(AlertContext);
    if (!showAlert) {
        throw new Error('useAlert must be used within an AppProvider');
    }
    const showToast = useContext(ToastContext);
    if (!showToast) {
        throw new Error('useAlert must be used within an AppProvider');
    }
    return { showAlert, showToast };
};
export const useModals = createCtxHook(ModalsContext, 'Modals');
export const useMiscUI = createCtxHook(MiscUIContext, 'MiscUI');
export const useScanner = createCtxHook(ScannerContext, 'Scanner');
export const usePWAInstall = createCtxHook(PWAInstallContext, 'PWAInstall');