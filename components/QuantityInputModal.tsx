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

    useEffect(() => {
        if (isOpen) {
            setQuantity(initialQuantity);
            // Auto-focus and select text for quick editing
            setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            }, 150); // Increased delay for robustness on slower devices
        }
    }, [isOpen, initialQuantity]);

    useAdjustForKeyboard(modalContentRef, isOpen);

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
            handleConfirm();
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true">
            <div ref={modalContentRef} className="bg-white rounded-xl shadow-2xl w-full max-w-xs overflow-hidden transition-transform duration-200" onClick={e => e.stopPropagation()}>
                <div className="p-2">
                    <h3 className="text-base font-semibold text-gray-800 text-center mb-1 truncate" title={itemName}>{itemName}</h3>
                    
                    <div className="flex items-center justify-center">
                         <input 
                            ref={inputRef}
                            type="number" 
                            value={quantity}
                            onChange={(e) => {
                                const value = e.target.value;
                                if (value === '' || value === '-') {
                                    setQuantity(value);
                                } else {
                                    const num = parseInt(value, 10);
                                    if (!isNaN(num)) setQuantity(num);
                                }
                            }}
                            onKeyDown={handleKeyDown}
                            className="w-full h-10 text-center border-2 border-blue-500 bg-blue-50 rounded-lg text-gray-800 font-bold text-xl focus:outline-none"
                            autoComplete="off"
                            pattern="-?\d*"
                        />
                    </div>
                </div>

                <div className="bg-gray-50 p-2 grid grid-cols-2 gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 h-10 flex items-center justify-center rounded-lg font-semibold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition text-sm"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleConfirm}
                        className="text-white px-4 h-10 flex items-center justify-center rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-sm"
                    >
                        확인
                    </button>
                </div>
            </div>
        </div>
    );
};

export default QuantityInputModal;