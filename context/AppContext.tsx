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
    isSyncing: boolean;
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
        isSyncing,
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
        isSyncing,
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
                return;
            }

            // 1. Load from cache for immediate UI responsiveness (batched)
            try {
                const [cachedCustomers, cachedProducts] = await Promise.all([
                    cache.getCachedData<Customer>('customers'),
                    cache.getCachedData<Product>('products'),
                ]);
                
                if (isMounted) {
                    setDataState(prev => ({ 
                        ...prev, 
                        customers: cachedCustomers, 
                        products: cachedProducts 
                    }));
                }
            } catch (cacheError) {
                console.warn("Failed to load data from cache:", cacheError);
            }

            // UI is now usable with cached data. Start background sync.
            setIsSyncing(true);

            // 2. Initialize Firebase connection
            try {
                await db.initDB();
            } catch (initError) {
                console.error("Database initialization failed:", initError);
                if (isMounted) {
                    showAlert("데이터베이스 연결에 실패했습니다. 오프라인 모드로 실행됩니다.");
                    setIsSyncing(false);
                }
                return;
            }
            
            if (!isMounted || !db.isInitialized()) {
                if (isMounted) setIsSyncing(false);
                return;
            }

            let customersLoaded = false;
            let productsLoaded = false;

            const checkSyncStatus = () => {
                if (customersLoaded && productsLoaded && isMounted) {
                    setIsSyncing(false);
                }
            };

            // 3. Attach real-time listeners for customers and products.
            // This approach fetches all data in one go, preventing the app from freezing
            // by avoiding thousands of individual state updates on startup.
            const unsubCustomers = db.listenToStore<Customer>('customers', (customersFromDB) => {
                if (isMounted) {
                    setDataState(prev => ({ ...prev, customers: customersFromDB }));
                    // Asynchronously update the cache in the background without blocking the UI.
                    cache.setCachedData('customers', customersFromDB).catch(e => console.error("Cache update failed for customers:", e));
                    if (!customersLoaded) {
                        customersLoaded = true;
                        checkSyncStatus();
                    }
                }
            });

            const unsubProducts = db.listenToStore<Product>('products', (productsFromDB) => {
                if (isMounted) {
                    setDataState(prev => ({ ...prev, products: productsFromDB }));
                    // Asynchronously update the cache in the background without blocking the UI.
                    cache.setCachedData('products', productsFromDB).catch(e => console.error("Cache update failed for products:", e));
                    if (!productsLoaded) {
                        productsLoaded = true;
                        checkSyncStatus();
                    }
                }
            });

            unsubscribers.push(unsubCustomers, unsubProducts);

            // 4. Set up listener for device-specific settings
            try {
                const deviceId = getDeviceId();
                const cameraSettingPath = `settings/cameraSettingsByDevice/${deviceId}`;
                unsubscribers.push(db.listenToValue<string | null>(cameraSettingPath, (id) => {
                    if (isMounted) setDataState(prev => ({ ...prev, selectedCameraId: id }));
                }));
            } catch (error) {
                console.error("Failed to setup settings listener:", error);
            }
        };

        initialize();
        
        return () => {
            isMounted = false;
            unsubscribers.forEach(unsub => unsub());
        };
    }, [user, showAlert]);
    
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
                        {children}
                    </DataStateContext.Provider>
                </DataActionsContext.Provider>
            </UIStateContext.Provider>
        </UIActionsContext.Provider>
    );
};