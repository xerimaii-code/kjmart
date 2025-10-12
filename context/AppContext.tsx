import React, { createContext, useState, useCallback, useEffect, ReactNode, useContext, useMemo, useRef } from 'react';
import { Customer, Product, Order, OrderItem, ScannerContext } from '../types';
import * as db from '../services/dbService';
import * as cache from '../services/cacheDbService';
import AlertModal from '../components/AlertModal';
import LoadingOverlay from '../components/LoadingOverlay';
import { useAuth } from './AuthContext';

// --- TYPE DEFINITIONS ---
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

interface AlertState {
    isOpen: boolean;
    message: string;
    onConfirm?: () => void;
    onCancel?: () => void;
    confirmText?: string;
    confirmButtonClass?: string;
}

interface UIState {
    alert: AlertState;
    isDetailModalOpen: boolean;
    editingOrder: Order | null;
    isScannerOpen: boolean;
    scannerContext: ScannerContext;
    isContinuousScan: boolean;
    onScanSuccess: (barcode: string) => void;
    isDeliveryModalOpen: boolean;
    orderToExport: Order | null;
    isInstallPromptAvailable: boolean;
    lastModifiedOrderId: number | null;
}

interface UIActions {
    showAlert: (message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string, onCancel?: () => void) => void;
    hideAlert: () => void;
    openDetailModal: (order: Order) => void;
    closeDetailModal: () => void;
    openScanner: (context: ScannerContext, onScan: (barcode: string) => void, continuous?: boolean) => void;
    closeScanner: () => void;
    openDeliveryModal: (order: Order) => void;
    closeDeliveryModal: () => void;
    triggerInstallPrompt: () => void;
    setLastModifiedOrderId: (id: number | null) => void;
}

const getDeviceId = (): string => {
    const DEVICE_ID_KEY = 'app-device-id';
    try {
        let storedId = localStorage.getItem(DEVICE_ID_KEY);
        if (!storedId) {
            // Simple UUID v4 generator
            storedId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                var r = (Math.random() * 16) | 0,
                    v = c === 'x' ? r : (r & 0x3) | 0x8;
                return v.toString(16);
            });
            localStorage.setItem(DEVICE_ID_KEY, storedId);
        }
        return storedId;
    } catch (error) {
        console.error("Failed to access localStorage for device ID:", error);
        // Fallback for environments where localStorage is not available (e.g., private browsing on some browsers)
        // This will not be persistent across sessions, but will be consistent for the current session.
        if (!(window as any)._sessionDeviceId) {
             (window as any)._sessionDeviceId = 'session-' + Date.now() + '-' + Math.random().toString(36).substring(2, 15);
        }
        return (window as any)._sessionDeviceId;
    }
};


// --- CONTEXT CREATION ---
// For performance optimization, contexts are split into State and Actions.
// Components that only need actions won't re-render when state changes.
const DataStateContext = createContext<DataState>({} as DataState);
const DataActionsContext = createContext<DataActions>({} as DataActions);
const UIStateContext = createContext<UIState>({} as UIState);
const UIActionsContext = createContext<UIActions>({} as UIActions);


// --- HOOKS for easier context consumption ---
export const useDataState = () => useContext(DataStateContext);
export const useDataActions = () => useContext(DataActionsContext);
export const useUIState = () => useContext(UIStateContext);
export const useUIActions = () => useContext(UIActionsContext);


