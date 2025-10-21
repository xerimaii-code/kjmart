export interface Customer {
    comcode: string;
    name: string;
    lastModified?: string;
}

export interface Product {
    barcode: string;
    name: string;
    costPrice: number;      // 단가 (매입가)
    sellingPrice: number;   // 판가 (판매가)
    salePrice?: string;     // 행사가
    saleEndDate?: string;   // 행사 종료일 (YYYY-MM-DD)
    supplierName?: string;  // 거래처명
    lastModified?: string;
}

export interface OrderItem {
    barcode: string;
    name: string;
    price: number; // 거래 시점의 확정 단가 (매입가)
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

export type Page = 'new-order' | 'history' | 'settings' | 'product-inquiry';

export type ScannerContext = 'new-order' | 'modal' | 'product-inquiry' | null;

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
