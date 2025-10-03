import React, { useState, useEffect } from 'react';

type DeliveryType = '일반배송' | '택배배송';

interface DeliveryTypeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (deliveryType: DeliveryType) => void;
}

const DeliveryTypeModal: React.FC<DeliveryTypeModalProps> = ({ isOpen, onClose, onConfirm }) => {
    const [selectedType, setSelectedType] = useState<DeliveryType>('일반배송');

    useEffect(() => {
        if (isOpen) {
            setSelectedType('일반배송'); // Reset selection to default when modal opens
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleConfirm = () => {
        onConfirm(selectedType);
    };
    
    const RadioOption: React.FC<{ value: DeliveryType; label: string }> = ({ value, label }) => (
        <label
            htmlFor={value}
            className={`flex items-center p-4 border rounded-lg cursor-pointer transition-all duration-200 ${
                selectedType === value
                    ? 'bg-blue-50 border-blue-500 ring-2 ring-blue-500'
                    : 'bg-gray-50 border-gray-300 hover:bg-gray-100'
            }`}
        >
            <input
                type="radio"
                id={value}
                name="deliveryType"
                value={value}
                checked={selectedType === value}
                onChange={() => setSelectedType(value)}
                className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
            />
            <span className="ml-3 text-lg font-medium text-gray-800">{label}</span>
        </label>
    );

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
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
                        className="px-6 py-3 rounded-lg font-semibold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!selectedType}
                        className="text-white px-6 py-3 rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                        계속
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DeliveryTypeModal;
