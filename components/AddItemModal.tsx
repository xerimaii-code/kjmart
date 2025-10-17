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
    const [quantity, setQuantity] = useState<number | string>(1);
    const [unit, setUnit] = useState<'개' | '박스'>('개');
    const [memo, setMemo] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const modalContentRef = useRef<HTMLDivElement>(null);
    const [isRendered, setIsRendered] = useState(false);

    useAdjustForKeyboard(modalContentRef, isOpen);

    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => setIsRendered(true), 10);
            
            if (product) {
                setQuantity(1);
                setUnit(initialSettings?.unit ?? existingItem?.unit ?? '개');
                setMemo(existingItem?.memo || '');
                
                if (trigger !== 'scan') {
                    setTimeout(() => {
                        inputRef.current?.focus();
                        inputRef.current?.select();
                    }, 150);
                }
            }

            return () => clearTimeout(timer);
        } else {
            setIsRendered(false);
        }
    }, [isOpen, product, existingItem, initialSettings, trigger]);

    if (!isOpen || !product) return null;

    const handleAdd = () => {
        const finalQuantity = Number(quantity);
        if (isNaN(finalQuantity)) return;
        onAdd({ quantity: finalQuantity, unit, memo: memo.trim() });
    };

    const handleAddAndScan = () => {
        const finalQuantity = Number(quantity);
        if (isNaN(finalQuantity)) return;
        onAdd({ quantity: finalQuantity, unit, memo: memo.trim() });
        if (onNextScan) onNextScan();
    };
    
    const isContinuousScan = trigger === 'scan' && onNextScan;
    const changeQuantity = (delta: number) => setQuantity(q => (Number(q) || 0) + delta);

    return (
        <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-60' : 'bg-transparent'}`} onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="addItemModalTitle">
            <div ref={modalContentRef} className={`bg-white rounded-2xl shadow-2xl w-full max-w-sm transition-all duration-300 ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`} onClick={e => e.stopPropagation()}>
                <div className="p-5">
                    <h3 id="addItemModalTitle" className="text-xl font-bold text-gray-800 text-center mb-1 truncate" title={product.name}>{product.name}</h3>
                    <p className="text-center text-sm text-gray-500 mb-4">{product.price.toLocaleString()}원</p>
                    {existingItem && (
                        <div className="text-center text-sm font-semibold text-blue-700 bg-blue-100 p-2.5 rounded-lg mb-4">
                            이미 <span className="font-bold">{existingItem.quantity}{existingItem.unit}</span>가 담겨있습니다. 추가 수량을 입력하세요.
                        </div>
                    )}

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2 text-center">수량</label>
                            <div className="flex items-center justify-center space-x-2">
                                <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(-1)} className="w-14 h-14 bg-gray-200 text-gray-700 text-3xl font-bold rounded-xl transition hover:bg-gray-300 active:scale-95 flex-shrink-0" aria-label="수량 감소">-</button>
                                <input
                                    ref={inputRef}
                                    type="text" inputMode="numeric" pattern="-?[0-9]*"
                                    value={quantity}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        if (value === '' || value === '-') {
                                            setQuantity(value);
                                        } else {
                                            const num = parseInt(value, 10);
                                            if (!isNaN(num)) {
                                                setQuantity(num);
                                            }
                                        }
                                    }}
                                    className="w-24 h-14 text-center border-2 border-blue-500 bg-blue-50 rounded-xl text-gray-800 font-bold text-3xl focus:outline-none"
                                />
                                <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(1)} className="w-14 h-14 bg-gray-200 text-gray-700 text-3xl font-bold rounded-xl transition hover:bg-gray-300 active:scale-95 flex-shrink-0" aria-label="수량 증가">+</button>
                            </div>
                        </div>
                        
                        <div>
                            <label htmlFor="item-memo" className="block text-sm font-medium text-gray-700 mb-1">품목 메모 (선택)</label>
                            <input
                                id="item-memo" type="text" value={memo} onChange={(e) => setMemo(e.target.value)}
                                placeholder="예: 월요일 도착"
                                className="w-full px-3 py-2 border-2 border-gray-200 bg-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
                                maxLength={50}
                            />
                        </div>

                        <div className="flex justify-center pt-2">
                            <ToggleSwitch id="item-unit" label="박스 단위" checked={unit === '박스'} onChange={(checked) => setUnit(checked ? '박스' : '개')} color="blue" />
                        </div>
                    </div>
                </div>
                
                <div className="bg-gray-50 px-3 py-3 rounded-b-2xl">
                    {isContinuousScan ? (
                        <div className="space-y-2">
                             <button onMouseDown={(e) => e.preventDefault()} onClick={handleAddAndScan} className="w-full text-white px-4 h-16 flex items-center justify-center rounded-xl font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-lg active:scale-95">추가 후 계속 스캔</button>
                            <div className="grid grid-cols-2 gap-2">
                                <button onMouseDown={(e) => e.preventDefault()} onClick={() => { if (onNextScan) { onClose(); onNextScan(); } }} className="px-4 h-12 flex items-center justify-center rounded-lg font-semibold text-blue-600 bg-blue-100 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-400 transition text-sm active:scale-95">건너뛰기</button>
                                <button onMouseDown={(e) => e.preventDefault()} onClick={onClose} className="px-4 h-12 flex items-center justify-center rounded-lg font-semibold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition text-sm active:scale-95">스캔 종료</button>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-3">
                            <button onMouseDown={(e) => e.preventDefault()} onClick={onClose} className="px-4 h-16 flex items-center justify-center rounded-xl font-bold text-gray-700 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition text-lg active:scale-95">취소</button>
                            <button onMouseDown={(e) => e.preventDefault()} onClick={handleAdd} className="text-white px-4 h-16 flex items-center justify-center rounded-xl font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-lg active:scale-95">{existingItem ? '수량 추가' : '품목 추가'}</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AddItemModal;
