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
    smartSyncCustomers: (customers: Customer[], userEmail: string) => Promise<void>;
    smartSyncProducts: (products: Product[], userEmail: string) => Promise<void>;
    addOrder: (orderData: { customer: Customer; items: OrderItem[]; total: number; memo?: string; }) => Promise<number>;
    updateOrder: (updatedOrder: Order) => Promise<void>;
    updateOrderStatus: (orderId: number, completionDetails: Order['completionDetails']) => Promise<void>;
    deleteOrder: (orderId: number) => Promise<void>;
    setSelectedCameraId: (id: string | null) => Promise<void>;
    clearOrders: () => Promise<void>;
    forceFullSync: () => Promise<void>;
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

    // New modal properties
    addItemModalProps: AddItemModalPayload | null;
    editItemModalProps: EditItemModalPayload | null;
    memoModalProps: MemoModalPayload | null;
    openAddItemModal: (data: AddItemModalPayload) => void;
    closeAddItemModal: () => void;
    openEditItemModal: (data: EditItemModalPayload) => void;
    closeEditItemModal: () => void;
    openMemoModal: (data: MemoModalPayload) => void;
    closeMemoModal: () => void;
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
    const [addItemModalProps, setAddItemModalProps] = useState<AddItemModalPayload | null>(null);
    const [editItemModalProps, setEditItemModalProps] = useState<EditItemModalPayload | null>(null);
    const [memoModalProps, setMemoModalProps] = useState<MemoModalPayload | null>(null);

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

        addItemModalProps,
        editItemModalProps,
        memoModalProps,
        openAddItemModal: (data) => setAddItemModalProps(data),
        closeAddItemModal: () => setAddItemModalProps(null),
        openEditItemModal: (data) => setEditItemModalProps(data),
        closeEditItemModal: () => setEditItemModalProps(null),
        openMemoModal: (data) => setMemoModalProps(data),
        closeMemoModal: () => setMemoModalProps(null),
    }), [isDetailModalOpen, editingOrder, isDeliveryModalOpen, orderToExport, addItemModalProps, editItemModalProps, memoModalProps]);
    
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
        smartSyncCustomers: (customers, userEmail) => db.smartSyncData('customers', customers, userEmail),
        smartSyncProducts: (products, userEmail) => db.smartSyncData('products', products, userEmail),
        addOrder: (orderData) => { const { items, ...orderShellData } = orderData; return db.addOrderWithItems(orderShellData, items); },
        updateOrder: (updatedOrder) => { const { items, ...orderShell } = updatedOrder; return db.updateOrderAndItems(orderShell, items || []); },
        updateOrderStatus: (orderId, completionDetails) => db.updateOrderStatus(orderId, completionDetails),
        deleteOrder: (orderId) => db.deleteOrderAndItems(orderId),
        setSelectedCameraId: (id) => { const deviceId = getDeviceId(); const cameraSettingPath = `settings/cameraSettingsByDevice/${deviceId}`; return db.setValue(cameraSettingPath, id); },
        clearOrders: () => db.clearOrders(),
        forceFullSync: async () => {
            if (!db.isInitialized()) {
                showToast("데이터베이스에 연결되지 않아 동기화할 수 없습니다.", 'error');
                return;
            }
            setIsSyncing(true);
            try {
                // Clear last sync keys to trigger a full download on next load.
                localStorage.removeItem(`${getDeviceId()}:lastCustomerSyncKey`);
                localStorage.removeItem(`${getDeviceId()}:lastProductSyncKey`);

                const [customers, products] = await Promise.all([
                    db.getStore<Customer>('customers'),
                    db.getStore<Product>('products'),
                ]);
                setDataState(prev => ({ ...prev, customers, products }));
                await Promise.all([
                    cache.setCachedData('customers', customers),
                    cache.setCachedData('products', products),
                ]);

                // Prime the incremental sync for the future.
                const [lastCustomerKey, lastProductKey] = await Promise.all([
                    db.getLastSyncLogKey('customers'),
                    db.getLastSyncLogKey('products')
                ]);
                if(lastCustomerKey) localStorage.setItem(`${getDeviceId()}:lastCustomerSyncKey`, lastCustomerKey);
                if(lastProductKey) localStorage.setItem(`${getDeviceId()}:lastProductSyncKey`, lastProductKey);

                showToast("전체 데이터 동기화가 완료되었습니다.", 'success');
            } catch (error) {
                console.error("Force full sync failed:", error);
                showToast("데이터 동기화에 실패했습니다.", 'error');
            } finally {
                setIsSyncing(false);
            }
        },
    }), [showToast]);

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
        if (!isAutoSyncEnabled || !user?.email) { console.log("[AutoSync] No auto-sync configurations found or user not logged in. Skipping."); return; }
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
                    if (config.type === 'customer') {
                        const { valid } = processCustomerData(rows);
                        if (valid.length > 0) await dataActions.smartSyncCustomers(valid, user.email);
                    } else {
                        const { valid } = processProductData(rows);
                        if (valid.length > 0) await dataActions.smartSyncProducts(valid, user.email);
                    }
                    settings.lastSyncTime = metadata.modifiedTime;
                    localStorage.setItem(deviceSpecificKey, JSON.stringify(settings));
                    console.log(`[AutoSync] ${config.type} synced successfully.`);
                } else { console.log(`[AutoSync] ${config.type} data is up to date.`); }
            } catch (syncError) {
                console.error(`[AutoSync] Failed to sync ${config.type} data:`, syncError);
                if (syncError instanceof Error && syncError.message.includes("File not found")) {
                    settings.autoSync = false;
                    localStorage.setItem(deviceSpecificKey, JSON.stringify(settings));
                }
            }
        }
    }, [dataActions, user]);
    
    // --- Main Data Loading Effect ---
    useEffect(() => {
        let isMounted = true;
        const unsubscribers: (() => void)[] = [];
        
        const initialize = async () => {
            if (!user) {
                setDataState({ customers: [], products: [], selectedCameraId: null });
                return;
            }
            
            // Trigger periodic sync log cleanup
            const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
            const lastCleanup = await db.getValue<string>('settings/sync-logs/lastCleanupTimestamp', '');
            if (Date.now() - new Date(lastCleanup || 0).getTime() > TWENTY_FOUR_HOURS_MS) {
                console.log("Performing scheduled sync log cleanup...");
                db.performSyncLogCleanup().catch(err => console.error("Sync log cleanup failed:", err));
            }

            setIsSyncing(true);

            // 1. Load from cache immediately
            try {
                const [cachedCustomers, cachedProducts] = await Promise.all([
                    cache.getCachedData<Customer>('customers'),
                    cache.getCachedData<Product>('products'),
                ]);
                if (isMounted) setDataState(prev => ({ ...prev, customers: cachedCustomers, products: cachedProducts }));
            } catch (cacheError) {
                console.warn("Failed to load data from cache:", cacheError);
            }

            if (!db.isInitialized()) {
                if (isMounted) {
                    showAlert("데이터베이스에 연결되지 않았습니다. 앱이 오프라인 모드로 실행됩니다.");
                    setIsSyncing(false);
                }
                return;
            }
            
            const deviceId = getDeviceId();

            // Define listener logic before sync logic to avoid hoisting issues.
            const attachListeners = <T extends { comcode: string } | { barcode: string }>(dataType: 'customers' | 'products', keyField: 'comcode' | 'barcode') => {
                unsubscribers.push(db.attachStoreListener(dataType, {
                    onAdd: (item: T) => {
                        if (isMounted) {
                            setDataState(prev => ({ ...prev, [dataType]: [...prev[dataType].filter((i: T) => (i as any)[keyField] !== (item as any)[keyField]), item] }));
                            cache.addOrUpdateCachedItem(dataType, item as any);
                        }
                    },
                    onChange: (item: T) => {
                        if (isMounted) {
                            setDataState(prev => ({
                                ...prev,
                                [dataType]: prev[dataType].map((i: T) => (i as any)[keyField] === (item as any)[keyField] ? item : i),
                            }));
                            cache.addOrUpdateCachedItem(dataType, item as any);
                        }
                    },
                    onRemove: (key: string) => {
                        if (isMounted) {
                            setDataState(prev => ({
                                ...prev,
                                [dataType]: prev[dataType].filter((i: T) => (i as any)[keyField] !== key)
                            }));
                            cache.removeCachedItem(dataType, key);
                        }
                    },
                }));
            };
            
            // 2. Perform incremental/full sync for customers and products
            const syncDataType = async <T extends Customer | Product>(dataType: 'customers' | 'products', keyField: 'comcode' | 'barcode') => {
                const lastSyncKey = localStorage.getItem(`${deviceId}:last${dataType.charAt(0).toUpperCase() + dataType.slice(1)}SyncKey`);
                
                let newLastKey: string | null = null;
                
                if (lastSyncKey) { // Incremental sync
                    const currentItems = (await cache.getCachedData<T>(dataType)) || [];
                    const changes = await db.getSyncLogChanges<T>(dataType, lastSyncKey);
                    if (changes.items.length > 0) {
                        const itemsMap = new Map(currentItems.map(item => [(item as any)[keyField], item]));
                        changes.items.forEach(item => {
                            if ((item as any)._deleted) {
                                itemsMap.delete((item as any)[keyField]);
                            } else {
                                itemsMap.set((item as any)[keyField], item);
                            }
                        });
                        const updatedItems = Array.from(itemsMap.values());
                        if(isMounted) {
                            setDataState(prev => ({...prev, [dataType]: updatedItems}));
                            await cache.setCachedData(dataType, updatedItems as any);
                        }
                    }
                    newLastKey = changes.lastKey;
                } else { // Full sync with chunking to prevent freezing
                    const CHUNK_SIZE = 500;
                    
                    if (isMounted) {
                        setDataState(prev => ({ ...prev, [dataType]: [] }));
                    }
                    
                    await db.getStoreByChunks<T>(
                        dataType,
                        CHUNK_SIZE,
                        async (chunk, isFirstChunk) => {
                            if (!isMounted) return;
                            
                            setDataState(prev => ({ ...prev, [dataType]: prev[dataType].concat(chunk) }));
                            
                            if (isFirstChunk) {
                                await cache.setCachedData(dataType, chunk as any);
                            } else {
                                await cache.appendCachedData(dataType, chunk as any);
                            }
                        }
                    );
                    
                    newLastKey = await db.getLastSyncLogKey(dataType);

                    if (isMounted && !newLastKey) {
                        console.log(`No sync logs found for ${dataType} after full sync. Creating a new sync marker.`);
                        newLastKey = db.createSyncMarker(dataType);
                    }
                }
                
                if (isMounted && newLastKey) {
                    localStorage.setItem(`${deviceId}:last${dataType.charAt(0).toUpperCase() + dataType.slice(1)}SyncKey`, newLastKey);
                }
            };
            
            await Promise.all([
                syncDataType<Customer>('customers', 'comcode'),
                syncDataType<Product>('products', 'barcode'),
            ]);
            
            if(isMounted) setIsSyncing(false);
            
            // 3. Attach real-time listeners for live updates
            attachListeners<Customer>('customers', 'comcode');
            attachListeners<Product>('products', 'barcode');
            
            const cameraSettingPath = `settings/cameraSettingsByDevice/${deviceId}`;
            const unsubscribeCamera = db.listenToValue<string>(cameraSettingPath, (id) => {
                if (isMounted) {
                    setDataState(prev => ({...prev, selectedCameraId: id}));
                }
            });
            unsubscribers.push(unsubscribeCamera);
            
            runAutoSyncOnStartup();
        };

        initialize();

        return () => {
            isMounted = false;
            unsubscribers.forEach(unsub => unsub());
        };
    }, [user, showAlert, runAutoSyncOnStartup]);

    return (
        <DataStateContext.Provider value={dataState}>
            <DataActionsContext.Provider value={dataActions}>
                <AlertContext.Provider value={alertContextValue}>
                    <ModalContext.Provider value={modalContextValue}>
                        <ScannerContext.Provider value={scannerContextValue}>
                            <SyncContext.Provider value={syncContextValue}>
                                <PWAInstallContext.Provider value={pwaInstallContextValue}>
                                    <MiscUIContext.Provider value={miscUIContextValue}>
                                        {children}
                                        <AlertModal
                                            isOpen={alert.isOpen}
                                            message={alert.message}
                                            onClose={hideAlert}
                                            onConfirm={alert.onConfirm}
                                            onCancel={alert.onCancel}
                                            confirmText={alert.confirmText}
                                            confirmButtonClass={alert.confirmButtonClass}
                                        />
                                        <Toast {...toast} onClose={hideToast} />
                                    </MiscUIContext.Provider>
                                </PWAInstallContext.Provider>
                            </SyncContext.Provider>
                        </ScannerContext.Provider>
                    </ModalContext.Provider>
                </AlertContext.Provider>
            </DataActionsContext.Provider>
        </DataStateContext.Provider>
    );
};
