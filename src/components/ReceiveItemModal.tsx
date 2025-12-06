
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Product, ReceivingItem } from '../types';
import { useAdjustForKeyboard } from '../hooks/useAdjustForKeyboard';
import { ReturnBoxIcon, BarcodeScannerIcon } from './Icons';
import { isSaleActive } from '../hooks/useOrderManager';

interface ReceiveItemModalProps {
    isOpen: boolean;
    product: Product | null;
    onClose: () => void;
    onAdd: (item: Omit<ReceivingItem, 'uniqueId'>) => void;
    currentItems: ReceivingItem[];
    onScanNext?: () => void; // 스캔 계속하기 콜백
}

const ReceiveItemModal: React.FC<ReceiveItemModalProps> = ({ isOpen, product, onClose, onAdd, currentItems = [], onScanNext }) => {
    const [quantity, setQuantity] = useState<number | string>(1);
    const [costPrice, setCostPrice] = useState<number | string>(0);
    const [sellingPrice, setSellingPrice] = useState<number | string>(0);
    const [isReturn, setIsReturn] = useState(false);
    
    const quantityInputRef = useRef<HTMLInputElement>(null);
    const modalContentRef = useRef<HTMLDivElement>(null);
    const [isRendered, setIsRendered] = useState(false);

    useAdjustForKeyboard(modalContentRef, isOpen);

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
                setCostPrice(product.costPrice);
                setSellingPrice(product.sellingPrice);
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
    const finalCost = Number(String(costPrice).replace(/,/g, ''));
    const finalSelling = Number(String(sellingPrice).replace(/,/g, ''));
    
    const isQuantityValid = !isNaN(finalQuantity) && finalQuantity !== 0;

    const createItemData = (): Omit<ReceivingItem, 'uniqueId'> => ({
        barcode: product.barcode,
        name: product.name,
        costPrice: finalCost, 
        sellingPrice: finalSelling,
        quantity: isReturn ? -finalQuantity : finalQuantity,
        isNew: true,
    });

    const handleAdd = () => {
        if (!isQuantityValid) return;
        onAdd(createItemData());
        onClose();
    };

    const handleAddAndScan = () => {
        if (!isQuantityValid) return;
        onAdd(createItemData());
        onClose();
        if (onScanNext) {
            // Give a slight delay to allow modal to close before reopening scanner
            setTimeout(onScanNext, 200);
        }
    };
    
    const toggleReturn = () => setIsReturn(prev => !prev);

    const changeQuantity = (delta: number) => {
        setQuantity(q => Math.max(1, (Number(q) || 0) + delta));
    };

    return createPortal(
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-50' : 'bg-transparent'}`} onClick={onClose} role="dialog" aria-modal="true">
            <div ref={modalContentRef} className={`bg-white rounded-xl shadow-lg w-full max-w-sm transition-[opacity,transform] duration-300 will-change-[opacity,transform] ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`} onClick={e => e.stopPropagation()}>
                <div className="p-4">
                    {/* Header */}
                    <div className="flex items-start justify-center gap-2 mb-1">
                        <h3 className="text-lg font-bold text-gray-800 text-center leading-tight break-keep" title={product.name || '신규 상품'}>
                            {product.name || '신규 상품'}
                        </h3>
                        {product.bomStatus === '묶음' && (
                            <span className="bg-purple-100 text-purple-700 text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5 border border-purple-200">
                                묶음
                            </span>
                        )}
                    </div>
                    <p className="text-center font-mono text-xs text-gray-400 mb-3">{product.barcode}</p>

                    {/* Price Inputs */}
                    <div className="flex gap-2 mb-4">
                        <div className="flex-1">
                            <label className="block text-xs font-bold text-gray-500 mb-1 text-center">매입가</label>
                            <input 
                                type="text" inputMode="numeric"
                                value={Number(costPrice).toLocaleString()}
                                onChange={(e) => setCostPrice(e.target.value.replace(/[^0-9]/g, ''))}
                                className="w-full text-center border border-gray-300 rounded-lg py-2 font-bold text-gray-800 focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="block text-xs font-bold text-gray-500 mb-1 text-center">판매가</label>
                            <input 
                                type="text" inputMode="numeric"
                                value={Number(sellingPrice).toLocaleString()}
                                onChange={(e) => setSellingPrice(e.target.value.replace(/[^0-9]/g, ''))}
                                className="w-full text-center border border-gray-300 rounded-lg py-2 font-bold text-blue-600 focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>

                    {/* Quantity Section */}
                    <div>
                        <div className="text-center mb-2">
                            <span className={`text-[11px] font-bold px-2 py-1 rounded-full border shadow-sm ${existingQuantity !== 0 ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`}>
                                현재 담긴 수량: {existingQuantity.toLocaleString()}개
                            </span>
                        </div>

                        <label className="block text-xs font-bold text-gray-700 mb-2 text-center">
                            {isReturn ? '반품 수량' : '입고 수량'}
                        </label>
                        <div className="flex justify-center items-center gap-2">
                            <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(-1)} className="w-12 h-12 bg-gray-100 text-gray-600 text-2xl font-bold rounded-xl transition active:scale-95 shadow-sm">-</button>
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
                            <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(1)} className="w-12 h-12 bg-gray-100 text-gray-600 text-2xl font-bold rounded-xl transition active:scale-95 shadow-sm">+</button>
                        </div>
                        
                        <div className="flex justify-center mt-3">
                             <button onClick={toggleReturn} className={`px-3 py-1.5 flex items-center gap-1.5 rounded-lg font-bold text-xs border transition-all active:scale-95 ${isReturn ? 'bg-red-600 text-white border-red-700 shadow-md ring-2 ring-red-200' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                                <ReturnBoxIcon className={`w-3.5 h-3.5 ${isReturn ? 'text-white' : 'text-gray-500'}`}/>
                                <span>{isReturn ? '반품 모드 켜짐' : '반품으로 변경'}</span>
                            </button>
                        </div>
                    </div>
                </div>
                
                <div className="bg-gray-50 px-3 py-3 rounded-b-xl border-t border-gray-100">
                    <div className="space-y-2">
                        {onScanNext ? (
                            <>
                                <button onMouseDown={(e) => e.preventDefault()} onClick={handleAddAndScan} disabled={!isQuantityValid} className="w-full text-white px-4 h-12 flex items-center justify-center rounded-lg font-bold text-lg bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition active:scale-95 disabled:bg-gray-400 disabled:cursor-not-allowed shadow-md shadow-blue-500/30 gap-2">
                                    <BarcodeScannerIcon className="w-5 h-5" />
                                    추가 후 계속 스캔
                                </button>
                                <div className="grid grid-cols-2 gap-2">
                                    <button onMouseDown={(e) => e.preventDefault()} onClick={onClose} className="px-2 h-10 flex items-center justify-center rounded-lg font-bold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition text-sm active:scale-95">스캔 종료</button>
                                    <button onMouseDown={(e) => e.preventDefault()} onClick={handleAdd} disabled={!isQuantityValid} className="px-2 h-10 flex items-center justify-center rounded-lg font-bold text-blue-600 bg-blue-100 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-400 transition text-sm active:scale-95 disabled:bg-gray-200 disabled:text-gray-400">추가 후 종료</button>
                                </div>
                            </>
                        ) : (
                            <div className="grid grid-cols-2 gap-3">
                                <button onMouseDown={(e) => e.preventDefault()} onClick={onClose} className="px-2 h-11 flex items-center justify-center rounded-lg font-bold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition text-base active:scale-95">취소</button>
                                <button onMouseDown={(e) => e.preventDefault()} onClick={handleAdd} disabled={!isQuantityValid} className="px-2 h-11 flex items-center justify-center rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-base active:scale-95 shadow-md disabled:bg-gray-400 disabled:cursor-not-allowed">추가</button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ReceiveItemModal;
