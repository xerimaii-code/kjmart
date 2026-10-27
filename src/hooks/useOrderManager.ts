import { useState, useMemo, useCallback, useEffect } from 'react';
import { OrderItem, Product } from '../types';
import { formatProductDisplayName } from '../utils/mapper';

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
            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return false;
            return startDate <= today && endDate >= today;
        }
        
        if (isNaN(endDate.getTime())) return false;
        return endDate >= today;
    } catch {
        return false;
    }
};

// Helper to ensure item properties are consistent
const normalizeItems = (items: OrderItem[]): OrderItem[] => {
    if (!items) return [];
    return items.map(item => ({
        barcode: item.barcode,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        unit: item.unit,
        memo: item.memo || '',
        masterPrice: item.masterPrice,
        eventPrice: item.eventPrice,
        salePrice: item.salePrice,
        saleName: item.saleName,
        saleStartDate: item.saleStartDate,
        saleEndDate: item.saleEndDate,
        isModified: item.isModified
    }));
};

export const useOrderManager = ({ initialItems = [], onItemsChange }: UseOrderManagerProps) => {
    const [items, setItems] = useState<OrderItem[]>(() => normalizeItems(initialItems));

    useEffect(() => {
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
            const priceToUse = product.costPrice;
            // 발주 시 표현 형태('상품명 [규격]')를 로컬/서버 구분 없이 일관되게 유지
            const formattedName = formatProductDisplayName(product.name, product.spec);

            // [Snapshot] 현재 행사 중인 경우 해당 시점의 정보를 스냅샷으로 캡처
            const saleActive = isSaleActive(product.saleStartDate, product.saleEndDate);
            const snapshot = saleActive ? {
                masterPrice: product.costPrice,
                eventPrice: product.eventCostPrice,
                salePrice: product.salePrice,
                saleName: product.saleName,
                saleStartDate: product.saleStartDate,
                saleEndDate: product.saleEndDate
            } : {
                masterPrice: product.costPrice,
                eventPrice: undefined,
                salePrice: undefined,
                saleName: undefined,
                saleStartDate: undefined,
                saleEndDate: undefined
            };

            if (existingItemIndex > -1) {
                const updatedItems = [...prevItems];
                const existingItem = updatedItems[existingItemIndex];
                const newQuantity = existingItem.quantity + details.quantity;

                if (newQuantity <= 0) {
                    updatedItems.splice(existingItemIndex, 1);
                } else {
                    updatedItems[existingItemIndex] = {
                        ...existingItem,
                        name: formattedName || existingItem.name,
                        ...snapshot,
                        quantity: newQuantity,
                        unit: details.unit,
                        memo: details.memo || '',
                        price: priceToUse,
                    };
                }
                return normalizeItems(updatedItems);
            } else {
                if (details.quantity <= 0) {
                    return prevItems;
                }
                const newItem: OrderItem = {
                    barcode: product.barcode,
                    name: formattedName,
                    price: priceToUse,
                    quantity: details.quantity,
                    unit: details.unit,
                    memo: details.memo || '',
                    ...snapshot
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
