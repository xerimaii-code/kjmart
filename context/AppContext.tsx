
import React, { createContext, useState, useCallback } from 'react';
import useLocalStorage from '../hooks/useLocalStorage';
import { Customer, Product, Order } from '../types';

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
    alert: AlertState;
    showAlert: (message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string) => void;
    hideAlert: () => void;
    isDetailModalOpen: boolean;
    editingOrderId: number | null;
    openDetailModal: (orderId: number) => void;
    closeDetailModal: () => void;
    hasUnsavedChanges: boolean;
    setHasUnsavedChanges: (hasChanges: boolean) => void;
    // Fix: Add selectedCameraId and its setter to the context type to resolve usage in ScannerModal.
    selectedCameraId: string | null;
    setSelectedCameraId: (id: string | null) => void;
}

export const AppContext = createContext<AppContextType>({} as AppContextType);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [customers, setCustomers] = useLocalStorage<Customer[]>('customers', []);
    const [products, setProducts] = useLocalStorage<Product[]>('products', []);
    const [orders, setOrders] = useLocalStorage<Order[]>('orders', []);

    const [alert, setAlert] = useState<AlertState>({ isOpen: false, message: '' });
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    // Fix: Add state for the selected camera ID, persisted in local storage.
    const [selectedCameraId, setSelectedCameraId] = useLocalStorage<string | null>('selectedCameraId', null);


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
            alert,
            showAlert,
            hideAlert,
            isDetailModalOpen,
            editingOrderId,
            openDetailModal,
            closeDetailModal,
            hasUnsavedChanges,
            setHasUnsavedChanges,
            // Fix: Provide selectedCameraId and its setter to context consumers.
            selectedCameraId,
            setSelectedCameraId,
        }}>
            {children}
        </AppContext.Provider>
    );
};
