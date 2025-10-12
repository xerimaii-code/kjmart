
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
    memo?: string;
}

export interface Order {
    id: number;
    date: string;
    createdAt?: string;
    customer: Customer;
    itemCount: number;
    total: number;
    memo?: string;
    completedAt?: string | null; // For backward compatibility
    completionDetails?: {
        type: 'sms' | 'xls';
        timestamp: string;
    } | null;
    // This is an optional property used to temporarily attach items after fetching them
    // from the separate /order-items/ path for specific UI operations like exports or modals.
    items?: OrderItem[];
}

export type Page = 'new-order' | 'history' | 'settings';

export type ScannerContext = 'new-order' | 'modal' | null;

// --- Draft Types for IndexedDB ---
export interface NewOrderDraft {
    selectedCustomer: Customer | null;
    items: OrderItem[];
    memo: string;
    isBoxUnitDefault: boolean;
}

export interface EditedOrderDraft {
    items: OrderItem[];
    memo: string;
}