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
    setValue
} from '../services/dbService';
import * as cache from '../services/cacheDbService';
import AlertModal from '../components/AlertModal';
import { useAuth } from './AuthContext';
import * as googleDrive from '../services/googleDriveService';
import { getDeviceId } from '../services/deviceService';
import Toast, { ToastState } from '../components/Toast';
import { processExcelFileInWorker } from '../services/dataService';
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
        const newOrderId = await dbAddOrder(orderData, orderData.items);
        return newOrderId;
    }, []);

    const updateOrder = useCallback(async (order: Order) => {
        if (!order.items) throw new Error("Order items are missing for update.");
        await dbUpdateOrder(order, order.items);
    }, []);

    const deleteOrder = useCallback(async (orderId: number) => {
        await dbDeleteOrder(orderId);
    }, []);

    const updateOrderStatus = useCallback(async (orderId: number, completionDetails: Order['completionDetails']) => {
        await dbUpdateOrderStatus(orderId, completionDetails);
    }, []);

    const clearOrders = useCallback(async () => {
        await dbClearOrders();
    }, []);

    const clearOrdersBeforeDate = useCallback(async (date: Date) => {
        const isoString = date.toISOString();
        return await dbClearOrdersBeforeDate(isoString);
    }, []);

    const syncWithFile = useCallback(async (file: File | Blob, dataType: 'customers' | 'products', source: 'local' | 'drive') => {
        if (isSyncing) {
            showToast("이미 다른 동기화가 진행 중입니다.", 'error');
            throw new Error("Sync already in progress");
        }
    
        setIsSyncing(true);
        setSyncDataType(dataType);
        setSyncSource(source);
        setSyncProgress(0);
        setSyncStatusText("기존 데이터 로딩 중...");
    
        const existingData = dataType === 'customers' ? customers : products;
        const dataTypeKorean = dataType === 'customers' ? '거래처' : '상품';
        
        try {
            const onProgress = (message: string) => {
                setSyncStatusText(message);
            };
    
            const parsedResult = await processExcelFileInWorker(file, dataType.slice(0, -1) as 'customer' | 'product', onProgress);
            const newData = parsedResult.valid as (Customer[] | Product[]);
    
            const syncResult = await smartSyncData(dataType, newData, user?.email || 'unknown', onProgress, existingData);
    
            if (dataType === 'customers') {
                setCustomers(newData as Customer[]);
                await cache.setCachedData('customers', newData as Customer[]);
            } else {
                setProducts(newData as Product[]);
                await cache.setCachedData('products', newData as Product[]);
            }
            
            const { additions, updates, deletions } = syncResult;
            if (additions > 0 || updates > 0 || deletions > 0) {
                const message = `${dataTypeKorean} 동기화 완료:\n${additions}개 추가, ${updates}개 수정, ${deletions}개 삭제됨`;
                showToast(message, 'success');
            } else {
                showToast(`${dataTypeKorean} 동기화 완료: 변경된 내용이 없습니다.`, 'success');
            }
            
        } catch (error: any) {
            console.error(`Sync from ${source} failed:`, error);
             if (error.message === 'MASS_DELETION_DETECTED') {
                const proceed = async () => {
                    const parsedResult = error.details.parsedResult;
                    const newData = parsedResult.valid as (Customer[] | Product[]);
                    const syncResult = await smartSyncData(dataType, newData, user?.email || 'unknown', (msg) => setSyncStatusText(msg), existingData, { bypassMassDeleteCheck: true });
                    
                    if (dataType === 'customers') {
                        setCustomers(newData as Customer[]);
                        await cache.setCachedData('customers', newData as Customer[]);
                    } else {
                        setProducts(newData as Product[]);
                        await cache.setCachedData('products', newData as Product[]);
                    }
    
                    const { additions, updates, deletions } = syncResult;
                    const message = `${dataTypeKorean} 동기화 완료:\n${additions}개 추가, ${updates}개 수정, ${deletions}개 삭제됨`;
                    showToast(message, 'success');
                };
                error.details.proceed = proceed;
            } else {
                showToast(`${dataTypeKorean} 동기화 실패.`, 'error');
            }
            throw error;
        } finally {
            setIsSyncing(false);
            setSyncDataType(null);
            setSyncSource(null);
            setSyncStatusText("");
        }
    }, [isSyncing, customers, products, user, showToast]);

    const forceFullSync = useCallback(async () => {
        if (!isInitialized()) {
            showAlert("데이터베이스에 연결되지 않아 동기화할 수 없습니다.");
            return;
        }
        setIsSyncing(true);
        setSyncDataType('full');
        try {
            setSyncStatusText("거래처 데이터 동기화 중...");
            const remoteCustomers = await getStore<Customer>('customers');
            await cache.setCachedData('customers', remoteCustomers);
            setCustomers(remoteCustomers);

            setSyncStatusText("상품 데이터 동기화 중...");
            const remoteProducts = await getStore<Product>('products');
            await cache.setCachedData('products', remoteProducts);
            setProducts(remoteProducts);
            
            showToast("전체 데이터 동기화가 완료되었습니다.", 'success');
        } catch (err) {
            showAlert("전체 데이터 동기화에 실패했습니다.");
        } finally {
            setIsSyncing(false);
            setSyncDataType(null);
            setSyncSource(null);
            setSyncStatusText("");
        }
    }, [showAlert, showToast]);

    const resetData = useCallback(async (dataType: 'customers' | 'products') => {
        const typeKorean = dataType === 'customers' ? '거래처' : '상품';
        try {
            await dbResetData(dataType);
            await cache.setCachedData(dataType, []);
            if (dataType === 'customers') setCustomers([]);
            else setProducts([]);
            showToast(`${typeKorean} 데이터가 성공적으로 초기화되었습니다.`, 'success');
        } catch (err) {
            console.error(`Failed to reset ${dataType} data:`, err);
            showToast(`${typeKorean} 데이터 초기화에 실패했습니다.`, 'error');
            throw err;
        }
    }, [showToast]);

    // --- Device Settings Actions ---
    const deviceSettingsActions = useMemo<DeviceSettingsActions>(() => ({
        setSelectedCameraId: async (id: string | null) => {
            setDeviceSettings(prev => ({ ...prev, selectedCameraId: id }));
            try {
                await setDeviceSetting(getDeviceId(), 'selectedCameraId', id);
            } catch (e) {
                console.error("Failed to save selected camera ID", e);
                showToast("카메라 설정 저장에 실패했습니다.", 'error');
            }
        },
        setScanSettings: async (settings: Partial<DeviceSettings['scanSettings']>) => {
            const newSettings = { ...deviceSettings.scanSettings, ...settings };
            setDeviceSettings(prev => ({ ...prev, scanSettings: newSettings }));
            try {
                await setDeviceSetting(getDeviceId(), 'scanSettings', newSettings);
            } catch (e) {
                console.error("Failed to save scan settings", e);
                showToast("스캔 설정 저장에 실패했습니다.", 'error');
            }
        },
        setLogRetentionDays: async (days: number) => {
            setDeviceSettings(prev => ({ ...prev, logRetentionDays: days }));
            try {
                await setDeviceSetting(getDeviceId(), 'logRetentionDays', days);
            } catch (e) {
                console.error("Failed to save log retention", e);
                showToast("로그 보관 기간 저장에 실패했습니다.", 'error');
            }
        },
        setGoogleDriveSyncSettings: async (type: 'customers' | 'products', settings: SyncSettings | null) => {
            setDeviceSettings(prev => ({
                ...prev,
                googleDriveSyncSettings: {
                    ...prev.googleDriveSyncSettings,
                    [type]: settings,
                },
            }));
            try {
                await setValue(`settings/devices/${getDeviceId()}/googleDriveSyncSettings/${type}`, settings);
            } catch (e) {
                console.error(`Failed to save GDrive settings for ${type}`, e);
                showToast("Google Drive 설정 저장에 실패했습니다.", 'error');
            }
        }
    }), [deviceSettings, showToast]);


    // --- Initial Data Load and Sync Effect ---
    useEffect(() => {
        if (!user || !isInitialized()) {
            setInitialSyncCompleted(!user);
            return;
        }
    
        const unsubscribers: (() => void)[] = [];
        let syncTimeout: number;
    
        const applyChanges = async (dataType: 'customers' | 'products', changes: SyncLog[]) => {
            if (changes.length === 0) return;
    
            const keyField = dataType === 'customers' ? 'comcode' : 'barcode';
            const setData = dataType === 'customers' ? setCustomers : setProducts;
    
            for (const change of changes) {
                const key = (change as any)[keyField];
                if (change._deleted) {
                    await cache.removeCachedItem(dataType, key);
                } else {
                    const { _key, timestamp, user, ...itemData } = change;
                    await cache.addOrUpdateCachedItem(dataType, itemData as any);
                }
            }
    
            setData(prevData => {
                const dataMap = new Map(prevData.map(item => [(item as any)[keyField], item]));
                changes.forEach(change => {
                    const key = (change as any)[keyField];
                    if (change._deleted) {
                        dataMap.delete(key);
                    } else {
                        const { _key, timestamp, user, ...itemData } = change;
                        dataMap.set(key, itemData);
                    }
                });
                return Array.from(dataMap.values()) as any;
            });
        };
    
        const runInitialSync = async () => {
            const forceFullSyncFlag = localStorage.getItem('forceFullSyncOnNextLoad') === 'true';

            if (IS_DEVELOPER_MODE && !forceFullSyncFlag) {
                console.warn('%c[DEV MODE] Minimal data sync is active.', 'color: orange; font-weight: bold;');
                setIsSyncing(true);
                setSyncDataType('full');
                setSyncProgress(0);
        
                try {
                    setSyncStatusText("DEV MODE: 기기 설정 로딩");
                    const deviceId = getDeviceId();
                    const remoteSettings = await getDeviceSettings(deviceId);
                    const loadedSettings = {
                        ...defaultDeviceSettings,
                        ...remoteSettings,
                        scanSettings: { ...defaultDeviceSettings.scanSettings, ...(remoteSettings.scanSettings || {}) },
                        googleDriveSyncSettings: { ...defaultDeviceSettings.googleDriveSyncSettings, ...(remoteSettings.googleDriveSyncSettings || {}) },
                    };
                    setDeviceSettings(loadedSettings);
                    setSyncProgress(25);
        
                    setSyncStatusText("DEV MODE: 거래처 샘플 로딩 (10개)");
                    const customerSnapshot = await firebaseDb.ref('customers').limitToFirst(10).get();
                    const customerData = customerSnapshot.val() || {};
                    const limitedCustomers = Object.values(customerData) as Customer[];
                    setCustomers(limitedCustomers);
                    await cache.setCachedData('customers', limitedCustomers);
                    setSyncProgress(50);
        
                    setSyncStatusText("DEV MODE: 상품 샘플 로딩 (50개)");
                    const productSnapshot = await firebaseDb.ref('products').limitToFirst(50).get();
                    const productData = productSnapshot.val() || {};
                    const limitedProducts = Object.values(productData) as Product[];
                    setProducts(limitedProducts);
                    await cache.setCachedData('products', limitedProducts);
                    setSyncProgress(75);
        
                    setSyncStatusText("앱 시작 준비 완료");
                    setSyncProgress(100);
                    setTimeout(() => {
                        setInitialSyncCompleted(true);
                        setIsSyncing(false);
                    }, 300);
        
                } catch (error) {
                    console.error("Dev mode sync failed:", error);
                    showAlert("개발자 모드 동기화에 실패했습니다. 캐시된 데이터로 시작합니다.");
                    // Still try to load from cache as a fallback
                    const cachedCustomers = await cache.getCachedData<Customer>('customers');
                    setCustomers(cachedCustomers);
                    const cachedProducts = await cache.getCachedData<Product>('products');
                    setProducts(cachedProducts);
                    setInitialSyncCompleted(true);
                    setIsSyncing(false);
                }
                return;
            }

            // This is now the full sync logic
            if (forceFullSyncFlag) {
                localStorage.removeItem('forceFullSyncOnNextLoad');
                showToast("강제 전체 동기화를 시작합니다.", 'success');
            }

            setIsSyncing(true);
            setSyncDataType('full');
            setSyncProgress(0);
            setSyncStatusText("앱 초기화 중");
            
            let loadedSettings = { ...defaultDeviceSettings };
            const deviceId = getDeviceId();
            try {
                setSyncProgress(5);
                setSyncStatusText("기기 설정 로딩");
                const remoteSettings = await getDeviceSettings(deviceId);
                loadedSettings = {
                    ...defaultDeviceSettings,
                    ...remoteSettings,
                    scanSettings: { ...defaultDeviceSettings.scanSettings, ...(remoteSettings.scanSettings || {}) },
                    googleDriveSyncSettings: { ...defaultDeviceSettings.googleDriveSyncSettings, ...(remoteSettings.googleDriveSyncSettings || {}) },
                };
                setDeviceSettings(loadedSettings);

            } catch (e) {
                console.warn("Could not load device settings from Firebase", e);
            }

            setSyncProgress(10);
            setSyncStatusText("로컬 캐시 읽기 (거래처)");
            const cachedCustomers = await cache.getCachedData<Customer>('customers');
            setCustomers(cachedCustomers);

            setSyncProgress(20);
            setSyncStatusText("로컬 캐시 읽기 (상품)");
            const cachedProducts = await cache.getCachedData<Product>('products');
            setProducts(cachedProducts);
    
            setSyncProgress(30);
    
            syncTimeout = window.setTimeout(() => {
                if (!initialSyncCompleted) {
                    console.warn("Sync timed out. Using cached data.");
                    showAlert("서버 동기화가 시간 초과되었습니다. 오프라인 데이터로 시작합니다.");
                    setInitialSyncCompleted(true);
                    setIsSyncing(false);
                }
            }, 20000);
    
            const syncDataTypeOp = async (dataType: 'customers' | 'products', lastKey: string | null | undefined, progressStart: number, progressEnd: number) => {
                const typeName = dataType === 'customers' ? '거래처' : '상품';
                const hasCache = dataType === 'customers' ? cachedCustomers.length > 0 : cachedProducts.length > 0;
                
                setSyncStatusText(`${typeName} 정보 동기화`);
                setSyncProgress(progressStart);

                if (!lastKey || !hasCache) { // Full Sync
                    setSyncStatusText(`${typeName} 전체 데이터 다운로드`);
                    const remoteData = await getStore<Customer | Product>(dataType);
                    
                    setSyncProgress(progressStart + (progressEnd - progressStart) * 0.7);
                    setSyncStatusText(`${typeName} 정보 적용`);
                    
                    if (dataType === 'customers') setCustomers(remoteData as Customer[]); else setProducts(remoteData as Product[]);
                    await cache.setCachedData(dataType, remoteData as any);
                    const newLastKey = await getLastSyncLogKey(dataType);
                    setLastSyncKeys(prev => ({ ...prev, [dataType]: newLastKey }));
                    
                    setSyncProgress(progressEnd);
                    return newLastKey;
                } else { // Incremental Sync
                    setSyncStatusText(`${typeName} 변경사항 확인`);
                    const { items: changes, newLastKey } = await getSyncLogChanges(dataType, lastKey);
                    
                    setSyncProgress(progressStart + (progressEnd - progressStart) * 0.7);

                    if (changes.length > 0) {
                        setSyncStatusText(`${typeName} ${changes.length}건 업데이트 적용`);
                        await applyChanges(dataType, changes);
                    }
                    if (newLastKey !== lastKey) {
                        setLastSyncKeys(prev => ({ ...prev, [dataType]: newLastKey }));
                    }
                    setSyncProgress(progressEnd);
                    return newLastKey;
                }
            };
    
            try {
                const finalCustomerKey = await syncDataTypeOp('customers', lastSyncKeysRef.current?.customers, 30, 60);
                
                setSyncStatusText("거래처 실시간 연결 설정");
                unsubscribers.push(
                    listenForNewLogs('customers', finalCustomerKey, async (newItem, newKey) => {
                        await applyChanges('customers', [newItem]);
                        setLastSyncKeys(prev => ({ ...prev, customers: newKey }));
                    })
                );
                setSyncProgress(65);

                const finalProductKey = await syncDataTypeOp('products', lastSyncKeysRef.current?.products, 65, 95);
                
                setSyncStatusText("상품 실시간 연결 설정");
                unsubscribers.push(
                    listenForNewLogs('products', finalProductKey, async (newItem, newKey) => {
                        await applyChanges('products', [newItem]);
                        setLastSyncKeys(prev => ({ ...prev, products: newKey }));
                    })
                );
                
                clearTimeout(syncTimeout);

                const retentionDays = loadedSettings.logRetentionDays;
                if (typeof retentionDays === 'number' && retentionDays > 0) {
                    Promise.all([
                        cleanupSyncLogs('customers', retentionDays),
                        cleanupSyncLogs('products', retentionDays)
                    ]).catch(err => console.warn("Background log cleanup failed on startup:", err));
                }

                setSyncProgress(100);
                setSyncStatusText("앱 시작 준비 완료");
                setTimeout(() => {
                    setInitialSyncCompleted(true);
                    setIsSyncing(false);
                }, 300);
    
            } catch (error) {
                console.error("Sync failed:", error);
                showAlert("데이터 동기화에 실패했습니다. 캐시된 데이터로 시작합니다.");
                clearTimeout(syncTimeout);
                setInitialSyncCompleted(true);
                setIsSyncing(false);
            }
        };
    
        runInitialSync();
    
        return () => {
            clearTimeout(syncTimeout);
            unsubscribers.forEach(unsub => unsub());
        };
    }, [user, showAlert, showToast]);


    // --- Modal Actions ---
    const modalsActions = useMemo<ModalsActions>(() => ({
        openDetailModal: (order) => setModalsState(s => ({ ...s, isDetailModalOpen: true, editingOrder: order })),
        closeDetailModal: () => setModalsState(s => ({ ...s, isDetailModalOpen: false, editingOrder: null })),
        openDeliveryModal: (order) => setModalsState(s => ({ ...s, isDeliveryModalOpen: true, orderToExport: order })),
        closeDeliveryModal: () => setModalsState(s => ({ ...s, isDeliveryModalOpen: false, orderToExport: null })),
        openAddItemModal: (props) => setModalsState(s => ({ ...s, addItemModalProps: props })),
        closeAddItemModal: () => setModalsState(s => ({ ...s, addItemModalProps: null })),
        openEditItemModal: (props) => setModalsState(s => ({ ...s, editItemModalProps: props })),
        closeEditItemModal: () => setModalsState(s => ({ ...s, editItemModalProps: null })),
        openMemoModal: (props) => setModalsState(s => ({ ...s, memoModalProps: props })),
        closeMemoModal: () => setModalsState(s => ({ ...s, memoModalProps: null })),
        openHistoryModal: () => setModalsState(s => ({ ...s, isHistoryModalOpen: true })),
        closeHistoryModal: () => setModalsState(s => ({ ...s, isHistoryModalOpen: false })),
        openClearHistoryModal: () => setModalsState(s => ({ ...s, isClearHistoryModalOpen: true })),
        closeClearHistoryModal: () => setModalsState(s => ({ ...s, isClearHistoryModalOpen: false })),
    }), []);
    
    // --- Scanner Actions ---
    const scannerActions = useMemo<ScannerActions>(() => ({
        openScanner: (context, onScan, continuous) => setScannerState({ isScannerOpen: true, scannerContext: context, onScanSuccess: onScan, continuousScan: continuous }),
        closeScanner: () => setScannerState({ isScannerOpen: false, scannerContext: null, onScanSuccess: () => {}, continuousScan: false }),
    }), []);
    
    // --- PWA Install Effect ---
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
            deferredInstallPrompt.current.userChoice.then((choiceResult: { outcome: 'accepted' | 'dismissed' }) => {
                if (choiceResult.outcome === 'accepted') {
                    showToast('앱이 설치되었습니다!', 'success');
                }
                setInstallPromptAvailable(false);
                deferredInstallPrompt.current = null;
            });
        }
    }, [showToast]);

    // --- Context Values ---
    const dataStateValue = useMemo(() => ({ customers, products }), [customers, products]);
    const dataActionsValue = useMemo(() => ({ addOrder, updateOrder, deleteOrder, updateOrderStatus, clearOrders, clearOrdersBeforeDate, syncWithFile, forceFullSync, resetData }), [addOrder, updateOrder, deleteOrder, updateOrderStatus, clearOrders, clearOrdersBeforeDate, syncWithFile, forceFullSync, resetData]);
    const syncStateValue = useMemo(() => ({ isSyncing, syncProgress, syncStatusText, syncDataType, syncSource, initialSyncCompleted }), [isSyncing, syncProgress, syncStatusText, syncDataType, syncSource, initialSyncCompleted]);
    const deviceSettingsValue = useMemo(() => ({ ...deviceSettings, ...deviceSettingsActions }), [deviceSettings, deviceSettingsActions]);
    const modalsValue = useMemo(() => ({ ...modalsState, ...modalsActions }), [modalsState, modalsActions]);
    const scannerValue = useMemo(() => ({ ...scannerState, ...scannerActions, scanSettings: deviceSettings.scanSettings, selectedCameraId: deviceSettings.selectedCameraId }), [scannerState, scannerActions, deviceSettings.scanSettings, deviceSettings.selectedCameraId]);
    const miscUIValue = useMemo(() => ({ lastModifiedOrderId, setLastModifiedOrderId }), [lastModifiedOrderId]);
    const pwaInstallValue = useMemo(() => ({ isInstallPromptAvailable, triggerInstallPrompt }), [isInstallPromptAvailable, triggerInstallPrompt]);

    return (
        <DataStateContext.Provider value={dataStateValue}>
            <DataActionsContext.Provider value={dataActionsValue}>
                <SyncStateContext.Provider value={syncStateValue}>
                    <DeviceSettingsContext.Provider value={deviceSettingsValue}>
                        <ModalsContext.Provider value={modalsValue}>
                            <ScannerContext.Provider value={scannerValue}>
                                <MiscUIContext.Provider value={miscUIValue}>
                                    <AlertContext.Provider value={showAlert}>
                                        <ToastContext.Provider value={showToast}>
                                            <PWAInstallContext.Provider value={pwaInstallValue}>
                                                {children}
                                                <AlertModal {...alertState} onClose={() => setAlertState(s => ({ ...s, isOpen: false }))} />
                                                <Toast {...toastState} onClose={() => setToastState(s => ({ ...s, isOpen: false }))} />
                                            </PWAInstallContext.Provider>
                                        </ToastContext.Provider>
                                    </AlertContext.Provider>
                                </MiscUIContext.Provider>
                            </ScannerContext.Provider>
                        </ModalsContext.Provider>
                    </DeviceSettingsContext.Provider>
                </SyncStateContext.Provider>
            </DataActionsContext.Provider>
        </DataStateContext.Provider>
    );
};

