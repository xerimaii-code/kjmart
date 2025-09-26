import { useState, useMemo, useEffect } from 'react';
import { Product, OrderItem } from '../types';

export const useOrderItems = (initialItems: OrderItem[] = []) => {
  const [items, setItems] = useState<OrderItem[]>(() => JSON.parse(JSON.stringify(initialItems)));
  const [isDirty, setIsDirty] = useState(false);

  const total = useMemo(() => items.reduce((sum, item) => sum + item.price * item.quantity, 0), [items]);
  
  useEffect(() => {
    const initialItemsString = JSON.stringify(initialItems);
    const currentItemsString = JSON.stringify(items);
    setIsDirty(initialItemsString !== currentItemsString);
  }, [items, initialItems]);

  const addProduct = (product: Product, options: { isPromotion: boolean; unit: '개' | '박스' }) => {
    setItems(prevItems => {
        const existingItemIndex = prevItems.findIndex(item => 
            item.barcode === product.barcode && 
            item.unit === options.unit && 
            item.isPromotion === options.isPromotion
        );
        if (existingItemIndex > -1) {
            const newItems = [...prevItems];
            newItems[existingItemIndex].quantity += 1;
            return newItems;
        } else {
            return [...prevItems, { ...product, quantity: 1, unit: options.unit, isPromotion: options.isPromotion }];
        }
    });
  };

  const updateItem = (barcode: string, unit: '개' | '박스', isPromotion: boolean | undefined, updateFn: (item: OrderItem) => OrderItem) => {
    setItems(prevItems => prevItems.map(item => 
      (item.barcode === barcode && item.unit === unit && item.isPromotion === isPromotion) ? updateFn(item) : item
    ));
  };
  
  const removeItem = (barcode: string, unit: '개' | '박스', isPromotion: boolean | undefined) => {
    setItems(prevItems => prevItems.filter(item => !(item.barcode === barcode && item.unit === unit && item.isPromotion === isPromotion)));
  };

  const resetItems = () => {
    setItems([]);
  };

  return {
    items,
    addProduct,
    updateItem,
    removeItem,
    total,
    isDirty,
    resetItems
  };
};
