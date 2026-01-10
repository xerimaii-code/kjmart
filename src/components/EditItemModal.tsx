
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { OrderItem, Product } from '../types';
import { useDataState, useDeviceSettings } from '../context/AppContext';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { isSaleActive } from '../hooks/useOrderManager';
import { XCircleIcon, PencilSquareIcon, ChatBubbleLeftIcon, SpinnerIcon } from './Icons';
import KeypadLayout, { KeypadHeaderControls } from './KeypadLayout';

// Global Singleton AudioContext for zero-latency feedback
let globalAudioCtx: AudioContext | null = null;

const initAudio = () => {
    if (!globalAudioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
            globalAudioCtx = new AudioContextClass();
        }
    }
    if (globalAudioCtx && globalAudioCtx.state === 'suspended') {
        globalAudioCtx.resume().catch(() => {});
    }
    return globalAudioCtx;
};

const playBeep = (enabled: boolean) => {
    if (!enabled) return;
    const ctx = initAudio();
    if (!ctx) return;

    try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.type = 'sine';
        const now = ctx.currentTime;
        osc.frequency.setValueAtTime(2200, now);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        
        osc.start(now);
        osc.stop(now + 0.1);
    } catch (e) {}
};

interface EditItemModalProps {
    isOpen: boolean;
    item: OrderItem | null;
    product?: Product; 
    onClose: () => void;
    onSave: (details: { quantity: number; unit: '개' | '박스'; memo?: string; }) => void;
}