// --- Custom Hooks ---

export const useDataState = (): DataState => {
    const context = useContext(DataStateContext);
    if (context === undefined) throw new Error('useDataState must be used within an AppProvider');
    return context;
};

export const useDataActions = (): DataActions => {
    const context = useContext(DataActionsContext);
    if (context === undefined) throw new Error('useDataActions must be used within an AppProvider');
    return context;
};

export const useSyncState = (): SyncState => {
    const context = useContext(SyncStateContext);
    if (context === undefined) throw new Error('useSyncState must be used within an AppProvider');
    return context;
};

export const useDeviceSettings = (): DeviceSettings & DeviceSettingsActions => {
    const context = useContext(DeviceSettingsContext);
    if (context === undefined) throw new Error('useDeviceSettings must be used within an AppProvider');
    return context;
};


export const useModals = (): ModalsState & ModalsActions => {
    const context = useContext(ModalsContext);
    if (context === undefined) throw new Error('useModals must be used within an AppProvider');
    return context;
};

export const useAlert = () => {
    const showAlert = useContext(AlertContext);
    const showToast = useContext(ToastContext);
    if (showAlert === undefined || showToast === undefined) throw new Error('useAlert must be used within an AppProvider');
    return { showAlert, showToast };
};

export const useMiscUI = (): MiscUIState & MiscUIActions => {
    const context = useContext(MiscUIContext);
    if (context === undefined) throw new Error('useMiscUI must be used within an AppProvider');
    return context;
};

export const useScanner = (): ScannerState & ScannerActions & { scanSettings: DeviceSettings['scanSettings'], selectedCameraId: string | null } => {
    const context = useContext(ScannerContext);
    if (context === undefined) throw new Error('useScanner must be used within an AppProvider');
    return context as any;
};

export const usePWAInstall = (): PWAInstallState => {
    const context = useContext(PWAInstallContext);
    if (context === undefined) throw new Error('usePWAInstall must be used within an AppProvider');
    return context;
};
