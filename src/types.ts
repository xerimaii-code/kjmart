
export interface Customer {
    comcode: string;
    name: string;
    lastModified?: string;
}

export interface Product {
    barcode: string;
    name: string;
    spec?: string;
    costPrice: number;
    sellingPrice: number;
    eventCostPrice?: number;
    salePrice?: number;
    saleName?: string;
    saleStartDate?: string;
    saleEndDate?: string;
    supplierName?: string;
    lastModified?: string;
    stockQuantity?: number;
    bomStatus?: string;
    ispack?: any;
    comcode?: string;
    gubun1?: string;
    gubun2?: string;
    gubun3?: string;
}

export interface OrderItem {
    barcode: string;
    name: string;
    price: number; // 발주 시 결정된 최종 단가 (작성 중에는 실시간 반영, 저장 시 확정)
    quantity: number;
    unit: '개' | '박스';
    memo?: string;
    isModified?: boolean;
    // [최종 확정 시 박제될 스냅샷 필드]
    masterPrice?: number;   // 마스터 정상 매입가
    eventPrice?: number;    // 마스터 행사 매입가
    salePrice?: number;     // 마스터 행사 판매가
    saleName?: string;      // 행사명
    saleStartDate?: string; // 행사 시작일
    saleEndDate?: string;   // 행사 종료일
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
    costPrice: number;
    sellingPrice: number;
    quantity: number;
    isNew?: boolean;
}

export interface ReceivingBatch {
    id: number;
    date: string;
    supplier: Customer;
    items: ReceivingItem[];
    itemCount: number;
    totalAmount: number;
    status: 'draft' | 'sent';
    sentAt?: string;
}

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
    product?: Product;
    onSave: (details: {
        quantity: number;
        unit: '개' | '박스';
        memo?: string;
    }) => void;
    onScanNext?: () => void;
}

export type ScannerContext = 'new-order' | 'modal' | 'product-inquiry' | 'inventory-audit' | null;

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
    selectedCameraLabel?: string;
    scanSettings: {
        soundOnScan: boolean;
        useScannerButton: boolean;
        scanResolution: '480p' | '720p';
        scanFps: 24 | 30 | 60 | 'auto';
        enableDownscaling?: boolean;
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
    allowDestructiveQueries: boolean;
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
    id?: string;
}

export interface Category {
    id: string;
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
