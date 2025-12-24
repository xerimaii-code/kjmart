
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Product, ReceivingItem } from '../types';
import { ReturnBoxIcon, SaveIcon, ChevronRightIcon, XCircleIcon, BarcodeScannerIcon } from './Icons';
import { isSaleActive } from '../hooks/useOrderManager';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useDeviceSettings, useScanner } from '../context/AppContext';
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

    const existingQuantityInBatch = useMemo(() => {
        if (!product || !currentItems || currentItems.length === 0) {
            return 0;
        }
        return currentItems
            .filter(item => item.barcode === product.barcode)
            .reduce((sum, item) => sum + item.quantity, 0);
    }, [product, currentItems]);

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
            setQuantity(1); setCostPrice(product.costPrice || 0); setSellingPrice(product.sellingPrice || 0);
            setCustomName(product.name || ''); setActiveField('quantity');
            isFirstInputRef.current = true;
        }
    }, [isOpen, product, timestamp]);

    if (!isMounted || !product) return null;
    
    const isQuantityValid = !isNaN(Number(quantity)) && Number(quantity) !== 0;
    const isUnregistered = !product.name || product.name === '미등록 상품' || product.name === '';
    const displayName = isUnregistered ? (customName || '미등록 상품') : product.name;

    const ButtonBase = ({ onClick, className, children, disabled }: any) => (
        <button onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); playKeypadBeep(); if (!disabled && !isSubmitting) onClick(); }} disabled={disabled || isSubmitting} className={`active:scale-95 transition-transform flex items-center justify-center font-bold rounded-lg shadow-sm ${className} ${disabled || isSubmitting ? 'opacity-50' : ''}`}>
            {children}
        </button>
    );

    const ControllerSection = (
        <div className="flex flex-col gap-1 h-full w-full min-w-0">
            <div className="flex flex-col gap-1 flex-shrink-0 mb-1">
                <div className="grid grid-cols-2 gap-1 mb-0.5">
                    <ButtonBase onClick={() => { if (onScanNext) closeScanner(); onClose(); }} className="bg-gray-100 text-gray-500 border border-gray-200 h-11 text-sm"><XCircleIcon className="w-4 h-4 mr-1" />종료</ButtonBase>
                    <ButtonBase onClick={() => { onClose(); if (onScanNext) setTimeout(onScanNext, 200); }} className="bg-white border border-gray-300 text-gray-500 h-11 text-sm"><ChevronRightIcon className="w-4 h-4 mr-1" />스킵</ButtonBase>
                </div>
                <div className="grid grid-cols-2 gap-1">
                    <ButtonBase onClick={() => { onAdd({ barcode: product.barcode, name: displayName, costPrice: Number(String(costPrice).replace(/,/g, '')), sellingPrice: Number(String(sellingPrice).replace(/,/g, '')), quantity: -Number(quantity), isNew: true }); if (onScanNext) closeScanner(); onClose(); }} disabled={!isQuantityValid} className="bg-red-50 text-red-500 border border-red-200 h-11 text-sm font-bold"><ReturnBoxIcon className="w-4 h-4 mr-1" />반품</ButtonBase>
                    <ButtonBase onClick={() => { onAdd({ barcode: product.barcode, name: displayName, costPrice: Number(String(costPrice).replace(/,/g, '')), sellingPrice: Number(String(sellingPrice).replace(/,/g, '')), quantity: Number(quantity), isNew: true }); if (onScanNext) closeScanner(); onClose(); }} disabled={!isQuantityValid} className="bg-white border border-blue-200 text-blue-700 h-11 text-sm font-bold"><SaveIcon className="w-4 h-4 mr-1" />추가&종료</ButtonBase>
                </div>
                {onScanNext && <ButtonBase onClick={() => { onAdd({ barcode: product.barcode, name: displayName, costPrice: Number(String(costPrice).replace(/,/g, '')), sellingPrice: Number(String(sellingPrice).replace(/,/g, '')), quantity: Number(quantity), isNew: true }); onClose(); setTimeout(onScanNext, 200); }} disabled={!isQuantityValid} className={`font-bold text-xl h-16 shadow-md mt-1 ${isUnregistered ? 'bg-orange-600' : 'bg-blue-600'} text-white`}><BarcodeScannerIcon className="w-6 h-6 mr-1.5" />추가 & 스캔</ButtonBase>}
            </div>
            <div className="grid grid-cols-3 gap-1 flex-grow min-h-0">
                {[7, 8, 9, 4, 5, 6, 1, 2, 3].map(num => (
                    <ButtonBase key={num} onClick={() => {
                        const wasFirst = isFirstInputRef.current;
                        const update = (prev: any) => wasFirst ? num : Number(String(prev).replace(/,/g, '') + num);
                        if (activeField === 'quantity') setQuantity(update); else if (activeField === 'cost') setCostPrice(update); else setSellingPrice(update);
                        isFirstInputRef.current = false;
                    }} className="bg-white text-gray-800 text-xl font-bold border border-gray-200 shadow-sm">{num}</ButtonBase>
                ))}
                <ButtonBase onClick={() => {
                    const wasFirst = isFirstInputRef.current;
                    const update = (prev: any) => wasFirst ? 0 : Number(String(prev).replace(/,/g, '') + '0');
                    if (activeField === 'quantity') setQuantity(update);
                    else if (activeField === 'cost') setCostPrice(update);
                    else setSellingPrice(update);
                    isFirstInputRef.current = false;
                }} className="bg-white text-gray-800 text-xl font-bold border border-gray-200 shadow-sm">0</ButtonBase>
                <ButtonBase onClick={() => {
                    if (activeField === 'quantity') setQuantity(0); else if (activeField === 'cost') setCostPrice(0); else setSellingPrice(0);
                    isFirstInputRef.current = true;
                }} className="bg-orange-50 text-orange-600 border border-orange-200 text-lg font-bold">C</ButtonBase>
                <ButtonBase onClick={() => {
                    const toggleSign = (prev: any) => -Number(String(prev).replace(/,/g, ''));
                    if (activeField === 'quantity') setQuantity(toggleSign); 
                    else if (activeField === 'cost') setCostPrice(toggleSign); 
                    else setSellingPrice(toggleSign);
                    isFirstInputRef.current = false;
                }} className="bg-gray-100 text-gray-800 border border-gray-300 text-2xl font-bold font-mono shadow-sm">-</ButtonBase>
            </div>
        </div>
    );

    const InfoSection = (
        <div className="flex flex-col h-full w-full pl-1 overflow-y-auto min-w-0">
            <div className="flex justify-between items-center mb-1 flex-shrink-0"><span className="text-[10px] text-gray-400 font-mono bg-gray-50 px-1 rounded">{product.barcode}</span><KeypadHeaderControls isLocked={!!isPositionLocked} onToggleLock={() => setIsPositionLocked(!isPositionLocked)} isLeft={!!isLeftHanded} onToggleHandedness={() => setIsLeftHanded(!isLeftHanded)} /></div>
            <div className="mb-2 flex-shrink-0 min-h-[2.5rem]">{isUnregistered ? (<input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)} onPointerDown={(e) => { e.stopPropagation(); playKeypadBeep(); }} placeholder="상품명 직접 입력" className="w-full border-b-2 border-red-300 focus:border-red-500 outline-none text-sm font-bold text-gray-800 placeholder-red-300 bg-transparent py-1" />) : (<div className="flex items-start gap-2">{(product.saleStartDate && product.saleEndDate && isSaleActive(product.saleStartDate, product.saleEndDate)) && (<span className="bg-rose-100 text-rose-600 text-[10px] font-extrabold px-1.5 py-0.5 rounded border border-rose-200 mt-0.5">행사중</span>)}<h3 className="text-sm font-extrabold text-gray-900 leading-tight break-keep line-clamp-2">{displayName}</h3></div>)}{product.spec && <p className="text-[10px] text-gray-500 mt-0.5 truncate">{product.spec}</p>}</div>
            <div className="flex flex-col gap-1 mb-2 flex-shrink-0">
                <div onPointerDown={() => { playKeypadBeep(); setActiveField('cost'); isFirstInputRef.current = true; }} className={`border rounded px-2 py-1 bg-gray-50 cursor-pointer flex justify-between items-center ${activeField === 'cost' ? 'ring-1 ring-blue-500 border-blue-500' : 'border-gray-200'}`}><span className="text-[10px] text-gray-500 font-bold">매입</span><span className="text-xs font-bold text-gray-800">{Number(costPrice).toLocaleString()}</span></div>
                <div onPointerDown={() => { playKeypadBeep(); setActiveField('selling'); isFirstInputRef.current = true; }} className={`border rounded px-2 py-1 bg-blue-50 cursor-pointer flex justify-between items-center ${activeField === 'selling' ? 'ring-1 ring-blue-500 border-blue-500' : 'border-blue-100'}`}><span className="text-[10px] text-blue-500 font-bold">판매</span><span className="text-xs font-bold text-blue-700">{Number(sellingPrice).toLocaleString()}</span></div>
            </div>
            <div className="flex-grow flex flex-col min-h-0 mb-1">
                <div className="flex gap-2 h-12 mb-2">
                    {existingQuantityInBatch > 0 ? (
                        <>
                            <div className="w-[40%] border-2 border-gray-300 bg-gray-100 rounded-xl flex flex-col items-center justify-center relative shadow-inner">
                                <label className="absolute top-1 left-2 text-[9px] font-bold text-gray-400">M</label>
                                <span className="text-2xl font-extrabold text-gray-500 tracking-tight">{existingQuantityInBatch.toLocaleString()}</span>
                            </div>
                            <div 
                                onPointerDown={() => { playKeypadBeep(); setActiveField('quantity'); isFirstInputRef.current = true; }} 
                                className={`w-[60%] border-2 rounded-xl flex items-center justify-center bg-white shadow-inner cursor-pointer relative ${activeField === 'quantity' ? 'border-blue-600 ring-2 ring-blue-50' : 'border-gray-300'}`}
                            >
                                <label className="absolute top-1 left-2 text-[9px] font-bold text-gray-400">수량</label>
                                <span className="text-3xl font-extrabold text-gray-900 tracking-tight">{quantity}</span>
                            </div>
                        </>
                    ) : (
                        <div 
                            onPointerDown={() => { playKeypadBeep(); setActiveField('quantity'); isFirstInputRef.current = true; }} 
                            className={`w-full h-full border-2 rounded-xl flex items-center justify-center bg-white shadow-inner cursor-pointer relative ${activeField === 'quantity' ? 'border-blue-600 ring-2 ring-blue-50' : 'border-gray-300'}`}
                        >
                            <label className="absolute top-1 left-2 text-[9px] font-bold text-gray-400">수량</label>
                            <span className="text-3xl font-extrabold text-gray-900 tracking-tight">{quantity}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    return createPortal(
        <div className={`fixed inset-0 z-[140] flex items-center justify-center transition-colors duration-200 ${isVisible ? 'bg-black bg-opacity-50' : 'bg-transparent'}`} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true">
            <KeypadLayout layoutId="receive_modal_layout" isLeftHanded={!!isLeftHanded} onToggleHandedness={() => setIsLeftHanded(!isLeftHanded)} leftContent={InfoSection} rightContent={ControllerSection} />
        </div>,
        document.body
    );
};

export default ReceiveItemModal;