const EditItemModal: React.FC<EditItemModalProps> = ({ isOpen, item, product: externalProduct, onSave, onClose }) => {
    const { uiFeedback } = useDeviceSettings();
    const [activeItem, setActiveItem] = useState<OrderItem | null>(item);
    const [isMounted, setIsMounted] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false); // Used for both submission and closing lock
    const [isLeftHanded, setIsLeftHanded] = useLocalStorage<boolean>('pos_layout_left_handed', false);
    const [isPositionLocked, setIsPositionLocked] = useLocalStorage<boolean>('pos_modal_locked', false);
    const [quantityStr, setQuantityStr] = useState<string>('0');
    const [unit, setUnit] = useState<'개' | '박스'>('개');
    const [memo, setMemo] = useState('');
    
    const isFirstInputRef = useRef(true);

    const { products } = useDataState();
    
    const currentProduct = useMemo(() => {
        if (externalProduct) return externalProduct;
        return activeItem ? products.find(p => p.barcode === activeItem.barcode) : null;
    }, [activeItem, products, externalProduct]);

    const eventDisplay = useMemo(() => {
        if (currentProduct && isSaleActive(currentProduct.saleStartDate, currentProduct.saleEndDate)) {
            return {
                cost: currentProduct.eventCostPrice,
                price: currentProduct.salePrice,
                name: currentProduct.saleName,
                active: true
            };
        }
        if (activeItem && activeItem.saleName && isSaleActive(activeItem.saleStartDate, activeItem.saleEndDate)) {
             return {
                cost: activeItem.eventPrice, 
                price: activeItem.salePrice,
                name: activeItem.saleName,
                active: true
            };
        }
        return null;
    }, [currentProduct, activeItem]);

    useEffect(() => { if (item) setActiveItem(item); }, [item]);
    
    useEffect(() => {
        if (isOpen) {
            setIsMounted(true);
            setIsSubmitting(false);
            initAudio();
            // Small delay to allow mounting before transition
            const timer = setTimeout(() => setIsVisible(true), 10);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    useEffect(() => {
        if (isOpen && item) {
            setQuantityStr(String(item.quantity)); 
            setUnit(item.unit); 
            setMemo(item.memo || '');
            isFirstInputRef.current = true;
        }
    }, [isOpen, item]);

    // Safe close handler to prevent ghost clicks
    const handleSafeClose = () => {
        if (isSubmitting) return;
        setIsSubmitting(true); // Lock interactions
        setIsVisible(false); // Start fade out
        
        // Wait for fade out animation and to consume any trailing touch events
        setTimeout(() => {
            if (isMounted) { // Check if still mounted to avoid memory leak warnings (though rare here)
                onClose();
            }
        }, 300);
    };

    const handleSaveAction = () => {
        if (isSubmitting || !isQuantityValid) return;
        setIsSubmitting(true);
        setIsVisible(false); // Start fade out
        
        setTimeout(() => {
            onSave({ quantity: Number(quantityStr), unit, memo: memo.trim() });
        }, 300);
    };

    if (!isMounted || !activeItem) return null;

    const isQuantityValid = quantityStr !== '' && !isNaN(Number(quantityStr));

    const KeypadButton = ({ onClick, className, children, disabled }: any) => (
        <button 
            type="button"
            onPointerDown={(e) => {
                if (disabled || isSubmitting) return;
                e.preventDefault();
                e.stopPropagation();
                playBeep(!!uiFeedback?.soundOnPress);
                onClick();
            }}
            disabled={disabled || isSubmitting}
            className={`flex items-center justify-center font-bold rounded-lg active:bg-gray-200 touch-none select-none ${className} ${disabled || isSubmitting ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer'}`}
        >
            {children}
        </button>
    );

    const ControllerSection = (
        <div className="flex flex-col gap-1 h-full w-full min-w-0">
            <div className="flex flex-col gap-1 flex-shrink-0 mb-1">
                <div className="grid grid-cols-2 gap-1">
                    <button 
                        type="button"
                        onPointerDown={(e) => { 
                            if (isSubmitting) return;
                            e.preventDefault(); e.stopPropagation(); 
                            playBeep(!!uiFeedback?.soundOnPress); 
                            handleSafeClose(); 
                        }}
                        disabled={isSubmitting}
                        className={`bg-gray-100 text-gray-500 border border-gray-200 h-16 text-sm sm:text-lg rounded-lg font-bold active:bg-gray-200 flex items-center justify-center touch-none select-none ${isSubmitting ? 'pointer-events-none opacity-50' : ''}`}
                    >
                        <XCircleIcon className="w-5 h-5 mr-1" />취소
                    </button>
                    <button 
                        type="button"
                        onPointerDown={(e) => { 
                            if(!isQuantityValid || isSubmitting) return;
                            e.preventDefault(); e.stopPropagation(); 
                            playBeep(!!uiFeedback?.soundOnPress); 
                            handleSaveAction(); 
                        }}
                        disabled={!isQuantityValid || isSubmitting} 
                        className={`bg-indigo-600 text-white h-16 text-sm sm:text-lg rounded-lg font-bold active:bg-indigo-700 flex items-center justify-center disabled:bg-gray-300 touch-none select-none ${isSubmitting ? 'pointer-events-none' : ''}`}
                    >
                        {isSubmitting ? <SpinnerIcon className="w-5 h-5 animate-spin" /> : <><PencilSquareIcon className="w-5 h-5 mr-1" />수정</>}
                    </button>
                </div>
            </div>
            
            <div className="grid grid-cols-3 gap-1 flex-grow min-h-0">
                {[7, 8, 9, 4, 5, 6, 1, 2, 3].map(num => (
                    <KeypadButton key={num} onClick={() => {
                        const wasFirst = isFirstInputRef.current;
                        setQuantityStr(prev => (wasFirst || prev === '0') ? String(num) : prev + num);
                        isFirstInputRef.current = false;
                    }} className="bg-white text-gray-800 text-xl border border-gray-200">{num}</KeypadButton>
                ))}
                <KeypadButton onClick={() => { 
                    const wasFirst = isFirstInputRef.current;
                    setQuantityStr(prev => (wasFirst || prev === '0') ? '0' : prev + '0');
                    isFirstInputRef.current = false;
                }} className="bg-white text-gray-800 text-xl border border-gray-200">0</KeypadButton>
                <KeypadButton onClick={() => { 
                    setQuantityStr('0'); 
                    isFirstInputRef.current = true;
                }} className="bg-red-50 text-red-600 border border-red-200 text-lg">C</KeypadButton>
                <KeypadButton onClick={() => {
                    setQuantityStr(prev => prev.startsWith('-') ? prev.slice(1) : '-' + prev);
                }} className="bg-gray-100 text-gray-800 border border-gray-300 text-2xl font-mono">-</KeypadButton>
            </div>
        </div>
    );

    const InfoSection = (
        <div className="flex flex-col h-full w-full pl-1 overflow-hidden" onPointerDown={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-1 flex-shrink-0">
                <span className="text-[10px] text-gray-400 font-mono bg-gray-50 px-1 rounded">{activeItem.barcode}</span>
                <KeypadHeaderControls isLocked={!!isPositionLocked} onToggleLock={() => setIsPositionLocked(!isPositionLocked)} isLeft={!!isLeftHanded} onToggleHandedness={() => setIsLeftHanded(!isLeftHanded)} />
            </div>
            <div className="mb-2 flex-shrink-0 min-h-[1.5rem]">
                <h3 className="text-sm font-extrabold text-gray-900 leading-tight break-words">{activeItem.name}</h3>
            </div>

            <div className="flex-grow flex flex-col gap-1.5 overflow-y-auto no-scrollbar pb-1">
                <div className="grid grid-cols-2 gap-1.5 flex-shrink-0">
                    <div className="border border-gray-200 bg-gray-50 rounded-lg h-9 flex justify-between items-center px-2">
                        <span className="text-[9px] font-bold text-gray-400 uppercase">매입가</span>
                        <span className="text-xs font-black text-gray-600 tabular-nums">
                            {(activeItem.masterPrice || currentProduct?.costPrice || activeItem.price)?.toLocaleString() || '-'}
                        </span>
                    </div>
                    <div className="border border-gray-200 bg-gray-50 rounded-lg h-9 flex justify-between items-center px-2">
                        <span className="text-[9px] font-bold text-gray-400 uppercase">판매가</span>
                        <span className="text-xs font-black text-gray-600 tabular-nums">{currentProduct?.sellingPrice?.toLocaleString() || '-'}</span>
                    </div>
                </div>

                <div className="flex gap-2 h-14 flex-shrink-0 mt-1">
                    <div className="w-[40%] border border-gray-300 bg-gray-100 rounded-xl flex flex-col items-center justify-center relative overflow-hidden">
                        <label className="absolute top-1 left-2 text-[9px] font-bold text-gray-400">기존</label>
                        <span className="text-2xl font-extrabold text-gray-400 tracking-tighter tabular-nums">{activeItem.quantity.toLocaleString()}</span>
                    </div>
                    <div 
                        onPointerDown={(e) => { 
                            e.preventDefault(); e.stopPropagation(); 
                            playBeep(!!uiFeedback?.soundOnPress); 
                            isFirstInputRef.current = true; 
                        }}
                        className={`w-[60%] border-2 rounded-xl flex flex-col items-center justify-center bg-white cursor-pointer relative h-full touch-none select-none ${isFirstInputRef.current ? 'border-indigo-600 bg-indigo-50/10' : 'border-gray-300'}`}
                    >
                        <label className="absolute top-1 left-2 text-[9px] font-bold text-gray-400">변경</label>
                        <span className="text-3xl font-black text-gray-900 tracking-tighter tabular-nums">{quantityStr}</span>
                    </div>
                </div>

                <div className="flex gap-1 h-8 flex-shrink-0">
                    <button type="button" onPointerDown={() => setUnit('개')} className={`flex-1 rounded-lg text-[11px] font-black border touch-none select-none ${unit === '개' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-gray-200 text-gray-500'}`}>낱개</button>
                    <button type="button" onPointerDown={() => setUnit('박스')} className={`flex-1 rounded-lg text-[11px] font-black border touch-none select-none ${unit === '박스' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-gray-200 text-gray-500'}`}>박스</button>
                </div>

                <div className="bg-white border border-gray-300 rounded-lg flex items-center px-2 h-9 flex-shrink-0">
                    <ChatBubbleLeftIcon className="w-3.5 h-3.5 text-gray-400 mr-1.5" />
                    <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} onPointerDown={(e) => e.stopPropagation()} placeholder="메모 입력" className="w-full h-full bg-transparent outline-none text-xs text-gray-800 placeholder-gray-400" />
                </div>

                {eventDisplay && (
                    <div className="mt-auto pt-2">
                        <div className="p-2.5 rounded-xl border border-rose-200 border-dashed bg-rose-50/50">
                            <div className="flex items-center gap-1.5 text-[10px] flex-wrap justify-center">
                                <span className="font-black text-rose-500 uppercase">행사가</span>
                                <span className="font-bold text-rose-700">
                                    {eventDisplay.cost?.toLocaleString()} / {eventDisplay.price?.toLocaleString()}
                                </span>
                                <span className="text-rose-300 mx-1">|</span>
                                <span className="text-gray-400 font-medium truncate">{eventDisplay.name}</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    return createPortal(
        <div className={`fixed inset-0 z-[140] flex items-center justify-center transition-colors duration-200 ${isVisible ? 'bg-black bg-opacity-50' : 'bg-transparent'}`} onClick={(e) => { if (e.target === e.currentTarget) handleSafeClose(); }} role="dialog" aria-modal="true">
            <KeypadLayout layoutId="edit_item_modal_layout" isLeftHanded={!!isLeftHanded} onToggleHandedness={() => setIsLeftHanded(!isLeftHanded)} leftContent={InfoSection} rightContent={ControllerSection} />
        </div>,
        document.body
    );
};

export default EditItemModal;
