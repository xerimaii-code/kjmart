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
import { ref, onValue, set, update } from 'firebase/database';

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
    smartSyncCustomers: (customers: Customer[], userEmail: string) => Promise<void>;
    smartSyncProducts: (products: Product[], userEmail: string) => Promise<void>;
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
    const [dataState, setDataState] = useState<DataState>({ customers: [], products: [], selectedCameraId: null, scanSettings: { vibrateOnScan: true, soundOnScan: true } });

    useEffect(() => {
        // This effect handles device-specific settings from Firebase
        if (!user || !db.isInitialized()) return;
        
        const deviceId = getDeviceId();
        const settingsRef = ref(db.db!, `device-settings/${deviceId}`);
        
        const unsubscribe = onValue(settingsRef, (snapshot) => {
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
        
        return () => unsubscribe();
    }, [user]);

    const dataActions: DataActions = useMemo(() => ({
        smartSyncCustomers: (customers, userEmail) => db.smartSyncData('customers', customers, userEmail),
        smartSyncProducts: (products, userEmail) => db.smartSyncData('products', products, userEmail),
        addOrder: ({ customer, items, total, memo }) => db.addOrderWithItems({ customer, total, memo }, items),
        updateOrder: async (updatedOrder) => {
            const { items, ...orderData } = updatedOrder;
            await db.updateOrderAndItems(orderData, items || []);
        },
        updateOrderStatus: (orderId, completionDetails) => db.updateOrderStatus(orderId, completionDetails),
        deleteOrder: (orderId) => db.deleteOrderAndItems(orderId),
        setSelectedCameraId: async (id) => {
            if (!user || !db.isInitialized()) return;
            const deviceId = getDeviceId();
            await set(ref(db.db!, `device-settings/${deviceId}/selectedCameraId`), id);
        },
        setScanSettings: async (settings) => {
            if (!user || !db.isInitialized()) return;
            const deviceId = getDeviceId();
            const updates: { [key: string]: any } = {};
            if (settings.vibrateOnScan !== undefined) updates[`device-settings/${deviceId}/scanSettings/vibrateOnScan`] = settings.vibrateOnScan;
            if (settings.soundOnScan !== undefined) updates[`device-settings/${deviceId}/scanSettings/soundOnScan`] = settings.soundOnScan;
            if (Object.keys(updates).length > 0) await update(ref(db.db!), updates);
        },
        clearOrders: () => db.clearOrders(),
        forceFullSync: async () => {
            setIsSyncing(true);
            try {
                // Clear local cache
                await cache.setCachedData('customers', []);
                await cache.setCachedData('products', []);

                // Get fresh data and populate cache
                await db.getStoreByChunks<Customer>('customers', 500, async (chunk, isFirstChunk) => {
                    if (isFirstChunk) await cache.setCachedData('customers', chunk);
                    else await cache.appendCachedData('customers', chunk);
                });
                await db.getStoreByChunks<Product>('products', 500, async (chunk, isFirstChunk) => {
                    if (isFirstChunk) await cache.setCachedData('products', chunk);
                    else await cache.appendCachedData('products', chunk);
                });
                
                // Update state
                const customers = await cache.getCachedData<Customer>('customers');
                const products = await cache.getCachedData<Product>('products');
                setDataState(prev => ({...prev, customers, products }));

                showToast("데이터 강제 동기화가 완료되었습니다.", "success");
            } catch (error) {
                console.error("Force full sync failed:", error);
                showAlert("데이터 강제 동기화에 실패했습니다.");
            } finally {
                setIsSyncing(false);
            }
        },
    }), [user, showToast, showAlert]);

     useEffect(() => {
        if (!user) {
            setDataState({ customers: [], products: [], selectedCameraId: null, scanSettings: { vibrateOnScan: true, soundOnScan: true } });
            return;
        }
        setIsSyncing(true);

        const initCache = async () => {
            const cachedCustomers = await cache.getCachedData<Customer>('customers');
            const cachedProducts = await cache.getCachedData<Product>('products');

            if (cachedCustomers.length > 0 || cachedProducts.length > 0) {
                 setDataState(prev => ({...prev, customers: cachedCustomers, products: cachedProducts }));
                 setIsSyncing(false); // Show cached data immediately
            }

            // Setup listeners for realtime updates
            const unsubCustomers = db.attachStoreListener<Customer>('customers', {
                onAdd: (item) => cache.addOrUpdateCachedItem('customers', item).then(() => setDataState(p => ({...p, customers: [...p.customers.filter(c => c.comcode !== item.comcode), item]}))),
                onChange: (item) => cache.addOrUpdateCachedItem('customers', item).then(() => setDataState(p => ({...p, customers: p.customers.map(c => c.comcode === item.comcode ? item : c)}))),
                onRemove: (key) => cache.removeCachedItem('customers', key).then(() => setDataState(p => ({...p, customers: p.customers.filter(c => c.comcode !== key)}))),
            });
            const unsubProducts = db.attachStoreListener<Product>('products', {
                onAdd: (item) => cache.addOrUpdateCachedItem('products', item).then(() => setDataState(p => ({...p, products: [...p.products.filter(pr => pr.barcode !== item.barcode), item]}))),
                onChange: (item) => cache.addOrUpdateCachedItem('products', item).then(() => setDataState(p => ({...p, products: p.products.map(pr => pr.barcode === item.barcode ? item : pr)}))),
                onRemove: (key) => cache.removeCachedItem('products', key).then(() => setDataState(p => ({...p, products: p.products.filter(pr => pr.barcode !== key)}))),
            });
            
             // Fetch all data if cache is empty
            if (cachedCustomers.length === 0 && cachedProducts.length === 0) {
                const customers = await db.getStore<Customer>('customers');
                const products = await db.getStore<Product>('products');
                await cache.setCachedData('customers', customers);
                await cache.setCachedData('products', products);
                setDataState(prev => ({...prev, customers, products }));
                setIsSyncing(false);
            }
            
            return () => {
                unsubCustomers();
                unsubProducts();
            };
        };

        initCache();
    }, [user, showAlert]);


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
