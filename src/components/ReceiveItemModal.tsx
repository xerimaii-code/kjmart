
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Product, ReceivingItem } from '../types';
import { useAdjustForKeyboard } from '../hooks/useAdjustForKeyboard';
import { ReturnBoxIcon } from './Icons';

interface ReceiveItemModalProps {
    isOpen: boolean;
    product: Product | null;
    onClose: () => void;
    onAdd: (item: Omit<ReceivingItem, 'uniqueId'>) => void;
}

const ReceiveItemModal: React.FC<ReceiveItemModalProps> = ({ isOpen, product, onClose, onAdd }) => {
    const [quantity, setQuantity] = useState<number | string>(1);
    const [isReturn, setIsReturn] = useState(false);
    
    const quantityInputRef = useRef<HTMLInputElement>(null);
    const modalContentRef = useRef<HTMLDivElement>(null);
    const [isRendered, setIsRendered] = useState(false);

    useAdjustForKeyboard(modalContentRef, isOpen);

    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => setIsRendered(true), 10);
            if (product) {
                setQuantity(1);
                setIsReturn(false);
                setTimeout(() => {
                    quantityInputRef.current?.focus();
                    quantityInputRef.current?.select();
                }, 150);
            }
            return () => clearTimeout(timer);
        } else {
            setIsRendered(false);
        }
    }, [isOpen, product]);

    if (!isOpen || !product) return null;
    
    const finalQuantity = Number(quantity);
    const isQuantityValid = !isNaN(finalQuantity) && finalQuantity !== 0;

    const handleAdd = () => {
        if (!isQuantityValid) return;
        
        const itemData: Omit<ReceivingItem, 'uniqueId'> = {
            barcode: product.barcode,
            name: product.name,
            costPrice: product.costPrice,
            sellingPrice: product.sellingPrice,
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
                    <h3 className="text-xl font-bold text-gray-800 truncate text-center" title={product.name || '신규 상품'}>
                        {product.name || '신규 상품'}
                    </h3>
                    <p className="text-center text-sm text-gray-500 mb-4">{product.barcode}</p>
                    
                    <div className="text-center text-gray-600 mb-6">
                        <span className="text-sm">매입가: </span>
                        <span className="font-semibold text-gray-800 text-lg">{product.costPrice.toLocaleString()}원</span>
                        <span className="mx-2 text-gray-300">/</span>
                        <span className="text-sm">판매가: </span>
                        <span className="font-semibold text-gray-800 text-lg">{product.sellingPrice.toLocaleString()}원</span>
                    </div>

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
