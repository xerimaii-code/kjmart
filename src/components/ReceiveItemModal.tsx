
import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Product, ReceivingItem } from '../types';
import { ReturnBoxIcon, SaveIcon, ChevronRightIcon, XCircleIcon, BarcodeScannerIcon } from './Icons';
import { isSaleActive } from '../hooks/useOrderManager';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useDeviceSettings, useScanner } from '../context/AppContext'; // Import useScanner
import KeypadLayout, { KeypadHeaderControls } from './KeypadLayout';

interface ReceiveItemModalProps {
    isOpen: boolean;
    product: Product | null; 
    onClose: () => void;
    onAdd: (item: Omit<ReceivingItem, 'uniqueId'>) => void;
    currentItems: ReceivingItem[];
    onScanNext?: () => void;
    timestamp?: number;
}

type ActiveField = 'quantity' | 'cost' | 'selling';

const ReceiveItemModal: React.FC<ReceiveItemModalProps> = ({ isOpen, product, onClose, onAdd, currentItems = [], onScanNext, timestamp }) => {
    const { uiFeedback } = useDeviceSettings();
    const { closeScanner } = useScanner(); // Get closeScanner action

    // Direct use of product prop instead of local state to avoid sync issues
    const [isMounted, setIsMounted] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Layout preference
    const [isLeftHanded, setIsLeftHanded] = useLocalStorage<boolean>('pos_layout_left_handed', false);
    // Position Lock Preference
    const [isPositionLocked, setIsPositionLocked] = useLocalStorage<boolean>('pos_modal_locked', false);

    // State for inputs
    const [quantity, setQuantity] = useState<number | string>(1);
    const [costPrice, setCostPrice] = useState<number | string>(0);
    const [sellingPrice, setSellingPrice] = useState<number | string>(0);
    const [customName, setCustomName] = useState('');
    
    // Focus Management
    const [activeField, setActiveField] = useState<ActiveField>('quantity');
    const [isFirstInput, setIsFirstInput] = useState(true);

    useEffect(() => {
        if (isOpen) {
            setIsMounted(true);
            setIsSubmitting(false);
            const timer = setTimeout(() => setIsVisible(true), 10);
            return () => clearTimeout(timer);
        } else {
            setIsVisible(false);
            const timer = setTimeout(() => setIsMounted(false), 200);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    // Force reset values when opening or when product changes (Critical for continuous scan)
    useEffect(() => {
        if (isOpen && product) {
            setQuantity(1);
            setCostPrice(product.costPrice || 0);
            setSellingPrice(product.sellingPrice || 0);
            setCustomName(product.name || '');
            
            // Reset to quantity field and first input mode
            setActiveField('quantity');
            setIsFirstInput(true);
        }
    }, [isOpen, product, product?.barcode, timestamp]); // Added timestamp dependency

    const existingQuantity = useMemo(() => {
        if (!product || !currentItems) return 0;
        return currentItems
            .filter(item => item.barcode === product.barcode)
            .reduce((sum, item) => sum + item.quantity, 0);
    }, [product, currentItems]);

    const isUnregistered = useMemo(() => {
        return product && (!product.name || product.name === '미등록 상품' || product.name === '');
    }, [product]);

    const saleActive = useMemo(() => {
        if (!product) return false;
        return isSaleActive(product.saleStartDate, product.saleEndDate);
    }, [product]);

    if (!isMounted || !product) return null;
    
    const finalQuantity = Number(quantity);
    const finalCost = Number(String(costPrice).replace(/,/g, ''));
    const finalSelling = Number(String(sellingPrice).replace(/,/g, ''));
    
    const isQuantityValid = !isNaN(finalQuantity) && finalQuantity !== 0;
    const displayName = isUnregistered ? (customName || '미등록 상품') : product.name;

    const createItemData = (isReturn: boolean): Omit<ReceivingItem, 'uniqueId'> => ({
        barcode: product.barcode,
        name: displayName,
        costPrice: finalCost, 
        sellingPrice: finalSelling,
        quantity: isReturn ? -finalQuantity : finalQuantity,
        isNew: true,
    });

    const handleAdd = (isReturn: boolean, e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (!isQuantityValid || isSubmitting) return;
        setIsSubmitting(true);
        onAdd(createItemData(isReturn));
        
        // '추가&종료' 클릭 시 스캐너도 함께 종료
        closeScanner();
        onClose();
    };

    const handleAddAndScan = (isReturn: boolean, e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (!isQuantityValid || isSubmitting) return;
        setIsSubmitting(true);
        onAdd(createItemData(isReturn));
        onClose();
        if (onScanNext) {
            setTimeout(onScanNext, 200);
        }
    };
    
    const handleReturnAction = (e?: React.MouseEvent) => {
        if (onScanNext) {
            handleAddAndScan(true, e);
        } else {
            handleAdd(true, e);
        }
    };
    
    const handleSkip = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (isSubmitting) return;
        setIsSubmitting(true);
        onClose();
        if (onScanNext) {
            setTimeout(onScanNext, 200);
        }
    };

    const handleClose = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        // [MODIFIED] '종료' 버튼 클릭 시에도 스캐너 종료
        closeScanner();
        onClose();
    }

    const handleFieldFocus = (field: ActiveField) => {
        setActiveField(field);
        setIsFirstInput(true);
    };

    const updateValue = (prev: number | string, val: string, isFirst: boolean) => {
        if (val === 'C') return 0;
        if (val === 'BS') {
            const s = String(prev).replace(/,/g, '');
            if (s.length <= 1) return 0;
            return Number(s.slice(0, -1));
        }
        if (isFirst) return Number(val);
        const newVal = Number(String(prev).replace(/,/g, '') + val);
        return isNaN(newVal) ? prev : newVal;
    };

    const handleKeypadInput = (val: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        
        if (uiFeedback?.vibrateOnPress && navigator.vibrate) {
            navigator.vibrate(30);
        }

        let nextIsFirst = isFirstInput;
        
        if (val === 'C') {
            nextIsFirst = false; 
            switch (activeField) {
                case 'quantity': setQuantity(0); break;
                case 'cost': setCostPrice(0); break;
                case 'selling': setSellingPrice(0); break;
            }
            setIsFirstInput(false);
            return;
        }

        if (val !== 'BS' && val !== 'C') {
            nextIsFirst = false;
        }

        switch (activeField) {
            case 'quantity': setQuantity(prev => updateValue(prev, val, isFirstInput)); break;
            case 'cost': setCostPrice(prev => updateValue(prev, val, isFirstInput)); break;
            case 'selling': setSellingPrice(prev => updateValue(prev, val, isFirstInput)); break;
        }
        
        if (!nextIsFirst) setIsFirstInput(false);
    };

    const ButtonBase = ({ onClick, className, children, disabled }: any) => (
        <button 
            onMouseDown={(e) => e.stopPropagation()} 
            onTouchStart={(e) => e.stopPropagation()}
            onClick={onClick} 
            disabled={disabled || isSubmitting}
            className={`active:scale-95 transition-transform flex items-center justify-center font-bold rounded-lg shadow-sm ${className} ${disabled || isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
            {children}
        </button>
    );

    const ControllerSection = (
        <div className="flex flex-col gap-1 h-full w-full min-w-0">
            <div className="flex flex-col gap-1 flex-shrink-0 mb-1">
                {onScanNext ? (
                    <>
                        <div className="grid grid-cols-2 gap-1 mb-0.5">
                            <ButtonBase onClick={handleSkip} className="bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 py-2 text-[11px]">
                                <ChevronRightIcon className="w-3.5 h-3.5 mr-1" />
                                스킵
                            </ButtonBase>
                            <ButtonBase onClick={handleReturnAction} className="bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 font-bold py-2 text-[11px]">
                                <ReturnBoxIcon className="w-3.5 h-3.5 mr-1" />
                                반품
                            </ButtonBase>
                        </div>
                        <div className={`grid gap-1 ${isLeftHanded ? 'grid-cols-[2fr_1fr]' : 'grid-cols-[1fr_2fr]'}`}>
                            {isLeftHanded ? (
                                <>
                                    <ButtonBase onClick={(e:any) => handleAdd(false, e)} disabled={!isQuantityValid} className="bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 font-bold py-2.5 text-sm shadow-sm"><SaveIcon className="w-4 h-4 mr-1" />추가&종료</ButtonBase>
                                    <ButtonBase onClick={handleClose} className="bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200 py-2 text-[11px]"><XCircleIcon className="w-4 h-4 mr-1" />종료</ButtonBase>
                                </>
                            ) : (
                                <>
                                    <ButtonBase onClick={handleClose} className="bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200 py-2 text-[11px]"><XCircleIcon className="w-4 h-4 mr-1" />종료</ButtonBase>
                                    <ButtonBase onClick={(e:any) => handleAdd(false, e)} disabled={!isQuantityValid} className="bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 font-bold py-2.5 text-sm shadow-sm"><SaveIcon className="w-4 h-4 mr-1" />추가&종료</ButtonBase>
                                </>
                            )}
                        </div>
                        <ButtonBase 
                            onClick={(e:any) => handleAddAndScan(false, e)} 
                            disabled={!isQuantityValid}
                            className={`font-bold py-2.5 text-sm shadow-md ${isUnregistered ? 'bg-orange-600 text-white' : 'bg-blue-600 text-white'}`}
                        >
                            <BarcodeScannerIcon className="w-4 h-4 mr-1" />
                            {isUnregistered ? '미등록 상품' : '추가 & 스캔'}
                        </ButtonBase>
                    </>
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-1 mb-0.5">
                            <ButtonBase onClick={handleReturnAction} className="bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 font-bold py-2 text-[11px]">
                                <ReturnBoxIcon className="w-3.5 h-3.5 mr-1" />
                                반품
                            </ButtonBase>
                            <ButtonBase onClick={handleClose} className="bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200 py-2 text-[11px]">
                                <XCircleIcon className="w-4 h-4 mr-1" />
                                종료
                            </ButtonBase>
                        </div>
                        <ButtonBase 
                            onClick={(e:any) => handleAdd(false, e)} 
                            disabled={!isQuantityValid} 
                            className="bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 font-bold py-3 text-sm shadow-sm"
                        >
                            <SaveIcon className="w-4 h-4 mr-1" />
                            추가 & 종료
                        </ButtonBase>
                    </>
                )}
            </div>

            <div className="grid grid-cols-3 gap-1 flex-grow min-h-0">
                {[7, 8, 9, 4, 5, 6, 1, 2, 3].map(num => (
                    <ButtonBase key={num} onClick={(e:any) => handleKeypadInput(String(num), e)} className="bg-white text-gray-800 text-xl font-bold border border-gray-200 hover:bg-gray-50 shadow-sm">{num}</ButtonBase>
                ))}
                <ButtonBase onClick={(e:any) => handleKeypadInput('0', e)} className="bg-white text-gray-800 text-xl font-bold border border-gray-200 hover:bg-gray-50 shadow-sm">0</ButtonBase>
                <ButtonBase onClick={(e:any) => handleKeypadInput('00', e)} className="bg-white text-gray-800 text-base font-bold border border-gray-200 hover:bg-gray-50 shadow-sm">00</ButtonBase>
                <ButtonBase onClick={(e:any) => handleKeypadInput('C', e)} className="bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100 text-lg font-bold">C</ButtonBase>
            </div>
        </div>
    );

    const InfoSection = (
        <div className="flex flex-col h-full w-full pl-1 overflow-y-auto min-w-0">
            <div className="flex justify-between items-center mb-1 flex-shrink-0">
                <span className="text-[10px] text-gray-400 font-mono tracking-tighter bg-gray-50 px-1 rounded">{product.barcode}</span>
                <KeypadHeaderControls 
                    isLocked={!!isPositionLocked}
                    onToggleLock={() => setIsPositionLocked(!isPositionLocked)}
                    isLeft={!!isLeftHanded}
                    onToggleHandedness={() => setIsLeftHanded(!isLeftHanded)}
                />
            </div>

            <div className="mb-2 flex-shrink-0 min-h-[2.5rem]">
                {isUnregistered ? (
                    <input 
                        type="text" 
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        placeholder="상품명 입력"
                        className="w-full border-b-2 border-red-300 focus:border-red-500 outline-none text-sm font-bold text-gray-800 placeholder-red-300 bg-transparent py-1"
                        onMouseDown={(e) => e.stopPropagation()}
                    />
                ) : (
                    <div className="flex items-start gap-2">
                        {saleActive && (
                            <span className="bg-rose-100 text-rose-600 text-[10px] font-extrabold px-1.5 py-0.5 rounded flex-shrink-0 whitespace-nowrap border border-rose-200 mt-0.5">
                                행사중
                            </span>
                        )}
                        <h3 className="text-sm font-extrabold text-gray-900 leading-tight break-keep line-clamp-2">
                            {displayName}
                        </h3>
                    </div>
                )}
                {product.spec && <p className="text-[10px] text-gray-500 mt-0.5 truncate">{product.spec}</p>}
            </div>

            <div className="flex flex-col gap-1 mb-2 flex-shrink-0" onMouseDown={(e) => e.stopPropagation()}>
                <div onClick={() => handleFieldFocus('cost')} className={`border rounded px-2 py-1 bg-gray-50 cursor-pointer flex justify-between items-center ${activeField === 'cost' ? 'ring-1 ring-blue-500 border-blue-500' : 'border-gray-200'}`}>
                    <span className="text-[10px] text-gray-500 font-bold">매입</span>
                    <span className="text-xs font-bold text-gray-800">{Number(costPrice).toLocaleString()}</span>
                </div>
                <div onClick={() => handleFieldFocus('selling')} className={`border rounded px-2 py-1 bg-blue-50 cursor-pointer flex justify-between items-center ${activeField === 'selling' ? 'ring-1 ring-blue-500 border-blue-500' : 'border-blue-100'}`}>
                    <span className="text-[10px] text-blue-500 font-bold">판매</span>
                    <span className="text-xs font-bold text-blue-700">{Number(sellingPrice).toLocaleString()}</span>
                </div>
            </div>

            <div className="flex-grow flex flex-col min-h-0 mb-1">
                {existingQuantity > 0 && (
                    <div className="w-full flex items-center justify-between border border-orange-300 bg-orange-50 rounded-lg px-2 py-0.5 mb-1 flex-shrink-0 shadow-sm animate-pulse">
                        <div className="flex flex-col">
                            <span className="text-[10px] font-bold text-orange-700">⚠️ 기존 수량</span>
                            <span className="text-[8px] text-orange-600">합산 예정</span>
                        </div>
                        <span className="text-base font-extrabold text-orange-600 tracking-tight">
                            {existingQuantity.toLocaleString()}
                        </span>
                    </div>
                )}
                
                <div className="flex justify-between items-end mb-1 px-1">
                    <label className="text-xs font-bold text-blue-600">입고 수량</label>
                </div>
                <div 
                    className={`w-full border-2 rounded-xl flex items-center justify-center bg-white shadow-inner transition-colors cursor-pointer relative overflow-hidden h-12 mb-2 ${activeField === 'quantity' ? 'border-blue-600 ring-2 ring-blue-50' : 'border-gray-300'}`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => handleFieldFocus('quantity')}
                >
                    <span className="text-3xl font-extrabold text-gray-900 tracking-tight z-10">{quantity}</span>
                    {activeField === 'quantity' && <div className="absolute inset-0 bg-blue-50/20 pointer-events-none"></div>}
                </div>

                <div className="flex-shrink-0 space-y-1">
                    {product.bomStatus === '묶음' && (
                        <div className="bg-purple-50 rounded p-1.5 border border-purple-100 flex items-center gap-2">
                            <span className="bg-purple-100 text-purple-700 px-1 py-0.5 rounded text-[9px] font-bold border border-purple-200">BOM</span>
                            <span className="text-[10px] text-purple-800 font-bold">묶음 상품</span>
                        </div>
                    )}
                    {saleActive && (
                        <div className="bg-red-50 rounded p-1.5 border border-red-100">
                            {product.saleName && <div className="text-[10px] font-bold text-red-600 mb-0.5 leading-tight">{product.saleName}</div>}
                            <div className="flex justify-between items-center mb-0.5">
                                <span className="bg-red-500 text-white text-[9px] font-bold px-1 rounded">행사중</span>
                                <span className="text-[9px] text-gray-500">{product.saleStartDate}~{product.saleEndDate}</span>
                            </div>
                            <div className="flex justify-between font-bold text-[10px]">
                                <span className="text-gray-600">행사매입: {product.eventCostPrice?.toLocaleString()}</span>
                                <span className="text-red-600">행사판매: {product.salePrice?.toLocaleString()}</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    return createPortal(
        <div 
            className={`fixed inset-0 z-[100] flex items-center justify-center transition-colors duration-200 ${isVisible ? 'bg-black bg-opacity-50' : 'bg-transparent'}`} 
            onClick={handleClose} 
            role="dialog" 
            aria-modal="true"
        >
            <KeypadLayout
                layoutId="receive_modal_layout"
                isLeftHanded={!!isLeftHanded}
                onToggleHandedness={() => setIsLeftHanded(!isLeftHanded)}
                leftContent={InfoSection}
                rightContent={ControllerSection}
            />
        </div>,
        document.body
    );
};

export default ReceiveItemModal;
