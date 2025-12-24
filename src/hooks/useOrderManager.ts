
import { useState, useMemo, useCallback, useEffect } from 'react';
import { OrderItem, Product } from '../types';

interface UseOrderManagerProps {
    initialItems?: OrderItem[];
    onItemsChange?: (items: OrderItem[]) => void;
}

// Helper to check if a sale is active for a product
export const isSaleActive = (saleStartDate?: string, saleEndDate?: string): boolean => {
    if (!saleEndDate) return false;
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endDate = new Date(saleEndDate);
        
        if (saleStartDate) {
            const startDate = new Date(saleStartDate);
            // Ensure dates are valid before comparing
            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return false;
            return startDate <= today && endDate >= today;
        }
        
        if (isNaN(endDate.getTime())) return false;
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
    // 초기 로드 시 한 번만 설정
    const [items, setItems] = useState<OrderItem[]>(() => normalizeItems(initialItems));

    // [중요 수정] props로 전달된 initialItems가 외부 요인(동기화 등)으로 변경되어도 
    // 현재 편집 중인 items 상태를 자동으로 덮어쓰지 않음. 
    // 이는 발주 상세에서 수정 중 데이터가 사라지는 현상을 방지함.

    useEffect(() => {
        // 내부 아이템 변경 시 부모 컴포넌트에 알림
        if(onItemsChange) {
            onItemsChange(items);
        }
    }, [items, onItemsChange]);
    
    const updateItem = useCallback((barcode: string, newValues: Partial<OrderItem>) => {
        setItems(prev => {
            if (newValues.quantity === 0) {
                return prev.filter(item => item.barcode !== barcode);
            }
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
                const newQuantity = existingItem.quantity + details.quantity;

                if (newQuantity <= 0) {
                    updatedItems.splice(existingItemIndex, 1);
                } else {
                    updatedItems[existingItemIndex] = {
                        ...existingItem,
                        quantity: newQuantity,
                        unit: details.unit,
                        memo: details.memo || '',
                        price: priceToUse, // 가격 변동 시 업데이트
                    };
                }
                return normalizeItems(updatedItems);
            } else {
                if (details.quantity <= 0) {
                    return prevItems;
                }
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

    const reorderItems = useCallback((startIndex: number, endIndex: number) => {
        setItems(prev => {
            const result = Array.from(prev);
            const [removed] = result.splice(startIndex, 1);
            result.splice(endIndex, 0, removed);
            return result;
        });
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
        reorderItems,
        resetItems,
        totalAmount,
    };
};
