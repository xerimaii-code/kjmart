import React, { useState, useEffect, useRef } from 'react';
import { OrderItem } from '../types';
import ToggleSwitch from './ToggleSwitch';
import { useAdjustForKeyboard } from '../hooks/useAdjustForKeyboard';

interface EditItemModalProps {
    isOpen: boolean;
    item: OrderItem | null;
    onClose: () => void;
    onSave: (details: { quantity: number; unit: '개' | '박스'; memo?: string; }) => void;
}

export default function EditItemModal({ isOpen, item, onClose, onSave }: EditItemModalProps) {
    // Use `any` for quantity state to allow for intermediate string values like '-'
    const [quantity, setQuantity] = useState<number | string>(1);
    const [unit, setUnit] = useState<'개' | '박스'>('개');
    const [memo, setMemo] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const modalContentRef = useRef<HTMLDivElement>(null);

    useAdjustForKeyboard(modalContentRef, isOpen);

    useEffect(() => {
        if (isOpen && item) {
            setQuantity(item.quantity);
            setUnit(item.unit);
            setMemo(item.memo || '');
            setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            }, 150); // Increased delay for robustness on slower devices
        }
    }, [isOpen, item]);

    if (!isOpen || !item) return null;

    const handleSave = () => {
        const finalQuantity = Number(quantity);
        if (isNaN(finalQuantity)) return; // Don't save if quantity is not a valid number
        onSave({ quantity: finalQuantity, unit, memo: memo.trim() });
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSave();
        }
    };
    
    const changeQuantity = (delta: number) => {
        setQuantity(q => (Number(q) || 0) + delta);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="editItemModalTitle">
            <div ref={modalContentRef} className="bg-white rounded-xl shadow-2xl w-full max-w-sm transition-transform duration-200" onClick={e => e.stopPropagation()}>
                <div className="p-4">
                    <h3 id="editItemModalTitle" className="text-lg font-bold text-gray-800 text-center mb-1 truncate" title={item.name}>{item.name}</h3>
                    <p className="text-center text-sm text-gray-500 mb-3">{item.price.toLocaleString()}원</p>
                    
                    <div className="space-y-3">
                        <div>
                            <label htmlFor="edit-quantity" className="block text-sm font-medium text-gray-700 mb-1 text-center">수량 수정</label>
                            <div className="flex items-center justify-center space-x-2">
                                <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(-1)} className="w-11 h-11 bg-gray-200 text-gray-700 text-2xl font-bold rounded-lg transition hover:bg-gray-300 active:scale-95 flex-shrink-0 flex items-center justify-center" aria-label="수량 감소">-</button>
                                <input 
                                    ref={inputRef}
                                    id="edit-quantity"
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
                                    className="w-full h-11 text-center border-2 border-blue-500 bg-blue-50 rounded-lg text-gray-800 font-bold text-2xl focus:outline-none"
                                    autoComplete="off"
                                />
                                <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(1)} className="w-11 h-11 bg-gray-200 text-gray-700 text-2xl font-bold rounded-lg transition hover:bg-gray-300 active:scale-95 flex-shrink-0 flex items-center justify-center" aria-label="수량 증가">+</button>
                            </div>
                        </div>

                        <div>
                            <label htmlFor="edit-item-memo" className="block text-sm font-medium text-gray-700 mb-1">품목 메모 (선택)</label>
                            <input
                                id="edit-item-memo"
                                type="text"
                                value={memo}
                                onChange={(e) => setMemo(e.target.value)}
                                placeholder="예: 월요일 도착"
                                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-base"
                                maxLength={50}
                            />
                        </div>

                        <div className="flex justify-center pt-1">
                            <ToggleSwitch
                                id="edit-item-unit"
                                label="박스 단위"
                                checked={unit === '박스'}
                                onChange={(checked) => setUnit(checked ? '박스' : '개')}
                                color="blue"
                            />
                        </div>
                    </div>
                </div>

                <div className="bg-gray-50 px-4 py-2.5 rounded-b-xl grid grid-cols-2 gap-3">
                    <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={onClose}
                        className="px-4 h-[4.5rem] flex items-center justify-center rounded-lg font-semibold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition text-base"
                    >
                        취소
                    </button>
                    <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={handleSave}
                        className="text-white px-4 h-[4.5rem] flex items-center justify-center rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-base"
                    >
                        저장
                    </button>
                </div>
            </div>
        </div>
    );
}