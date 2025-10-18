import React, { createContext, useState, useCallback, useEffect, ReactNode, useContext, useMemo, useRef } from 'react';
import { Customer, Product, Order, OrderItem, ScannerContext } from '../types';
import * as db from '../services/dbService';
import * as cache from '../services/cacheDbService';
import AlertModal from '../components/AlertModal';
import { useAuth } from './AuthContext';
import * as googleDrive from '../services/googleDriveService';
import { parseExcelFile, processCustomerData, processProductData } from '../services/dataService';
import { getDeviceId } from '../services/deviceService';
import Toast from '../components/Toast';

// --- TYPE DEFINITIONS ---

interface SyncSettings {
    fileId: string;
    fileName: string;
    lastSyncTime: string | null;
    autoSync: boolean;
}

// Data Context
interface DataState {
    customers: Customer[];
    products: Product[];
    selectedCameraId: string | null;
}
interface DataActions {
    setCustomers: (customers: Customer[]) => Promise<void>;
    setProducts: (products: Product[]) => Promise<void>;
    addOrder: (orderData: { customer: Customer; items: OrderItem[]; total: number; memo?: string; }) => Promise<number>;
    updateOrder: (updatedOrder: Order) => Promise<void>;
    updateOrderStatus: (orderId: number, completionDetails: Order['completionDetails']) => Promise<void>;
    deleteOrder: (orderId: number) => Promise<void>;
    setSelectedCameraId: (id: string | null) => Promise<void>;
    clearOrders: () => Promise<void>;
}

// Alert Context
interface AlertState { isOpen: boolean; message: string; onConfirm?: () => void; onCancel?: () => void; confirmText?: string; confirmButtonClass?: string; }
interface ToastState { isOpen: boolean; message: string; type: 'success' | 'error'; }
interface AlertContextValue {
    alert: AlertState;
    toast: ToastState;
    showAlert: (message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string, onCancel?: () => void) => void;
    hideAlert: () => void;
    showToast: (message: string, type: 'success' | 'error') => void;
    hideToast: () => void;
}

// Modal Context
interface ModalContextValue {
    isDetailModalOpen: boolean;
    editingOrder: Order | null;
    openDetailModal: (order: Order) => void;
    closeDetailModal: () => void;
    isDeliveryModalOpen: boolean;
    orderToExport: Order | null;
    openDeliveryModal: (order: Order) => void;
    closeDeliveryModal: () => void;
}

// Scanner Context
interface ScannerContextValue {
    isScannerOpen: boolean;
    scannerContext: ScannerContext;
    isContinuousScan: boolean;
    onScanSuccess: (barcode: string) => void;
    openScanner: (context: ScannerContext, onScan: (barcode: string) => void, continuous?: boolean) => void;
    closeScanner: () => void;
}

// Sync Context
interface SyncContextValue { isSyncing: boolean; }

// PWA Install Context
interface PWAInstallContextValue {
    isInstallPromptAvailable: boolean;
    triggerInstallPrompt: () => void;
}

// Misc UI Context
interface MiscUIContextValue {
    lastModifiedOrderId: number | null;
    setLastModifiedOrderId: (id: number | null) => void;
}

// --- CONTEXT CREATION ---
const DataStateContext = createContext<DataState>({} as DataState);
const DataActionsContext = createContext<DataActions>({} as DataActions);
const AlertContext = createContext<AlertContextValue>({} as AlertContextValue);
const ModalContext = createContext<ModalContextValue>({} as ModalContextValue);
const ScannerContext = createContext<ScannerContextValue>({} as ScannerContextValue);
const SyncContext = createContext<SyncContextValue>({} as SyncContextValue);
const PWAInstallContext = createContext<PWAInstallContextValue>({} as PWAInstallContextValue);
const MiscUIContext = createContext<MiscUIContextValue>({} as MiscUIContextValue);


