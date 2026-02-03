
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Product } from '../types';
import { useDeviceSettings, useScanner } from '../context/AppContext';
import { useLocalStorage } from '../hooks/useLocalStorage';
import KeypadLayout, { KeypadHeaderControls } from './KeypadLayout';
import { XCircleIcon, SaveIcon, BarcodeScannerIcon, CheckCircleIcon, ChevronRightIcon } from './Icons';

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

interface StockAuditItemModalProps {
    isOpen: boolean;
    product: Product | null;
    applyMode: 'immediate' | 'batch';
    trigger: 'scan' | 'search';
    prevQty: number;
    onClose: () => void;
    onConfirm: (quantity: number, nextScan: boolean) => void;
    onSkip?: () => void; 
    timestamp?: number;
}

const StockAuditItemModal: React.FC<StockAuditItemModalProps> = ({ 
    isOpen, product, applyMode, trigger, prevQty, onClose, onConfirm, onSkip, timestamp 
}) => {
    const { uiFeedback } = useDeviceSettings();
    const { closeScanner } = useScanner();

    const [isMounted, setIsMounted] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLeftHanded, setIsLeftHanded] = useLocalStorage<boolean>('pos_layout_left_handed', false);
    const [isPositionLocked, setIsPositionLocked] = useLocalStorage<boolean>('pos_modal_locked', false);
    const [qtyStr, setQtyStr] = useState('1');
    const isFirstInputRef = useRef(true);

    useEffect(() => {
        if (isOpen) {
            setIsMounted(true);
            setIsSubmitting(false);
            initAudio();
            const t = setTimeout(() => setIsVisible(true), 10);
            return () => clearTimeout(t);
        } else {
            setIsVisible(false);
            const t = setTimeout(() => setIsMounted(false), 150);
            return () => clearTimeout(t);
        }
    }, [isOpen]);

    useEffect(() => {
        if (isOpen && product) {
            setQtyStr('1');
            isFirstInputRef.current = true;
        }
    }, [isOpen, product, timestamp]);

    if (!isMounted || !product) return null;

    const KeypadButton = ({ onClick, className, children }: any) => (
        <button 
            type="button"
            onPointerDown={(e) => { 
                if (isSubmitting) return;
                e.preventDefault(); e.stopPropagation();
                playBeep(!!uiFeedback?.soundOnPress); 
                onClick(); 
            }}
            disabled={isSubmitting}
            className={`active:bg-gray-200 flex items-center justify-center font-bold rounded-lg touch-none select-none ${className} ${isSubmitting ? 'opacity-50 pointer-events-none' : ''}`}
        >
            {children}
        </button>
    );

    const ActionButton = ({ onAction, className, children, disabled }: any) => (
        <button 
            type="button"
            onPointerDown={(e) => { 
                if (disabled || isSubmitting) return;
                e.preventDefault(); e.stopPropagation();
                playBeep(!!uiFeedback?.soundOnPress); 
                onAction(); 
            }}
            disabled={disabled || isSubmitting}
            className={`active:bg-gray-200 flex items-center justify-center font-bold rounded-lg whitespace-nowrap touch-none select-none ${className} ${disabled || isSubmitting ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
        >
            {children}
        </button>
    );

    const isImmediate = applyMode === 'immediate';
    const actionLabel = isImmediate ? '적용' : '저장';

    const ControllerSection = (
        <div className="flex flex-col gap-1 h-full w-full min-w-0">
            <div className="flex flex-col gap-1 flex-shrink-0 mb-1">
                <div className="grid grid-cols-2 gap-1">
                    <ActionButton onAction={() => { closeScanner(); onClose(); }} className="bg-gray-100 text-gray-500 border border-gray-200 h-11 text-xs sm:text-sm font-bold">
                        <XCircleIcon className="w-4 h-4 mr-1" />취소
                    </ActionButton>
                    <ActionButton 
                        onAction={() => { 
                            if (onSkip) onSkip(); 
                            else if (trigger === 'scan') onConfirm(Number(qtyStr), true); 
                            else onClose(); 
                        }} 
                        className="bg-white border border-gray-300 text-gray-500 h-11 text-xs sm:text-sm font-bold"
                    >
                        <ChevronRightIcon className="w-4 h-4 mr-1" />스킵
                    </ActionButton>
                </div>
                <ActionButton 
                    onAction={() => onConfirm(Number(qtyStr), false)} 
                    className="bg-white border-2 border-indigo-100 text-indigo-600 h-12 text-xs sm:text-sm font-black"
                >
                    <SaveIcon className="w-4 h-4 mr-1.5" />{actionLabel}&종료
                </ActionButton>
                {trigger === 'scan' ? (
                    <ActionButton 
                        onAction={() => onConfirm(Number(qtyStr), true)} 
                        className="bg-indigo-600 text-white h-16 text-base sm:text-xl font-black active:bg-indigo-700"
                    >
                        <BarcodeScannerIcon className="w-5 h-5 sm:w-7 sm:h-7 mr-2" />{actionLabel}후스캔
                    </ActionButton>
                ) : (
                    <ActionButton 
                        onAction={() => onConfirm(Number(qtyStr), false)} 
                        className="bg-indigo-600 text-white h-16 text-base sm:text-xl font-black active:bg-indigo-700"
                    >
                        <CheckCircleIcon className="w-5 h-5 sm:w-7 sm:h-7 mr-2" />{isImmediate ? '즉시 적용' : '확인'}
                    </ActionButton>
                )}
            </div>
            <div className="grid grid-cols-3 gap-1 flex-grow">
                {[7, 8, 9, 4, 5, 6, 1, 2, 3].map(n => (
                    <KeypadButton key={n} onClick={() => {
                        setQtyStr(prev => isFirstInputRef.current ? String(n) : prev + n);
                        isFirstInputRef.current = false;
                    }} className="bg-white text-gray-800 text-xl border border-gray-200 font-bold">{n}</KeypadButton>
                ))}
                <KeypadButton onClick={() => {
                    setQtyStr(prev => isFirstInputRef.current ? '0' : (prev === '0' ? '0' : prev + '0'));
                    isFirstInputRef.current = false;
                }} className="bg-white text-gray-800 text-xl border border-gray-200 font-bold">0</KeypadButton>
                <KeypadButton onClick={() => { setQtyStr('0'); isFirstInputRef.current = true; }} className="bg-orange-50 text-orange-600 border border-orange-200 font-bold text-lg">C</KeypadButton>
                <KeypadButton onClick={() => {
                    setQtyStr(prev => prev.startsWith('-') ? prev.slice(1) : '-' + prev);
                    isFirstInputRef.current = false;
                }} className="bg-gray-100 text-gray-800 border border-gray-300 text-2xl font-mono">-</KeypadButton>
            </div>
        </div>
    );

    const InfoSection = (
        <div className="flex flex-col h-full w-full pl-1 overflow-y-auto">
            <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] text-gray-400 font-mono bg-gray-50 px-1 rounded">{product.barcode}</span>
                <KeypadHeaderControls isLocked={!!isPositionLocked} onToggleLock={() => setIsPositionLocked(!isPositionLocked)} isLeft={!!isLeftHanded} onToggleHandedness={() => setIsLeftHanded(!isLeftHanded)} />
            </div>
            <div className="mb-2">
                <h3 className="text-sm font-extrabold text-gray-900 leading-snug break-words whitespace-pre-wrap">{product.name}</h3>
                {product.spec && <p className="text-[10px] text-gray-500 mt-1 break-words">{product.spec}</p>}
            </div>
            <div className="grid grid-cols-2 gap-1.5 mb-2 flex-shrink-0">
                <div className="bg-gray-100 p-2 rounded-lg border border-gray-200 flex flex-col items-center">
                    <p className="text-[9px] font-bold text-gray-500 uppercase leading-none">전산 재고</p>
                    <p className="text-base font-black text-gray-700 mt-1">{product.stockQuantity?.toLocaleString() ?? 0}</p>
                </div>
                <div className="bg-indigo-50 p-2 rounded-lg border border-indigo-100 flex flex-col items-center">
                    <p className="text-[9px] font-bold text-indigo-400 uppercase leading-none">직전 실사</p>
                    <p className="text-base font-black text-indigo-700 mt-1">{prevQty.toLocaleString()}</p>
                </div>
            </div>
            <div className="flex-grow flex flex-col justify-center min-h-0">
                <div 
                    onPointerDown={(e) => { 
                        e.preventDefault(); e.stopPropagation(); 
                        playBeep(!!uiFeedback?.soundOnPress); 
                        isFirstInputRef.current = true; 
                    }}
                    className={`w-full border-2 rounded-xl bg-white flex flex-col items-center justify-center p-3 py-6 relative cursor-pointer active:bg-indigo-50 transition-none touch-none select-none ${isFirstInputRef.current ? 'border-indigo-600 bg-indigo-50/10' : 'border-gray-200'}`}
                >
                    <label className="absolute top-1.5 left-2 text-[10px] font-black text-indigo-400 uppercase tracking-tighter">실사 수량 입력</label>
                    <span className="text-5xl font-black text-gray-900 tracking-tighter tabular-nums">{qtyStr}</span>
                    <div className="absolute bottom-1 right-2 animate-pulse">
                        <div className="w-1.5 h-6 bg-indigo-200 rounded-full"></div>
                    </div>
                </div>
            </div>
        </div>
    );

    const backdropClass = trigger === 'scan' ? 'bg-black/95' : 'bg-black/50';

    return createPortal(
        <div className={`fixed inset-0 z-[140] flex items-center justify-center transition-colors duration-200 ${isVisible ? backdropClass : 'bg-transparent'}`} onClick={(e) => { if(e.target === e.currentTarget && !isSubmitting) onClose(); }} role="dialog" aria-modal="true">
            <KeypadLayout layoutId="audit_keypad_layout" isLeftHanded={!!isLeftHanded} onToggleHandedness={() => setIsLeftHanded(!isLeftHanded)} leftContent={InfoSection} rightContent={ControllerSection} />
        </div>,
        document.body
    );
};

export default StockAuditItemModal;
