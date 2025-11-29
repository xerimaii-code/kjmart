
import React, { useState, useEffect } from 'react';

type DeliveryType = '일반배송' | '택배배송';

interface DeliveryTypeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (deliveryType: DeliveryType) => void;
}

const DeliveryTypeModal: React.FC<DeliveryTypeModalProps> = ({ isOpen, onClose, onConfirm }) => {
    const [selectedType, setSelectedType] = useState<DeliveryType>('일반배송');
    const [isRendered, setIsRendered] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setSelectedType('일반배송');
            const timer = setTimeout(() => setIsRendered(true), 10);
            return () => clearTimeout(timer);
        } else {
            setIsRendered(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleConfirm = () => {
        onConfirm(selectedType);
    };
    
    const RadioOption: React.FC<{ value: DeliveryType; label: string }> = ({ value, label }) => (
        <label
            htmlFor={value}
            className={`flex items-center p-5 border-2 rounded-xl cursor-pointer transition-all duration-200 ${
                selectedType === value
                    ? 'bg-blue-50 border-blue-500 ring-2 ring-blue-500/50'
                    : 'bg-gray-50 border-gray-200 hover:border-gray-400'
            }`}
        >
            <input
                type="radio"
                id={value}
                name="deliveryType"
                value={value}
                checked={selectedType === value}
                onChange={() => setSelectedType(value)}
                className="h-5 w-5 text-blue-600 border-gray-300 focus:ring-blue-500"
            />
            <span className="ml-4 text-lg font-bold text-gray-800">{label}</span>
        </label>
    );

    return (
        <div className={`fixed inset-0 z-[80] flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-50' : 'bg-transparent'}`} role="dialog" aria-modal="true">
            <div className={`bg-white rounded-xl shadow-lg w-full max-w-sm overflow-hidden transition-[opacity,transform] duration-300 will-change-[opacity,transform] ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
                <div className="p-6">
                    <h3 className="text-xl font-bold text-gray-800 text-center mb-6">배송 유형 선택</h3>
                    <div className="space-y-4">
                        <RadioOption value="일반배송" label="일반배송" />
                        <RadioOption value="택배배송" label="택배배송" />
                    </div>
                </div>
                <div className="bg-gray-50 p-3 grid grid-cols-2 gap-3">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 rounded-lg font-bold text-gray-700 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition active:scale-95"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!selectedType}
                        className="text-white px-6 py-2 rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition active:scale-95 disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                        계속
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DeliveryTypeModal;
