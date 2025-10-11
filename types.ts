

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
    items: OrderItem[];
    total: number;
    memo?: string;
    completedAt?: string | null; // For backward compatibility
    completionDetails?: {
        type: 'sms' | 'xls';
        timestamp: string;
    } | null;
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

export interface GoogleDriveFile {
    id: string;
    name: string;
}