// --- HOOKS for easier context consumption ---
export const useDataState = () => useContext(DataStateContext);
export const useDataActions = () => useContext(DataActionsContext);
export const useAlert = () => useContext(AlertContext);
export const useModals = () => useContext(ModalContext);
export const useScanner = () => useContext(ScannerContext);
export const useSyncState = () => useContext(SyncContext);
export const usePWAInstall = () => useContext(PWAInstallContext);
export const useMiscUI = () => useContext(MiscUIContext);


// --- MAIN PROVIDER ---
export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();

    // States
    const [alert, setAlert] = useState<AlertState>({ isOpen: false, message: '' });
    const [toast, setToast] = useState<ToastState>({ isOpen: false, message: '', type: 'success' });
    const [isSyncing, setIsSyncing] = useState(false);
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [editingOrder, setEditingOrder] = useState<Order | null>(null);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [scannerContext, setScannerContext] = useState<ScannerContext>(null);
    const [isContinuousScan, setIsContinuousScan] = useState(false);
    const onScanCallbackRef = useRef<(barcode: string) => void>(() => {});
    const [installPromptEvent, setInstallPromptEvent] = useState<Event | null>(null);
    const [lastModifiedOrderId, setLastModifiedOrderId] = useState<number | null>(null);
    const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);
    const [orderToExport, setOrderToExport] = useState<Order | null>(null);

    // Alert Actions
    const showAlert = useCallback((message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string, onCancel?: () => void) => {
        setAlert({ isOpen: true, message, onConfirm, confirmText, confirmButtonClass, onCancel });
    }, []);
    const hideAlert = useCallback(() => setAlert(prev => ({ ...prev, isOpen: false })), []);
    const showToast = useCallback((message: string, type: 'success' | 'error') => setToast({ isOpen: true, message, type }), []);
    const hideToast = useCallback(() => setToast(prev => ({...prev, isOpen: false})), []);

    // PWA Install Event Listener
    useEffect(() => {
        const handleBeforeInstallPrompt = (e: Event) => { e.preventDefault(); setInstallPromptEvent(e); };
        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    }, []);

    const onScanSuccess = useCallback((barcode: string) => {
        onScanCallbackRef.current?.(barcode);
    }, []);
    
    // --- Context Value Objects ---
    const alertContextValue = useMemo(() => ({ alert, toast, showAlert, hideAlert, showToast, hideToast }), [alert, toast, showAlert, hideAlert, showToast, hideToast]);
    
    const modalContextValue = useMemo(() => ({
        isDetailModalOpen, editingOrder,
        openDetailModal: (order: Order) => { setEditingOrder(order); setIsDetailModalOpen(true); },
        closeDetailModal: () => { setIsDetailModalOpen(false); setEditingOrder(null); },
        isDeliveryModalOpen, orderToExport,
        openDeliveryModal: (order: Order) => { setOrderToExport(order); setIsDeliveryModalOpen(true); },
        closeDeliveryModal: () => { setIsDeliveryModalOpen(false); setOrderToExport(null); },
    }), [isDetailModalOpen, editingOrder, isDeliveryModalOpen, orderToExport]);
    
    const scannerContextValue = useMemo(() => ({
        isScannerOpen, scannerContext, isContinuousScan, onScanSuccess,
        openScanner: (context, onScan, continuous = false) => {
            setScannerContext(context);
            onScanCallbackRef.current = onScan;
            setIsContinuousScan(continuous);
            setIsScannerOpen(true);
        },
        closeScanner: () => { setIsScannerOpen(false); setIsContinuousScan(false); setScannerContext(null); },
    }), [isScannerOpen, scannerContext, isContinuousScan, onScanSuccess]);
    
    const syncContextValue = useMemo(() => ({ isSyncing }), [isSyncing]);
    
    const pwaInstallContextValue = useMemo(() => ({
        isInstallPromptAvailable: !!installPromptEvent,
        triggerInstallPrompt: () => {
            if (!installPromptEvent) {
                showAlert('앱을 설치할 수 없습니다. 브라우저가 이 기능을 지원하는지 확인해주세요.');
                return;
            }
            (installPromptEvent as any).prompt();
            setInstallPromptEvent(null);
        },
    }), [installPromptEvent, showAlert]);

    const miscUIContextValue = useMemo(() => ({ lastModifiedOrderId, setLastModifiedOrderId }), [lastModifiedOrderId]);
    
    // --- DATA STATE & ACTIONS ---
    const [dataState, setDataState] = useState<DataState>({ customers: [], products: [], selectedCameraId: null });

    const dataActions: DataActions = useMemo(() => ({
        setCustomers: async (customers) => { await cache.setCachedData('customers', customers).catch(e => console.error("Failed to cache new customers", e)); return db.replaceAll('customers', customers); },
        setProducts: async (products) => { await cache.setCachedData('products', products).catch(e => console.error("Failed to cache new products", e)); return db.replaceAll('products', products); },
        addOrder: (orderData) => { const { items, ...orderShellData } = orderData; return db.addOrderWithItems(orderShellData, items); },
        updateOrder: (updatedOrder) => { const { items, ...orderShell } = updatedOrder; return db.updateOrderAndItems(orderShell, items || []); },
        updateOrderStatus: (orderId, completionDetails) => db.updateOrderStatus(orderId, completionDetails),
        deleteOrder: (orderId) => db.deleteOrderAndItems(orderId),
        setSelectedCameraId: (id) => { const deviceId = getDeviceId(); const cameraSettingPath = `settings/cameraSettingsByDevice/${deviceId}`; return db.setValue(cameraSettingPath, id); },
        clearOrders: () => db.clearOrders(),
    }), []);

    // Auto-sync logic
    const runAutoSyncOnStartup = useCallback(async () => {
        const deviceId = getDeviceId();
        const syncConfigs = [ { type: 'customer', key: `google-drive-sync-settings-customer` }, { type: 'product', key: `google-drive-sync-settings-product` } ];
        const isAutoSyncEnabled = syncConfigs.some(config => {
            const deviceSpecificKey = `${deviceId}:${config.key}`;
            const settingsJSON = localStorage.getItem(deviceSpecificKey);
            if (!settingsJSON) return false;
            try { const settings: SyncSettings = JSON.parse(settingsJSON); return settings.autoSync && !!settings.fileId; } catch { return false; }
        });
        if (!isAutoSyncEnabled) { console.log("[AutoSync] No auto-sync configurations found. Skipping."); return; }
        try { await googleDrive.initGoogleApi(); } catch (apiInitError) { console.warn("[AutoSync] Could not initialize Google API.", apiInitError); return; }
        for (const config of syncConfigs) {
            const deviceSpecificKey = `${deviceId}:${config.key}`;
            const settingsJSON = localStorage.getItem(deviceSpecificKey);
            if (!settingsJSON) continue;
            const settings: SyncSettings = JSON.parse(settingsJSON);
            if (!settings.autoSync || !settings.fileId) continue;
            try {
                console.log(`[AutoSync] Checking for ${config.type} updates...`);
                const metadata = await googleDrive.getFileMetadata(settings.fileId);
                const isModified = !settings.lastSyncTime || new Date(metadata.modifiedTime) > new Date(settings.lastSyncTime);
                if (isModified) {
                    console.log(`[AutoSync] New version of ${config.type} file found. Syncing...`);
                    const fileBlob = await googleDrive.getFileContent(settings.fileId, metadata.mimeType);
                    const rows = await parseExcelFile(fileBlob);
                    if (config.type === 'customer') { const { valid } = processCustomerData(rows); if (valid.length > 0) await dataActions.setCustomers(valid); }
                    else { const { valid } = processProductData(rows); if (valid.length > 0) await dataActions.setProducts(valid); }
                    settings.lastSyncTime = metadata.modifiedTime;
                    localStorage.setItem(deviceSpecificKey, JSON.stringify(settings));
                    console.log(`[AutoSync] ${config.type} synced successfully.`);
                } else { console.log(`[AutoSync] ${config.type} data is up to date.`); }
            } catch (syncError) {
                console.error(`[AutoSync] Failed to sync ${config.type} data:`, syncError);
                if (syncError instanceof Error && syncError.message.includes("File not found")) { settings.autoSync = false; localStorage.setItem(deviceSpecificKey, JSON.stringify(settings)); }
            }
        }
    }, [dataActions]);

    useEffect(() => {
        if (!user) return;
        const initialSyncTimeoutId = window.setTimeout(() => { console.log('[AutoSync] Running auto-sync on startup...'); runAutoSyncOnStartup(); }, 10000);
        return () => clearTimeout(initialSyncTimeoutId);
    }, [user, runAutoSyncOnStartup]);

    // --- Main Data Loading Effect ---
    useEffect(() => {
        let isMounted = true;
        const unsubscribers: (() => void)[] = [];
        const initialize = async () => {
            if (!user) { setDataState({ customers: [], products: [], selectedCameraId: null }); return; }
            try {
                const [cachedCustomers, cachedProducts] = await Promise.all([ cache.getCachedData<Customer>('customers'), cache.getCachedData<Product>('products'), ]);
                if (isMounted) setDataState(prev => ({ ...prev, customers: cachedCustomers, products: cachedProducts }));
            } catch (cacheError) { console.warn("Failed to load data from cache:", cacheError); }
            setIsSyncing(true);
            try { await db.initDB(); }
            catch (initError) { console.error("Database initialization failed:", initError); if (isMounted) { showAlert("데이터베이스 연결에 실패했습니다. 오프라인 모드로 실행됩니다."); setIsSyncing(false); } return; }
            if (!isMounted || !db.isInitialized()) { if (isMounted) setIsSyncing(false); return; }
            let customersLoaded = false, productsLoaded = false;
            const checkSyncStatus = () => { if (customersLoaded && productsLoaded && isMounted) setIsSyncing(false); };
            const unsubCustomers = db.listenToStore<Customer>('customers', (customersFromDB) => {
                if (isMounted) { setDataState(prev => ({ ...prev, customers: customersFromDB })); cache.setCachedData('customers', customersFromDB).catch(e => console.error("Cache update failed for customers:", e)); if (!customersLoaded) { customersLoaded = true; checkSyncStatus(); } }
            });
            const unsubProducts = db.listenToStore<Product>('products', (productsFromDB) => {
                if (isMounted) { setDataState(prev => ({ ...prev, products: productsFromDB })); cache.setCachedData('products', productsFromDB).catch(e => console.error("Cache update failed for products:", e)); if (!productsLoaded) { productsLoaded = true; checkSyncStatus(); } }
            });
            unsubscribers.push(unsubCustomers, unsubProducts);
            try { const deviceId = getDeviceId(); const cameraSettingPath = `settings/cameraSettingsByDevice/${deviceId}`; unsubscribers.push(db.listenToValue<string | null>(cameraSettingPath, (id) => { if (isMounted) setDataState(prev => ({ ...prev, selectedCameraId: id })); })); }
            catch (error) { console.error("Failed to setup settings listener:", error); }
        };
        initialize();
        return () => { isMounted = false; unsubscribers.forEach(unsub => unsub()); };
    }, [user, showAlert]);
    
    return (
        <AlertContext.Provider value={alertContextValue}>
        <ModalContext.Provider value={modalContextValue}>
        <ScannerContext.Provider value={scannerContextValue}>
        <SyncContext.Provider value={syncContextValue}>
        <PWAInstallContext.Provider value={pwaInstallContextValue}>
        <MiscUIContext.Provider value={miscUIContextValue}>
            <DataActionsContext.Provider value={dataActions}>
                <DataStateContext.Provider value={dataState}>
                    <Toast isOpen={toast.isOpen} message={toast.message} type={toast.type} onClose={hideToast} />
                    <AlertModal isOpen={alert.isOpen} message={alert.message} onClose={hideAlert} onConfirm={alert.onConfirm} onCancel={alert.onCancel} confirmText={alert.confirmText} confirmButtonClass={alert.confirmButtonClass} />
                    {children}
                </DataStateContext.Provider>
            </DataActionsContext.Provider>
        </MiscUIContext.Provider>
        </PWAInstallContext.Provider>
        </SyncContext.Provider>
        </ScannerContext.Provider>
        </ModalContext.Provider>
        </AlertContext.Provider>
    );
};