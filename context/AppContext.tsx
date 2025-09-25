
import React, { createContext, useState, useCallback } from 'react';
import useLocalStorage from '../hooks/useLocalStorage';
import { Customer, Product, Order, ScannerContext } from '../types';

interface AlertState {
    isOpen: boolean;
    message: string;
    onConfirm?: () => void;
    confirmText?: string;
    confirmButtonClass?: string;
}

interface AppContextType {
    customers: Customer[];
    setCustomers: (customers: Customer[]) => void;
    products: Product[];
    setProducts: (products: Product[]) => void;
    orders: Order[];
    setOrders: (orders: Order[]) => void;
    addOrder: (order: Omit<Order, 'id' | 'date'>) => void;
    updateOrder: (updatedOrder: Order) => void;
    deleteOrder: (orderId: number) => void;
    selectedCameraId: string | null;
    setSelectedCameraId: (id: string | null) => void;
    alert: AlertState;
    showAlert: (message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string) => void;
    hideAlert: () => void;
    isDetailModalOpen: boolean;
    editingOrderId: number | null;
    openDetailModal: (orderId: number) => void;
    closeDetailModal: () => void;
    isScannerOpen: boolean;
    scannerContext: ScannerContext;
    openScanner: (context: ScannerContext) => void;
    closeScanner: () => void;
    onScanSuccess: (barcode: string) => void;
    setOnScanSuccess: (callback: (barcode: string) => void) => void;
    hasUnsavedChanges: boolean;
    setHasUnsavedChanges: (hasChanges: boolean) => void;
}

export const AppContext = createContext<AppContextType>({} as AppContextType);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [customers, setCustomers] = useLocalStorage<Customer[]>('customers', []);
    const [products, setProducts] = useLocalStorage<Product[]>('products', []);
    const [orders, setOrders] = useLocalStorage<Order[]>('orders', []);
    const [selectedCameraId, setSelectedCameraId] = useLocalStorage<string | null>('selectedCameraId', null);

    const [alert, setAlert] = useState<AlertState>({ isOpen: false, message: '' });
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [scannerContext, setScannerContext] = useState<ScannerContext>(null);
    const [scanSuccessCallback, setScanSuccessCallback] = useState<(barcode: string) => void>(() => () => {});
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);


    const showAlert = useCallback((message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string) => {
        setAlert({ isOpen: true, message, onConfirm, confirmText, confirmButtonClass });
    }, []);

    const hideAlert = useCallback(() => {
        setAlert({ isOpen: false, message: '' });
    }, []);

    const addOrder = useCallback((order: Omit<Order, 'id' | 'date'>) => {
        const newOrder: Order = {
            ...order,
            id: Date.now(),
            date: new Date().toISOString(),
        };
        setOrders(prevOrders => [...prevOrders, newOrder]);
    }, [setOrders]);

    const updateOrder = useCallback((updatedOrder: Order) => {
        setOrders(prevOrders => prevOrders.map(o => o.id === updatedOrder.id ? updatedOrder : o));
    }, [setOrders]);
    
    const deleteOrder = useCallback((orderId: number) => {
        setOrders(prevOrders => prevOrders.filter(o => o.id !== orderId));
    }, [setOrders]);

    const openDetailModal = useCallback((orderId: number) => {
        setEditingOrderId(orderId);
        setIsDetailModalOpen(true);
    }, []);

    const closeDetailModal = useCallback(() => {
        setIsDetailModalOpen(false);
        setEditingOrderId(null);
    }, []);

    const openScanner = useCallback((context: ScannerContext) => {
        setScannerContext(context);
        setIsScannerOpen(true);
    }, []);

    const closeScanner = useCallback(() => {
        setIsScannerOpen(false);
        setScannerContext(null);
    }, []);

    const onScanSuccess = useCallback((barcode: string) => {
        if(scanSuccessCallback) {
            scanSuccessCallback(barcode);
        }
    },[scanSuccessCallback]);

    const setOnScanSuccess = useCallback((callback: (barcode: string) => void) => {
        setScanSuccessCallback(() => callback);
    }, []);


    return (
        <AppContext.Provider value={{
            customers,
            setCustomers,
            products,
            setProducts,
            orders,
            setOrders,
            addOrder,
            updateOrder,
            deleteOrder,
            selectedCameraId,
            setSelectedCameraId,
            alert,
            showAlert,
            hideAlert,
            isDetailModalOpen,
            editingOrderId,
            openDetailModal,
            closeDetailModal,
            isScannerOpen,
            scannerContext,
            openScanner,
            closeScanner,
            onScanSuccess,
            setOnScanSuccess,
            hasUnsavedChanges,
            setHasUnsavedChanges,
        }}>
            {children}
        </AppContext.Provider>
    );
};