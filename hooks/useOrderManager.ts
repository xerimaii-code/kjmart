import { useState, useMemo, useCallback, useEffect } from 'react';
import { OrderItem, Product } from '../types';

interface UseOrderManagerProps {
    initialItems?: OrderItem[];
    onItemsChange?: (items: OrderItem[]) => void;
}

// Helper to check if a sale is active for a product
export const isSaleActive = (saleEndDate?: string): boolean => {
    if (!saleEndDate) return false;
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Set to start of today for accurate date comparison
        const endDate = new Date(saleEndDate);
        return endDate >= today;
    } catch {
        return false;
    }
};


// Helper to ensure item properties are consistent, preventing false change detection.
const normalizeItems = (items: OrderItem[]): OrderItem[] => {
    if (!items) return [];
    return items.map(item => ({
        barcode: item.barcode,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        unit: item.unit,
        memo: item.memo || '',
    }));
};


export const useOrderManager = ({ initialItems = [], onItemsChange }: UseOrderManagerProps) => {
    const [items, setItems] = useState<OrderItem[]>(() => normalizeItems(initialItems));

    // Synchronize the internal state with the initialItems prop when it changes
    useEffect(() => {
        setItems(normalizeItems(initialItems));
    }, [initialItems]);

    useEffect(() => {
        // Notify parent component of any changes to the managed items.
        if(onItemsChange) {
            onItemsChange(items);
        }
    }, [items, onItemsChange]);
    
    const updateItem = useCallback((barcode: string, newValues: Partial<OrderItem>) => {
        setItems(prev => {
            const updatedItems = prev.map(item => item.barcode === barcode ? { ...item, ...newValues } : item);
            return normalizeItems(updatedItems);
        });
    }, []);

    const addOrUpdateItem = useCallback((product: Product, details: { quantity: number; unit: '개' | '박스'; memo?: string; }) => {
        setItems(prevItems => {
            const existingItemIndex = prevItems.findIndex(i => i.barcode === product.barcode);
            
            // 발주 품목의 단가는 상품의 매입 단가(costPrice)를 사용
            const priceToUse = product.costPrice;

            if (existingItemIndex > -1) {
                const updatedItems = [...prevItems];
                const existingItem = updatedItems[existingItemIndex];
                updatedItems[existingItemIndex] = {
                    ...existingItem,
                    quantity: existingItem.quantity + details.quantity,
                    unit: details.unit,
                    memo: details.memo || '',
                    price: priceToUse, // 가격 변동 시 업데이트
                };
                return normalizeItems(updatedItems);
            } else {
                const newItem: OrderItem = {
                    barcode: product.barcode,
                    name: product.name,
                    price: priceToUse,
                    quantity: details.quantity,
                    unit: details.unit,
                    memo: details.memo || '',
                };
                return normalizeItems([...prevItems, newItem]);
            }
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
        updateItem,
        addOrUpdateItem,
        removeItem,
        resetItems,
        totalAmount,
    };
};
