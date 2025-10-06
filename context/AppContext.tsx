import React, { createContext, useState, useCallback, useEffect, ReactNode, useContext } from 'react';
import { Customer, Product, Order, ScannerContext } from '../types';
import * as db from '../services/dbService';
import AlertModal from '../components/AlertModal';
import LoadingOverlay from '../components/LoadingOverlay';

// --- TYPE DEFINITIONS ---
interface DataState {
    customers: Customer[];
    products: Product[];
    orders: Order[];
    selectedCameraId: string | null;
}

interface DataActions {
    setCustomers: (customers: Customer[]) => Promise<void>;
    setProducts: (products: Product[]) => Promise<void>;
    setOrders: (orders: Order[]) => Promise<void>;
    addOrder: (order: Omit<Order, 'id' | 'date'>) => Promise<void>;
    updateOrder: (updatedOrder: Order) => Promise<void>;
    deleteOrder: (orderId: number) => Promise<void>;
    setSelectedCameraId: (id: string | null) => Promise<void>;
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
    editingOrderId: number | null;
    isScannerOpen: boolean;
    scannerContext: ScannerContext;
    isContinuousScan: boolean;
    onScanSuccess: (barcode: string) => void;
    isInstallPromptAvailable: boolean;
}

interface UIActions {
    showAlert: (message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string, onCancel?: () => void) => void;
    hideAlert: () => void;
    openDetailModal: (orderId: number) => void;
    closeDetailModal: () => void;
    openScanner: (context: ScannerContext, onScan: (barcode: string) => void, continuous?: boolean) => void;
    closeScanner: () => void;
    triggerInstallPrompt: () => void;
}

// --- CONTEXT CREATION ---
export const DataContext = createContext<DataState & DataActions>({} as DataState & DataActions);
export const UIContext = createContext<UIState & UIActions>({} as UIState & UIActions);


// --- HOOKS for easier context consumption ---
export const useData = () => useContext(DataContext);
export const useUI = () => useContext(UIContext);

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [dataState, setDataState] = useState<DataState>({
        customers: [],
        products: [],
        orders: [],
        selectedCameraId: null,
    });
    const [loadingState, setLoadingState] = useState({
        connecting: false,
        customers: false,
        products: false,
        orders: false,
        settings: false,
    });
    const { showAlert } = useUI();
    
    // Initial Data Load from Firebase
    useEffect(() => {
        let isMounted = true;
        const unsubscribers: (() => void)[] = [];

        const initialize = async () => {
            await db.initDB();
            if (!isMounted) return;
            setLoadingState(prev => ({ ...prev, connecting: true }));

            if (!db.isInitialized()) {
                console.warn("Database not initialized. Proceeding without realtime data.");
                if (isMounted) {
                    setLoadingState({ connecting: true, customers: true, products: true, orders: true, settings: true });
                }
                return;
            }

            try {
                const customers = await db.getAll<Customer>('customers');
                if (isMounted) { setDataState(prev => ({ ...prev, customers })); setLoadingState(prev => ({ ...prev, customers: true })); }

                const products = await db.getAll<Product>('products');
                if (isMounted) { setDataState(prev => ({ ...prev, products })); setLoadingState(prev => ({ ...prev, products: true })); }

                const orders = await db.getAll<Order>('orders');
                if (isMounted) { setDataState(prev => ({ ...prev, orders })); setLoadingState(prev => ({ ...prev, orders: true })); }
                
                const selectedCameraId = await db.getSetting<string | null>('selectedCameraId', null);
                if (isMounted) { setDataState(prev => ({ ...prev, selectedCameraId })); setLoadingState(prev => ({ ...prev, settings: true })); }

                unsubscribers.push(db.listenToStore<Customer>('customers', (data) => isMounted && setDataState(prev => ({ ...prev, customers: data }))));
                unsubscribers.push(db.listenToStore<Product>('products', (data) => isMounted && setDataState(prev => ({ ...prev, products: data }))));
                unsubscribers.push(db.listenToStore<Order>('orders', (data) => isMounted && setDataState(prev => ({ ...prev, orders: data }))));
                unsubscribers.push(db.listenToSetting<string | null>('selectedCameraId', (id) => isMounted && setDataState(prev => ({ ...prev, selectedCameraId: id }))));

            } catch (error) {
                console.error("Failed to fetch initial data from Firebase:", error);
                if (isMounted) {
                     showAlert("데이터를 불러오는 데 실패했습니다. 네트워크 연결을 확인하고 앱을 새로고침하세요.");
                     setLoadingState({ connecting: true, customers: true, products: true, orders: true, settings: true });
                }
            }
        };

        initialize();
        
        return () => {
            isMounted = false;
            unsubscribers.forEach(unsub => unsub());
        };
    }, [showAlert]);
    
    const isLoading = Object.values(loadingState).some(status => !status);

    const dataActions: DataActions = {
        setCustomers: (customers) => db.replaceAll('customers', customers),
        setProducts: (products) => db.replaceAll('products', products),
        setOrders: (orders) => db.replaceAll('orders', orders),
        addOrder: async (order) => {
            const now = new Date().toISOString();
            const newOrder: Order = { ...order, id: Date.now(), date: now, createdAt: now, completedAt: null };
            await db.put('orders', newOrder);
        },
        updateOrder: (updatedOrder) => db.put('orders', updatedOrder),
        deleteOrder: (orderId) => db.deleteByKey('orders', orderId),
        setSelectedCameraId: (id) => db.setSetting('selectedCameraId', id),
    };

    return (
        <DataContext.Provider value={{ ...dataState, ...dataActions }}>
            {isLoading ? <LoadingOverlay status={loadingState} /> : children}
        </DataContext.Provider>
    );
};


