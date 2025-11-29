
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
