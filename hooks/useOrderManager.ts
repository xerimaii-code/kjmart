import { useState, useMemo, useCallback, useEffect } from 'react';
import { OrderItem, Product } from '../types';

interface UseOrderManagerProps {
    initialItems?: OrderItem[];
    onItemsChange?: (items: OrderItem[]) => void;
}

// Helper to ensure item properties are consistent, preventing false change detection.
const normalizeItems = (items: OrderItem[]): OrderItem[] => {
    return items.map(item => ({
        ...item,
    }));
};

export const useOrderManager = ({ initialItems = [], onItemsChange }: UseOrderManagerProps) => {
    const [items, setItems] = useState<OrderItem[]>(() => normalizeItems(initialItems));

    // This effect synchronizes the hook's internal state with the `initialItems` prop.
    // This is crucial for components like OrderDetailModal where the `initialItems` can change
    // when a new order is selected, ensuring the displayed data is always correct.
    useEffect(() => {
        setItems(normalizeItems(initialItems));
    }, [initialItems]);

    useEffect(() => {
        // Notify parent component of any changes to the managed items.
        if(onItemsChange) {
            onItemsChange(items);
        }
    }, [items, onItemsChange]);

    const addItem = useCallback((
        product: Product, 
        options: { isBoxUnit: boolean; quantity?: number; memo?: string; }
    ) => {
        const newUnit = options.isBoxUnit ? '박스' : '개';
        // New items are already normalized by their creation process.
        const newItem: OrderItem = { ...product, quantity: options.quantity ?? 1, unit: newUnit, memo: options.memo };
        
        setItems(prevItems => [...prevItems, newItem]);
    }, []);
    
    const updateItem = useCallback((barcode: string, newValues: Partial<OrderItem>) => {
        // Updated items from modals will have a boolean `isPromotion`, so they are also normalized.
        setItems(prev => prev.map(item => item.barcode === barcode ? { ...item, ...newValues } : item));
    }, []);

    const removeItem = useCallback((barcode: string) => {
        setItems(prev => prev.filter(item => item.barcode !== barcode));
    }, []);

    const totalAmount = useMemo(() => {
        return Math.floor(items.reduce((sum, item) => sum + (item.price * item.quantity), 0));
    }, [items]);

    const resetItems = useCallback((newItems: OrderItem[] = []) => {
        setItems(normalizeItems(newItems));
    }, []);

    return {
        items,
        addItem,
        updateItem,
        removeItem,
        resetItems,
        totalAmount,
    };
};