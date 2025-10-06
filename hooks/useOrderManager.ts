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
        isPromotion: !!item.isPromotion, // Coerce undefined/null to false, keep true as true.
    }));
};

export const useOrderManager = ({ initialItems = [], onItemsChange }: UseOrderManagerProps) => {
    // FIX: Normalize initial items to ensure `isPromotion` is always a boolean.
    // This prevents false positives in change detection where `undefined` is compared to `false`.
    const [items, setItems] = useState<OrderItem[]>(() => normalizeItems(initialItems));

    useEffect(() => {
        // When initialItems prop changes (e.g., opening a new order), reset and normalize the state.
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
        options: { isBoxUnit: boolean; isPromotion: boolean; quantity?: number; }
    ) => {
        const newUnit = options.isBoxUnit ? '박스' : '개';
        // New items are already normalized by their creation process.
        const newItem: OrderItem = { ...product, quantity: options.quantity ?? 1, unit: newUnit, isPromotion: options.isPromotion };
        
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