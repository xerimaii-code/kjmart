import { Customer, Order, Product, OrderItem } from "../types";

const isObject = (value: unknown): value is object => value !== null && typeof value === 'object' && !Array.isArray(value);

export const validateCustomer = (item: unknown): item is Customer => {
    if (!isObject(item)) return false;
    const maybeCustomer = item as Customer;
    return typeof maybeCustomer.comcode === 'string' &&
           typeof maybeCustomer.name === 'string';
};

export const validateProduct = (item: unknown): item is Product => {
    if (!isObject(item)) return false;
    const maybeProduct = item as Product;
    // FIX: A Product has 'costPrice' and 'sellingPrice', not 'price'.
    return typeof maybeProduct.barcode === 'string' &&
           typeof maybeProduct.name === 'string' &&
           typeof maybeProduct.costPrice === 'number' &&
           typeof maybeProduct.sellingPrice === 'number';
};

export const validateOrderItem = (item: unknown): item is OrderItem => {
    // FIX: Rewrote to correctly validate an OrderItem's properties independently.
    // The previous logic incorrectly called validateProduct, which checks for different fields.
    if (!isObject(item)) return false;
    const typedItem = item as OrderItem;
    return typeof typedItem.barcode === 'string' &&
           typeof typedItem.name === 'string' &&
           typeof typedItem.price === 'number' &&
           typeof typedItem.quantity === 'number' &&
           (typedItem.unit === '개' || typedItem.unit === '박스') &&
           (typeof typedItem.memo === 'string' || typeof typedItem.memo === 'undefined');
};

export const validateOrder = (item: unknown): item is Order => {
    if (!isObject(item)) return false;
    const maybeOrder = item as Order;
    return typeof maybeOrder.id === 'number' &&
           typeof maybeOrder.date === 'string' &&
           (typeof maybeOrder.createdAt === 'string' || typeof maybeOrder.createdAt === 'undefined') &&
           validateCustomer(maybeOrder.customer) &&
           Array.isArray(maybeOrder.items) &&
           maybeOrder.items.every(validateOrderItem) &&
           typeof maybeOrder.total === 'number' &&
           (typeof maybeOrder.completedAt === 'string' || maybeOrder.completedAt === null || typeof maybeOrder.completedAt === 'undefined');
};

export const validateCustomers = (data: any[]): Customer[] => {
    return data.filter(validateCustomer);
};

export const validateProducts = (data: any[]): Product[] => {
    return data.filter(validateProduct);
};

export const validateOrders = (data: any[]): Order[] => {
    return data.filter(validateOrder);
};

export const validateFullBackup = (data: any): boolean => {
    // To ensure backward compatibility with older backup files,
    // only check for the essential data arrays. The restore logic
    // in SettingsPage.tsx will handle missing optional keys gracefully.
    return isObject(data) &&
        'customers' in data && Array.isArray(data.customers) &&
        'products' in data && Array.isArray(data.products) &&
        'orders' in data && Array.isArray(data.orders);
};

export const validateOrdersBackup = (data: any): boolean => {
    return isObject(data) && 'orders' in data && Array.isArray(data.orders);
};
