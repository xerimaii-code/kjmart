
export interface Customer {
    comcode: string;
    name: string;
    lastModified?: string;
}

export interface Product {
    barcode: string;
    name: string;
    costPrice: number;
    sellingPrice: number;
    eventCostPrice?: number;
    salePrice?: number;
    saleStartDate?: string;
    saleEndDate?: string;
    supplierName?: string;
    lastModified?: string;
    stockQuantity?: number;
    bomStatus?: string;
    comcode?: string; // Added for full sync
    gubun1?: string;  // Added for full sync
    gubun2?: string;  // Added for full sync
    gubun3?: string;  // Added for full sync
}

export interface OrderItem {
    barcode: string;
    name: string;
    price: number;
    quantity: number;
    unit: '개' | '박스';
    memo?: string;
}

export interface Order {
    id: number;
    date: string;
    createdAt: string;
    updatedAt: string;
    customer: Customer;
    itemCount: number;
    total: number;
    completedAt?: string | null;
    completionDetails?: {
        type: 'sms' | 'xls' | 'return';
        timestamp: string;
    } | null;
    items?: OrderItem[];
}

export type ScannerContext = 'new-order' | 'modal' | 'product-inquiry' | null;

export interface NewOrderDraft {
    selectedCustomer: Customer | null;
    items: OrderItem[];
    isBoxUnitDefault: boolean;
}

export interface EditedOrderDraft {
    items: OrderItem[];
}

export interface SyncSettings {
    fileId: string;
    fileName: string;
    lastSyncTime: string | null;
    autoSync: boolean;
}

export interface DeviceSettings {
    selectedCameraId: string | null;
    scanSettings: {
        vibrateOnScan: boolean;
        soundOnScan: boolean;
    };
    logRetentionDays: number;
    googleDriveSyncSettings: {
        customers: SyncSettings | null;
        products: SyncSettings | null;
    };
    dataSourceSettings: {
        newOrder: 'offline' | 'online';
        productInquiry: 'offline' | 'online';
        autoSwitch: boolean;
    };
    allowDestructiveQueries: boolean; // SQL Runner Safety Setting
}

export interface SyncLog {
    _key: string;
    timestamp: number;
    user?: string;
    name?: string;
    barcode?: string;
    comcode?: string;
    _deleted?: boolean;
}

export interface BOM {
    pcode: string;
    ccode: string;
    qty: number;
    id?: string; // Composite key helper for IndexedDB
}

export interface Category {
    id: string; // Unique key (e.g., "1-01", "2-01-02")
    level: 1 | 2 | 3;
    code1: string;
    code2?: string;
    code3?: string;
    name: string;
}

export interface UserQuery {
    id: string;
    name: string;
    query: string;
    type: 'sql' | 'natural';
    isQuickRun?: boolean;
    isImportant?: boolean;
    order?: number;
}
