
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Product } from '../types';
import { useDeviceSettings, useScanner } from '../context/AppContext';
import { useLocalStorage } from '../hooks/useLocalStorage';
import KeypadLayout, { KeypadHeaderControls } from './KeypadLayout';
import { XCircleIcon, SaveIcon, BarcodeScannerIcon, CheckCircleIcon, ChevronRightIcon } from './Icons';

interface StockAuditItemModalProps {
    isOpen: boolean;
    product: Product | null;
    applyMode: 'immediate' | 'batch';
    trigger: 'scan' | 'search';
    prevQty: number;
    onClose: () => void;
    onConfirm: (quantity: number, nextScan: boolean) => void;
    onSkip?: () => void; // 스킵 처리를 위한 콜백 추가
    timestamp?: number;
}

const StockAuditItemModal: React.FC<StockAuditItemModalProps> = ({ 
    isOpen, product, applyMode, trigger, prevQty, onClose, onConfirm, onSkip, timestamp 
}) => {
    const { uiFeedback } = useDeviceSettings();
    const { closeScanner } = useScanner();

    const [isMounted, setIsMounted] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const [isLeftHanded, setIsLeftHanded] = useLocalStorage<boolean>('pos_layout_left_handed', false);
    const [isPositionLocked, setIsPositionLocked] = useLocalStorage<boolean>('pos_modal_locked', false);
    const [qtyStr, setQtyStr] = useState('1');
    const isFirstInputRef = useRef(true);

    const audioCtxRef = useRef<AudioContext | null>(null);

    // [Fix] AudioContext 안전한 재사용 로직
    const getAudioCtx = useCallback(() => {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return null;

        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
            audioCtxRef.current = new AudioContextClass();
        }
        return audioCtxRef.current;
    }, []);

    const playBeep = useCallback(() => {
        if (!uiFeedback?.soundOnPress) return;
        const ctx = getAudioCtx();
        if (!ctx) return;
        
        if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
            ctx.resume().catch(() => {});
        }

        try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = 'square'; osc.frequency.setValueAtTime(2400, ctx.currentTime);
            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
            osc.start(); osc.stop(ctx.currentTime + 0.15);
        } catch (e) {}
    }, [uiFeedback?.soundOnPress, getAudioCtx]);

    useEffect(() => {
        if (isOpen) {
            setIsMounted(true);
            const t = setTimeout(() => setIsVisible(true), 10);
            return () => clearTimeout(t);
        } else {
            setIsVisible(false);
            const t = setTimeout(() => setIsMounted(false), 200);
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

    // 숫자 입력 버튼 (PointerDown)
    const InputButton = ({ onClick, className, children }: any) => (
        <button 
            onPointerDown={(e) => { 
                e.preventDefault(); 
                e.stopPropagation(); 
                playBeep(); 
                onClick(); 
            }} 
            className={`active:scale-95 transition-transform flex items-center justify-center font-bold rounded-lg shadow-sm ${className}`}
        >
            {children}
        </button>
    );

    // 최종 실행 버튼 (Click)
    const ActionButton = ({ onClick, className, children, disabled }: any) => (
        <button 
            onClick={(e) => { 
                e.preventDefault(); 
                e.stopPropagation(); 
                if(!disabled) {
                    playBeep(); 
                    onClick();
                } 
            }} 
            disabled={disabled}
            className={`active:scale-95 transition-transform flex items-center justify-center font-bold rounded-lg shadow-sm whitespace-nowrap ${className} ${disabled ? 'opacity-50' : ''}`}
        >
            {children}
        </button>
    );

    const isImmediate = applyMode === 'immediate';
    const actionLabel = isImmediate ? '적용' : '저장';

    const ControllerSection = (
        <div className="flex flex-col gap-1 h-full w-full min-w-0">
            <div className="flex flex-col gap-1 flex-shrink-0 mb-1">
                {/* 1행: 취소 | 스킵 (스캔 모드일 때만 스킵 표시) */}
                <div className="grid grid-cols-2 gap-1">
                    <ActionButton onClick={() => { closeScanner(); onClose(); }} className="bg-gray-100 text-gray-500 border border-gray-200 h-11 text-xs sm:text-sm font-bold">
                        <XCircleIcon className="w-4 h-4 mr-1" />취소
                    </ActionButton>
                    <ActionButton 
                        onClick={() => { 
                            if (onSkip) onSkip(); 
                            else if (trigger === 'scan') onConfirm(Number(qtyStr), true); 
                            else onClose(); 
                        }} 
                        className="bg-white border border-gray-300 text-gray-500 h-11 text-xs sm:text-sm font-bold"
                    >
                        <ChevronRightIcon className="w-4 h-4 mr-1" />스킵
                    </ActionButton>
                </div>

                {/* 2행: 적용/저장 & 종료 */}
                <ActionButton 
                    onClick={() => onConfirm(Number(qtyStr), false)} 
                    className="bg-white border-2 border-indigo-100 text-indigo-600 h-12 text-xs sm:text-sm font-black shadow-sm"
                >
                    <SaveIcon className="w-4 h-4 mr-1.5" />{actionLabel}&종료
                </ActionButton>

                {/* 3행: 적용/저장 후 스캔 */}
                {trigger === 'scan' ? (
                    <ActionButton 
                        onClick={() => onConfirm(Number(qtyStr), true)} 
                        className="bg-indigo-600 text-white h-16 text-base sm:text-xl shadow-lg font-black"
                    >
                        <BarcodeScannerIcon className="w-5 h-5 sm:w-7 sm:h-7 mr-2" />{actionLabel}후스캔
                    </ActionButton>
                ) : (
                    <ActionButton 
                        onClick={() => onConfirm(Number(qtyStr), false)} 
                        className="bg-indigo-600 text-white h-16 text-base sm:text-xl shadow-lg font-black"
                    >
                        <CheckCircleIcon className="w-5 h-5 sm:w-7 sm:h-7 mr-2" />{isImmediate ? '즉시 적용' : '확인'}
                    </ActionButton>
                )}
            </div>

            {/* 키패드 영역 */}
            <div className="grid grid-cols-3 gap-1 flex-grow">
                {[7, 8, 9, 4, 5, 6, 1, 2, 3].map(n => (
                    <InputButton key={n} onClick={() => {
                        setQtyStr(prev => isFirstInputRef.current ? String(n) : prev + n);
                        isFirstInputRef.current = false;
                    }} className="bg-white text-gray-800 text-xl border border-gray-200 font-bold">{n}</InputButton>
                ))}
                <InputButton onClick={() => {
                    setQtyStr(prev => isFirstInputRef.current ? '0' : (prev === '0' ? '0' : prev + '0'));
                    isFirstInputRef.current = false;
                }} className="bg-white text-gray-800 text-xl border border-gray-200 font-bold">0</InputButton>
                <InputButton onClick={() => { setQtyStr('0'); isFirstInputRef.current = true; }} className="bg-orange-50 text-orange-600 border border-orange-200 font-bold text-lg">C</InputButton>
                <InputButton onClick={() => {
                    setQtyStr(prev => prev.startsWith('-') ? prev.slice(1) : '-' + prev);
                    isFirstInputRef.current = false;
                }} className="bg-gray-100 text-gray-800 border border-gray-300 text-2xl font-mono">-</InputButton>
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
                <h3 className="text-sm font-extrabold text-gray-900 leading-tight line-clamp-2">{product.name}</h3>
                {product.spec && <p className="text-[10px] text-gray-500 mt-0.5 truncate">{product.spec}</p>}
            </div>
            
            <div className="grid grid-cols-2 gap-1.5 mb-2 flex-shrink-0">
                <div className="bg-gray-100 p-2 rounded-lg border border-gray-200 shadow-inner flex flex-col items-center">
                    <p className="text-[9px] font-bold text-gray-500 uppercase leading-none">전산 재고</p>
                    <p className="text-base font-black text-gray-700 mt-1">{product.stockQuantity?.toLocaleString() ?? 0}</p>
                </div>
                <div className="bg-indigo-50 p-2 rounded-lg border border-indigo-100 shadow-inner flex flex-col items-center">
                    <p className="text-[9px] font-bold text-indigo-400 uppercase leading-none">직전 실사</p>
                    <p className="text-base font-black text-indigo-700 mt-1">{prevQty.toLocaleString()}</p>
                </div>
            </div>

            <div className="flex-grow flex flex-col justify-center min-h-0">
                <div 
                    onPointerDown={() => { isFirstInputRef.current = true; playBeep(); }}
                    className={`w-full border-2 border-indigo-600 rounded-xl bg-white shadow-inner flex flex-col items-center justify-center p-3 py-6 relative cursor-pointer active:bg-indigo-50 transition-colors ${isFirstInputRef.current ? 'ring-2 ring-indigo-200' : ''}`}
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

    // 스캔 후 모달이 뜰 때는 95% 블랙 배경으로 설정 (집중도 향상 및 스캔 화면 가림)
    const backdropClass = trigger === 'scan' ? 'bg-black/95' : 'bg-black/50';

    return createPortal(
        <div className={`fixed inset-0 z-[140] flex items-center justify-center transition-colors duration-200 ${isVisible ? backdropClass : 'bg-transparent'}`} onPointerDown={(e) => { if(e.target === e.currentTarget) onClose(); }}>
            <KeypadLayout layoutId="audit_keypad_layout" isLeftHanded={!!isLeftHanded} onToggleHandedness={() => setIsLeftHanded(!isLeftHanded)} leftContent={InfoSection} rightContent={ControllerSection} />
        </div>,
        document.body
    );
};

export default StockAuditItemModal;
