import React, { createContext, useState, useCallback, useEffect, ReactNode, useContext, useMemo, useRef } from 'react';
import { Customer, Product, Order, OrderItem, ScannerContext as ScannerContextType, SyncLog, DeviceSettings, SyncSettings } from '../types';
import { 
    isDbReady, getDeviceSettings, getStore, 
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
import { syncCustomersAndProductsFromDb, syncCustomersFromDb, syncProductsIncrementally, checkSqlConnection } from '../services/sqlService';
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
    syncWithDb: () => Promise<void>;
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
    setDataSourceSettings: (settings: Partial<DeviceSettings['dataSourceSettings']>) => Promise<void>;
}

const DeviceSettingsContext = createContext<(DeviceSettings & DeviceSettingsActions) | undefined>(undefined);


// --- Sync Context ---
interface SyncState {
    isSyncing: boolean;
    syncProgress: number;
    syncStatusText: string;
    syncDataType: 'customers' | 'products' | 'full' | 'background' | null;
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
    cancelText?: string;
    onClose?: () => void;
}

interface ModalsState {
    isDetailModalOpen: boolean;
    editingOrder: Order | null;
    isDeliveryModalOpen: boolean;
    orderToExport: Order | null;
    addItemModalProps: AddItemModalPayload | null;
    editItemModalProps: EditItemModalPayload | null;
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
    openHistoryModal: () => void;
    closeHistoryModal: () => void;
    openClearHistoryModal: () => void;
    closeClearHistoryModal: () => void;
}

type SqlServerStatus = 'unknown' | 'connected' | 'error' | 'checking';

interface MiscUIState {
    lastModifiedOrderId: number | null;
    activeMenuOrderId: number | null;
    sqlQueryInput: string;
    sqlStatus: SqlServerStatus;
}

interface MiscUIActions {
    setLastModifiedOrderId: React.Dispatch<React.SetStateAction<number | null>>;
    setActiveMenuOrderId: React.Dispatch<React.SetStateAction<number | null>>;
    setSqlQueryInput: React.Dispatch<React.SetStateAction<string>>;
    checkSql: () => Promise<void>;
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

const AlertContext = createContext<((message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string, onCancel?: () => void, cancelText?: string, onClose?: () => void) => void) | undefined>(undefined);
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
    isHistoryModalOpen: false,
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
    dataSourceSettings: {
        newOrder: 'offline',
        productInquiry: 'online',
        autoSwitch: true,
    },
};

