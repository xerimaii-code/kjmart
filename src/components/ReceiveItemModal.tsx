
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Product, ReceivingItem } from '../types';
import { ReturnBoxIcon, SaveIcon, ChevronRightIcon, XCircleIcon, BarcodeScannerIcon } from './Icons';
import { isSaleActive } from '../hooks/useOrderManager';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useDeviceSettings, useScanner } from '../context/AppContext';
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
    const { closeScanner } = useScanner();
    const [isMounted, setIsMounted] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLeftHanded, setIsLeftHanded] = useLocalStorage<boolean>('pos_layout_left_handed', false);
    const [isPositionLocked, setIsPositionLocked] = useLocalStorage<boolean>('pos_modal_locked', false);
    const [quantity, setQuantity] = useState<number | string>(1);
    const [costPrice, setCostPrice] = useState<number | string>(0);
    const [sellingPrice, setSellingPrice] = useState<number | string>(0);
    const [customName, setCustomName] = useState('');
    const [activeField, setActiveField] = useState<ActiveField>('quantity');
    const isFirstInputRef = useRef(true);

    const totalExistingQty = useMemo(() => {
        if (!product) return 0;
        return currentItems
            .filter(item => item.barcode === product.barcode)
            .reduce((sum, item) => sum + item.quantity, 0);
    }, [currentItems, product]);

    const saleActive = useMemo(() => 
        product ? isSaleActive(product.saleStartDate, product.saleEndDate) : false
    , [product]);

    useEffect(() => {
        if (isOpen) {
            setIsMounted(true); setIsSubmitting(false);
            initAudio();
            const timer = setTimeout(() => setIsVisible(true), 10);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    useEffect(() => {
        if (isOpen && product) {
            setQuantity(1); setCostPrice(product.costPrice || 0); setSellingPrice(product.sellingPrice || 0);
            setCustomName(product.name || ''); setActiveField('quantity');
            isFirstInputRef.current = true;
        }
    }, [isOpen, product, timestamp]);

    if (!isMounted || !product) return null;
    
    const isQuantityValid = !isNaN(Number(quantity)) && Number(quantity) !== 0;
    const isUnregistered = !product.name || product.name === '미등록 상품' || product.name === '';
    const displayName = isUnregistered ? (customName || '미등록 상품') : product.name;

    // Safe close handler
    const handleSafeClose = () => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        setIsVisible(false);
        if (onScanNext) closeScanner();
        
        setTimeout(() => {
            if (isMounted) onClose();
        }, 300);
    };

    const handleSafeSkip = () => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        setIsVisible(false);
        
        setTimeout(() => {
            if (isMounted) {
                onClose();
                if (onScanNext) setTimeout(onScanNext, 200);
            }
        }, 300);
    };

    const handleAddItemAction = (isReturn: boolean, shouldScanNext: boolean) => {
        if (isSubmitting || !isQuantityValid) return;
        setIsSubmitting(true);
        setIsVisible(false); // Start animation immediately

        setTimeout(() => {
            const qty = isReturn ? -Math.abs(Number(quantity)) : Number(quantity);
            onAdd({ barcode: product.barcode, name: displayName, costPrice: Number(costPrice), sellingPrice: Number(sellingPrice), quantity: qty, isNew: true });
            
            if (shouldScanNext && onScanNext) { 
                onClose(); 
                setTimeout(onScanNext, 150); 
            } else { 
                if (onScanNext) closeScanner(); 
                onClose(); 
            }
        }, 300);
    };

    const KeypadButton = ({ onClick, className, children, disabled }: any) => (
        <button 
            type="button"
            onPointerDown={(e) => {
                if (disabled || isSubmitting) return;
                e.preventDefault(); e.stopPropagation();
                playBeep(!!uiFeedback?.soundOnPress);
                onClick();
            }}
            disabled={disabled || isSubmitting}
            className={`active:bg-gray-200 flex items-center justify-center font-bold rounded-lg touch-none select-none ${className} ${disabled || isSubmitting ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
        >
            {children}
        </button>
    );

    const ControllerSection = (
        <div className="flex flex-col gap-1 h-full w-full min-w-0">
            <div className="flex flex-col gap-1 flex-shrink-0 mb-1">
                <div className="grid grid-cols-2 gap-1 mb-0.5">
                    <KeypadButton onClick={handleSafeClose} className="bg-gray-100 text-gray-500 border border-gray-200 h-11"><XCircleIcon className="w-4 h-4 mr-1" />종료</KeypadButton>
                    <KeypadButton onClick={handleSafeSkip} className="bg-white border border-gray-300 text-gray-500 h-11"><ChevronRightIcon className="w-4 h-4 mr-1" />스킵</KeypadButton>
                </div>
                <div className="grid grid-cols-2 gap-1">
                    <KeypadButton onClick={() => handleAddItemAction(true, !!onScanNext)} disabled={!isQuantityValid} className="bg-red-50 text-red-500 border border-red-200 h-11"><ReturnBoxIcon className="w-4 h-4 mr-1" />반품</KeypadButton>
                    <KeypadButton onClick={() => handleAddItemAction(false, false)} disabled={!isQuantityValid} className="bg-white border border-blue-200 text-blue-700 h-11"><SaveIcon className="w-4 h-4 mr-1" />추가&종료</KeypadButton>
                </div>
                {onScanNext && <KeypadButton onClick={() => handleAddItemAction(false, true)} disabled={!isQuantityValid} className={`h-16 mt-1 ${isUnregistered ? 'bg-orange-600' : 'bg-blue-600'} text-white text-lg sm:text-xl active:bg-blue-700`}><BarcodeScannerIcon className="w-5 h-5 sm:w-6 sm:h-6 mr-1.5" />추가 & 스캔</KeypadButton>}
            </div>
            <div className="grid grid-cols-3 gap-1 flex-grow min-h-0">
                {[7, 8, 9, 4, 5, 6, 1, 2, 3].map(num => (
                    <KeypadButton key={num} onClick={() => {
                        const wasFirst = isFirstInputRef.current;
                        const update = (prev: any) => wasFirst ? num : Number(String(prev).replace(/,/g, '') + num);
                        if (activeField === 'quantity') setQuantity(update); else if (activeField === 'cost') setCostPrice(update); else setSellingPrice(update);
                        isFirstInputRef.current = false;
                    }} className="bg-white text-gray-800 text-xl border border-gray-200 font-bold">{num}</KeypadButton>
                ))}
                <KeypadButton onClick={() => {
                    const wasFirst = isFirstInputRef.current;
                    const update = (prev: any) => wasFirst || String(prev) === '0' ? 0 : Number(String(prev).replace(/,/g, '') + '0');
                    if (activeField === 'quantity') setQuantity(update); else if (activeField === 'cost') setCostPrice(update); else setSellingPrice(update);
                    isFirstInputRef.current = false;
                }} className="bg-white text-gray-800 text-xl font-bold border border-gray-200">0</KeypadButton>
                <KeypadButton onClick={() => {
                    if (activeField === 'quantity') setQuantity(0); else if (activeField === 'cost') setCostPrice(0); else setSellingPrice(0);
                    isFirstInputRef.current = true;
                }} className="bg-orange-50 text-orange-600 border border-orange-200 font-bold text-lg">C</KeypadButton>
                <KeypadButton onClick={() => {
                    const toggleSign = (prev: any) => -Number(String(prev).replace(/,/g, ''));
                    if (activeField === 'quantity') setQuantity(toggleSign); else if (activeField === 'cost') setCostPrice(toggleSign); else setSellingPrice(toggleSign);
                    isFirstInputRef.current = false;
                }} className="bg-gray-100 text-gray-800 border border-gray-300 text-2xl font-mono">-</KeypadButton>
            </div>
        </div>
    );

    const InfoSection = (
        <div className="flex flex-col h-full w-full pl-1 overflow-hidden">
            <div className="flex justify-between items-center mb-1 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400 font-mono bg-gray-50 px-1 rounded">{product.barcode}</span>
                </div>
                <KeypadHeaderControls isLocked={!!isPositionLocked} onToggleLock={() => setIsPositionLocked(!isPositionLocked)} isLeft={!!isLeftHanded} onToggleHandedness={() => setIsLeftHanded(!isLeftHanded)} />
            </div>
            
            <div className="mb-2 flex-shrink-0">
                {isUnregistered ? (
                    <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)} onPointerDown={(e) => e.stopPropagation()} placeholder="상품명 직접 입력" className="w-full border-b-2 border-red-300 outline-none text-sm font-bold text-gray-800 bg-transparent py-1" />
                ) : (
                    <h3 className="text-sm font-extrabold text-gray-900 leading-tight break-words">{displayName}</h3>
                )}
            </div>

            <div className="flex-grow flex flex-col gap-1.5 overflow-y-auto no-scrollbar pb-1">
                <div 
                    onPointerDown={(e) => { 
                        e.preventDefault(); e.stopPropagation(); 
                        playBeep(!!uiFeedback?.soundOnPress); 
                        setActiveField('cost'); isFirstInputRef.current = true; 
                    }}
                    className={`border-2 rounded-xl h-12 flex justify-between items-center px-3 flex-shrink-0 transition-none touch-none select-none ${activeField === 'cost' ? 'border-blue-500 bg-white' : 'border-gray-200 bg-gray-50'}`}
                >
                    <span className="text-[10px] font-black text-gray-400 uppercase">매입가</span>
                    <span className="text-lg font-black text-gray-800 tabular-nums">{Number(costPrice).toLocaleString()}</span>
                </div>

                <div 
                    onPointerDown={(e) => { 
                        e.preventDefault(); e.stopPropagation(); 
                        playBeep(!!uiFeedback?.soundOnPress); 
                        setActiveField('selling'); isFirstInputRef.current = true; 
                    }}
                    className={`border-2 rounded-xl h-12 flex justify-between items-center px-3 flex-shrink-0 transition-none touch-none select-none ${activeField === 'selling' ? 'border-blue-500 bg-white' : 'border-blue-100 bg-blue-50/30'}`}
                >
                    <span className="text-[10px] font-black text-blue-500 uppercase">판매가</span>
                    <span className="text-lg font-black text-blue-700 tabular-nums">{Number(sellingPrice).toLocaleString()}</span>
                </div>

                <div className="flex gap-2 h-14 w-full flex-shrink-0">
                    <div className={`${totalExistingQty !== 0 ? 'w-[44%]' : 'w-0 hidden'} border border-gray-300 bg-gray-100 rounded-xl flex flex-col items-center justify-center relative overflow-hidden`}>
                        <label className="absolute top-1 left-2 text-[9px] font-bold text-gray-400">이전</label>
                        <span className="text-2xl font-extrabold text-gray-400 tracking-tight tabular-nums">{totalExistingQty.toLocaleString()}</span>
                    </div>
                    <div 
                        onPointerDown={(e) => { 
                            e.preventDefault(); e.stopPropagation(); 
                            playBeep(!!uiFeedback?.soundOnPress); 
                            setActiveField('quantity'); isFirstInputRef.current = true; 
                        }}
                        className={`${totalExistingQty !== 0 ? 'w-[56%]' : 'w-full'} border-2 rounded-xl flex flex-col items-center justify-center bg-white cursor-pointer relative h-full transition-none touch-none select-none ${activeField === 'quantity' ? 'border-blue-600' : 'border-gray-300'}`}
                    >
                        <label className="absolute top-1 left-2 text-[10px] font-black text-indigo-400 uppercase tracking-tighter">수량 입력</label>
                        <span className="text-3xl font-black text-gray-900 tracking-tighter tabular-nums">{quantity}</span>
                    </div>
                </div>

                {saleActive && (
                    <div className="mt-auto pt-2">
                        <div className="p-2.5 rounded-xl border border-rose-200 bg-rose-50 shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-16 h-16 bg-rose-100 rounded-full -mr-8 -mt-8 opacity-30 pointer-events-none"></div>
                            <div className="flex justify-between items-center mb-1.5 relative z-10">
                                <p className="text-[11px] font-black text-rose-600 leading-tight flex-1 pr-2">{product.saleName}</p>
                                <span className="text-[9px] text-rose-500 font-bold tabular-nums flex-shrink-0 bg-white px-1.5 rounded-full border border-rose-100">{product.saleStartDate?.slice(5)}~{product.saleEndDate?.slice(5)}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-px bg-rose-100 rounded-lg p-[1px] text-center overflow-hidden">
                                <div className="flex flex-col bg-white py-1">
                                    <span className="text-[9px] text-gray-400 font-bold uppercase">행사매입</span>
                                    <b className="text-sm tabular-nums text-rose-600">{product.eventCostPrice?.toLocaleString()}</b>
                                </div>
                                <div className="flex flex-col bg-white py-1">
                                    <span className="text-[9px] text-gray-400 font-bold uppercase">행사판매</span>
                                    <b className="text-sm tabular-nums text-indigo-600">{product.salePrice?.toLocaleString()}</b>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    const backdropClass = onScanNext ? 'bg-black/95' : 'bg-black/50';

    return createPortal(
        <div className={`fixed inset-0 z-[140] flex items-center justify-center transition-colors duration-200 ${isVisible ? backdropClass : 'bg-transparent'}`} onClick={(e) => { if(e.target === e.currentTarget) handleSafeClose(); }} role="dialog" aria-modal="true">
            <KeypadLayout layoutId="receive_modal_layout" isLeftHanded={!!isLeftHanded} onToggleHandedness={() => setIsLeftHanded(!isLeftHanded)} leftContent={InfoSection} rightContent={ControllerSection} />
        </div>,
        document.body
    );
};

export default ReceiveItemModal;
