import React, { createContext, useState, ReactNode } from 'react';
import useLocalStorage from '../hooks/useLocalStorage';
import { Customer, Product, Order, CameraSettings } from '../types';

type Page = 'new-order' | 'order-history' | 'settings';

interface AlertState {
  isOpen: boolean;
  message: string;
  isConfirm?: boolean;
  onConfirm?: () => void;
}

interface AppContextType {
  customers: Customer[];
  setCustomers: (customers: Customer[]) => void;
  products: Product[];
  setProducts: (products: Product[]) => void;
  orders: Order[];
  setOrders: (orders: Order[]) => void;
  addOrder: (order: Order) => void;
  updateOrder: (order: Order) => void;
  deleteOrder: (orderId: number) => void;
  cameraSettings: CameraSettings;
  setCameraSettings: (settings: CameraSettings) => void;
  activePage: Page;
  setActivePage: (page: Page) => void;
  isDirty: boolean;
  setIsDirty: (dirty: boolean) => void;
  alert: AlertState;
  showAlert: (message: string, isConfirm?: boolean, onConfirm?: () => void) => void;
  hideAlert: () => void;
}

export const AppContext = createContext<AppContextType>({} as AppContextType);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [customers, setCustomers] = useLocalStorage<Customer[]>('customers', []);
  const [products, setProducts] = useLocalStorage<Product[]>('products', []);
  const [orders, setOrders] = useLocalStorage<Order[]>('orders', []);
  const [cameraSettings, setCameraSettings] = useLocalStorage<CameraSettings>('cameraSettings', { deviceId: null });
  const [activePage, setActivePage] = useState<Page>('new-order');
  const [isDirty, setIsDirty] = useState(false);
  const [alert, setAlert] = useState<AlertState>({ isOpen: false, message: '', isConfirm: false });

  const addOrder = (order: Order) => {
    setOrders(prevOrders => [...prevOrders, order]);
  };
  
  const updateOrder = (updatedOrder: Order) => {
    setOrders(prevOrders => prevOrders.map(order => order.id === updatedOrder.id ? updatedOrder : order));
  }

  const deleteOrder = (orderId: number) => {
    setOrders(prevOrders => prevOrders.filter(order => order.id !== orderId));
  }
  
  const showAlert = (message: string, isConfirm = false, onConfirm = () => {}) => {
    setAlert({ isOpen: true, message, isConfirm, onConfirm });
  };
  
  const hideAlert = () => {
    setAlert({ isOpen: false, message: '', isConfirm: false });
  };

  const contextValue = {
    customers,
    setCustomers,
    products,
    setProducts,
    orders,
    setOrders,
    addOrder,
    updateOrder,
    deleteOrder,
    cameraSettings,
    setCameraSettings,
    activePage,
    setActivePage: (page: Page) => {
      if (isDirty) {
        showAlert('저장하지 않은 변경사항이 있습니다. 정말 이동하시겠습니까?', true, () => {
          setIsDirty(false);
          setActivePage(page);
          hideAlert();
        });
      } else {
        setActivePage(page);
      }
    },
    isDirty,
    setIsDirty,
    alert,
    showAlert,
    hideAlert
  };

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
};
