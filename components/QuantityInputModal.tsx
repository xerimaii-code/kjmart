import React, { useState, useEffect, useRef } from 'react';
import { useAdjustForKeyboard } from '../hooks/useAdjustForKeyboard';

interface QuantityInputModalProps {
    isOpen: boolean;
    itemName: string;
    initialQuantity: number;
    onClose: () => void;
    onConfirm: (newQuantity: number) => void;
}

const QuantityInputModal: React.FC<QuantityInputModalProps> = ({ isOpen, itemName, initialQuantity, onClose, onConfirm }) => {
    const [quantity, setQuantity] = useState<number | string>(initialQuantity);
    const inputRef = useRef<HTMLInputElement>(null);
    const modalContentRef = useRef<HTMLDivElement>(null);
    const [isRendered, setIsRendered] = useState(false);

    useAdjustForKeyboard(modalContentRef, isOpen);

    useEffect(() => {
        if (isOpen) {
            // This tiny delay allows the component to mount with initial (hidden) styles,
            // then the transition to visible styles is triggered for the slide-up animation.
            const timer = setTimeout(() => setIsRendered(true), 10);
            
            setQuantity(initialQuantity);
            // Auto-focus and select text for quick editing
            setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            }, 150); // Delay to ensure modal is visible and focusable

            return () => clearTimeout(timer);
        } else {
            setIsRendered(false);
        }
    }, [isOpen, initialQuantity]);

    if (!isOpen) return null;

    const handleConfirm = () => {
        const newQuantity = Number(quantity);
        if (Number.isFinite(newQuantity)) {
            onConfirm(newQuantity);
            onClose();
        }
    };
    
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleConfirm();
        }
    };
    
    const changeQuantity = (delta: number) => {
        setQuantity(q => (Number(q) || 0) + delta);
    };

    return (
        <div 
            className={`fixed inset-0 z-50 flex items-end justify-center transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-60' : 'bg-transparent'}`} 
            onClick={onClose} 
            role="dialog" 
            aria-modal="true"
        >
            <div 
                ref={modalContentRef} 
                className={`bg-white rounded-t-2xl shadow-2xl w-full max-w-md mx-auto transition-transform duration-300 ease-out ${isRendered ? 'translate-y-0' : 'translate-y-full'}`} 
                onClick={e => e.stopPropagation()}
            >
                <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto my-2" />
                <div className="p-4 pt-0">
                    <h3 className="text-lg font-bold text-gray-800 text-center mb-4 truncate" title={itemName}>{itemName}</h3>
                    
                    <div>
                        <label htmlFor="quantity-input" className="block text-sm font-medium text-gray-700 mb-1 text-center">수량</label>
                        <div className="flex items-center justify-center space-x-2">
                            <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(-1)} className="w-12 h-12 bg-gray-200 text-gray-700 text-2xl font-bold rounded-lg transition hover:bg-gray-300 active:scale-95 flex-shrink-0 flex items-center justify-center" aria-label="수량 감소">-</button>
                            <input 
                                ref={inputRef}
                                id="quantity-input"
                                type="number" 
                                value={quantity}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    // Allow empty string or just a minus sign for flexible input
                                    if (value === '' || value === '-') {
                                        setQuantity(value);
                                    } else {
                                        const num = parseInt(value, 10);
                                        if (!isNaN(num)) setQuantity(num);
                                    }
                                }}
                                onKeyDown={handleKeyDown}
                                className="w-full h-12 text-center border-2 border-blue-500 bg-blue-50 rounded-lg text-gray-800 font-bold text-2xl focus:outline-none"
                                autoComplete="off"
                                pattern="-?\d*"
                            />
                            <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(1)} className="w-12 h-12 bg-gray-200 text-gray-700 text-2xl font-bold rounded-lg transition hover:bg-gray-300 active:scale-95 flex-shrink-0 flex items-center justify-center" aria-label="수량 증가">+</button>
                        </div>
                    </div>
                </div>

                <div className="bg-gray-50 p-3 grid grid-cols-2 gap-3 border-t border-gray-200">
                    <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={onClose}
                        className="h-14 flex items-center justify-center rounded-lg font-semibold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition text-base"
                    >
                        취소
                    </button>
                    <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={handleConfirm}
                        className="text-white h-14 flex items-center justify-center rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-base"
                    >
                        확인
                    </button>
                </div>
            </div>
        </div>
    );
};

export default QuantityInputModal;