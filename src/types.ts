
export interface Customer {
    comcode: string;
    name: string;
    lastModified?: string;
}

export interface Product {
    barcode: string;
    name: string;
    spec?: string; // Added spec field
    costPrice: number;
    sellingPrice: number;
    eventCostPrice?: number;
    salePrice?: number;
    saleName?: string; // Added saleName field
    saleStartDate?: string;
    saleEndDate?: string;
    supplierName?: string;
    lastModified?: string;
    stockQuantity?: number;
    bomStatus?: string;
    ispack?: any; // Added to support BOM logic
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
    isModified?: boolean; // Added to track modification status in New Order
}

export interface AuditedItem {
    barcode: string;
    name: string;
    spec?: string;
    computerStock: number;
    prevAuditQty?: number;
    auditQty: number;
    diff: number;
    timestamp: number;
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

export interface ReceivingItem {
    uniqueId: number;
    barcode: string;
    name: string;
    costPrice: number; // 입고 시점의 매입가
    sellingPrice: number;
    // FIX: Add missing quantity property to ReceivingItem type.
    quantity: number;
    isNew?: boolean; // 새로 추가된 항목인지 여부
}

export interface ReceivingBatch {
    id: number; // Timestamp-based ID
    date: string; // YYYY-MM-DD
    supplier: Customer;
    items: ReceivingItem[];
    itemCount: number;
    totalAmount: number;
    status: 'draft' | 'sent';
    sentAt?: string;
}

// FIX: Add AddItemModalPayload and EditItemModalPayload types to be used in AppContext.
export interface AddItemModalPayload {
    product: Product;
    existingItem: OrderItem | null;
    onAdd: (details: {
        quantity: number;
        unit: '개' | '박스';
        memo?: string;
    }) => void;
    onClose?: () => void;
    onNextScan?: () => void;
    trigger: 'scan' | 'search';
    initialSettings?: {
        unit: '개' | '박스';
    };
    timestamp?: number;
}

export interface EditItemModalPayload {
    item: OrderItem;
    onSave: (details: {
        quantity: number;
        unit: '개' | '박스';
        memo?: string;
    }) => void;
    onScanNext?: () => void;
}


export type ScannerContext = 'new-order' | 'modal' | 'product-inquiry' | 'inventory-audit' | null;

// New interface for Scanner Options
export interface ScannerOptions {
    continuous: boolean;
    useHighPrecision?: boolean;
}

export interface NewOrderDraft {
    selectedCustomer: Customer | null;
    items: OrderItem[];
    isBoxUnitDefault: boolean;
}

export interface EditedOrderDraft {
    items: OrderItem[];
}

export interface ReceivingDraft {
    currentDate: string;
    selectedSupplier: Customer | null;
    items: ReceivingItem[];
}

export interface InventoryAuditDraft {
    items: AuditedItem[];
    applyMode: 'immediate' | 'batch';
}

export interface EventRegistrationDraft {
    step: 1 | 2;
    junno: string;
    eventName: string;
    startDate: string;
    endDate: string;
    items: any[];
}


export interface SyncSettings {
    fileId: string;
    fileName: string;
    lastSyncTime: string | null;
    autoSync: boolean;
}

export interface DeviceSettings {
    selectedCameraId: string | null;
    selectedCameraLabel?: string; // 카메라 이름 저장 (ID 변경 대응)
    scanSettings: {
        soundOnScan: boolean;
        useScannerButton: boolean; // Added: Manual scan button toggle
        scanResolution: '480p' | '720p'; // Added: Resolution selection
        scanFps: 24 | 30 | 60 | 'auto'; // Modified: Added 'auto' for true variable fps
        enableDownscaling?: boolean; // [New] 분석 이미지 다운스케일링 여부
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
    uiFeedback: {
        vibrateOnPress: boolean;
        soundOnPress: boolean;
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

export interface EventItem {
    salename: string;
    startday: string;
    endday: string;
    isappl: string;
    itemcount: number;
    junno: string;
    [key: string]: any;
}

export interface LearningItem {
    id: string;
    title: string;
    content: string;
}
