import { useState, useMemo, useCallback, useEffect } from 'react';
import { OrderItem, Product } from '../types';

interface UseOrderManagerProps {
    initialItems?: OrderItem[];
    onItemsChange?: (items: OrderItem[]) => void;
}

// Helper to ensure item properties are consistent, preventing false change detection.
// This creates a clean object with a defined property order and ensures optional fields are handled consistently.
const normalizeItems = (items: OrderItem[]): OrderItem[] => {
    if (!items) return [];
    return items.map(item => ({
        barcode: item.barcode,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        unit: item.unit,
        // CRITICAL FIX: Ensure `memo` is always a defined string.
        // `item.memo || ''` converts `undefined`, `null`, or `''` into a consistent `''`.
        // This is vital for `JSON.stringify` comparisons to work reliably when checking for changes.
        memo: item.memo || '',
    }));
};


export const useOrderManager = ({ initialItems = [], onItemsChange }: UseOrderManagerProps) => {
    const [items, setItems] = useState<OrderItem[]>(() => normalizeItems(initialItems));

    // Synchronize the internal state with the initialItems prop when it changes
    // (e.g., when a draft is loaded or a different order is displayed).
    useEffect(() => {
        // This effect synchronizes the manager's state with the initialItems prop.
        // It should only run when initialItems changes, not when the internal `items` state changes.
        // The parent component is responsible for memoizing initialItems if it's an array literal.
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
        const newItem: OrderItem = { ...product, quantity: options.quantity ?? 1, unit: newUnit, memo: options.memo };
        
        // Ensure state remains normalized after adding
        setItems(prevItems => normalizeItems([...prevItems, newItem]));
    }, []);
    
    const updateItem = useCallback((barcode: string, newValues: Partial<OrderItem>) => {
        setItems(prev => {
            const updatedItems = prev.map(item => item.barcode === barcode ? { ...item, ...newValues } : item);
            // Ensure state remains normalized after update
            return normalizeItems(updatedItems);
        });
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