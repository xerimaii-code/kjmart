
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Product, OrderItem } from '../types';
import { isSaleActive } from '../hooks/useOrderManager';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useDeviceSettings, useScanner } from '../context/AppContext';
import { BarcodeScannerIcon, XCircleIcon, SaveIcon, ChevronRightIcon, ChatBubbleLeftIcon } from './Icons';
import KeypadLayout, { KeypadHeaderControls } from './KeypadLayout';

interface AddItemModalProps {
    isOpen: boolean;
    product: Product | null;
    existingItem: OrderItem | null;
    onClose: () => void;
    onAdd: (details: { quantity: number; unit: '개' | '박스'; memo?: string }) => void;
    onNextScan?: () => void;
    trigger: 'scan' | 'search';
    initialSettings?: { unit: '개' | '박스' };
    timestamp?: number;
}

const AddItemModal: React.FC<AddItemModalProps> = ({ isOpen, product, existingItem, onClose, onAdd, onNextScan, trigger, initialSettings, timestamp }) => {
    const { uiFeedback } = useDeviceSettings();
    const { closeScanner } = useScanner(); 
    
    const [isMounted, setIsMounted] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [isLeftHanded, setIsLeftHanded] = useLocalStorage<boolean>('pos_layout_left_handed', false);
    const [isPositionLocked, setIsPositionLocked] = useLocalStorage<boolean>('pos_modal_locked', false);

    const [quantity, setQuantity] = useState<number | string>(1);
    const [unit, setUnit] = useState<'개' | '박스'>('개');
    const [memo, setMemo] = useState('');
    
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

    useEffect(() => {
        if (isOpen && product) {
            setQuantity(1);
            setUnit(initialSettings?.unit ?? existingItem?.unit ?? '개');
            setMemo(existingItem?.memo || '');
            setIsFirstInput(true);
        }
    }, [isOpen, product, product?.barcode, existingItem, initialSettings, trigger, timestamp]);

    if (!isMounted || !product) return null;

    const finalQuantity = Number(quantity);
    const isQuantityValid = !isNaN(finalQuantity) && finalQuantity !== 0;

    const handleAdd = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (!isQuantityValid || isSubmitting) return;
        setIsSubmitting(true);
        onAdd({ quantity: finalQuantity, unit, memo: memo.trim() });
        closeScanner();
        onClose();
    };

    const handleAddAndScan = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (!isQuantityValid || isSubmitting) return;
        setIsSubmitting(true);
        onAdd({ quantity: finalQuantity, unit, memo: memo.trim() });
        onClose();
        if (onNextScan) {
            setTimeout(onNextScan, 200);
        }
    };
    
    const handleSkip = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (isSubmitting) return;
        setIsSubmitting(true);
        onClose();
        if (onNextScan) {
            setTimeout(onNextScan, 200);
        }
    };

    const handleClose = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        closeScanner();
        onClose();
    }

    const updateValue = (prev: number | string, val: string, isFirst: boolean) => {
        if (val === 'C') return 0;
        if (val === '-') return Number(prev) * -1;
        
        if (isFirst) return Number(val);
        const newVal = Number(String(prev) + val);
        return isNaN(newVal) ? prev : newVal;
    };

    const handleKeypadInput = (val: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (uiFeedback?.vibrateOnPress && navigator.vibrate) {
            navigator.vibrate(30);
        }
        if (val === 'C') {
            setQuantity(0);
            setIsFirstInput(false);
            return;
        }
        setQuantity(prev => updateValue(prev, val, isFirstInput));
        if (val !== '-') setIsFirstInput(false);
    };

    const saleIsActive = isSaleActive(product.saleStartDate, product.saleEndDate);

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
                {trigger === 'scan' ? (
                    <>
                        <div className={`grid gap-1 ${isLeftHanded ? 'grid-cols-[1fr_1fr]' : 'grid-cols-[1fr_1fr]'}`}>
                            {isLeftHanded ? (
                                <>
                                    <ButtonBase onClick={handleClose} className="bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200 py-2.5 text-xs"><XCircleIcon className="w-4 h-4 mr-1" />취소</ButtonBase>
                                    <ButtonBase onClick={handleSkip} className="bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 py-2.5 text-xs"><ChevronRightIcon className="w-3.5 h-3.5 mr-1" />스킵</ButtonBase>
                                </>
                            ) : (
                                <>
                                    <ButtonBase onClick={handleSkip} className="bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 py-2.5 text-xs"><ChevronRightIcon className="w-3.5 h-3.5 mr-1" />스킵</ButtonBase>
                                    <ButtonBase onClick={handleClose} className="bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200 py-2.5 text-xs"><XCircleIcon className="w-4 h-4 mr-1" />취소</ButtonBase>
                                </>
                            )}
                        </div>
                        <ButtonBase onClick={handleAdd} disabled={!isQuantityValid} className="bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 font-bold py-2 text-xs shadow-sm h-10"><SaveIcon className="w-3.5 h-3.5 mr-1" />저장 & 종료</ButtonBase>
                        <ButtonBase onClick={handleAddAndScan} disabled={!isQuantityValid} className="w-full shadow-md bg-blue-600 hover:bg-blue-700 text-white py-4 text-base font-bold h-14"><BarcodeScannerIcon className="w-5 h-5 mr-1.5" />추가 & 스캔</ButtonBase>
                    </>
                ) : (
                    <>
                        <div className="flex flex-col gap-1">
                            <ButtonBase onClick={handleClose} className="bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200 py-2.5 text-sm"><XCircleIcon className="w-4 h-4 mr-1" />취소</ButtonBase>
                            <ButtonBase onClick={handleAdd} disabled={!isQuantityValid} className="bg-blue-600 text-white hover:bg-blue-700 font-bold py-3 text-base shadow-md"><SaveIcon className="w-4 h-4 mr-1" />저장</ButtonBase>
                        </div>
                    </>
                )}
            </div>
            <div className="grid grid-cols-3 gap-1 flex-grow min-h-0">
                {[7, 8, 9, 4, 5, 6, 1, 2, 3].map(num => (
                    <ButtonBase key={num} onClick={(e: any) => handleKeypadInput(String(num), e)} className="bg-white text-gray-800 text-xl hover:bg-gray-50 border border-gray-200 font-bold shadow-sm">{num}</ButtonBase>
                ))}
                <ButtonBase onClick={(e: any) => handleKeypadInput('0', e)} className="bg-white text-gray-800 text-xl hover:bg-gray-50 border border-gray-200 font-bold shadow-sm">0</ButtonBase>
                <ButtonBase onClick={(e: any) => handleKeypadInput('C', e)} className="bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 text-lg font-bold shadow-sm">C</ButtonBase>
                <ButtonBase onClick={(e: any) => handleKeypadInput('-', e)} className="bg-gray-100 text-gray-800 hover:bg-gray-200 border border-gray-300 text-2xl font-bold font-mono shadow-sm">-</ButtonBase>
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
                <div className="flex items-start gap-1">
                    {existingItem && <span className="bg-orange-100 text-orange-700 text-[9px] font-bold px-1 py-0.5 rounded flex-shrink-0 mt-0.5">수정</span>}
                    <h3 className="text-sm font-extrabold text-gray-900 leading-tight break-keep line-clamp-2">{product.name}</h3>
                </div>
                {product.spec && <p className="text-[10px] text-gray-500 mt-0.5 truncate">{product.spec}</p>}
            </div>
            <div className="flex items-center justify-between bg-gray-50 px-2 py-1.5 rounded text-xs text-gray-600 mb-2 flex-shrink-0 border border-gray-100">
                <div className="flex gap-3 w-full justify-around">
                    <div className="flex items-center gap-1"><span className="text-gray-500">매입</span><b className="text-gray-900">{product.costPrice.toLocaleString()}</b></div>
                    <div className="flex items-center gap-1"><span className="text-gray-500">판매</span><b className="text-gray-900">{product.sellingPrice?.toLocaleString()}</b></div>
                </div>
            </div>
            <div className="flex-grow flex flex-col min-h-0 mb-1">
                {existingItem && (
                    <div className="w-full flex items-center justify-between border border-gray-200 bg-gray-50 rounded-lg px-3 py-1.5 mb-1.5 flex-shrink-0">
                        <span className="text-[11px] font-bold text-gray-500">이미 담긴 수량</span>
                        <span className="text-base font-extrabold text-red-600">{existingItem.quantity.toLocaleString()}</span>
                    </div>
                )}
                <div 
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => setIsFirstInput(true)}
                    className="w-full border-2 border-blue-600 ring-2 ring-blue-50 rounded-xl flex items-center justify-center bg-white shadow-inner transition-colors cursor-pointer relative overflow-hidden h-12 mb-2 flex-shrink-0"
                >
                    <label className="absolute top-1 left-2 text-[9px] font-bold text-blue-300">수량</label>
                    <span className="text-2xl font-extrabold text-gray-900 tracking-tight z-10">{quantity}</span>
                </div>
                <div className="flex gap-1 h-8 flex-shrink-0 mb-2" onMouseDown={(e) => e.stopPropagation()}>
                    <button onClick={() => setUnit('개')} className={`flex-1 rounded-lg text-xs font-bold transition-all border ${unit === '개' ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>낱개</button>
                    <button onClick={() => setUnit('박스')} className={`flex-1 rounded-lg text-xs font-bold transition-all border ${unit === '박스' ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>박스</button>
                </div>
                <div className="bg-white border border-gray-300 rounded-lg flex items-center px-2 h-9 focus-within:ring-2 focus-within:ring-blue-500 mb-2 flex-shrink-0" onMouseDown={(e) => e.stopPropagation()}>
                    <ChatBubbleLeftIcon className="w-3.5 h-3.5 text-gray-400 mr-1.5 flex-shrink-0" />
                    <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} placeholder="메모 입력" className="w-full h-full bg-transparent outline-none text-xs text-gray-800 placeholder-gray-400" />
                </div>
                <div className="flex-shrink-0 space-y-1 overflow-y-auto">
                    {(product.bomStatus === '묶음' || saleIsActive) ? (
                        <>
                            {product.bomStatus === '묶음' && (
                                <div className="bg-purple-50 rounded p-1.5 border border-purple-100 flex items-center gap-2">
                                    <span className="bg-purple-100 text-purple-700 px-1 py-0.5 rounded text-[9px] font-bold border border-purple-200">BOM</span>
                                    <span className="text-[10px] text-purple-800 font-bold">묶음 상품</span>
                                </div>
                            )}
                            {saleIsActive && (
                                <div className="bg-red-50 rounded p-2 border border-red-100 mt-1">
                                    {product.saleName && <div className="text-[11px] font-bold text-red-600 mb-1 leading-tight">{product.saleName}</div>}
                                    <div className="flex justify-between font-bold text-[11px] mb-1">
                                        <div className="flex items-center gap-1"><span className="text-gray-500">행사매입</span><span className="text-gray-800">{product.eventCostPrice?.toLocaleString()}</span></div>
                                        <div className="flex items-center gap-1"><span className="text-red-500">행사판매</span><span className="text-red-700">{product.salePrice?.toLocaleString()}</span></div>
                                    </div>
                                    <div className="text-[10px] text-gray-500 text-right">행사기간: {product.saleStartDate} ~ {product.saleEndDate}</div>
                                </div>
                            )}
                        </>
                    ) : (<p className="text-center text-gray-300 text-[10px] mt-2">특이사항 없음</p>)}
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
                layoutId="add_item_modal_layout"
                isLeftHanded={!!isLeftHanded}
                onToggleHandedness={() => setIsLeftHanded(!isLeftHanded)}
                leftContent={InfoSection}
                rightContent={ControllerSection}
            />
        </div>,
        document.body
    );
};

export default AddItemModal;
