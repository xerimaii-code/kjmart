export interface Customer {
    comcode: string;
    name: string;
}

export interface Product {
    barcode: string;
    name:string;
    price: number;
}

export interface OrderItem extends Product {
    quantity: number;
    unit: '개' | '박스';
}

export interface Order {
    id: number;
    date: string;
    customer: Customer;
    items: OrderItem[];
    total: number;
}

export type Page = 'new-order' | 'history' | 'settings';

export interface AlertState {
    isOpen: boolean;
    message: string;
    onConfirm?: () => void;
    confirmText?: string;
    confirmButtonClass?: string;
}

export interface AppContextType {
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
    selectedCameraId: string | null;
    setSelectedCameraId: (id: string | null) => void;
}