const formatDate = (date: any): string | undefined => {
    if (!date) return undefined;
    try {
        const d = new Date(date);
        if (isNaN(d.getTime())) return undefined;
        const year = d.getFullYear();
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const day = d.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch (e) {
        return undefined;
    }
};

const sanitizeFirebaseKey = (key: string): string => {
    if (typeof key !== 'string') return '';
    // Firebase keys can't contain ., #, $, /, [, or ]
    // We replace them with an underscore.
    return key.replace(/[.#$[\]/]/g, '_');
};


// --- AppProvider Component ---

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();

    // --- Data State ---
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [deviceSettings, setDeviceSettings] = useState<DeviceSettings>(defaultDeviceSettings);

    // --- Sync State ---
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncProgress, setSyncProgress] = useState(0);
    const [syncStatusText, setSyncStatusText] = useState('');
    const [syncDataType, setSyncDataType] = useState<'customers' | 'products' | 'full' | 'background' | null>(null);
    const [syncSource, setSyncSource] = useState<'local' | 'drive' | null>(null);
    const [initialSyncCompleted, setInitialSyncCompleted] = useState(false);

    // --- UI State ---
    const [alertState, setAlertState] = useState<AlertState>({ isOpen: false, message: '' });
    const [toastState, setToastState] = useState<ToastState>({ isOpen: false, message: '', type: 'success' });
    const [modalsState, setModalsState] = useState<ModalsState>(initialModalsState);
    const [lastModifiedOrderId, setLastModifiedOrderId] = useState<number | null>(null);
    const [activeMenuOrderId, setActiveMenuOrderId] = useState<number | null>(null);
    const [sqlQueryInput, setSqlQueryInput] = useState('');
    const [scannerState, setScannerState] = useState<ScannerState>({ isScannerOpen: false, scannerContext: null, onScanSuccess: () => {}, continuousScan: false });
    const [isInstallPromptAvailable, setInstallPromptAvailable] = useState(false);
    const deferredInstallPrompt = useRef<any>(null);
    const [sqlStatus, setSqlStatus] = useState<SqlServerStatus>('unknown');
    const isCheckingSql = useRef(false);

    const checkSql = useCallback(async () => {
        if (isCheckingSql.current) return;
        isCheckingSql.current = true;
        setSqlStatus('checking');
        try {
            await checkSqlConnection();
            setSqlStatus('connected');
        } catch (err) {
            console.error("SQL Connection Check Failed:", err);
            setSqlStatus('error');
        } finally {
            isCheckingSql.current = false;
        }
    }, []);

    useEffect(() => {
        checkSql(); // Initial check
        const sqlTimerId = setInterval(checkSql, 60000); // Check every 60 seconds
        return () => clearInterval(sqlTimerId);
    }, [checkSql]);


    // --- Alert & Toast Actions ---
    const showAlert = useCallback((message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string, onCancel?: () => void, cancelText?: string, onClose?: () => void) => {
        setAlertState({ isOpen: true, message, onConfirm, confirmText, confirmButtonClass, onCancel, cancelText, onClose });
    }, []);

    const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToastState({ isOpen: true, message, type });
    }, []);
    
    const closeAlert = useCallback(() => {
        if (alertState.onClose) {
            alertState.onClose();
        }
        setAlertState({ isOpen: false, message: '' });
    }, [alertState]);

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
    }, [isSyncing, user, customers, products, showToast]);

    const syncWithDb = useCallback(async () => {
        if (isSyncing) {
            showToast("이미 다른 동기화가 진행 중입니다.", 'error');
            return;
        }

        setIsSyncing(true);
        setSyncDataType('full');
        setSyncSource('drive'); // Representing DB as a remote source like drive
        setSyncProgress(0);
        setSyncStatusText("데이터베이스 연결 중...");

        try {
            const { customers: newCustomersRaw, products: newProductsRaw } = await syncCustomersAndProductsFromDb();
            setSyncStatusText("데이터 처리 중...");

            const newCustomers = newCustomersRaw.map(c => ({
                comcode: String(c.거래처코드),
                name: String(c.거래처명)
            }));
            
            const newProducts = newProductsRaw.map(p => ({
                barcode: String(p.바코드),
                name: String(p.상품명),
                costPrice: parseFloat(String(p.매입가 || 0)),
                sellingPrice: parseFloat(String(p.판매가 || 0)),
                eventCostPrice: p.행사매입가 ? parseFloat(String(p.행사매입가)) : undefined,
                salePrice: p.행사판매가 ? parseFloat(String(p.행사판매가)) : undefined,
                saleStartDate: p.행사시작일 || undefined,
                saleEndDate: p.행사종료일 || undefined,
                supplierName: p.거래처명 || undefined,
                lastModified: p.upday1 || undefined,
            }));

            setSyncProgress(25);
            setSyncStatusText("거래처 데이터 동기화...");
            const customerSyncResult = await smartSyncData('customers', newCustomers, user?.email || 'sql-sync', (msg) => setSyncStatusText(`거래처: ${msg}`), customers);
            setCustomers(newCustomers);
            await cache.setCachedData('customers', newCustomers);

            setSyncProgress(75);
            setSyncStatusText("상품 데이터 동기화...");
            const productSyncResult = await smartSyncData('products', newProducts, user?.email || 'sql-sync', (msg) => setSyncStatusText(`상품: ${msg}`), products);
            setProducts(newProducts);
            await cache.setCachedData('products', newProducts);
            
            showToast("데이터베이스 동기화가 완료되었습니다.", "success");
            
        } catch (error: any) {
            console.error("Sync from DB failed:", error);
            showAlert(`데이터베이스 동기화 실패: ${error.message}`);
        } finally {
            setIsSyncing(false);
            setSyncDataType(null);
            setSyncSource(null);
        }

    }, [isSyncing, user, customers, products, showToast, showAlert]);


    const forceFullSync = useCallback(async () => {
        if (isSyncing) {
            showToast("이미 동기화가 진행 중입니다.", "error");
            return;
        }
        setIsSyncing(true);
        setSyncStatusText("전체 데이터 강제 동기화...");
        setSyncProgress(0);

        try {
            const [serverCustomers, serverProducts] = await Promise.all([
                getStore<Customer>('customers'),
                getStore<Product>('products')
            ]);
            setSyncProgress(50);
            
            await cache.setCachedData('customers', serverCustomers);
            setCustomers(serverCustomers);

            await cache.setCachedData('products', serverProducts);
            setProducts(serverProducts);
            
            setSyncProgress(100);
            showToast("강제 동기화 완료. 모든 데이터가 최신 상태입니다.", "success");
        } catch(e: any) {
            showAlert(`강제 동기화 실패: ${e.message}`);
        } finally {
            setIsSyncing(false);
        }

    }, [isSyncing, showAlert, showToast]);

    const resetData = useCallback(async (dataType: 'customers' | 'products') => {
        const typeKorean = dataType === 'customers' ? '거래처' : '상품';
        try {
            await dbResetData(dataType);
            if (dataType === 'customers') {
                await cache.setCachedData('customers', []);
                setCustomers([]);
            } else {
                await cache.setCachedData('products', []);
                setProducts([]);
            }
            showToast(`${typeKorean} 데이터가 성공적으로 초기화되었습니다.`, 'success');
        } catch (err: any) {
            showAlert(`${typeKorean} 데이터 초기화에 실패했습니다: ${err.message}`);
        }
    }, [showAlert, showToast]);


    // --- Device Settings Actions ---
    const setDeviceSettingAndState = useCallback(async <K extends keyof DeviceSettings>(key: K, value: DeviceSettings[K]) => {
        await setDeviceSetting(getDeviceId(), key, value);
        setDeviceSettings(prev => ({ ...prev, [key]: value }));
    }, []);

    const setSelectedCameraId = useCallback((id: string | null) => setDeviceSettingAndState('selectedCameraId', id), [setDeviceSettingAndState]);
    const setScanSettings = useCallback((settings: Partial<DeviceSettings['scanSettings']>) => {
        const newSettings = { ...deviceSettings.scanSettings, ...settings };
        return setDeviceSettingAndState('scanSettings', newSettings);
    }, [deviceSettings.scanSettings, setDeviceSettingAndState]);
    const setLogRetentionDays = useCallback((days: number) => setDeviceSettingAndState('logRetentionDays', days), [setDeviceSettingAndState]);
    const setGoogleDriveSyncSettings = useCallback((type: 'customers' | 'products', settings: SyncSettings | null) => {
        const newSettings = { ...deviceSettings.googleDriveSyncSettings, [type]: settings };
        return setDeviceSettingAndState('googleDriveSyncSettings', newSettings);
    }, [deviceSettings.googleDriveSyncSettings, setDeviceSettingAndState]);
    const setDataSourceSettings = useCallback(async (settings: Partial<DeviceSettings['dataSourceSettings']>) => {
        const newSettings = { ...deviceSettings.dataSourceSettings, ...settings };
        await setDeviceSettingAndState('dataSourceSettings', newSettings);
    }, [deviceSettings.dataSourceSettings, setDeviceSettingAndState]);


    // --- Modals Actions ---
    const openDetailModal = useCallback((order: Order) => setModalsState(s => ({ ...s, isDetailModalOpen: true, editingOrder: order })), []);
    const closeDetailModal = useCallback(() => setModalsState(s => ({ ...s, isDetailModalOpen: false, editingOrder: null })), []);
    const openDeliveryModal = useCallback((order: Order) => setModalsState(s => ({ ...s, isDeliveryModalOpen: true, orderToExport: order })), []);
    const closeDeliveryModal = useCallback(() => setModalsState(s => ({ ...s, isDeliveryModalOpen: false, orderToExport: null })), []);
    const openAddItemModal = useCallback((props: AddItemModalPayload) => setModalsState(s => ({ ...s, addItemModalProps: props })), []);
    const closeAddItemModal = useCallback(() => setModalsState(s => ({ ...s, addItemModalProps: null })), []);
    const openEditItemModal = useCallback((props: EditItemModalPayload) => setModalsState(s => ({ ...s, editItemModalProps: props })), []);
    const closeEditItemModal = useCallback(() => setModalsState(s => ({ ...s, editItemModalProps: null })), []);
    const openHistoryModal = useCallback(() => setModalsState(s => ({ ...s, isHistoryModalOpen: true })), []);
    const closeHistoryModal = useCallback(() => setModalsState(s => ({ ...s, isHistoryModalOpen: false })), []);
    const openClearHistoryModal = useCallback(() => setModalsState(s => ({ ...s, isClearHistoryModalOpen: true })), []);
    const closeClearHistoryModal = useCallback(() => setModalsState(s => ({ ...s, isClearHistoryModalOpen: false })), []);
    
    // --- Scanner Actions ---
    const openScanner = useCallback((context: ScannerContextType, onScan: (barcode: string) => void, continuous: boolean) => {
        setScannerState({ isScannerOpen: true, scannerContext: context, onScanSuccess: onScan, continuousScan: continuous });
    }, []);
    const closeScanner = useCallback(() => {
        setScannerState(prev => ({ ...prev, isScannerOpen: false }));
    }, []);

    // --- PWA Install ---
    useEffect(() => {
        const beforeInstallPromptHandler = (e: Event) => {
            e.preventDefault();
            deferredInstallPrompt.current = e;
            setInstallPromptAvailable(true);
        };
        window.addEventListener('beforeinstallprompt', beforeInstallPromptHandler);
        return () => window.removeEventListener('beforeinstallprompt', beforeInstallPromptHandler);
    }, []);

    const triggerInstallPrompt = useCallback(() => {
        if (deferredInstallPrompt.current) {
            deferredInstallPrompt.current.prompt();
            deferredInstallPrompt.current.userChoice.then((choiceResult: any) => {
                if (choiceResult.outcome === 'accepted') {
                    showToast('앱이 설치되었습니다!', 'success');
                }
                deferredInstallPrompt.current = null;
                setInstallPromptAvailable(false);
            });
        }
    }, [showToast]);

    // --- Initial Data Load ---
    useEffect(() => {
        if (!user) return;
        // FIX: Replaced NodeJS.Timeout with ReturnType<typeof setTimeout> for browser compatibility.
        // The previous type was causing a TypeScript error because Node.js types are not available in a browser environment.
        let backgroundSyncTimer: ReturnType<typeof setTimeout> | null = null;
        
        const loadInitialData = async () => {
            setSyncStatusText("로컬 캐시 로딩 중");
            setSyncProgress(10);
            
            const [cachedCustomers, cachedProducts, settings] = await Promise.all([
                cache.getCachedData<Customer>('customers'),
                cache.getCachedData<Product>('products'),
                getDeviceSettings(getDeviceId())
            ]);
            
            setDeviceSettings(prev => ({...prev, ...defaultDeviceSettings, ...settings}));
            
            if (cachedCustomers.length > 0 || cachedProducts.length > 0) {
                setCustomers(cachedCustomers);
                setProducts(cachedProducts);
                setInitialSyncCompleted(true);
            }

            if (!IS_DEVELOPER_MODE) {
                setSyncStatusText("백그라운드 동기화 시작");
                setSyncDataType('background');
                setSyncProgress(20);
                setIsSyncing(true);

                try {
                    const lastCustomerSync = await cache.getSetting<string>('lastCustomerSyncTime');
                    const lastProductSync = await cache.getSetting<string>('lastProductSyncTime');
                    
                    const [serverCustomers, serverProducts] = await Promise.all([
                        syncCustomersFromDb(),
                        syncProductsIncrementally(lastProductSync || null)
                    ]);
                    
                    const newCustomers = serverCustomers.map((c: any) => ({ comcode: c.거래처코드, name: c.거래처명, lastModified: new Date().toISOString() }));
                    await cache.setCachedData('customers', newCustomers);
                    setCustomers(newCustomers);
                    await cache.setSetting('lastCustomerSyncTime', new Date().toISOString());

                    const currentProducts = cachedProducts.length > 0 ? cachedProducts : [];
                    const productMap = new Map(currentProducts.map(p => [p.barcode, p]));
                    
                    serverProducts.forEach((p: any) => {
                        const product = {
                            barcode: String(p.바코드), name: String(p.상품명), costPrice: parseFloat(String(p.매입가 || 0)), sellingPrice: parseFloat(String(p.판매가 || 0)),
                            eventCostPrice: p.행사매입가 ? parseFloat(String(p.행사매입가)) : undefined,
                            salePrice: p.행사판매가 ? parseFloat(String(p.행사판매가)) : undefined,
                            saleStartDate: p.행사시작일 || undefined,
                            saleEndDate: p.행사종료일 || undefined,
                            supplierName: p.거래처명 || undefined,
                            lastModified: p.upday1 || undefined,
                        };
                        productMap.set(product.barcode, product);
                    });

                    const updatedProducts = Array.from(productMap.values());
                    await cache.setCachedData('products', updatedProducts);
                    setProducts(updatedProducts);
                    await cache.setSetting('lastProductSyncTime', new Date().toISOString());
                    
                    setSyncStatusText("백그라운드 동기화 완료");
                } catch (err) {
                    console.error("Background sync failed:", err);
                    setSyncStatusText("백그라운드 동기화 실패");
                } finally {
                    setIsSyncing(false);
                    setSyncDataType(null);
                }

            } else {
                if (!initialSyncCompleted) { // Only run this in dev mode if cache was empty
                    setInitialSyncCompleted(true);
                }
            }
        };

        if (isDbReady()) {
            loadInitialData();
        }

        return () => {
            if (backgroundSyncTimer) clearTimeout(backgroundSyncTimer);
        };
    }, [user]);

    // --- Context Provider Values ---
    const dataStateValue = useMemo(() => ({ customers, products }), [customers, products]);
    const dataActionsValue = useMemo(() => ({
        addOrder, updateOrder, deleteOrder, updateOrderStatus, clearOrders, clearOrdersBeforeDate, syncWithFile, syncWithDb, forceFullSync, resetData,
    }), [addOrder, updateOrder, deleteOrder, updateOrderStatus, clearOrders, clearOrdersBeforeDate, syncWithFile, syncWithDb, forceFullSync, resetData]);
    
    const deviceSettingsValue = useMemo(() => ({
        ...deviceSettings, setSelectedCameraId, setScanSettings, setLogRetentionDays, setGoogleDriveSyncSettings, setDataSourceSettings,
    }), [deviceSettings, setSelectedCameraId, setScanSettings, setLogRetentionDays, setGoogleDriveSyncSettings, setDataSourceSettings]);

    const syncStateValue = useMemo(() => ({
        isSyncing, syncProgress, syncStatusText, syncDataType, syncSource, initialSyncCompleted,
    }), [isSyncing, syncProgress, syncStatusText, syncDataType, syncSource, initialSyncCompleted]);
    
    const modalsValue = useMemo(() => ({
        ...modalsState, openDetailModal, closeDetailModal, openDeliveryModal, closeDeliveryModal,
        openAddItemModal, closeAddItemModal, openEditItemModal, closeEditItemModal,
        openHistoryModal, closeHistoryModal, openClearHistoryModal, closeClearHistoryModal,
    }), [modalsState, openDetailModal, closeDetailModal, openDeliveryModal, closeDeliveryModal, openAddItemModal, closeAddItemModal, openEditItemModal, closeEditItemModal, openHistoryModal, closeHistoryModal, openClearHistoryModal, closeClearHistoryModal]);
    
    const miscUIValue = useMemo(() => ({
        lastModifiedOrderId, setLastModifiedOrderId, activeMenuOrderId, setActiveMenuOrderId,
        sqlQueryInput, setSqlQueryInput, sqlStatus, checkSql
    }), [lastModifiedOrderId, activeMenuOrderId, sqlQueryInput, sqlStatus, checkSql]);

    const scannerValue = useMemo(() => ({
        ...scannerState, selectedCameraId: deviceSettings.selectedCameraId, scanSettings: deviceSettings.scanSettings, openScanner, closeScanner
    }), [scannerState, deviceSettings.selectedCameraId, deviceSettings.scanSettings, openScanner, closeScanner]);

    const pwaInstallValue = useMemo(() => ({
        isInstallPromptAvailable, triggerInstallPrompt
    }), [isInstallPromptAvailable, triggerInstallPrompt]);

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
                                                <AlertModal
                                                    isOpen={alertState.isOpen}
                                                    message={alertState.message}
                                                    closeHandler={closeAlert}
                                                    onConfirm={alertState.onConfirm}
                                                    onCancel={alertState.onCancel}
                                                    confirmText={alertState.confirmText}
                                                    confirmButtonClass={alertState.confirmButtonClass}
                                                    cancelText={alertState.cancelText}
                                                />
                                                <Toast 
                                                    isOpen={toastState.isOpen}
                                                    message={toastState.message}
                                                    type={toastState.type}
                                                    onClose={() => setToastState(s => ({ ...s, isOpen: false }))}
                                                />
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

