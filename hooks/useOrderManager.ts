import { useState, useMemo, useCallback, useEffect } from 'react';
import { OrderItem, Product } from '../types';

interface UseOrderManagerProps {
    initialItems?: OrderItem[];
    onItemsChange?: (items: OrderItem[]) => void;
}

export const useOrderManager = ({ initialItems = [], onItemsChange }: UseOrderManagerProps) => {
    const [items, setItems] = useState<OrderItem[]>(initialItems);

    useEffect(() => {
        // initialItems가 명시적으로 변경될 때만 내부 상태를 동기화합니다.
        // (예: 모달이 다른 주문으로 열릴 때)
        // 이 로직은 부모 컴포넌트에서 안정적인 참조를 제공하는 것을 전제로 합니다.
        setItems(initialItems);
    }, [initialItems]);
    
    useEffect(() => {
        // 아이템 목록이 변경될 때마다 부모 컴포넌트에 알립니다.
        if(onItemsChange) {
            onItemsChange(items);
        }
    }, [items, onItemsChange]);

    const addItem = useCallback((
        product: Product, 
        options: { isBoxUnit: boolean; isPromotion: boolean; quantity?: number; }
    ) => {
        const newUnit = options.isBoxUnit ? '박스' : '개';
        const newItem: OrderItem = { ...product, quantity: options.quantity ?? 1, unit: newUnit, isPromotion: options.isPromotion };
        
        setItems(prevItems => [...prevItems, newItem]);
    }, []);
    
    const updateItem = useCallback((barcode: string, newValues: Partial<OrderItem>) => {
        setItems(prev => prev.map(item => item.barcode === barcode ? { ...item, ...newValues } : item));
    }, []);

    const removeItem = useCallback((barcode: string) => {
        setItems(prev => prev.filter(item => item.barcode !== barcode));
    }, []);

    const totalAmount = useMemo(() => {
        return Math.floor(items.reduce((sum, item) => sum + (item.price * item.quantity), 0));
    }, [items]);

    const resetItems = useCallback((newItems: OrderItem[] = []) => {
        setItems(newItems);
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