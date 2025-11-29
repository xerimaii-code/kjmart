
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
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
    // An empty input should be considered invalid, not converted to 0.
    const isQuantityValid = quantity !== '' && !isNaN(finalQuantity);

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
        if (!isQuantityValid || !item) return;

        let quantityToSave = finalQuantity;

        // If user enters a negative number, treat it as a subtraction from the original quantity.
        if (finalQuantity < 0) {
            quantityToSave = item.quantity + finalQuantity;
        }

        // The final quantity cannot be negative. Default to 0, which will trigger removal.
        if (quantityToSave < 0) {
            quantityToSave = 0;
        }

        onSave({ quantity: quantityToSave, unit, memo: memo.trim() });
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

    const saleIsActive = product ? isSaleActive(product.saleStartDate, product.saleEndDate) : false;
    const hasSalePrice = product ? (product.salePrice !== undefined && product.salePrice !== null) : false;

    return createPortal(
        <div className={`fixed inset-0 z-[80] flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-50' : 'bg-transparent'}`} onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="editItemModalTitle">
            <div ref={modalContentRef} className={`bg-white rounded-xl shadow-lg w-full max-w-sm transition-[opacity,transform] duration-300 will-change-[opacity,transform] ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`} onClick={e => e.stopPropagation()}>
                <div className="p-5">
                    <h3 id="editItemModalTitle" className="text-xl font-bold text-gray-800 text-center mb-1 truncate" title={item.name}>{item.name}</h3>
                    {product && (
                        <div className="text-center text-sm text-gray-500 mb-2">
                            <span>{product.barcode}</span>
                            {product.stockQuantity !== undefined && (
                                <span className="ml-4 font-semibold text-teal-600">재고: {product.stockQuantity.toLocaleString()}</span>
                            )}
                        </div>
                    )}
                    {product ? (
                        <div className="text-center text-gray-600 mb-4 space-y-1">
                            <div className="text-base flex items-baseline justify-center gap-x-2 flex-wrap">
                                <span className="text-sm text-gray-500">현재가:</span>
                                <span className="font-semibold text-gray-800">{product.costPrice?.toLocaleString()}원</span>
                                <span className="text-gray-400 mx-1">/</span>
                                <span className={`font-semibold ${saleIsActive && hasSalePrice ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                                    {product.sellingPrice?.toLocaleString()}원
                                </span>
                                {hasSalePrice && (
                                    <span
                                        className={`ml-1 font-bold ${saleIsActive ? 'text-red-600' : 'text-gray-500'}`}
                                    >
                                        {product.salePrice?.toLocaleString()}원
                                    </span>
                                )}
                            </div>
                            {(product.saleStartDate || product.saleEndDate || product.supplierName) && (
                                <div className="text-xs text-gray-500">
                                    <div className="flex items-center justify-center gap-x-3">
                                        {(product.saleStartDate || product.saleEndDate) && (
                                            <span className={saleIsActive ? 'font-semibold text-blue-600' : 'text-gray-400'}>
                                                {product.saleStartDate ? `${product.saleStartDate}~` : `~`}{product.saleEndDate}
                                            </span>
                                        )}
                                        {product.supplierName && (
                                            <span>({product.supplierName})</span>
                                        )}
                                    </div>
                                </div>
                            )}
                            <p className="font-bold text-blue-600 pt-1 text-base">발주단가: {item.price.toLocaleString()}원</p>
                        </div>
                   ) : (
                        <p className="text-center text-base text-gray-500 mb-4 font-bold text-blue-600">발주단가: {item.price.toLocaleString()}원</p>
                   )}
                    
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="edit-quantity" className="block text-sm font-medium text-gray-700 mb-2 text-center">수량 수정</label>
                            <div className="flex justify-center items-center gap-2">
                                <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(-1)} className="w-12 h-12 bg-gray-100 text-gray-600 text-2xl font-bold rounded-lg transition hover:bg-gray-200 active:scale-95 flex-shrink-0" aria-label="수량 감소">-</button>
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
                                    className="w-20 h-12 text-center border border-gray-300 bg-white rounded-lg text-gray-800 font-bold text-2xl focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                    autoComplete="off"
                                />
                                <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(1)} className="w-12 h-12 bg-gray-100 text-gray-600 text-2xl font-bold rounded-lg transition hover:bg-gray-200 active:scale-95 flex-shrink-0" aria-label="수량 증가">+</button>
                            </div>
                        </div>

                        <div>
                            <label htmlFor="edit-item-memo" className="block text-sm font-medium text-gray-700 mb-1">품목 메모 (선택)</label>
                            <input
                                id="edit-item-memo" type="text" value={memo} onChange={(e) => setMemo(e.target.value)}
                                placeholder="예: 행사"
                                className="w-full px-3 py-2 border border-gray-300 bg-white rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-base"
                                maxLength={50}
                            />
                        </div>

                        <div className="flex justify-center pt-2">
                            <ToggleSwitch id="edit-item-unit" label="박스 단위" checked={unit === '박스'} onChange={(checked) => setUnit(checked ? '박스' : '개')} color="blue" />
                        </div>
                    </div>
                </div>

                <div className="bg-gray-50 px-4 py-3 rounded-b-xl grid grid-cols-2 gap-3">
                    <button
                        onMouseDown={(e) => e.preventDefault()} onClick={onClose}
                        className="h-10 flex items-center justify-center rounded-lg font-semibold text-gray-700 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition text-base active:scale-95"
                    >
                        취소
                    </button>
                    <button
                        onMouseDown={(e) => e.preventDefault()} onClick={handleSave}
                        disabled={!isQuantityValid}
                        className="h-10 flex items-center justify-center rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-base active:scale-95 disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                        저장
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
