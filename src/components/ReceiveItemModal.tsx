
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Product, ReceivingItem } from '../types';
import { useAdjustForKeyboard } from '../hooks/useAdjustForKeyboard';
import { ReturnBoxIcon } from './Icons';
import { isSaleActive } from '../hooks/useOrderManager';

interface ReceiveItemModalProps {
    isOpen: boolean;
    product: Product | null;
    onClose: () => void;
    onAdd: (item: Omit<ReceivingItem, 'uniqueId'>) => void;
    currentItems: ReceivingItem[];
}

const ReceiveItemModal: React.FC<ReceiveItemModalProps> = ({ isOpen, product, onClose, onAdd, currentItems = [] }) => {
    const [quantity, setQuantity] = useState<number | string>(1);
    const [isReturn, setIsReturn] = useState(false);
    
    const quantityInputRef = useRef<HTMLInputElement>(null);
    const modalContentRef = useRef<HTMLDivElement>(null);
    const [isRendered, setIsRendered] = useState(false);

    useAdjustForKeyboard(modalContentRef, isOpen);

    // Calculate existing quantity for this product in the current batch
    const existingQuantity = useMemo(() => {
        if (!product || !currentItems) return 0;
        return currentItems
            .filter(item => item.barcode === product.barcode)
            .reduce((sum, item) => sum + item.quantity, 0);
    }, [product, currentItems]);

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

    // Sale & Badge Logic
    const saleIsActive = isSaleActive(product.saleStartDate, product.saleEndDate);
    const hasEventCost = product.eventCostPrice !== undefined && product.eventCostPrice !== null && product.eventCostPrice > 0;
    const hasSalePrice = product.salePrice !== undefined && product.salePrice !== null && product.salePrice > 0;
    const isSaleInfoVisible = saleIsActive && (hasEventCost || hasSalePrice);
    const isBundle = product.bomStatus === '묶음' || product.bomStatus === '1';

    return createPortal(
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-50' : 'bg-transparent'}`} onClick={onClose} role="dialog" aria-modal="true">
            <div ref={modalContentRef} className={`bg-white rounded-xl shadow-lg w-full max-w-sm transition-[opacity,transform] duration-300 will-change-[opacity,transform] ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`} onClick={e => e.stopPropagation()}>
                <div className="p-5">
                    {/* Header: Name & Badge */}
                    <div className="flex items-start justify-center gap-2 mb-1">
                        <h3 className="text-xl font-bold text-gray-800 text-center leading-snug break-keep" title={product.name || '신규 상품'}>
                            {product.name || '신규 상품'}
                        </h3>
                        {isBundle && (
                            <span className="bg-purple-100 text-purple-700 text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 mt-1.5 border border-purple-200">
                                묶음
                            </span>
                        )}
                    </div>

                    {/* Sub-header: Spec & Barcode */}
                    <div className="text-center mb-4 flex flex-col items-center gap-1">
                        {product.spec && (
                            <span className="text-gray-600 font-medium text-xs bg-gray-100 px-2 py-0.5 rounded-full inline-block">
                                {product.spec}
                            </span>
                        )}
                        <span className="font-mono text-xs text-gray-400 tracking-tight">{product.barcode}</span>
                    </div>
                    
                    {/* Price Info Box */}
                    <div className={`text-center mb-6 p-3 rounded-xl border transition-colors ${isSaleInfoVisible ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
                        {/* Normal Prices */}
                        <div className={`flex justify-center items-center gap-2 ${isSaleInfoVisible ? 'text-xs text-gray-400 mb-1' : 'text-gray-600'}`}>
                            <div className="flex flex-col items-end min-w-[3rem]">
                                <span className="text-[10px]">매입</span>
                                <span className={`font-semibold ${isSaleInfoVisible ? 'line-through' : 'text-lg text-gray-800'}`}>
                                    {product.costPrice.toLocaleString()}
                                </span>
                            </div>
                            <div className="h-8 w-px bg-gray-300 mx-1 opacity-50"></div>
                            <div className="flex flex-col items-start min-w-[3rem]">
                                <span className="text-[10px]">판매</span>
                                <span className={`font-semibold ${isSaleInfoVisible ? 'line-through' : 'text-lg text-gray-800'}`}>
                                    {product.sellingPrice.toLocaleString()}
                                </span>
                            </div>
                        </div>

                        {/* Sale Prices (Visible only if active sale) */}
                        {isSaleInfoVisible && (
                            <div className="flex justify-center items-center gap-3 text-red-600 font-bold border-t border-red-200/50 pt-1.5 mt-1">
                                <div className="flex flex-col items-end min-w-[3rem]">
                                    <span className="text-[10px] text-red-400 font-normal">행사매입</span>
                                    <span className="text-lg leading-tight tracking-tight">
                                        {hasEventCost ? product.eventCostPrice?.toLocaleString() : '-'}
                                    </span>
                                </div>
                                <div className="flex flex-col items-start min-w-[3rem]">
                                    <span className="text-[10px] text-red-400 font-normal">행사판매</span>
                                    <span className="text-lg leading-tight tracking-tight">
                                        {hasSalePrice ? product.salePrice?.toLocaleString() : '-'}
                                    </span>
                                </div>
                            </div>
                        )}
                        
                        {/* Sale Date */}
                        {isSaleInfoVisible && (product.saleStartDate || product.saleEndDate) && (
                            <div className="text-[10px] text-red-500 mt-1.5 font-medium bg-red-100/50 rounded py-0.5 px-2 inline-block">
                                {product.saleStartDate} ~ {product.saleEndDate}
                            </div>
                        )}
                    </div>

                    {/* Quantity Input Section */}
                    <div>
                        {/* Duplicate Quantity Badge */}
                        <div className="text-center mb-3">
                            <span className={`text-xs font-bold px-3 py-1.5 rounded-full border shadow-sm transition-colors ${existingQuantity !== 0 ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                                현재 담긴 수량: {existingQuantity.toLocaleString()}개
                            </span>
                        </div>

                        <label className="block text-sm font-bold text-gray-700 mb-2 text-center">
                            {isReturn ? '반품 수량' : '입고 수량'}
                        </label>
                        <div className="flex justify-center items-center gap-2">
                            <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(-1)} className="w-12 h-12 bg-gray-100 text-gray-600 text-2xl font-bold rounded-xl transition hover:bg-gray-200 active:scale-95 flex-shrink-0 shadow-sm" aria-label="수량 감소">-</button>
                            <input
                                ref={quantityInputRef}
                                type="text" inputMode="numeric"
                                value={quantity}
                                onChange={(e) => {
                                    const value = e.target.value.replace(/[^0-9]/g, '');
                                    if (value === '' || (Number(value) > 0)) setQuantity(value);
                                }}
                                className={`w-24 h-12 text-center border-2 rounded-xl font-bold text-2xl focus:outline-none focus:ring-2 transition-colors shadow-inner ${
                                    isReturn 
                                    ? 'bg-red-50 border-red-200 text-red-600 focus:border-red-400 focus:ring-red-200' 
                                    : 'bg-white border-gray-200 text-gray-800 focus:border-blue-500 focus:ring-blue-100'
                                }`}
                            />
                            <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(1)} className="w-12 h-12 bg-gray-100 text-gray-600 text-2xl font-bold rounded-xl transition hover:bg-gray-200 active:scale-95 flex-shrink-0 shadow-sm" aria-label="수량 증가">+</button>
                        </div>
                        
                        <div className="flex justify-center mt-4">
                             <button onClick={toggleReturn} className={`px-4 py-2 flex items-center gap-2 rounded-lg font-bold text-sm border transition-all active:scale-95 ${isReturn ? 'bg-red-600 text-white border-red-700 shadow-md ring-2 ring-red-200' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                                <ReturnBoxIcon className={`w-4 h-4 ${isReturn ? 'text-white' : 'text-gray-500'}`}/>
                                <span>{isReturn ? '반품 모드 켜짐' : '반품으로 변경'}</span>
                            </button>
                        </div>
                    </div>
                </div>
                
                <div className="bg-gray-50 px-4 py-3 rounded-b-xl grid grid-cols-2 gap-3 border-t border-gray-100">
                    <button onMouseDown={(e) => e.preventDefault()} onClick={onClose} className="px-4 h-12 flex items-center justify-center rounded-xl font-bold text-gray-600 bg-white border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-200 transition text-base active:scale-95 shadow-sm">취소</button>
                    <button onMouseDown={(e) => e.preventDefault()} onClick={handleAdd} disabled={!isQuantityValid} className={`text-white px-4 h-12 flex items-center justify-center rounded-xl font-bold focus:outline-none focus:ring-2 transition text-base active:scale-95 shadow-md disabled:bg-gray-300 disabled:shadow-none disabled:cursor-not-allowed ${isReturn ? 'bg-red-600 hover:bg-red-700 focus:ring-red-200' : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-200'}`}>
                        {isReturn ? '반품 등록' : '입고 등록'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ReceiveItemModal;
