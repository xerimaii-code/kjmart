import React, { useState, useEffect, useRef, useMemo } from 'react';
import { OrderItem } from '../types';
import ToggleSwitch from './ToggleSwitch';
import { useAdjustForKeyboard } from '../hooks/useAdjustForKeyboard';
import { useDataState } from '../context/AppContext';
import { isSaleActive } from '../hooks/useOrderManager';

interface EditItemModalProps {
    isOpen: boolean;
    item: OrderItem | null;
    onClose: () => void;
    onSave: (details: { quantity: number; unit: '개' | '박스'; memo?: string; }) => void;
}

export default function EditItemModal({ isOpen, item, onSave, onClose }: EditItemModalProps) {
    const [quantity, setQuantity] = useState<number | string>(1);
    const [unit, setUnit] = useState<'개' | '박스'>('개');
    const [memo, setMemo] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const modalContentRef = useRef<HTMLDivElement>(null);
    const [isRendered, setIsRendered] = useState(false);

    const { products } = useDataState();
    const product = useMemo(() => {
        if (!item) return null;
        return products.find(p => p.barcode === item.barcode);
    }, [item, products]);

    useAdjustForKeyboard(modalContentRef, isOpen);
    
    const finalQuantity = Number(quantity);
    const isQuantityValid = !isNaN(finalQuantity);

    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => setIsRendered(true), 10);
            if (item) {
                setQuantity(item.quantity);
                setUnit(item.unit);
                setMemo(item.memo || '');
                setTimeout(() => {
                    inputRef.current?.focus();
                    inputRef.current?.select();
                }, 150);
            }
            return () => clearTimeout(timer);
        } else {
            setIsRendered(false);
        }
    }, [isOpen, item]);

    if (!isOpen || !item) return null;

    const handleSave = () => {
        if (!isQuantityValid) return;
        onSave({ quantity: finalQuantity, unit, memo: memo.trim() });
        onClose();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSave();
        }
    };
    
    const changeQuantity = (delta: number) => {
        setQuantity(q => {
            const currentQuantity = Number(q) || 0;
            const newQuantity = currentQuantity + delta;
            return newQuantity;
        });
    };

    const saleIsActive = product ? isSaleActive(product.saleEndDate) : false;
    const hasSalePrice = product ? !!product.salePrice : false;

    return (
        <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-60' : 'bg-transparent'}`} onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="editItemModalTitle">
            <div ref={modalContentRef} className={`bg-white rounded-2xl shadow-2xl w-full max-w-sm transition-all duration-300 ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`} onClick={e => e.stopPropagation()}>
                <div className="p-5">
                    <h3 id="editItemModalTitle" className="text-2xl font-bold text-gray-800 text-center mb-1 truncate" title={item.name}>{item.name}</h3>
                    {product ? (
                        <div className="text-center text-gray-600 mb-4 space-y-1">
                            <div className="text-lg flex items-baseline justify-center gap-x-1.5 flex-wrap">
                                <span className="text-gray-600 font-semibold">{product.costPrice?.toLocaleString()}원</span>
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
                                <div className="text-sm text-gray-500">
                                    <div className="flex items-center justify-center gap-x-3">
                                        {product.saleEndDate && (
                                            <span className={saleIsActive ? 'font-bold text-blue-600' : 'text-gray-400 text-xs'}>
                                                ~{product.saleEndDate}
                                            </span>
                                        )}
                                        {product.supplierName && (
                                            <span>({product.supplierName})</span>
                                        )}
                                    </div>
                                </div>
                            )}
                            <p className="font-bold text-blue-600 pt-1 text-lg">발주단가: {item.price.toLocaleString()}원</p>
                        </div>
                   ) : (
                        <p className="text-center text-lg text-gray-500 mb-4 font-bold text-blue-600">발주단가: {item.price.toLocaleString()}원</p>
                   )}
                    
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="edit-quantity" className="block text-sm font-medium text-gray-700 mb-2 text-center">수량 수정</label>
                            <div className="flex justify-center items-center gap-2">
                                <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(-1)} className="w-14 h-14 bg-gray-200 text-gray-700 text-3xl font-bold rounded-xl transition hover:bg-gray-300 active:scale-95 flex-shrink-0" aria-label="수량 감소">-</button>
                                <input
                                    ref={inputRef}
                                    id="edit-quantity"
                                    type="text"
                                    inputMode="numeric"
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
                                    onKeyDown={handleKeyDown}
                                    className="w-24 h-14 text-center border-2 border-blue-500 bg-blue-50 rounded-xl text-gray-800 font-bold text-3xl focus:outline-none"
                                    autoComplete="off"
                                />
                                <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(1)} className="w-14 h-14 bg-gray-200 text-gray-700 text-3xl font-bold rounded-xl transition hover:bg-gray-300 active:scale-95 flex-shrink-0" aria-label="수량 증가">+</button>
                            </div>
                        </div>

                        <div>
                            <label htmlFor="edit-item-memo" className="block text-sm font-medium text-gray-700 mb-1">품목 메모 (선택)</label>
                            <input
                                id="edit-item-memo" type="text" value={memo} onChange={(e) => setMemo(e.target.value)}
                                placeholder="예: 월요일 도착"
                                className="w-full px-3 py-2 border-2 border-gray-200 bg-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
                                maxLength={50}
                            />
                        </div>

                        <div className="flex justify-center pt-2">
                            <ToggleSwitch id="edit-item-unit" label="박스 단위" checked={unit === '박스'} onChange={(checked) => setUnit(checked ? '박스' : '개')} color="blue" />
                        </div>
                    </div>
                </div>

                <div className="bg-gray-50 px-3 py-3 rounded-b-2xl grid grid-cols-2 gap-3">
                    <button
                        onMouseDown={(e) => e.preventDefault()} onClick={onClose}
                        className="px-4 h-16 flex items-center justify-center rounded-xl font-bold text-gray-700 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition text-lg active:scale-95"
                    >
                        취소
                    </button>
                    <button
                        onMouseDown={(e) => e.preventDefault()} onClick={handleSave}
                        disabled={!isQuantityValid}
                        className="text-white px-4 h-16 flex items-center justify-center rounded-xl font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-lg active:scale-95 disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                        저장
                    </button>
                </div>
            </div>
        </div>
    );
}