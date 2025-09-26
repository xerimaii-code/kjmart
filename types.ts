
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
    isPromotion?: boolean;
}

export interface Order {
    id: number;
    date: string;
    customer: Customer;
    items: OrderItem[];
    total: number;
}

export type Page = 'new-order' | 'history' | 'settings';

export type ScannerContext = 'new-order' | 'modal' | null;