// --- MAIN PROVIDER ---
export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [alert, setAlert] = useState<AlertState>({ isOpen: false, message: '' });
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [scannerContext, setScannerContext] = useState<ScannerContext>(null);
    const [isContinuousScan, setIsContinuousScan] = useState(false);
    const [scanSuccessCallback, setScanSuccessCallback] = useState<(barcode: string) => void>(() => () => {});
    const [installPromptEvent, setInstallPromptEvent] = useState<Event | null>(null);
    
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
    
    const uiActions: UIActions = {
        showAlert,
        hideAlert: useCallback(() => setAlert(prev => ({ ...prev, isOpen: false })), []),
        openDetailModal: useCallback((orderId: number) => {
            setEditingOrderId(orderId);
            setIsDetailModalOpen(true);
        }, []),
        closeDetailModal: useCallback(() => {
            setIsDetailModalOpen(false);
            setEditingOrderId(null);
        }, []),
        openScanner: useCallback((context, onScan, continuous = false) => {
            setScannerContext(context);
            setScanSuccessCallback(() => onScan);
            setIsContinuousScan(continuous);
            setIsScannerOpen(true);
        }, []),
        closeScanner: useCallback(() => {
            setIsScannerOpen(false);
            setIsContinuousScan(false);
            setScannerContext(null);
        }, []),
        triggerInstallPrompt: () => {
            if (!installPromptEvent) {
                showAlert('앱을 설치할 수 없습니다. 브라우저가 이 기능을 지원하는지 확인해주세요.');
                return;
            }
            (installPromptEvent as any).prompt();
            setInstallPromptEvent(null);
        },
    };
    
    const onScanSuccess = useCallback((barcode: string) => {
        if (scanSuccessCallback) scanSuccessCallback(barcode);
    }, [scanSuccessCallback]);

    const uiState: UIState = {
        alert,
        isDetailModalOpen,
        editingOrderId,
        isScannerOpen,
        scannerContext,
        isContinuousScan,
        onScanSuccess,
        isInstallPromptAvailable: !!installPromptEvent,
    };

    return (
        <UIContext.Provider value={{...uiState, ...uiActions}}>
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
        </UIContext.Provider>
    );
};