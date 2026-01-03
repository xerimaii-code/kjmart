
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { OrderItem } from '../types';
import { useDataState, useDeviceSettings } from '../context/AppContext';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { XCircleIcon, SaveIcon, ChatBubbleLeftIcon, BarcodeScannerIcon } from './Icons';
import KeypadLayout, { KeypadHeaderControls } from './KeypadLayout';

interface EditItemModalProps {
    isOpen: boolean;
    item: OrderItem | null;
    onClose: () => void;
    onSave: (details: { quantity: number; unit: '개' | '박스'; memo?: string; }) => void;
    onScanNext?: () => void;
}

const EditItemModal: React.FC<EditItemModalProps> = ({ isOpen, item, onSave, onClose, onScanNext }) => {
    const { uiFeedback } = useDeviceSettings();
    const [activeItem, setActiveItem] = useState<OrderItem | null>(item);
    const [isMounted, setIsMounted] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const [isLeftHanded, setIsLeftHanded] = useLocalStorage<boolean>('pos_layout_left_handed', false);
    const [isPositionLocked, setIsPositionLocked] = useLocalStorage<boolean>('pos_modal_locked', false);
    const [quantityStr, setQuantityStr] = useState<string>('0');
    const [unit, setUnit] = useState<'개' | '박스'>('개');
    const [memo, setMemo] = useState('');
    const isFirstInputRef = useRef(true);

    const { products } = useDataState();
    const product = useMemo(() => activeItem ? products.find(p => p.barcode === activeItem.barcode) : null, [activeItem, products]);
    
    const audioCtxRef = useRef<AudioContext | null>(null);
    useEffect(() => {
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioContextClass && !audioCtxRef.current) audioCtxRef.current = new AudioContextClass();
        } catch (e) { }
    }, []);

    const playKeypadBeep = useCallback(() => {
        if (!uiFeedback?.soundOnPress) return;
        const audioCtx = audioCtxRef.current;
        if (!audioCtx) return;
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        try {
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            oscillator.type = 'square';
            oscillator.frequency.setValueAtTime(2400, audioCtx.currentTime);
            gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.8, audioCtx.currentTime + 0.005);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);
            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + 0.15);
        } catch (e) {}
    }, [uiFeedback?.soundOnPress]);

    useEffect(() => { if (item) setActiveItem(item); }, [item]);
    useEffect(() => {
        if (isOpen) {
            setIsMounted(true);
            const timer = setTimeout(() => setIsVisible(true), 10);
            return () => clearTimeout(timer);
        } else {
            setIsVisible(false);
            const timer = setTimeout(() => setIsMounted(false), 200);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    useEffect(() => {
        if (isOpen && item) {
            setQuantityStr(String(item.quantity)); setUnit(item.unit); setMemo(item.memo || '');
            isFirstInputRef.current = true;
        }
    }, [isOpen, item]);

    if (!isMounted || !activeItem) return null;

    const isQuantityValid = quantityStr !== '' && !isNaN(Number(quantityStr));

    const handleKeypadPress = (action: () => void) => {
        playKeypadBeep(); 
        action();
    };

    const handleSaveAndScan = () => {
        onSave({ quantity: Number(quantityStr), unit, memo: memo.trim() });
        onClose();
        if (onScanNext) {
            setTimeout(onScanNext, 200);
        }
    };

    const ControllerSection = (
        <div className="flex flex-col gap-1 h-full w-full min-w-0" onClick={e => e.stopPropagation()}>
            <div className="flex flex-col gap-1 flex-shrink-0 mb-1">
                <div className="grid grid-cols-2 gap-1">
                     <button 
                        onClick={(e) => { e.stopPropagation(); onClose(); }} 
                        className="bg-gray-100 text-gray-500 border border-gray-200 h-12 text-xs sm:text-sm font-bold rounded-lg shadow-sm active:scale-95 flex items-center justify-center gap-1 transition-transform whitespace-nowrap"
                    >
                        <XCircleIcon className="w-4 h-4" />취소
                    </button>
                    <button 
                        onClick={(e) => { 
                            e.stopPropagation();
                            if(isQuantityValid) {
                                onSave({ quantity: Number(quantityStr), unit, memo: memo.trim() }); 
                                onClose(); 
                            }
                        }} 
                        disabled={!isQuantityValid}
                        className="bg-blue-600 text-white font-bold h-12 text-sm sm:text-lg rounded-lg shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-transform whitespace-nowrap"
                    >
                        <SaveIcon className="w-5 h-5" />저장
                    </button>
                </div>
                 {onScanNext && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); if(isQuantityValid) handleSaveAndScan(); }}
                        disabled={!isQuantityValid}
                        className="bg-blue-600 text-white font-extrabold h-16 text-base sm:text-xl rounded-lg shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-transform whitespace-nowrap"
                    >
                        <BarcodeScannerIcon className="w-5 h-5 sm:w-6 sm:h-6 mr-1.5" />저장 & 스캔
                    </button>
                )}
            </div>
            <div className="grid grid-cols-3 gap-1 flex-grow min-h-0">
                {[7, 8, 9, 4, 5, 6, 1, 2, 3].map(num => (
                    <button 
                        key={num} 
                        onPointerDown={(e) => {
                            e.preventDefault(); e.stopPropagation();
                            handleKeypadPress(() => {
                                const wasFirst = isFirstInputRef.current;
                                setQuantityStr(prev => (wasFirst || prev === '0') ? String(num) : prev + num);
                                isFirstInputRef.current = false;
                            });
                        }} 
                        className="bg-white text-gray-800 text-xl border border-gray-200 font-bold rounded-lg shadow-sm active:scale-95"
                    >
                        {num}
                    </button>
                ))}
                <button 
                    onPointerDown={(e) => {
                        e.preventDefault(); e.stopPropagation();
                        handleKeypadPress(() => { 
                            if (!isFirstInputRef.current && quantityStr !== '0') setQuantityStr(prev => prev + '0'); 
                        });
                    }} 
                    className="bg-white text-gray-800 text-xl border border-gray-200 font-bold rounded-lg shadow-sm active:scale-95"
                >
                    0
                </button>
                <button 
                    onPointerDown={(e) => {
                        e.preventDefault(); e.stopPropagation();
                        handleKeypadPress(() => { 
                            setQuantityStr('0'); isFirstInputRef.current = true; 
                        });
                    }} 
                    className="bg-red-50 text-red-600 border border-red-200 text-lg font-bold rounded-lg active:scale-95"
                >
                    C
                </button>
                <button 
                    onPointerDown={(e) => {
                        e.preventDefault(); e.stopPropagation();
                        handleKeypadPress(() => setQuantityStr(prev => prev.startsWith('-') ? prev.slice(1) : '-' + prev));
                    }} 
                    className="bg-gray-100 text-gray-800 border border-gray-300 text-2xl font-bold font-mono rounded-lg active:scale-95"
                >
                    -
                </button>
            </div>
        </div>
    );

    const InfoSection = (
        <div className="flex flex-col h-full w-full pl-1 overflow-y-auto min-w-0" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-1 flex-shrink-0">
                <span className="text-[10px] text-gray-400 font-mono bg-gray-50 px-1 rounded">{activeItem.barcode}</span>
                <KeypadHeaderControls isLocked={!!isPositionLocked} onToggleLock={() => setIsPositionLocked(!isPositionLocked)} isLeft={!!isLeftHanded} onToggleHandedness={() => setIsLeftHanded(!isLeftHanded)} />
            </div>
            <div className="mb-2 flex-shrink-0 min-h-[2.5rem]"><div className="flex items-start gap-1"><span className="bg-orange-100 text-orange-700 text-[9px] font-bold px-1 py-0.5 rounded flex-shrink-0 mt-0.5">수정</span><h3 className="text-sm font-extrabold text-gray-900 leading-tight break-keep line-clamp-2">{activeItem.name}</h3></div></div>
            {product && <div className="flex items-center justify-between bg-gray-50 px-2 py-1.5 rounded text-xs text-gray-600 mb-2 flex-shrink-0 border border-gray-100"><div className="flex gap-3 w-full justify-around"><div className="flex items-center gap-1"><span>매입</span><b className="text-gray-900">{product.costPrice.toLocaleString()}</b></div><div className="flex items-center gap-1"><span>판매</span><b className="text-gray-900">{product.sellingPrice?.toLocaleString()}</b></div></div></div>}
            <div className="flex-grow flex flex-col min-h-0 mb-1">
                <div className="flex gap-2 h-12 mb-2 flex-shrink-0">
                    <div className="w-[40%] border-2 border-gray-300 bg-gray-100 rounded-xl flex flex-col items-center justify-center relative shadow-inner">
                        <label className="absolute top-1 left-2 text-[9px] font-bold text-gray-400">M</label>
                        <span className="text-2xl font-extrabold text-gray-500 tracking-tight">{activeItem.quantity.toLocaleString()}</span>
                    </div>
                    <div 
                        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); handleKeypadPress(() => { isFirstInputRef.current = true; }); }} 
                        className="w-[60%] border-2 border-blue-600 ring-2 ring-blue-50 rounded-xl flex flex-col items-center justify-center bg-white shadow-inner cursor-pointer relative overflow-hidden"
                    >
                        <label className="absolute top-1 left-2 text-[9px] font-bold text-gray-400">수량</label>
                        <span className="text-2xl font-extrabold text-gray-900 tracking-tight z-10">{quantityStr}</span>
                    </div>
                </div>
                <div className="flex gap-1 h-8 flex-shrink-0 mb-2">
                    <button onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); handleKeypadPress(() => setUnit('개')); }} className={`flex-1 rounded-lg text-xs font-bold border transition-all ${unit === '개' ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white border-gray-200 text-gray-500'}`}>낱개</button>
                    <button onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); handleKeypadPress(() => setUnit('박스')); }} className={`flex-1 rounded-lg text-xs font-bold border transition-all ${unit === '박스' ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white border-gray-200 text-gray-500'}`}>박스</button>
                </div>
                <div className="bg-white border border-gray-300 rounded-lg flex items-center px-2 h-9 mb-2 flex-shrink-0">
                    <ChatBubbleLeftIcon className="w-3.5 h-3.5 text-gray-400 mr-1.5 flex-shrink-0" />
                    <input 
                        type="text" 
                        value={memo} 
                        onChange={(e) => setMemo(e.target.value)} 
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()} 
                        placeholder="메모 입력" 
                        className="w-full h-full bg-transparent outline-none text-xs text-gray-800" 
                    />
                </div>
            </div>
        </div>
    );

    return createPortal(
        <div 
            className={`fixed inset-0 z-[140] flex items-center justify-center transition-colors duration-200 ${isVisible ? 'bg-black bg-opacity-50' : 'bg-transparent'}`} 
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} 
            role="dialog" 
            aria-modal="true"
        >
            <KeypadLayout 
                layoutId="edit_item_modal_layout" 
                isLeftHanded={!!isLeftHanded} 
                onToggleHandedness={() => setIsLeftHanded(!isLeftHanded)} 
                leftContent={InfoSection} 
                rightContent={ControllerSection} 
            />
        </div>,
        document.body
    );
};

export default EditItemModal;
