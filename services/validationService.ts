import { Customer, Order, Product, OrderItem } from "../types";

const isObject = (value: any): value is object => value !== null && typeof value === 'object' && !Array.isArray(value);

// FIX: Cast `item` to access properties, as `isObject` narrows its type to `object`.
export const validateCustomer = (item: any): item is Customer => {
    return isObject(item) &&
           typeof (item as Customer).comcode === 'string' &&
           typeof (item as Customer).name === 'string';
};

// FIX: Cast `item` to access properties, as `isObject` narrows its type to `object`.
export const validateProduct = (item: any): item is Product => {
    return isObject(item) &&
           typeof (item as Product).barcode === 'string' &&
           typeof (item as Product).name === 'string' &&
           typeof (item as Product).price === 'number';
};

// FIX: Cast `item` to `OrderItem` to access properties not present on the `Product` type, which `item` is narrowed to by `validateProduct`.
export const validateOrderItem = (item: any): item is OrderItem => {
    const typedItem = item as OrderItem;
    return validateProduct(item) &&
           typeof typedItem.quantity === 'number' &&
           (typedItem.unit === '개' || typedItem.unit === '박스') &&
           (typeof typedItem.isPromotion === 'boolean' || typeof typedItem.isPromotion === 'undefined') &&
           (typeof typedItem.status === 'undefined' || typedItem.status === 'new' || typedItem.status === 'modified' || typedItem.status === null);
};

// FIX: Cast `item` to access properties, as `isObject` narrows its type to `object`.
export const validateOrder = (item: any): item is Order => {
    return isObject(item) &&
           typeof (item as Order).id === 'number' &&
           typeof (item as Order).date === 'string' &&
           (typeof (item as Order).createdAt === 'string' || typeof (item as Order).createdAt === 'undefined') &&
           validateCustomer((item as Order).customer) &&
           Array.isArray((item as Order).items) &&
           (item as Order).items.every(validateOrderItem) &&
           typeof (item as Order).total === 'number' &&
           (typeof (item as Order).completedAt === 'string' || (item as Order).completedAt === null || typeof (item as Order).completedAt === 'undefined');
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