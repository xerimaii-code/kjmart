import React, { useState, useEffect, useRef } from 'react';
import { OrderItem } from '../types';
import ToggleSwitch from './ToggleSwitch';

interface EditItemModalProps {
    isOpen: boolean;
    item: OrderItem | null;
    onClose: () => void;
    onSave: (details: { quantity: number; unit: '개' | '박스'; isPromotion: boolean }) => void;
}

export default function EditItemModal({ isOpen, item, onClose, onSave }: EditItemModalProps) {
    const [quantity, setQuantity] = useState(1);
    const [unit, setUnit] = useState<'개' | '박스'>('개');
    const [isPromotion, setIsPromotion] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen && item) {
            setQuantity(item.quantity);
            setUnit(item.unit);
            setIsPromotion(item.isPromotion || false);
            // Auto-focus and select text for quick editing
            setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            }, 100);
        }
    }, [isOpen, item]);

    if (!isOpen || !item) return null;

    const handleSave = () => {
        const newQuantity = Number(quantity);
        if (newQuantity > 0) {
            onSave({ quantity: newQuantity, unit, isPromotion });
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleSave();
        }
    };
    
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                    <h3 className="text-xl font-bold text-gray-800 text-center mb-2 truncate" title={item.name}>{item.name}</h3>
                    <p className="text-center text-gray-500 mb-6">{item.price.toLocaleString()}원</p>
                    
                    <div className="space-y-6">
                        {/* Quantity Control */}
                        <div>
                            <label htmlFor="edit-quantity" className="block text-sm font-bold text-gray-700 mb-2 text-center">
                                수량
                            </label>
                            <div className="flex items-center justify-center">
                                <input 
                                    ref={inputRef}
                                    id="edit-quantity"
                                    type="number" 
                                    value={quantity}
                                    onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                                    onKeyDown={handleKeyDown}
                                    className="w-full h-16 text-center border-2 border-blue-500 bg-blue-50 rounded-lg text-gray-800 font-bold text-3xl focus:outline-none"
                                    autoComplete="off"
                                    min="1"
                                    pattern="\d*"
                                />
                            </div>
                        </div>

                        {/* Toggles */}
                        <div className="flex justify-end items-center pt-4 border-t border-gray-200 space-x-4">
                             <ToggleSwitch
                                id="edit-item-promotion"
                                label="행사"
                                checked={isPromotion}
                                onChange={setIsPromotion}
                                color="red"
                            />
                            <ToggleSwitch
                                id="edit-item-unit"
                                label="박스"
                                checked={unit === '박스'}
                                onChange={(checked) => setUnit(checked ? '박스' : '개')}
                                color="blue"
                            />
                        </div>
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
                        onClick={handleSave}
                        className="text-white px-6 py-3 rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                    >
                        저장
                    </button>
                </div>
            </div>
        </div>
    );
}