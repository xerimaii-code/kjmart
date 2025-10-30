import React, { useState, useEffect, useRef } from 'react';
import { Product, OrderItem } from '../types';
import ToggleSwitch from './ToggleSwitch';
import { useAdjustForKeyboard } from '../hooks/useAdjustForKeyboard';
import { isSaleActive } from '../hooks/useOrderManager';

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

    const finalQuantity = Number(quantity);
    const isQuantityValid = !isNaN(finalQuantity) && finalQuantity !== 0;

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
        if (!isQuantityValid) return;
        onAdd({ quantity: finalQuantity, unit, memo: memo.trim() });
        onClose();
    };

    const handleAddAndScan = () => {
        if (!isQuantityValid) return;
        onAdd({ quantity: finalQuantity, unit, memo: memo.trim() });
        onClose();
        if (onNextScan) {
            onNextScan();
        }
    };
    
    const isContinuousScan = trigger === 'scan' && onNextScan;
    
    const changeQuantity = (delta: number) => {
        setQuantity(q => {
            const currentQuantity = Number(q) || 0;
            const newQuantity = currentQuantity + delta;
            return newQuantity;
        });
    };
    
    const saleIsActive = isSaleActive(product.saleEndDate);
    const hasSalePrice = !!product.salePrice;

    return (
        <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-50' : 'bg-transparent'}`} onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="addItemModalTitle">
            <div ref={modalContentRef} className={`bg-white rounded-xl shadow-lg w-full max-w-sm transition-all duration-300 ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`} onClick={e => e.stopPropagation()}>
                <div className="p-5">
                    <h3 id="addItemModalTitle" className="text-xl font-bold text-gray-800 text-center mb-1 truncate" title={product.name}>{product.name}</h3>
                    <div className="text-center text-gray-600 mb-4 space-y-1">
                        <div className="text-base flex items-baseline justify-center gap-x-1.5 flex-wrap">
                            <span className="text-gray-600 font-semibold">{product.costPrice.toLocaleString()}원</span>
                            <span className="text-gray-400">/</span>
                            <span className={`font-semibold ${saleIsActive && hasSalePrice ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                                {product.sellingPrice?.toLocaleString()}원
                            </span>
                            {hasSalePrice && (
                                <span 
                                    className={`${saleIsActive ? 'text-red-600 font-bold' : 'text-gray-500'}`}
                                    style={!saleIsActive ? { fontSize: '80%' } : {}}
                                >
                                    {product.salePrice}원
                                </span>
                            )}
                        </div>
                        {(product.saleEndDate || product.supplierName) && (
                            <div className="text-xs text-gray-500">
                                <div className="flex items-center justify-center gap-x-3">
                                    {product.saleEndDate && (
                                        <span className={saleIsActive ? 'font-semibold text-blue-600' : 'text-gray-400'}>
                                            ~{product.saleEndDate}
                                        </span>
                                    )}
                                    {product.supplierName && (
                                        <span>({product.supplierName})</span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                    {existingItem && (
                        <div className="text-center text-sm font-semibold text-blue-700 bg-blue-100 p-2 rounded-md mb-4">
                            이미 <span className="font-bold">{existingItem.quantity}{existingItem.unit}</span>가 담겨있습니다. 추가 수량을 입력하세요.
                        </div>
                    )}

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2 text-center">수량</label>
                            <div className="flex justify-center items-center gap-2">
                                <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(-1)} className="w-12 h-12 bg-gray-100 text-gray-600 text-2xl font-bold rounded-lg transition hover:bg-gray-200 active:scale-95 flex-shrink-0" aria-label="수량 감소">-</button>
                                <input
                                    ref={inputRef}
                                    type="text" inputMode="numeric"
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
                                    className="w-20 h-12 text-center border border-gray-300 bg-white rounded-lg text-gray-800 font-bold text-2xl focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                />
                                <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(1)} className="w-12 h-12 bg-gray-100 text-gray-600 text-2xl font-bold rounded-lg transition hover:bg-gray-200 active:scale-95 flex-shrink-0" aria-label="수량 증가">+</button>
                            </div>
                        </div>
                        
                        <div>
                            <label htmlFor="item-memo" className="block text-sm font-medium text-gray-700 mb-1">품목 메모 (선택)</label>
                            <input
                                id="item-memo" type="text" value={memo} onChange={(e) => setMemo(e.target.value)}
                                placeholder="예: 월요일 도착"
                                className="w-full px-3 py-2 border border-gray-300 bg-white rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-base"
                                maxLength={50}
                            />
                        </div>

                        <div className="flex justify-center pt-2">
                            <ToggleSwitch id="item-unit" label="박스 단위" checked={unit === '박스'} onChange={(checked) => setUnit(checked ? '박스' : '개')} color="blue" />
                        </div>
                    </div>
                </div>
                
                <div className="bg-gray-50 px-4 py-3 rounded-b-xl">
                    {isContinuousScan ? (
                        <div className="space-y-2">
                             <button onMouseDown={(e) => e.preventDefault()} onClick={handleAddAndScan} disabled={!isQuantityValid} className="w-full text-white px-4 h-12 flex items-center justify-center rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-base active:scale-95 disabled:bg-gray-400 disabled:cursor-not-allowed">추가 후 계속 스캔</button>
                            <div className="grid grid-cols-3 gap-2">
                                <button onMouseDown={(e) => e.preventDefault()} onClick={onClose} className="px-2 h-10 flex items-center justify-center rounded-md font-semibold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition text-sm active:scale-95">스캔 종료</button>
                                <button onMouseDown={(e) => e.preventDefault()} onClick={handleAdd} disabled={!isQuantityValid} className="px-2 h-10 flex items-center justify-center rounded-md font-semibold text-blue-600 bg-blue-100 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-400 transition text-sm active:scale-95 text-center disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">추가 후 종료</button>
                                <button onMouseDown={(e) => e.preventDefault()} onClick={() => { if (onNextScan) { onClose(); onNextScan(); } }} className="px-2 h-10 flex items-center justify-center rounded-md font-semibold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition text-sm active:scale-95">건너뛰기</button>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-3">
                            <button onMouseDown={(e) => e.preventDefault()} onClick={onClose} className="px-4 h-12 flex items-center justify-center rounded-lg font-semibold text-gray-700 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition text-base active:scale-95">취소</button>
                            <button onMouseDown={(e) => e.preventDefault()} onClick={handleAdd} disabled={!isQuantityValid} className="text-white px-4 h-12 flex items-center justify-center rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-base active:scale-95 disabled:bg-gray-400 disabled:cursor-not-allowed">{existingItem ? '수량 추가' : '품목 추가'}</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AddItemModal;