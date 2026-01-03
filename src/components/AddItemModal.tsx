
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
    const [quantityStr, setQuantityStr] = useState<string>('1');
    const [unit, setUnit] = useState<'개' | '박스'>('개');
    const [memo, setMemo] = useState('');
    const isFirstInputRef = useRef(true);

    const audioCtxRef = useRef<AudioContext | null>(null);

    // [Fix] AudioContext 생성을 안전하게 처리 및 재사용
    const getAudioCtx = useCallback(() => {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return null;

        // 기존 컨텍스트가 없거나 닫혀있으면(백그라운드 킬 등으로 인해) 새로 생성
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
            audioCtxRef.current = new AudioContextClass();
        }
        return audioCtxRef.current;
    }, []);

    const playKeypadBeep = useCallback(() => {
        if (!uiFeedback?.soundOnPress) return;
        const ctx = getAudioCtx();
        if (!ctx) return;
        
        // [Fix] 터치 시점마다 resume 시도 (안드로이드 절전모드 복귀 대응)
        if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
            ctx.resume().catch(() => {});
        }
        
        try {
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);
            oscillator.type = 'square';
            oscillator.frequency.setValueAtTime(2400, ctx.currentTime);
            gainNode.gain.setValueAtTime(0, ctx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 0.005);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
            oscillator.start(ctx.currentTime);
            oscillator.stop(ctx.currentTime + 0.15);
        } catch (e) {}
    }, [uiFeedback?.soundOnPress, getAudioCtx]);

    useEffect(() => {
        if (isOpen) {
            setIsMounted(true); setIsSubmitting(false);
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
            setQuantityStr('1');
            setUnit(initialSettings?.unit ?? existingItem?.unit ?? '개');
            setMemo(existingItem?.memo || '');
            isFirstInputRef.current = true;
        }
    }, [isOpen, product, existingItem, initialSettings, timestamp]);

    if (!isMounted || !product) return null;

    const finalQuantity = Number(quantityStr);
    const isQuantityValid = !isNaN(finalQuantity) && finalQuantity !== 0;

    const ActionButton = ({ onClick, className, children, disabled }: any) => (
        <button 
            onClick={(e) => { 
                e.preventDefault(); 
                e.stopPropagation(); 
                if (!disabled && !isSubmitting) {
                    playKeypadBeep(); 
                    onClick(); 
                }
            }} 
            disabled={disabled || isSubmitting} 
            className={`active:scale-95 transition-transform flex items-center justify-center font-bold rounded-lg shadow-sm whitespace-nowrap ${className} ${disabled || isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
            {children}
        </button>
    );

    const InputButton = ({ onClick, className, children, disabled }: any) => (
        <button 
            onPointerDown={(e) => { 
                e.preventDefault(); 
                e.stopPropagation(); 
                if (!disabled) {
                    playKeypadBeep(); 
                    onClick(); 
                }
            }} 
            disabled={disabled}
            className={`active:scale-95 transition-transform flex items-center justify-center font-bold rounded-lg shadow-sm ${className} ${disabled ? 'opacity-50' : ''}`}
        >
            {children}
        </button>
    );

    const ControllerSection = (
        <div className="flex flex-col gap-1 h-full w-full min-w-0" onClick={e => e.stopPropagation()}>
            <div className="flex flex-col gap-1 flex-shrink-0 mb-1">
                {trigger === 'scan' ? (
                    <>
                        <div className="grid grid-cols-2 gap-1">
                            <ActionButton onClick={() => { closeScanner(); onClose(); }} className="bg-gray-100 text-gray-500 border border-gray-200 h-11 text-xs sm:text-sm"><XCircleIcon className="w-4 h-4 mr-1" />취소</ActionButton>
                            <ActionButton onClick={() => { onClose(); if (onNextScan) setTimeout(onNextScan, 200); }} className="bg-white border border-gray-300 text-gray-600 h-11 text-xs sm:text-sm"><ChevronRightIcon className="w-4 h-4 mr-1" />스킵</ActionButton>
                        </div>
                        <ActionButton onClick={() => { onAdd({ quantity: finalQuantity, unit, memo: memo.trim() }); closeScanner(); onClose(); }} disabled={!isQuantityValid} className="bg-white border border-blue-200 text-blue-700 font-bold py-2.5 text-xs sm:text-sm h-11"><SaveIcon className="w-4 h-4 mr-1" />저장 & 종료</ActionButton>
                        <ActionButton onClick={() => { onAdd({ quantity: finalQuantity, unit, memo: memo.trim() }); onClose(); if (onNextScan) setTimeout(onNextScan, 200); }} disabled={!isQuantityValid} className="w-full shadow-md bg-blue-600 text-white py-3 text-sm sm:text-lg font-extrabold h-14"><BarcodeScannerIcon className="w-5 h-5 sm:w-6 sm:h-6 mr-1.5" />추가 & 스캔</ActionButton>
                    </>
                ) : (
                    <div className="flex flex-col gap-1">
                        <ActionButton onClick={onClose} className="bg-gray-100 text-gray-500 border border-gray-200 h-11 text-xs sm:text-sm"><XCircleIcon className="w-4 h-4 mr-1" />취소</ActionButton>
                        <ActionButton onClick={() => { onAdd({ quantity: finalQuantity, unit, memo: memo.trim() }); onClose(); }} disabled={!isQuantityValid} className="bg-blue-600 text-white hover:bg-blue-700 font-extrabold h-16 text-lg sm:text-xl shadow-md"><SaveIcon className="w-6 h-6 mr-1.5" />확인</ActionButton>
                    </div>
                )}
            </div>
            <div className="grid grid-cols-3 gap-1 flex-grow min-h-0">
                {[7, 8, 9, 4, 5, 6, 1, 2, 3].map(num => (
                    <InputButton key={num} onClick={() => {
                        const wasFirst = isFirstInputRef.current;
                        setQuantityStr(prev => (wasFirst || prev === '0') ? String(num) : prev + num);
                        isFirstInputRef.current = false;
                    }} className="bg-white text-gray-800 text-xl border border-gray-200 shadow-sm">{num}</InputButton>
                ))}
                <InputButton onClick={() => {
                    if (isFirstInputRef.current) return;
                    setQuantityStr(prev => prev === '0' ? '0' : prev + '0');
                }} className="bg-white text-gray-800 text-xl border border-gray-200 shadow-sm">0</InputButton>
                <InputButton onClick={() => { setQuantityStr('0'); isFirstInputRef.current = true; }} className="bg-red-50 text-red-600 border border-red-200 text-lg font-bold">C</InputButton>
                <InputButton onClick={() => setQuantityStr(prev => prev.startsWith('-') ? prev.slice(1) : '-' + prev)} className="bg-gray-100 text-gray-800 border border-gray-300 text-2xl font-bold font-mono shadow-sm">-</InputButton>
            </div>
        </div>
    );

    const InfoSection = (
        <div className="flex flex-col h-full w-full pl-1 overflow-y-auto min-w-0" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-1 flex-shrink-0">
                <span className="text-[10px] text-gray-400 font-mono bg-gray-50 px-1 rounded">{product.barcode}</span>
                <KeypadHeaderControls isLocked={!!isPositionLocked} onToggleLock={() => setIsPositionLocked(!isPositionLocked)} isLeft={!!isLeftHanded} onToggleHandedness={() => setIsLeftHanded(!isLeftHanded)} />
            </div>
            <div className="mb-2 flex-shrink-0 min-h-[2.5rem]"><div className="flex items-start gap-1">{(product.saleStartDate && product.saleEndDate && isSaleActive(product.saleStartDate, product.saleEndDate)) && <span className="bg-red-100 text-red-600 text-[10px] font-extrabold px-1.5 py-0.5 rounded border border-red-200 flex-shrink-0 mt-0.5">행사중</span>}<h3 className="text-sm font-extrabold text-gray-900 leading-tight break-keep line-clamp-2">{product.name}</h3></div>{product.spec && <p className="text-[10px] text-gray-500 mt-0.5 truncate">{product.spec}</p>}</div>
            <div className="flex items-center justify-between bg-gray-50 px-2 py-1.5 rounded text-xs text-gray-600 mb-2 flex-shrink-0 border border-gray-100"><div className="flex gap-3 w-full justify-around"><div className="flex items-center gap-1"><span className="text-gray-500">매입</span><b className="text-gray-900">{product.costPrice.toLocaleString()}</b></div><div className="flex items-center gap-1"><span className="text-gray-500">판매</span><b className="text-gray-900">{product.sellingPrice?.toLocaleString()}</b></div></div></div>
            <div className="flex-grow flex flex-col min-h-0 mb-1">
                <div className="flex gap-2 h-12 mb-2 flex-shrink-0">
                    {(existingItem?.quantity || 0) > 0 ? (
                        <>
                            <div className="w-[40%] border-2 border-gray-300 bg-gray-100 rounded-xl flex flex-col items-center justify-center relative shadow-inner">
                                <label className="absolute top-1 left-2 text-[9px] font-bold text-gray-400">M</label>
                                <span className="text-2xl font-extrabold text-gray-500 tracking-tight">{existingItem?.quantity.toLocaleString()}</span>
                            </div>
                            <div 
                                onPointerDown={() => { playKeypadBeep(); isFirstInputRef.current = true; }} 
                                className="w-[60%] border-2 border-blue-600 ring-2 ring-blue-50 rounded-xl flex flex-col items-center justify-center bg-white shadow-inner cursor-pointer relative overflow-hidden"
                            >
                                <label className="absolute top-1 left-2 text-[9px] font-bold text-gray-400">수량</label>
                                <span className="text-2xl font-extrabold text-gray-900 tracking-tight z-10">{quantityStr}</span>
                            </div>
                        </>
                    ) : (
                        <div 
                            onPointerDown={() => { playKeypadBeep(); isFirstInputRef.current = true; }} 
                            className="w-full border-2 border-blue-600 ring-2 ring-blue-50 rounded-xl flex items-center justify-center bg-white shadow-inner cursor-pointer relative overflow-hidden h-full"
                        >
                            <label className="absolute top-1 left-2 text-[9px] font-bold text-gray-400">수량</label>
                            <span className="text-2xl font-extrabold text-gray-900 tracking-tight z-10">{quantityStr}</span>
                        </div>
                    )}
                </div>
                <div className="flex gap-1 h-8 flex-shrink-0 mb-2">
                    <button onPointerDown={() => setUnit('개')} className={`flex-1 rounded-lg text-xs font-bold border transition-all ${unit === '개' ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white border-gray-200 text-gray-500'}`}>낱개</button>
                    <button onPointerDown={() => setUnit('박스')} className={`flex-1 rounded-lg text-xs font-bold border transition-all ${unit === '박스' ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white border-gray-200 text-gray-500'}`}>박스</button>
                </div>
                <div className="bg-white border border-gray-300 rounded-lg flex items-center px-2 h-9 mb-2 flex-shrink-0"><ChatBubbleLeftIcon className="w-3.5 h-3.5 text-gray-400 mr-1.5 flex-shrink-0" /><input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => { e.stopPropagation(); playKeypadBeep(); }} placeholder="메모 입력" className="w-full h-full bg-transparent outline-none text-xs text-gray-800 placeholder-gray-400" /></div>
            </div>
        </div>
    );

    // 스캔 후 모달이 뜰 때는 95% 블랙 배경으로 설정 (집중도 향상 및 스캔 화면 가림)
    const backdropClass = trigger === 'scan' ? 'bg-black/95' : 'bg-black/50';

    return createPortal(
        <div className={`fixed inset-0 z-[140] flex items-center justify-center transition-colors duration-200 ${isVisible ? backdropClass : 'bg-transparent'}`} onClick={() => { closeScanner(); onClose(); }} role="dialog" aria-modal="true">
            <KeypadLayout layoutId="add_item_modal_layout" isLeftHanded={!!isLeftHanded} onToggleHandedness={() => setIsLeftHanded(!isLeftHanded)} leftContent={InfoSection} rightContent={ControllerSection} />
        </div>,
        document.body
    );
};

export default AddItemModal;
