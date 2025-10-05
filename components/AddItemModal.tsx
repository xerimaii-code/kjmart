import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Product, OrderItem } from '../types';
import ToggleSwitch from './ToggleSwitch';

interface AddItemModalProps {
    isOpen: boolean;
    product: Product | null;
    existingItem: OrderItem | null;
    onClose: () => void;
    onAdd: (details: { quantity: number; unit: '개' | '박스'; isPromotion: boolean }) => void;
    onNextScan?: () => void;
    trigger: 'scan' | 'search';
    initialSettings?: { unit: '개' | '박스'; isPromotion: boolean };
}

const AddItemModal: React.FC<AddItemModalProps> = ({ isOpen, product, existingItem, onClose, onAdd, onNextScan, trigger, initialSettings }) => {
    const [quantity, setQuantity] = useState(1);
    const [unit, setUnit] = useState<'개' | '박스'>('개');
    const [isPromotion, setIsPromotion] = useState(false);

    const longPressTimeoutRef = useRef<number | null>(null);
    const rapidChangeIntervalRef = useRef<number | null>(null);
    const isLongPress = useRef(false);

    const handlePressEnd = useCallback(() => {
        if (longPressTimeoutRef.current) {
            clearTimeout(longPressTimeoutRef.current);
            longPressTimeoutRef.current = null;
        }
        if (rapidChangeIntervalRef.current) {
            clearInterval(rapidChangeIntervalRef.current);
            rapidChangeIntervalRef.current = null;
        }
    }, []);

    const handlePressStart = useCallback((delta: number) => {
        handlePressEnd();
        isLongPress.current = false;

        longPressTimeoutRef.current = window.setTimeout(() => {
            isLongPress.current = true;
            
            // Initial rapid change
            setQuantity(prev => Math.max(1, prev + (delta * 10)));
            if (navigator.vibrate) {
                navigator.vibrate(20);
            }

            // Subsequent rapid changes
            rapidChangeIntervalRef.current = window.setInterval(() => {
                setQuantity(prev => Math.max(1, prev + (delta * 10)));
                if (navigator.vibrate) {
                    navigator.vibrate(20);
                }
            }, 500);
        }, 500);
    }, [handlePressEnd]);
    
    const handleShortClick = useCallback((delta: number) => {
        // The click event fires after pressEnd. We check the ref to see if a long press occurred.
        if (!isLongPress.current) {
            setQuantity(prev => Math.max(1, prev + delta));
        }
    }, []);


    // Cleanup timers when the modal closes or component unmounts
    useEffect(() => {
        return () => {
            handlePressEnd();
        };
    }, [handlePressEnd]);

    useEffect(() => {
        // Reset state when a new product is passed in or modal opens
        if (product) {
            setQuantity(1); // Always default to adding 1
            // Use initialSettings if available (continuous scan), otherwise use existingItem's settings, or default.
            setUnit(initialSettings?.unit ?? existingItem?.unit ?? '개');
            setIsPromotion(initialSettings?.isPromotion ?? (existingItem?.isPromotion || false));
        }
    }, [product, existingItem, initialSettings]);

    if (!isOpen || !product) return null;

    const handleAddAndClose = () => {
        onAdd({ quantity, unit, isPromotion });
        onClose();
    };

    const handleAddAndNextScan = () => {
        onAdd({ quantity, unit, isPromotion });
        onClose(); // Close current modal before opening scanner
        if (onNextScan) {
            onNextScan();
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                    <h3 className="text-xl font-bold text-gray-800 text-center mb-2">{product.name}</h3>
                    <p className="text-center text-gray-500 mb-4">{product.price.toLocaleString()}원</p>
                    
                    {/* Duplicate item warning */}
                    {existingItem && (
                        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-lg text-center mb-6 shadow-inner">
                            <p className="font-bold">이미 추가된 상품입니다.</p>
                            <p className="text-sm mt-1">기존 수량: <span className="font-semibold">{existingItem.quantity} {existingItem.unit}</span></p>
                        </div>
                    )}
                    
                    <div className="space-y-6">
                        {/* Quantity Control */}
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2 text-center">
                                {existingItem ? '추가할 수량' : '수량'}
                            </label>
                            <div className="flex items-center justify-center space-x-4">
                                <button 
                                    onClick={() => handleShortClick(-1)}
                                    onMouseDown={() => handlePressStart(-1)}
                                    onMouseUp={handlePressEnd}
                                    onMouseLeave={handlePressEnd}
                                    onTouchStart={(e) => { e.preventDefault(); handlePressStart(-1); }}
                                    onTouchEnd={handlePressEnd}
                                    onContextMenu={(e) => e.preventDefault()}
                                    className="bg-gray-200 hover:bg-gray-300 border border-gray-300 w-12 h-12 rounded-full font-bold text-2xl text-gray-600 flex items-center justify-center transition-colors select-none"
                                >-</button>
                                <input 
                                    type="number" 
                                    value={quantity}
                                    onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                                    className="w-24 h-16 text-center border-2 border-blue-500 bg-blue-50 rounded-lg text-gray-800 font-bold text-3xl focus:outline-none"
                                    autoComplete="off"
                                />
                                <button
                                    onClick={() => handleShortClick(1)}
                                    onMouseDown={() => handlePressStart(1)}
                                    onMouseUp={handlePressEnd}
                                    onMouseLeave={handlePressEnd}
                                    onTouchStart={(e) => { e.preventDefault(); handlePressStart(1); }}
                                    onTouchEnd={handlePressEnd}
                                    onContextMenu={(e) => e.preventDefault()}
                                    className="bg-gray-200 hover:bg-gray-300 border border-gray-300 w-12 h-12 rounded-full font-bold text-2xl text-gray-600 flex items-center justify-center transition-colors select-none"
                                >+</button>
                            </div>
                        </div>

                        {/* Toggles */}
                        <div className="flex justify-end items-center pt-4 border-t border-gray-200 space-x-4">
                            <ToggleSwitch
                                id="add-item-promotion"
                                label="행사"
                                checked={isPromotion}
                                onChange={setIsPromotion}
                                color="red"
                            />
                            <ToggleSwitch
                                id="add-item-unit"
                                label="박스"
                                checked={unit === '박스'}
                                onChange={(checked) => setUnit(checked ? '박스' : '개')}
                                color="blue"
                            />
                        </div>
                    </div>
                </div>

                <div className="bg-gray-50 p-3">
                    {trigger === 'scan' ? (
                        <div className="grid grid-cols-3 gap-2">
                             <button
                                onClick={onClose}
                                className="px-4 py-3 rounded-lg font-semibold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition text-sm"
                            >
                                취소
                            </button>
                             <button
                                onClick={handleAddAndClose}
                                className="text-white px-4 py-3 rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-sm"
                            >
                                추가 후 닫기
                            </button>
                            <button
                                onClick={handleAddAndNextScan}
                                className="text-white px-4 py-3 rounded-lg font-bold bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 transition text-sm"
                            >
                                추가 후 스캔
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={onClose}
                                className="px-6 py-3 rounded-lg font-semibold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition"
                            >
                                취소
                            </button>
                            <button
                                onClick={handleAddAndClose}
                                className="text-white px-6 py-3 rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                            >
                                {existingItem ? '수량 추가' : '상품 추가'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AddItemModal;