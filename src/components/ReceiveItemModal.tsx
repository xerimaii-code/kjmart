
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Product, ReceivingItem } from '../types';
import { useAdjustForKeyboard } from '../hooks/useAdjustForKeyboard';
import { ReturnBoxIcon } from './Icons';

interface ReceiveItemModalProps {
    isOpen: boolean;
    itemInfo: (Product & { isNew?: false }) | { barcode: string, isNew: true } | null;
    onClose: () => void;
    onAdd: (item: Omit<ReceivingItem, 'uniqueId'>) => void;
}

const formatInteger = (value: number | string): string => {
    if (value === '' || value === undefined || value === null) return '';
    const num = String(value).replace(/[^0-9]/g, '');
    return num ? Number(num).toLocaleString() : '';
};


const ReceiveItemModal: React.FC<ReceiveItemModalProps> = ({ isOpen, itemInfo, onClose, onAdd }) => {
    const [quantity, setQuantity] = useState<number | string>(1);
    const [isReturn, setIsReturn] = useState(false);
    
    // State for new items
    const [name, setName] = useState('');
    const [costPrice, setCostPrice] = useState<number | string>('');
    const [sellingPrice, setSellingPrice] = useState<number | string>('');

    const quantityInputRef = useRef<HTMLInputElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const modalContentRef = useRef<HTMLDivElement>(null);
    const [isRendered, setIsRendered] = useState(false);

    useAdjustForKeyboard(modalContentRef, isOpen);

    const isNewItem = itemInfo?.isNew === true;

    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => setIsRendered(true), 10);
            if (itemInfo) {
                setQuantity(1);
                setIsReturn(false);

                if (itemInfo.isNew) {
                    setName('');
                    setCostPrice('');
                    setSellingPrice('');
                    setTimeout(() => nameInputRef.current?.focus(), 150);
                } else {
                    setTimeout(() => {
                        quantityInputRef.current?.focus();
                        quantityInputRef.current?.select();
                    }, 150);
                }
            }
            return () => clearTimeout(timer);
        } else {
            setIsRendered(false);
        }
    }, [isOpen, itemInfo]);

    if (!isOpen || !itemInfo) return null;
    
    const finalQuantity = Number(quantity);
    const isFormValid = isNewItem
        ? name.trim() !== '' && String(costPrice).trim() !== '' && String(sellingPrice).trim() !== ''
        : true;
    const isQuantityValid = !isNaN(finalQuantity) && finalQuantity !== 0 && isFormValid;

    const handleAdd = () => {
        if (!isQuantityValid) return;
        
        const itemData: Omit<ReceivingItem, 'uniqueId'> = {
            barcode: itemInfo.barcode,
            name: isNewItem ? name.trim() : (itemInfo as Product).name,
            costPrice: isNewItem ? Number(String(costPrice).replace(/,/g, '')) : (itemInfo as Product).costPrice,
            sellingPrice: isNewItem ? Number(String(sellingPrice).replace(/,/g, '')) : (itemInfo as Product).sellingPrice,
            quantity: isReturn ? -finalQuantity : finalQuantity,
        };
        onAdd(itemData);
        onClose();
    };
    
    const toggleReturn = () => setIsReturn(prev => !prev);

    const changeQuantity = (delta: number) => {
        setQuantity(q => Math.max(1, (Number(q) || 0) + delta));
    };

    return createPortal(
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-50' : 'bg-transparent'}`} onClick={onClose} role="dialog" aria-modal="true">
            <div ref={modalContentRef} className={`bg-white rounded-xl shadow-lg w-full max-w-sm transition-[opacity,transform] duration-300 will-change-[opacity,transform] ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`} onClick={e => e.stopPropagation()}>
                <div className="p-5">
                    <h3 className="text-xl font-bold text-gray-800 truncate text-center" title={isNewItem ? '신규 상품 등록' : (itemInfo as Product).name}>
                        {isNewItem ? '신규 상품 등록' : (itemInfo as Product).name}
                    </h3>
                    <p className="text-center text-sm text-gray-500 mb-4">{itemInfo.barcode}</p>
                    
                    {isNewItem ? (
                        <div className="space-y-3 mb-6">
                            <div>
                                <label htmlFor="new-item-name" className="block text-xs font-bold text-gray-600 mb-1">상품명</label>
                                <input id="new-item-name" ref={nameInputRef} type="text" value={name} onChange={e => setName(e.target.value)} className="w-full h-10 px-3 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="new-item-cost" className="block text-xs font-bold text-gray-600 mb-1">매입가</label>
                                    <input id="new-item-cost" type="text" inputMode="numeric" value={formatInteger(costPrice)} onChange={e => setCostPrice(e.target.value)} className="w-full h-10 px-3 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-right font-mono" />
                                </div>
                                <div>
                                    <label htmlFor="new-item-selling" className="block text-xs font-bold text-gray-600 mb-1">판매가</label>
                                    <input id="new-item-selling" type="text" inputMode="numeric" value={formatInteger(sellingPrice)} onChange={e => setSellingPrice(e.target.value)} className="w-full h-10 px-3 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-right font-mono" />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center text-gray-600 mb-6">
                            <span className="text-sm">매입가: </span>
                            <span className="font-semibold text-gray-800 text-lg">{(itemInfo as Product).costPrice.toLocaleString()}원</span>
                            <span className="mx-2 text-gray-300">/</span>
                            <span className="text-sm">판매가: </span>
                            <span className="font-semibold text-gray-800 text-lg">{(itemInfo as Product).sellingPrice.toLocaleString()}원</span>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 text-center">수량</label>
                        <div className="flex justify-center items-center gap-2">
                            <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(-1)} className="w-12 h-12 bg-gray-100 text-gray-600 text-2xl font-bold rounded-lg transition hover:bg-gray-200 active:scale-95 flex-shrink-0" aria-label="수량 감소">-</button>
                            <input
                                ref={quantityInputRef}
                                type="text" inputMode="numeric"
                                value={quantity}
                                onChange={(e) => {
                                    const value = e.target.value.replace(/[^0-9]/g, '');
                                    if (value === '' || (Number(value) > 0)) setQuantity(value);
                                }}
                                className={`w-24 h-12 text-center border rounded-lg font-bold text-2xl focus:outline-none focus:ring-1 transition-colors ${isReturn ? 'bg-red-50 border-red-300 text-red-700 focus:border-red-500 focus:ring-red-500' : 'bg-white border-gray-300 text-gray-800 focus:border-blue-500 focus:ring-blue-500'}`}
                            />
                            <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(1)} className="w-12 h-12 bg-gray-100 text-gray-600 text-2xl font-bold rounded-lg transition hover:bg-gray-200 active:scale-95 flex-shrink-0" aria-label="수량 증가">+</button>
                        </div>
                        <div className="flex justify-center mt-3">
                             <button onClick={toggleReturn} className={`px-4 py-2 flex items-center gap-2 rounded-lg font-bold border-2 transition-all ${isReturn ? 'bg-red-600 text-white border-red-700 shadow-md' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'}`}>
                                <ReturnBoxIcon className="w-5 h-5"/>
                                <span>반품</span>
                            </button>
                        </div>
                    </div>
                </div>
                
                <div className="bg-gray-50 px-4 py-3 rounded-b-xl grid grid-cols-2 gap-3">
                    <button onMouseDown={(e) => e.preventDefault()} onClick={onClose} className="px-4 h-12 flex items-center justify-center rounded-lg font-semibold text-gray-700 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition text-base active:scale-95">취소</button>
                    <button onMouseDown={(e) => e.preventDefault()} onClick={handleAdd} disabled={!isQuantityValid} className="text-white px-4 h-12 flex items-center justify-center rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-base active:scale-95 disabled:bg-gray-400 disabled:cursor-not-allowed">
                        {isReturn ? '반품 추가' : '입고 추가'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ReceiveItemModal;