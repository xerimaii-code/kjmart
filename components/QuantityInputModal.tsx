import React, { useState, useEffect, useRef } from 'react';

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
            <div ref={modalContentRef} className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transition-transform duration-200" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                    <h3 className="text-lg font-bold text-gray-800 text-center mb-4 truncate" title={itemName}>{itemName}</h3>
                    
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
                            className="w-full h-14 text-center border-2 border-blue-500 bg-blue-50 rounded-lg text-gray-800 font-bold text-2xl focus:outline-none"
                            autoComplete="off"
                            pattern="-?\d*"
                        />
                    </div>
                </div>

                <div
                    className="bg-gray-50 p-3 flex gap-3"
                    style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
                >
                    <button
                        onClick={onClose}
                        className="w-1/3 px-4 h-16 flex items-center justify-center rounded-lg font-semibold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition text-lg"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleConfirm}
                        className="flex-grow text-white px-4 h-16 flex items-center justify-center rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-lg"
                    >
                        확인
                    </button>
                </div>
            </div>
        </div>
    );
};

export default QuantityInputModal;