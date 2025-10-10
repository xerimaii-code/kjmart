import React, { useState, useEffect, useRef } from 'react';

interface QuantityInputModalProps {
    isOpen: boolean;
    itemName: string;
    initialQuantity: number;
    onClose: () => void;
    onConfirm: (newQuantity: number) => void;
}

const QuantityInputModal: React.FC<QuantityInputModalProps> = ({ isOpen, itemName, initialQuantity, onClose, onConfirm }) => {
    const [quantity, setQuantity] = useState(initialQuantity);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setQuantity(initialQuantity);
            // Auto-focus and select text for quick editing
            setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            }, 100); // Small delay to ensure modal is rendered
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
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-4">
                    <h3 className="text-lg font-bold text-gray-800 text-center mb-3 truncate" title={itemName}>{itemName}</h3>
                    
                    <div className="flex items-center justify-center">
                         <input 
                            ref={inputRef}
                            type="number" 
                            value={quantity}
                            onChange={e => setQuantity(parseInt(e.target.value) || 0)}
                            onKeyDown={handleKeyDown}
                            className="w-full h-10 text-center border-2 border-blue-500 bg-blue-50 rounded-lg text-gray-800 font-bold text-2xl focus:outline-none"
                            autoComplete="off"
                            pattern="\d*"
                        />
                    </div>
                </div>

                <div className="bg-gray-50 p-2 grid grid-cols-2 gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg font-semibold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleConfirm}
                        className="text-white px-4 py-2 rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                    >
                        확인
                    </button>
                </div>
            </div>
        </div>
    );
};

export default QuantityInputModal;