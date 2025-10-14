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

    const uiState: UIState = {
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

        // First, check if any auto-sync is enabled before initializing the heavy Google API.
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
            return; // Exit if no auto-sync is configured.
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
                // Silently disable auto-sync on critical errors like file not found.
                if (syncError instanceof Error && syncError.message.includes("File not found")) {
                    settings.autoSync = false;
                    localStorage.setItem(deviceSpecificKey, JSON.stringify(settings));
                }
            }
        }
    }, [dataActions]);

    // Auto-sync on startup effect
    useEffect(() => {
        if (!user) return; // Only run for logged-in users

        // Run on startup after a short delay to not interfere with initial load
        const initialSyncTimeoutId = window.setTimeout(() => {
            console.log('[AutoSync] Running auto-sync on startup...');
            runAutoSyncOnStartup();
        }, 10000); // 10-second delay

        return () => {
            clearTimeout(initialSyncTimeoutId);
        };
    }, [user, runAutoSyncOnStartup]);


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
            
            try {
                const deviceId = getDeviceId();
                const cameraSettingPath = `settings/cameraSettingsByDevice/${deviceId}`;
                const selectedCameraId = await db.getValue<string | null>(cameraSettingPath, null);
                if (isMounted) { setDataState(prev => ({ ...prev, selectedCameraId })); setLoadingState(prev => ({ ...prev, settings: true })); }

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