// --- Custom Hooks for easy context consumption ---
export const useDataState = () => {
    const context = useContext(DataStateContext);
    if (!context) throw new Error('useDataState must be used within an AppProvider');
    return context;
};
export const useDataActions = () => {
    const context = useContext(DataActionsContext);
    if (!context) throw new Error('useDataActions must be used within an AppProvider');
    return context;
};
export const useDeviceSettings = () => {
    const context = useContext(DeviceSettingsContext);
    if (!context) throw new Error('useDeviceSettings must be used within an AppProvider');
    return context;
};
export const useSyncState = () => {
    const context = useContext(SyncStateContext);
    if (!context) throw new Error('useSyncState must be used within an AppProvider');
    return context;
};
export const useAlert = () => {
    const showAlert = useContext(AlertContext);
    const showToast = useContext(ToastContext);
    if (!showAlert || !showToast) throw new Error('useAlert must be used within an AppProvider');
    return { showAlert, showToast };
};
export const useModals = () => {
    const context = useContext(ModalsContext);
    if (!context) throw new Error('useModals must be used within an AppProvider');
    return context;
};
export const useMiscUI = () => {
    const context = useContext(MiscUIContext);
    if (!context) throw new Error('useMiscUI must be used within an AppProvider');
    return context;
};
export const useScanner = () => {
    const context = useContext(ScannerContext);
    if (!context) throw new Error('useScanner must be used within an AppProvider');
    return context;
};
export const usePWAInstall = () => {
    const context = useContext(PWAInstallContext);
    if (!context) throw new Error('usePWAInstall must be used within an AppProvider');
    return context;
};