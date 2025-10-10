import React, { useState, useEffect, useRef } from 'react';
import { Product, OrderItem } from '../types';
import ToggleSwitch from './ToggleSwitch';
import { useAdjustForKeyboard } from '../hooks/useAdjustForKeyboard';

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
    // Use `any` for quantity state to allow for intermediate string values like '-'
    const [quantity, setQuantity] = useState<number | string>(1);
    const [unit, setUnit] = useState<'개' | '박스'>('개');
    const [memo, setMemo] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const modalContentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Reset state when a new product is passed in or modal opens
        if (isOpen && product) {
            setQuantity(1); // Always default to adding 1
            setUnit(initialSettings?.unit ?? existingItem?.unit ?? '개');
            setMemo(existingItem?.memo || '');
            
            // As per request, focus the input unless triggered by a scan to allow for a faster workflow.
            if (trigger !== 'scan') {
                setTimeout(() => {
                    inputRef.current?.focus();
                    inputRef.current?.select();
                }, 150); // Increased delay for robustness on slower devices
            }
        }
    }, [isOpen, product, existingItem, initialSettings, trigger]);

    useAdjustForKeyboard(modalContentRef, isOpen);

    if (!isOpen || !product) return null;

    const handleAdd = () => {
        const finalQuantity = Number(quantity);
        if (isNaN(finalQuantity) || finalQuantity === 0) {
            return;
        }
        onAdd({ quantity: finalQuantity, unit, memo: memo.trim() });
    };

    const handleAddAndScan = () => {
        const finalQuantity = Number(quantity);
         if (isNaN(finalQuantity) || finalQuantity === 0) {
            return;
        }
        onAdd({ quantity: finalQuantity, unit, memo: memo.trim() });
        if (onNextScan) {
            onNextScan();
        }
    };
    
    const isContinuousScan = trigger === 'scan' && onNextScan;

    const changeQuantity = (delta: number) => {
        setQuantity(q => (Number(q) || 0) + delta);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="addItemModalTitle">
            <div ref={modalContentRef} className="bg-white rounded-xl shadow-2xl w-full max-w-sm transition-transform duration-200" onClick={e => e.stopPropagation()}>
                <div className="p-4">
                    <h3 id="addItemModalTitle" className="text-lg font-bold text-gray-800 text-center mb-1 truncate" title={product.name}>{product.name}</h3>
                    <p className="text-center text-sm text-gray-500 mb-3">{product.price.toLocaleString()}원</p>
                    {existingItem && (
                        <div className="text-center text-xs text-blue-600 bg-blue-50 p-2 rounded-md mb-3">
                            이미 <span className="font-bold">{existingItem.quantity}{existingItem.unit}</span>가 담겨있습니다. 추가 수량을 입력하세요.
                        </div>
                    )}

                    <div className="space-y-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 text-center">수량</label>
                            <div className="flex items-center justify-center space-x-2">
                                <button onClick={() => changeQuantity(-1)} className="w-10 h-10 bg-gray-200 text-gray-700 text-2xl font-bold rounded-full transition hover:bg-gray-300 active:scale-95 flex-shrink-0" aria-label="수량 감소">-</button>
                                <input
                                    ref={inputRef}
                                    type="number"
                                    value={quantity}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        if (value === '' || value === '-') {
                                            setQuantity(value);
                                        } else {
                                            const num = parseInt(value, 10);
                                            if (!isNaN(num)) setQuantity(num);
                                        }
                                    }}
                                    className="w-20 h-10 text-center border-2 border-blue-500 bg-blue-50 rounded-lg text-gray-800 font-bold text-2xl focus:outline-none"
                                />
                                <button onClick={() => changeQuantity(1)} className="w-10 h-10 bg-gray-200 text-gray-700 text-2xl font-bold rounded-full transition hover:bg-gray-300 active:scale-95 flex-shrink-0" aria-label="수량 증가">+</button>
                            </div>
                        </div>
                        
                        <div>
                            <label htmlFor="item-memo" className="block text-sm font-medium text-gray-700 mb-1">품목 메모 (선택)</label>
                            <input
                                id="item-memo"
                                type="text"
                                value={memo}
                                onChange={(e) => setMemo(e.target.value)}
                                placeholder="예: 월요일 도착"
                                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-base"
                                maxLength={50}
                            />
                        </div>

                        <div className="flex justify-center pt-1">
                            <ToggleSwitch
                                id="item-unit"
                                label="박스 단위"
                                checked={unit === '박스'}
                                onChange={(checked) => setUnit(checked ? '박스' : '개')}
                                color="blue"
                            />
                        </div>
                    </div>
                </div>
                
                <div className="bg-gray-50 px-4 py-2.5 rounded-b-xl">
                    {isContinuousScan ? (
                        <div className="space-y-2">
                             <button onClick={handleAddAndScan} className="w-full text-white px-4 h-12 flex items-center justify-center rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-base">
                                추가 후 계속 스캔
                            </button>
                            <div className="grid grid-cols-2 gap-2">
                                <button onClick={() => { if (onNextScan) { onClose(); onNextScan(); } }} className="px-4 h-10 flex items-center justify-center rounded-lg font-semibold text-blue-600 bg-blue-100 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-400 transition text-sm">
                                    건너뛰기
                                </button>
                                <button onClick={onClose} className="px-4 h-10 flex items-center justify-center rounded-lg font-semibold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition text-sm">
                                    스캔 종료
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-3">
                            <button onClick={onClose} className="px-4 h-12 flex items-center justify-center rounded-lg font-semibold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition text-base">
                                취소
                            </button>
                            <button onClick={handleAdd} className="text-white px-4 h-12 flex items-center justify-center rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-base">
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