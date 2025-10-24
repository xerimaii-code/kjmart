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
import { useLocalStorage } from '../hooks/useLocalStorage';
// FIX: The following import from 'firebase/database' causes errors with older Firebase SDK versions.
// It is removed as the database operations are now using the v8 compat syntax provided by dbService.

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
    scanSettings: { vibrateOnScan: boolean; soundOnScan: boolean; };
}
interface DataActions {
    smartSyncCustomers: (customers: Customer[], userEmail: string, onProgress?: (message: string) => void) => Promise<void>;
    smartSyncProducts: (products: Product[], userEmail: string, onProgress?: (message: string) => void) => Promise<void>;
    addOrder: (orderData: { customer: Customer; items: OrderItem[]; total: number; memo?: string; }) => Promise<number>;
    updateOrder: (updatedOrder: Order) => Promise<void>;
    updateOrderStatus: (orderId: number, completionDetails: Order['completionDetails']) => Promise<void>;
    deleteOrder: (orderId: number) => Promise<void>;
    setSelectedCameraId: (id: string | null) => Promise<void>;
    setScanSettings: (settings: Partial<{ vibrateOnScan: boolean; soundOnScan: boolean; }>) => Promise<void>;
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
    isHistoryModalOpen: boolean;
    openHistoryModal: () => void;
    closeHistoryModal: () => void;
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
interface SyncContextValue { isSyncing: boolean; syncProgress: number; initialSyncCompleted: boolean; syncStatusText: string; }

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
    const [syncProgress, setSyncProgress] = useState(0);
    const [syncStatusText, setSyncStatusText] = useState('초기화 중...');
    const [initialSyncCompleted, setInitialSyncCompleted] = useState(false);
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
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [lastSyncKeys, setLastSyncKeys] = useLocalStorage<{ customers: string | null, products: string | null }>('last-sync-log-keys', { customers: null, products: null });

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
        isHistoryModalOpen,
        openHistoryModal: () => setIsHistoryModalOpen(true),
        closeHistoryModal: () => setIsHistoryModalOpen(false),
    }), [isDetailModalOpen, editingOrder, isDeliveryModalOpen, orderToExport, addItemModalProps, editItemModalProps, memoModalProps, isHistoryModalOpen]);
    
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
    
    const syncContextValue = useMemo(() => ({ isSyncing, syncProgress, initialSyncCompleted, syncStatusText }), [isSyncing, syncProgress, initialSyncCompleted, syncStatusText]);
    
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
    const [dataState, setDataState] = useState<DataState>({ customers: [], products: [], selectedCameraId: null, scanSettings: { vibrateOnScan: true, soundOnScan: true } });

    useEffect(() => {
        // This effect handles device-specific settings from Firebase
        if (!user || !db.isInitialized() || !db.db) return;
        
        const deviceId = getDeviceId();
        // FIX: Use v8 compat API
        const settingsRef = db.db.ref(`device-settings/${deviceId}`);
        
        // FIX: Use v8 compat API
        const listener = settingsRef.on('value', (snapshot) => {
            const settings = snapshot.val();
            setDataState(prevState => ({
                ...prevState,
                selectedCameraId: settings?.selectedCameraId ?? null,
                scanSettings: {
                    vibrateOnScan: settings?.scanSettings?.vibrateOnScan ?? true,
                    soundOnScan: settings?.scanSettings?.soundOnScan ?? true,
                }
            }));
        });
        
        // FIX: Use v8 compat API
        return () => settingsRef.off('value', listener);
    }, [user]);

    const dataActions: DataActions = useMemo(() => ({
        smartSyncCustomers: (customers, userEmail, onProgress) => db.smartSyncData('customers', customers, userEmail, onProgress),
        smartSyncProducts: (products, userEmail, onProgress) => db.smartSyncData('products', products, userEmail, onProgress),
        addOrder: ({ customer, items, total, memo }) => db.addOrderWithItems({ customer, total, memo }, items),
        updateOrder: async (updatedOrder) => {
            const { items, ...orderData } = updatedOrder;
            await db.updateOrderAndItems(orderData, items || []);
        },
        updateOrderStatus: (orderId, completionDetails) => db.updateOrderStatus(orderId, completionDetails),
        deleteOrder: (orderId) => db.deleteOrderAndItems(orderId),
        setSelectedCameraId: async (id) => {
            // FIX: Use v8 compat API
            if (!user || !db.isInitialized() || !db.db) return;
            const deviceId = getDeviceId();
            await db.db.ref(`device-settings/${deviceId}/selectedCameraId`).set(id);
        },
        setScanSettings: async (settings) => {
            // FIX: Use v8 compat API
            if (!user || !db.isInitialized() || !db.db) return;
            const deviceId = getDeviceId();
            const updates: { [key: string]: any } = {};
            if (settings.vibrateOnScan !== undefined) updates[`device-settings/${deviceId}/scanSettings/vibrateOnScan`] = settings.vibrateOnScan;
            if (settings.soundOnScan !== undefined) updates[`device-settings/${deviceId}/scanSettings/soundOnScan`] = settings.soundOnScan;
            if (Object.keys(updates).length > 0) await db.db.ref().update(updates);
        },
        clearOrders: () => db.clearOrders(),
        forceFullSync: async () => {
            setIsSyncing(true);
            try {
                // Get fresh data from the primary data nodes
                const customers = await db.getStore<Customer>('customers');
                const products = await db.getStore<Product>('products');

                // Overwrite local cache with the full fresh dataset
                await Promise.all([
                    cache.setCachedData('customers', customers),
                    cache.setCachedData('products', products)
                ]);
                
                // Update the application's state
                setDataState(prev => ({...prev, customers, products }));

                // CRITICAL: Find the latest log keys and reset the sync markers
                // This ensures the next incremental sync starts from this point.
                const lastCustomerKey = await db.getLastSyncLogKey('customers');
                const lastProductKey = await db.getLastSyncLogKey('products');
                setLastSyncKeys({ customers: lastCustomerKey, products: lastProductKey });

                showToast("데이터 강제 동기화가 완료되었습니다.", "success");
            } catch (error) {
                console.error("Force full sync failed:", error);
                showAlert("데이터 강제 동기화에 실패했습니다.");
            } finally {
                setIsSyncing(false);
            }
        },
    }), [user, showToast, showAlert, setLastSyncKeys]);

    useEffect(() => {
        if (!user) {
            setDataState({ customers: [], products: [], selectedCameraId: null, scanSettings: { vibrateOnScan: true, soundOnScan: true } });
            if (lastSyncKeys?.customers || lastSyncKeys?.products) {
                 setLastSyncKeys({ customers: null, products: null });
            }
            setInitialSyncCompleted(false); 
            return;
        }
    
        let isMounted = true;
        const unsubscribers: (() => void)[] = [];
    
        const performSync = async () => {
            if (!isMounted) return;
            setIsSyncing(true);
            setSyncProgress(0);
            setSyncStatusText('동기화 시작...');
    
            try {
                // 1. Load local cache first for instant UI response
                if (isMounted) {
                    setSyncProgress(10);
                    setSyncStatusText('로컬 캐시 로딩 중...');
                }
                const [cachedCustomers, cachedProducts] = await Promise.all([
                    cache.getCachedData<Customer>('customers'),
                    cache.getCachedData<Product>('products'),
                ]);
                if (isMounted) {
                    setDataState(prev => ({ ...prev, customers: cachedCustomers, products: cachedProducts }));
                    setSyncProgress(20);
                    setSyncStatusText('서버와 변경사항 확인 중...');
                }
    
                // 2. Sync function for a given data type
                const syncDataType = async (dataType: 'customers' | 'products'): Promise<void> => {
                    let localData = dataType === 'customers' ? cachedCustomers : cachedProducts;
                    const keyField = dataType === 'customers' ? 'comcode' : 'barcode';
                    const lastKey = lastSyncKeys?.[dataType] ?? null;

                    // --- OPTIMIZATION ---
                    // If local cache is empty, perform a faster full sync instead of processing all logs.
                    if (localData.length === 0) {
                        console.log(`Cache for ${dataType} is empty. Performing initial full sync.`);
                        const fullData = await db.getStore<Customer | Product>(dataType);

                        if (isMounted && fullData.length > 0) {
                            await cache.setCachedData(dataType, fullData as any);
                            setDataState(prev => ({ ...prev, [dataType]: fullData }));
                            
                            const latestLogKey = await db.getLastSyncLogKey(dataType);
                            if (latestLogKey) {
                                setLastSyncKeys(prevKeys => ({ ...(prevKeys || { customers: null, products: null }), [dataType]: latestLogKey }));
                            }
                            
                            if (!isMounted) return;
                            const unsub = db.listenForNewLogs(dataType, latestLogKey, (newItem, itemKey) => {
                                if (!isMounted) return;
                                
                                setDataState(prev => {
                                    const currentData = prev[dataType];
                                    const dataMap = new Map(currentData.map(item => [(item as any)[keyField], item]) as [string, Customer | Product][]);
                                    
                                    if ((newItem as any)._deleted) {
                                        dataMap.delete((newItem as any)[keyField]);
                                    } else {
                                        dataMap.set((newItem as any)[keyField], newItem);
                                    }
                                    const updatedData = Array.from(dataMap.values());
            
                                    cache.setCachedData(dataType, updatedData as any).then(() => {
                                        if (isMounted) {
                                            setLastSyncKeys(prevKeys => ({ ...(prevKeys || { customers: null, products: null }), [dataType]: itemKey }));
                                        }
                                    }).catch(err => {
                                        console.error(`Failed to cache and update sync key for ${dataType}`, err);
                                    });
                                    
                                    return { ...prev, [dataType]: updatedData };
                                });
                            });
                            unsubscribers.push(unsub);
                        }
                        return;
                    }


                    // --- Original Incremental Sync Logic (for when cache is already populated) ---
                    const { items: changes, newLastKey } = await db.getSyncLogChanges(dataType, lastKey);
    
                    if (isMounted && changes.length > 0) {
                        const dataMap = new Map(localData.map(item => [(item as any)[keyField], item]) as [string, Customer | Product][]);
                        
                        for (const change of changes) {
                            const key = (change as any)[keyField];
                            if (!key) {
                                console.warn(`Sync change for ${dataType} is missing keyField '${keyField}'. Change:`, change);
                                continue;
                            }
                            if ((change as any)._deleted) {
                                dataMap.delete(key);
                            } else {
                                dataMap.set(key, change);
                            }
                        }
                        const updatedLocalData = Array.from(dataMap.values());
                        
                        await cache.setCachedData(dataType, updatedLocalData as any);
                        setDataState(prev => ({ ...prev, [dataType]: updatedLocalData }));
                    }
    
                    const finalKeyForListener = newLastKey || lastKey;
                    if (isMounted && newLastKey !== lastKey) {
                        setLastSyncKeys(prevKeys => ({ ...(prevKeys || { customers: null, products: null }), [dataType]: newLastKey }));
                    }
    
                    if (!isMounted) return;
                    const unsub = db.listenForNewLogs(dataType, finalKeyForListener, (newItem, itemKey) => {
                        if (!isMounted) return;
                        
                        setDataState(prev => {
                            const currentData = prev[dataType];
                            const dataMap = new Map(currentData.map(item => [(item as any)[keyField], item]) as [string, Customer | Product][]);
                            
                            if ((newItem as any)._deleted) {
                                dataMap.delete((newItem as any)[keyField]);
                            } else {
                                dataMap.set((newItem as any)[keyField], newItem);
                            }
                            const updatedData = Array.from(dataMap.values());
    
                            // Ensure cache and sync key are updated atomically after UI state update.
                            cache.setCachedData(dataType, updatedData as any).then(() => {
                                if (isMounted) { // Check mount status again in async callback
                                    setLastSyncKeys(prevKeys => ({ ...(prevKeys || { customers: null, products: null }), [dataType]: itemKey }));
                                }
                            }).catch(err => {
                                console.error(`Failed to cache and update sync key for ${dataType}`, err);
                            });
                            
                            return { ...prev, [dataType]: updatedData };
                        });
                    });
                    unsubscribers.push(unsub);
                };
    
                // Run sync for both in parallel
                const customerSyncPromise = syncDataType('customers').then(() => {
                    if (isMounted) {
                        setSyncProgress(prev => prev + 40);
                        setSyncStatusText('상품 정보 동기화...');
                    }
                });
                const productSyncPromise = syncDataType('products').then(() => {
                    if (isMounted) {
                        setSyncProgress(prev => prev + 40);
                        setSyncStatusText('마무리 중...');
                    }
                });

                await Promise.all([customerSyncPromise, productSyncPromise]);

                if (isMounted) {
                    setSyncProgress(100);
                }
    
            } catch (error) {
                console.error("Incremental sync failed:", error);
                if (isMounted) showAlert("데이터 동기화에 실패했습니다. 강제 동기화를 시도해보세요.");
            } finally {
                if (isMounted) {
                    setIsSyncing(false);
                    setInitialSyncCompleted(true);
                     // After a short delay, reset progress for future background syncs
                    setTimeout(() => {
                        if (isMounted) setSyncProgress(0);
                    }, 1000);
                }
            }
        };

        const performMaintenance = async () => {
            try {
                const retentionDays = await db.getValue<number>('settings/sync-logs/retentionDays', 30);
                if (retentionDays > 0) {
                    await Promise.all([
                        db.cleanupSyncLogs('customers', retentionDays),
                        db.cleanupSyncLogs('products', retentionDays)
                    ]);
                }
            } catch (error) {
                console.warn("Sync log cleanup failed:", error);
            }
        };
    
        performSync();
        performMaintenance();
    
        return () => {
            isMounted = false;
            unsubscribers.forEach(unsub => unsub());
        };
    }, [user, showAlert, lastSyncKeys, setLastSyncKeys]);


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
                                        <Toast 
                                            isOpen={toast.isOpen}
                                            message={toast.message}
                                            type={toast.type}
                                            onClose={hideToast}
                                        />
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