import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Product, OrderItem } from '../types';
import ToggleSwitch from './ToggleSwitch';

interface AddItemModalProps {
    isOpen: boolean;
    product: Product | null;
    existingItem: OrderItem | null;
    onClose: () => void;
    onAdd: (details: { quantity: number; unit: '개' | '박스'; memo?: string }) => void;
    onNextScan?: () => void;
    trigger: 'scan' | 'search';
    initialSettings?: { unit: '개' | '박스' };
}

const AddItemModal: React.FC<AddItemModalProps> = ({ isOpen, product, existingItem, onClose, onAdd, onNextScan, trigger, initialSettings }) => {
    const [quantity, setQuantity] = useState(1);
    const [unit, setUnit] = useState<'개' | '박스'>('개');
    const [memo, setMemo] = useState('');

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
            
            setQuantity(prev => Math.max(1, prev + (delta * 5)));
            if (navigator.vibrate) {
                navigator.vibrate(20);
            }

            rapidChangeIntervalRef.current = window.setInterval(() => {
                setQuantity(prev => Math.max(1, prev + (delta * 5)));
                if (navigator.vibrate) {
                    navigator.vibrate(20);
                }
            }, 150);
        }, 500);
    }, [handlePressEnd]);
    
    const handleShortClick = useCallback((delta: number) => {
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
        if (isOpen && product) {
            setQuantity(1); // Always default to adding 1
            // Use initialSettings if available (continuous scan), otherwise use existingItem's settings, or default.
            setUnit(initialSettings?.unit ?? existingItem?.unit ?? '개');
            setMemo(existingItem?.memo || '');
        }
    }, [isOpen, product, existingItem, initialSettings]);

    if (!isOpen || !product) return null;

    const handleAdd = () => {
        onAdd({ quantity, unit, memo: memo.trim() });
    };

    const handleAddAndScan = () => {
        onAdd({ quantity, unit, memo: memo.trim() });
        if (onNextScan) {
            onNextScan();
        }
    };
    
    const isContinuousScan = trigger === 'scan' && onNextScan;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-4">
                    <h3 className="text-lg font-bold text-gray-800 text-center mb-1 truncate" title={product.name}>{product.name}</h3>
                    <p className="text-center text-gray-500 mb-4">{product.price.toLocaleString()}원</p>
                    {existingItem && (
                        <div className="text-center text-sm text-blue-600 bg-blue-50 p-2 rounded-lg mb-4">
                            이미 <span className="font-bold">{existingItem.quantity}{existingItem.unit}</span>가 담겨있습니다. 추가 수량을 입력하세요.
                        </div>
                    )}

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1 text-center">수량</label>
                            <div className="flex items-center justify-center space-x-2">
                                <button
                                    onPointerDown={() => handlePressStart(-1)}
                                    onPointerUp={handlePressEnd}
                                    onPointerLeave={handlePressEnd}
                                    onClick={() => handleShortClick(-1)}
                                    disabled={quantity <= 1}
                                    className="w-12 h-12 bg-gray-200 text-gray-700 text-3xl font-bold rounded-full disabled:opacity-50 transition"
                                    aria-label="수량 감소"
                                >
                                    -
                                </button>
                                <div className="w-24 h-12 text-center border-2 border-blue-500 bg-blue-50 rounded-lg text-gray-800 font-bold text-3xl flex items-center justify-center">
                                    {quantity}
                                </div>
                                <button
                                    onPointerDown={() => handlePressStart(1)}
                                    onPointerUp={handlePressEnd}
                                    onPointerLeave={handlePressEnd}
                                    onClick={() => handleShortClick(1)}
                                    className="w-12 h-12 bg-gray-200 text-gray-700 text-3xl font-bold rounded-full transition"
                                    aria-label="수량 증가"
                                >
                                    +
                                </button>
                            </div>
                        </div>

                        <div>
                            <label htmlFor="item-memo" className="block text-sm font-bold text-gray-700 mb-1 text-center">품목 메모 (선택)</label>
                            <input
                                id="item-memo"
                                type="text"
                                value={memo}
                                onChange={(e) => setMemo(e.target.value)}
                                placeholder="예: 월요일 도착"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                maxLength={50}
                            />
                        </div>
                        
                        <div className="flex justify-end items-center pt-3 border-t border-gray-200">
                            <ToggleSwitch
                                id="item-unit"
                                label="박스"
                                checked={unit === '박스'}
                                onChange={(checked) => setUnit(checked ? '박스' : '개')}
                                color="blue"
                            />
                        </div>
                    </div>
                </div>
                
                <div className="bg-gray-50 p-2">
                    {isContinuousScan ? (
                        <div className="flex flex-col gap-2">
                            <div className="grid grid-cols-2 gap-2">
                                <button onClick={onClose} className="px-4 py-3 rounded-lg font-semibold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition">
                                    스캔 종료
                                </button>
                                <button onClick={() => { if (onNextScan) { onClose(); onNextScan(); } }} className="px-4 py-3 rounded-lg font-semibold text-blue-600 bg-blue-100 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-400 transition">
                                    건너뛰기
                                </button>
                            </div>
                            <button onClick={handleAddAndScan} className="w-full text-white px-4 py-3 rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition">
                                추가 후 계속 스캔
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={onClose} className="px-4 py-2 rounded-lg font-semibold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition">
                                취소
                            </button>
                            <button onClick={handleAdd} className="text-white px-4 py-2 rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition">
                                {existingItem ? '수량 추가' : '품목 추가'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AddItemModal;