// --- MAIN PROVIDER ---
export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();

    // --- UI STATE & ACTIONS ---
    const [alert, setAlert] = useState<AlertState>({ isOpen: false, message: '' });
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
    
    const showAlert = useCallback((message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string, onCancel?: () => void) => {
        setAlert({ isOpen: true, message, onConfirm, confirmText, confirmButtonClass, onCancel });
    }, []);

    useEffect(() => {
        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            setInstallPromptEvent(e);
        };
        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        };
    }, []);

    const onScanSuccess = useCallback((barcode: string) => {
        if (onScanCallbackRef.current) {
            onScanCallbackRef.current(barcode);
        }
    }, []);
    
    const uiActions: UIActions = useMemo(() => ({
        showAlert,
        hideAlert: () => setAlert(prev => ({ ...prev, isOpen: false })),
        openDetailModal: (order: Order) => {
            setEditingOrder(order);
            setIsDetailModalOpen(true);
        },
        closeDetailModal: () => {
            setIsDetailModalOpen(false);
            setEditingOrder(null);
        },
        openScanner: (context, onScan, continuous = false) => {
            setScannerContext(context);
            onScanCallbackRef.current = onScan;
            setIsContinuousScan(continuous);
            setIsScannerOpen(true);
        },
        closeScanner: () => {
            setIsScannerOpen(false);
            setIsContinuousScan(false);
            setScannerContext(null);
        },
        openDeliveryModal: (order: Order) => {
            setOrderToExport(order);
            setIsDeliveryModalOpen(true);
        },
        closeDeliveryModal: () => {
            setIsDeliveryModalOpen(false);
            setOrderToExport(null);
        },
        triggerInstallPrompt: () => {
            if (!installPromptEvent) {
                showAlert('앱을 설치할 수 없습니다. 브라우저가 이 기능을 지원하는지 확인해주세요.');
                return;
            }
            (installPromptEvent as any).prompt();
            setInstallPromptEvent(null);
        },
        setLastModifiedOrderId: (id: number | null) => {
            setLastModifiedOrderId(id);
        },
    }), [showAlert, installPromptEvent]);

    const uiState: UIState = {
        alert,
        isDetailModalOpen,
        editingOrder,
        isScannerOpen,
        scannerContext,
        isContinuousScan,
        onScanSuccess,
        isDeliveryModalOpen,
        orderToExport,
        isInstallPromptAvailable: !!installPromptEvent,
        lastModifiedOrderId,
    };
    
    // --- DATA STATE & ACTIONS ---
    const [dataState, setDataState] = useState<DataState>({
        customers: [],
        products: [],
        selectedCameraId: null,
    });
    const [loadingState, setLoadingState] = useState({
        connecting: true,
        customers: true,
        products: true,
        orders: true,
        settings: true,
    });
    
    // Initial Data Load: Cache-first strategy
    useEffect(() => {
        let isMounted = true;
        const unsubscribers: (() => void)[] = [];

        const initialize = async () => {
            if (!user) {
                setDataState({ customers: [], products: [], selectedCameraId: null });
                setLoadingState({ connecting: true, customers: true, products: true, orders: true, settings: true });
                return;
            }

            setLoadingState({ connecting: false, customers: false, products: false, orders: true, settings: false });

            // 1. Load master data from local cache for instant UI
            try {
                const cachedCustomers = await cache.getCachedData<Customer>('customers');
                if (isMounted && cachedCustomers.length > 0) {
                    setDataState(prev => ({ ...prev, customers: cachedCustomers }));
                    setLoadingState(prev => ({ ...prev, customers: true }));
                }
                const cachedProducts = await cache.getCachedData<Product>('products');
                if (isMounted && cachedProducts.length > 0) {
                    setDataState(prev => ({ ...prev, products: cachedProducts }));
                    setLoadingState(prev => ({ ...prev, products: true }));
                }
            } catch (cacheError) {
                console.warn("Failed to load data from cache:", cacheError);
            }

            // 2. Connect to Firebase
            try {
                await db.initDB();
            } catch (initError) {
                console.error("Database initialization failed:", initError);
                if (isMounted) {
                    showAlert("데이터베이스 연결에 실패했습니다. 오프라인 모드로 실행됩니다.");
                    setLoadingState({ connecting: true, customers: true, products: true, orders: true, settings: true });
                }
                return;
            }
            
            if (!isMounted) return;
            setLoadingState(prev => ({ ...prev, connecting: true }));

            if (!db.isInitialized()) {
                console.warn("Database not initialized. Proceeding with cached data only.");
                if (isMounted) {
                    setLoadingState({ connecting: true, customers: true, products: true, orders: true, settings: true });
                }
                return;
            }
            
            // 3. Fetch dynamic data and listen for realtime updates
            try {
                const deviceId = getDeviceId();
                const cameraSettingPath = `settings/cameraSettingsByDevice/${deviceId}`;

                // Fetch initial non-cached data
                const selectedCameraId = await db.getValue<string | null>(cameraSettingPath, null);
                if (isMounted) { setDataState(prev => ({ ...prev, selectedCameraId })); setLoadingState(prev => ({ ...prev, settings: true })); }

                // Listen for realtime updates for master data, and update cache when new data arrives
                unsubscribers.push(db.listenToStore<Customer>('customers', (data) => {
                    if (isMounted) {
                        setDataState(prev => ({ ...prev, customers: data }));
                        setLoadingState(prev => ({ ...prev, customers: true }));
                        cache.setCachedData('customers', data).catch(e => console.error("Failed to cache customers", e));
                    }
                }));
                unsubscribers.push(db.listenToStore<Product>('products', (data) => {
                    if (isMounted) {
                        setDataState(prev => ({ ...prev, products: data }));
                        setLoadingState(prev => ({ ...prev, products: true }));
                        cache.setCachedData('products', data).catch(e => console.error("Failed to cache products", e));
                    }
                }));
                
                unsubscribers.push(db.listenToValue<string | null>(cameraSettingPath, (id) => isMounted && setDataState(prev => ({ ...prev, selectedCameraId: id }))));

            } catch (error) {
                console.error("Failed to fetch initial data from Firebase:", error);
                if (isMounted) {
                     showAlert("데이터를 불러오는 데 실패했습니다. 캐시된 데이터로 표시됩니다.");
                     setLoadingState({ connecting: true, customers: true, products: true, orders: true, settings: true });
                }
            }
        };

        initialize();
        
        return () => {
            isMounted = false;
            unsubscribers.forEach(unsub => unsub());
        };
    }, [user, showAlert]);
    
    const isDataLoading = !!user && Object.values(loadingState).some(status => !status);

    const dataActions: DataActions = useMemo(() => ({
        setCustomers: async (customers) => {
            await cache.setCachedData('customers', customers).catch(e => console.error("Failed to cache new customers", e));
            return db.replaceAll('customers', customers);
        },
        setProducts: async (products) => {
            await cache.setCachedData('products', products).catch(e => console.error("Failed to cache new products", e));
            return db.replaceAll('products', products);
        },
        // FIX: Refactor to give parameter a name (`orderData`) before destructuring.
        // This helps TypeScript correctly infer the type of `orderShellData` from the `DataActions` interface,
        // resolving a type mismatch error when calling `db.addOrderWithItems`.
        addOrder: (orderData) => {
            const { items, ...orderShellData } = orderData;
            return db.addOrderWithItems(orderShellData, items);
        },
        updateOrder: (updatedOrder) => {
            const { items, ...orderShell } = updatedOrder;
            return db.updateOrderAndItems(orderShell, items || []);
        },
        updateOrderStatus: (orderId, completionDetails) => db.updateOrderStatus(orderId, completionDetails),
        deleteOrder: (orderId) => db.deleteOrderAndItems(orderId),
        setSelectedCameraId: (id) => {
            const deviceId = getDeviceId();
            const cameraSettingPath = `settings/cameraSettingsByDevice/${deviceId}`;
            return db.setValue(cameraSettingPath, id);
        },
        clearOrders: () => db.clearOrders(),
    }), []);

    return (
        <UIActionsContext.Provider value={uiActions}>
            <UIStateContext.Provider value={uiState}>
                <DataActionsContext.Provider value={dataActions}>
                    <DataStateContext.Provider value={dataState}>
                        <AlertModal
                            isOpen={alert.isOpen}
                            message={alert.message}
                            onClose={uiActions.hideAlert}
                            onConfirm={alert.onConfirm}
                            onCancel={alert.onCancel}
                            confirmText={alert.confirmText}
                            confirmButtonClass={alert.confirmButtonClass}
                        />
                        {isDataLoading ? <LoadingOverlay status={loadingState} /> : children}
                    </DataStateContext.Provider>
                </DataActionsContext.Provider>
            </UIStateContext.Provider>
        </UIActionsContext.Provider>
    );
};