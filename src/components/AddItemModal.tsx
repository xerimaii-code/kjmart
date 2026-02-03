
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Product, OrderItem } from '../types';
import { isSaleActive } from '../hooks/useOrderManager';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useDeviceSettings, useScanner } from '../context/AppContext';
import { BarcodeScannerIcon, XCircleIcon, SaveIcon, ChevronRightIcon, ChatBubbleLeftIcon } from './Icons';
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
        
        // High pitched, short beep for keypad
        osc.frequency.setValueAtTime(2200, now);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        
        osc.start(now);
        osc.stop(now + 0.1);
    } catch (e) {
        // Ignore audio errors
    }
};

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
    const [quantityStr, setQuantityStr] = useState<string>('1');
    const [unit, setUnit] = useState<'개' | '박스'>('개');
    const [memo, setMemo] = useState('');
    
    const isFirstInputRef = useRef(true);

    const saleActive = useMemo(() => 
        product ? isSaleActive(product.saleStartDate, product.saleEndDate) : false
    , [product]);

    useEffect(() => {
        if (isOpen) {
            setIsMounted(true);
            setIsSubmitting(false);
            setQuantityStr('1');
            setMemo(existingItem?.memo || '');
            setUnit(initialSettings?.unit ?? existingItem?.unit ?? '개');
            isFirstInputRef.current = true;
            // Pre-warm audio context
            initAudio();
            
            const timer = setTimeout(() => setIsVisible(true), 10);
            return () => clearTimeout(timer);
        }
    }, [isOpen, timestamp, existingItem, initialSettings]);

    if (!isMounted || !product) return null;

    const isQuantityValid = quantityStr !== '' && !isNaN(Number(quantityStr)) && Number(quantityStr) !== 0;

    // Safe close handler for Cancel button
    const handleSafeClose = () => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        setIsVisible(false);
        if (trigger === 'scan') closeScanner();
        
        setTimeout(() => {
            if (isMounted) onClose();
        }, 300);
    };

    // Safe close for Skip action
    const handleSafeSkip = () => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        setIsVisible(false);
        
        setTimeout(() => {
            if (isMounted) {
                onClose();
                if (onNextScan) setTimeout(onNextScan, 50); // Small additional delay before reopening scanner
            }
        }, 300);
    };

    const handleConfirmAdd = (shouldCloseScanner: boolean, shouldScanNext: boolean) => {
        if (isSubmitting || !isQuantityValid) return;
        setIsSubmitting(true);
        setIsVisible(false);

        // Calculate if we need to wait for animation. 
        // If we are opening scanner immediately, we can be faster, but let's be safe.
        setTimeout(() => {
            onAdd({ quantity: Number(quantityStr), unit, memo: memo.trim() });
            if (shouldCloseScanner) closeScanner();
            onClose();
            if (shouldScanNext && onNextScan) setTimeout(onNextScan, 200);
        }, 300);
    };

    // Updated KeypadButton using onPointerDown for instant reaction
    const KeypadButton = ({ onClick, className, children, disabled }: any) => (
        <button 
            type="button"
            onPointerDown={(e) => {
                if (disabled || isSubmitting) return;
                e.preventDefault(); // Prevent ghost clicks
                e.stopPropagation();
                playBeep(!!uiFeedback?.soundOnPress);
                onClick();
            }}
            disabled={disabled || isSubmitting}
            className={`flex items-center justify-center font-bold rounded-lg active:bg-gray-200 touch-none select-none ${className} ${disabled || isSubmitting ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
        >
            {children}
        </button>
    );

    const ControllerSection = (
        <div className="flex flex-col gap-1 h-full w-full min-w-0" onPointerDown={e => e.stopPropagation()}>
            <div className="flex flex-col gap-1 flex-shrink-0 mb-1">
                {trigger === 'scan' ? (
                    <>
                        <div className="grid grid-cols-2 gap-1">
                            <KeypadButton onClick={handleSafeClose} className="bg-gray-100 text-gray-500 border border-gray-200 h-11 text-xs sm:text-sm"><XCircleIcon className="w-4 h-4 mr-1" />취소</KeypadButton>
                            <KeypadButton onClick={handleSafeSkip} className="bg-white border border-gray-300 text-gray-600 h-11 text-xs sm:text-sm"><ChevronRightIcon className="w-4 h-4 mr-1" />스킵</KeypadButton>
                        </div>
                        <KeypadButton onClick={() => handleConfirmAdd(true, false)} disabled={!isQuantityValid} className="bg-white border border-blue-200 text-blue-700 h-11"><SaveIcon className="w-4 h-4 mr-1" />저장 & 종료</KeypadButton>
                        <KeypadButton onClick={() => handleConfirmAdd(false, true)} disabled={!isQuantityValid} className="w-full bg-blue-600 text-white h-14 text-lg sm:text-xl active:bg-blue-700"><BarcodeScannerIcon className="w-5 h-5 sm:w-6 sm:h-6 mr-1.5" />추가 & 스캔</KeypadButton>
                    </>
                ) : (
                    <div className="flex flex-col gap-1">
                        <KeypadButton onClick={handleSafeClose} className="bg-gray-100 text-gray-500 border border-gray-200 h-11"><XCircleIcon className="w-4 h-4 mr-1" />취소</KeypadButton>
                        <KeypadButton onClick={() => handleConfirmAdd(false, false)} disabled={!isQuantityValid} className="bg-blue-600 text-white h-16 text-lg sm:text-xl active:bg-blue-700"><SaveIcon className="w-6 h-6 mr-1.5" />확인</KeypadButton>
                    </div>
                )}
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
                <KeypadButton onClick={() => { setQuantityStr('1'); isFirstInputRef.current = true; }} className="bg-red-50 text-red-600 border border-red-200 text-lg font-bold">C</KeypadButton>
                <KeypadButton onClick={() => setQuantityStr(prev => prev.startsWith('-') ? prev.slice(1) : '-' + prev)} className="bg-gray-100 text-gray-800 border border-gray-300 text-2xl font-mono">-</KeypadButton>
            </div>
        </div>
    );

    const InfoSection = (
        <div className="flex flex-col h-full w-full pl-1 overflow-hidden" onPointerDown={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-1 flex-shrink-0">
                <span className="text-[10px] text-gray-400 font-mono bg-gray-50 px-1 rounded">{product.barcode}</span>
                <KeypadHeaderControls isLocked={!!isPositionLocked} onToggleLock={() => setIsPositionLocked(!isPositionLocked)} isLeft={!!isLeftHanded} onToggleHandedness={() => setIsLeftHanded(!isLeftHanded)} />
            </div>
            
            <div className="mb-2 flex-shrink-0">
                <h3 className="text-sm font-extrabold text-gray-900 leading-tight break-words">{product.name}</h3>
            </div>

            <div className="flex-grow flex flex-col gap-1.5 overflow-y-auto no-scrollbar pb-1">
                <div className="grid grid-cols-2 gap-1.5 flex-shrink-0">
                    <div className="border border-gray-200 bg-gray-50 rounded-lg h-9 flex justify-between items-center px-2">
                        <span className="text-[9px] font-bold text-gray-400 uppercase">매입</span>
                        <span className="text-xs font-black text-gray-600 tabular-nums">{product.costPrice?.toLocaleString()}</span>
                    </div>
                    <div className="border border-gray-200 bg-gray-50 rounded-lg h-9 flex justify-between items-center px-2">
                        <span className="text-[9px] font-bold text-gray-400 uppercase">판매</span>
                        <span className="text-xs font-black text-gray-600 tabular-nums">{product.sellingPrice?.toLocaleString()}</span>
                    </div>
                </div>

                <div className="flex gap-2 h-14 w-full flex-shrink-0">
                    <div className={`${existingItem ? 'w-[44%]' : 'w-0 hidden'} border border-gray-300 bg-gray-100 rounded-xl flex flex-col items-center justify-center relative overflow-hidden`}>
                        <label className="absolute top-1 left-2 text-[9px] font-bold text-gray-400">이전</label>
                        <span className="text-2xl font-extrabold text-gray-400 tracking-tighter tabular-nums">{existingItem?.quantity.toLocaleString() || 0}</span>
                    </div>
                    <div 
                        onPointerDown={(e) => { 
                            e.preventDefault(); e.stopPropagation(); 
                            playBeep(!!uiFeedback?.soundOnPress); 
                            isFirstInputRef.current = true; 
                        }}
                        className={`${existingItem ? 'w-[56%]' : 'w-full'} border-2 rounded-xl flex flex-col items-center justify-center bg-white cursor-pointer relative h-full touch-none select-none ${isFirstInputRef.current ? 'border-blue-600 bg-blue-50/10' : 'border-gray-300'}`}
                    >
                        <label className="absolute top-1 left-2 text-[9px] font-bold text-gray-400">발주수량</label>
                        <span className="text-3xl font-black text-gray-900 tracking-tighter tabular-nums">{quantityStr}</span>
                    </div>
                </div>

                <div className="flex gap-1 h-8 flex-shrink-0">
                    <button 
                        onPointerDown={(e) => { 
                            e.preventDefault(); e.stopPropagation();
                            playBeep(!!uiFeedback?.soundOnPress); 
                            setUnit('개'); 
                        }} 
                        className={`flex-1 rounded-lg text-[11px] font-black border touch-none select-none ${unit === '개' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-500'}`}
                    >
                        낱개
                    </button>
                    <button 
                        onPointerDown={(e) => { 
                            e.preventDefault(); e.stopPropagation();
                            playBeep(!!uiFeedback?.soundOnPress); 
                            setUnit('박스'); 
                        }} 
                        className={`flex-1 rounded-lg text-[11px] font-black border touch-none select-none ${unit === '박스' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-500'}`}
                    >
                        박스
                    </button>
                </div>
                
                <div className="bg-white border border-gray-300 rounded-lg flex items-center px-2 h-9 flex-shrink-0">
                    <ChatBubbleLeftIcon className="w-3.5 h-3.5 text-gray-400 mr-1.5" />
                    <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} onPointerDown={(e) => e.stopPropagation()} placeholder="메모 입력" className="w-full h-full bg-transparent outline-none text-xs text-gray-800 placeholder-gray-400" />
                </div>

                {saleActive && (
                    <div className="mt-auto pt-2">
                        <div className="p-2.5 rounded-xl border border-rose-200 bg-rose-50 shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-16 h-16 bg-rose-100 rounded-full -mr-8 -mt-8 opacity-30 pointer-events-none"></div>
                            <div className="flex justify-between items-center mb-1.5 relative z-10">
                                <p className="text-[11px] font-black text-rose-600 leading-tight flex-1 pr-2 truncate">{product.saleName}</p>
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

    const backdropClass = trigger === 'scan' ? 'bg-black/95' : 'bg-black/50';

    return createPortal(
        <div className={`fixed inset-0 z-[140] flex items-center justify-center transition-colors duration-200 ${isVisible ? backdropClass : 'bg-transparent'}`} onClick={(e) => { if (e.target === e.currentTarget) handleSafeClose(); }} role="dialog" aria-modal="true">
            <KeypadLayout layoutId="add_item_modal_layout" isLeftHanded={!!isLeftHanded} onToggleHandedness={() => setIsLeftHanded(!isLeftHanded)} leftContent={InfoSection} rightContent={ControllerSection} />
        </div>,
        document.body
    );
};

export default AddItemModal;
