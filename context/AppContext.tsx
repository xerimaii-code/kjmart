import React, { createContext, useState, useCallback, useEffect, ReactNode, useContext, useMemo, useRef } from 'react';
import { Customer, Product, Order, OrderItem, ScannerContext } from '../types';
import * as db from '../services/dbService';
import * as cache from '../services/cacheDbService';
import AlertModal from '../components/AlertModal';
import LoadingOverlay from '../components/LoadingOverlay';
import { useAuth } from './AuthContext';
import * as googleDrive from '../services/googleDriveService';
import { parseExcelFile, processCustomerData, processProductData } from '../services/dataService';
import { getDeviceId } from '../services/deviceService';
import Toast from '../components/Toast';


interface SyncSettings {
    fileId: string;
    fileName: string;
    lastSyncTime: string | null;
    autoSync: boolean;
}

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

interface ToastState {
    isOpen: boolean;
    message: string;
    type: 'success' | 'error';
}

interface UIState {
    alert: AlertState;
    toast: ToastState;
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
    showToast: (message: string, type: 'success' | 'error') => void;
    hideToast: () => void;
    openDetailModal: (order: Order) => void;
    closeDetailModal: () => void;
    openScanner: (context: ScannerContext, onScan: (barcode: string) => void, continuous?: boolean) => void;
    closeScanner: () => void;
    openDeliveryModal: (order: Order) => void;
    closeDeliveryModal: () => void;
    triggerInstallPrompt: () => void;
    setLastModifiedOrderId: (id: number | null) => void;
}

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
    const [toast, setToast] = useState<ToastState>({ isOpen: false, message: '', type: 'success' });
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

    const showToast = useCallback((message: string, type: 'success' | 'error') => {
        setToast({ isOpen: true, message, type });
    }, []);

    const hideToast = useCallback(() => {
        setToast(prev => ({...prev, isOpen: false}));
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
        showToast,
        hideToast,
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
    }), [showAlert, showToast, hideToast, installPromptEvent]);

    const uiState: UIState = useMemo(() => ({
        alert,
        toast,
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
    }), [
        alert.isOpen,
        toast.isOpen,
        isDetailModalOpen,
        editingOrder,
        isScannerOpen,
        scannerContext,
        isContinuousScan,
        onScanSuccess,
        isDeliveryModalOpen,
        orderToExport,
        installPromptEvent,
        lastModifiedOrderId
    ]);
    
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

    const dataActions: DataActions = useMemo(() => ({
        setCustomers: async (customers) => {
            await cache.setCachedData('customers', customers).catch(e => console.error("Failed to cache new customers", e));
            return db.replaceAll('customers', customers);
        },
        setProducts: async (products) => {
            await cache.setCachedData('products', products).catch(e => console.error("Failed to cache new products", e));
            return db.replaceAll('products', products);
        },
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

    // --- State to Cache Synchronization ---
    useEffect(() => {
        if (dataState.customers.length > 0) {
            cache.setCachedData('customers', dataState.customers);
        }
    }, [dataState.customers]);

    useEffect(() => {
        if (dataState.products.length > 0) {
            cache.setCachedData('products', dataState.products);
        }
    }, [dataState.products]);
    
    // Auto-sync logic
    const runAutoSyncOnStartup = useCallback(async () => {
        const deviceId = getDeviceId();
        const syncConfigs = [
            { type: 'customer', key: `google-drive-sync-settings-customer` },
            { type: 'product', key: `google-drive-sync-settings-product` }
        ];

        const isAutoSyncEnabled = syncConfigs.some(config => {
            const deviceSpecificKey = `${deviceId}:${config.key}`;
            const settingsJSON = localStorage.getItem(deviceSpecificKey);
            if (!settingsJSON) return false;
            try {
                const settings: SyncSettings = JSON.parse(settingsJSON);
                return settings.autoSync && !!settings.fileId;
            } catch {
                return false;
            }
        });

        if (!isAutoSyncEnabled) {
            console.log("[AutoSync] No auto-sync configurations found. Skipping Google API initialization.");
            return;
        }

        try {
            await googleDrive.initGoogleApi();
        } catch (apiInitError) {
            console.warn("[AutoSync] Could not initialize Google API for auto-sync.", apiInitError);
            return;
        }

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
                        if (valid.length > 0) await dataActions.setCustomers(valid);
                    } else {
                        const { valid } = processProductData(rows);
                        if (valid.length > 0) await dataActions.setProducts(valid);
                    }
                    
                    settings.lastSyncTime = metadata.modifiedTime;
                    localStorage.setItem(deviceSpecificKey, JSON.stringify(settings));
                    console.log(`[AutoSync] ${config.type} data synced successfully.`);
                } else {
                    console.log(`[AutoSync] ${config.type} data is already up to date.`);
                }
            } catch (syncError) {
                console.error(`[AutoSync] Failed to sync ${config.type} data:`, syncError);
                if (syncError instanceof Error && syncError.message.includes("File not found")) {
                    settings.autoSync = false;
                    localStorage.setItem(deviceSpecificKey, JSON.stringify(settings));
                }
            }
        }
    }, [dataActions]);

    useEffect(() => {
        if (!user) return;
        const initialSyncTimeoutId = window.setTimeout(() => {
            console.log('[AutoSync] Running auto-sync on startup...');
            runAutoSyncOnStartup();
        }, 10000);
        return () => {
            clearTimeout(initialSyncTimeoutId);
        };
    }, [user, runAutoSyncOnStartup]);

    // --- Main Data Loading Effect ---
    useEffect(() => {
        let isMounted = true;
        const unsubscribers: (() => void)[] = [];

        const initialize = async () => {
            if (!user) {
                setDataState({ customers: [], products: [], selectedCameraId: null });
                setLoadingState({ connecting: true, customers: true, products: true, orders: true, settings: true });
                return;
            }

            setLoadingState({ connecting: false, customers: true, products: true, orders: true, settings: true });

            // 1. Load from cache for immediate UI responsiveness
            try {
                const cachedCustomers = await cache.getCachedData<Customer>('customers');
                if (isMounted && cachedCustomers.length > 0) {
                    setDataState(prev => ({ ...prev, customers: cachedCustomers }));
                }
                const cachedProducts = await cache.getCachedData<Product>('products');
                if (isMounted && cachedProducts.length > 0) {
                    setDataState(prev => ({ ...prev, products: cachedProducts }));
                }
            } catch (cacheError) {
                console.warn("Failed to load data from cache:", cacheError);
            }

            // 2. Initialize Firebase connection
            try {
                await db.initDB();
                if (isMounted) {
                    setLoadingState({ connecting: true, customers: false, products: false, orders: true, settings: false });
                }
            } catch (initError) {
                console.error("Database initialization failed:", initError);
                if (isMounted) {
                    showAlert("데이터베이스 연결에 실패했습니다. 오프라인 모드로 실행됩니다.");
                    setLoadingState({ connecting: true, customers: true, products: true, orders: true, settings: true });
                }
                return;
            }
            
            if (!isMounted || !db.isInitialized()) return;

            // 3. Fetch initial data from Firebase to overwrite cache and get the latest.
            // This provides a clear "loaded" state and is faster than item-by-item listeners.
            try {
                const [customersFromDB, productsFromDB] = await Promise.all([
                    db.getStore<Customer>('customers'),
                    db.getStore<Product>('products')
                ]);
                
                if (isMounted) {
                    // Set initial data and mark as loaded
                    setDataState(prev => ({ ...prev, customers: customersFromDB, products: productsFromDB }));
                    setLoadingState(prev => ({ ...prev, customers: true, products: true }));
                }
            } catch (dataError) {
                console.error("Failed to get initial customer/product data:", dataError);
                if (isMounted) {
                    // Mark as loaded even on error to unblock UI. App will run on cached data if available.
                    setLoadingState(prev => ({ ...prev, customers: true, products: true }));
                }
            }

            // 4. After initial data is loaded, attach listeners for real-time updates.
            const unsubCustomers = db.listenToStoreChanges<Customer>('customers', {
                onAdd: (customer) => {
                    if (isMounted) setDataState(prev => ({ ...prev, customers: [...prev.customers.filter(c => c.comcode !== customer.comcode), customer] }));
                },
                onChange: (customer) => {
                    if (isMounted) setDataState(prev => ({ ...prev, customers: prev.customers.map(c => c.comcode === customer.comcode ? customer : c) }));
                },
                onRemove: (comcode) => {
                    if (isMounted) setDataState(prev => ({ ...prev, customers: prev.customers.filter(c => c.comcode !== comcode) }));
                }
            });

            const unsubProducts = db.listenToStoreChanges<Product>('products', {
                onAdd: (product) => {
                    if (isMounted) setDataState(prev => ({ ...prev, products: [...prev.products.filter(p => p.barcode !== product.barcode), product] }));
                },
                onChange: (product) => {
                    if (isMounted) setDataState(prev => ({ ...prev, products: prev.products.map(p => p.barcode === product.barcode ? product : p) }));
                },
                onRemove: (barcode) => {
                    if (isMounted) setDataState(prev => ({ ...prev, products: prev.products.filter(p => p.barcode !== barcode) }));
                }
            });

            unsubscribers.push(unsubCustomers, unsubProducts);

            // 5. Set up listeners for device-specific settings
            try {
                const deviceId = getDeviceId();
                const cameraSettingPath = `settings/cameraSettingsByDevice/${deviceId}`;
                const selectedCameraId = await db.getValue<string | null>(cameraSettingPath, null);
                if (isMounted) { 
                    setDataState(prev => ({ ...prev, selectedCameraId })); 
                    setLoadingState(prev => ({ ...prev, settings: true })); 
                }
                unsubscribers.push(db.listenToValue<string | null>(cameraSettingPath, (id) => {
                    if (isMounted) setDataState(prev => ({ ...prev, selectedCameraId: id }));
                }));
            } catch (error) {
                console.error("Failed to setup settings listener:", error);
                 if (isMounted) setLoadingState(prev => ({ ...prev, settings: true }));
            }
        };

        initialize();
        
        return () => {
            isMounted = false;
            unsubscribers.forEach(unsub => unsub());
        };
    }, [user, showAlert]);
    
    const isDataLoading = !!user && Object.values(loadingState).some(status => !status);

    return (
        <UIActionsContext.Provider value={uiActions}>
            <UIStateContext.Provider value={uiState}>
                <DataActionsContext.Provider value={dataActions}>
                    <DataStateContext.Provider value={dataState}>
                        <Toast
                            isOpen={uiState.toast.isOpen}
                            message={uiState.toast.message}
                            type={uiState.toast.type}
                            onClose={uiActions.hideToast}
                        />
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