import React, { useState, useEffect, useRef } from 'react';
import { OrderItem } from '../types';
import ToggleSwitch from './ToggleSwitch';

interface EditItemModalProps {
    isOpen: boolean;
    item: OrderItem | null;
    onClose: () => void;
    onSave: (details: { quantity: number; unit: '개' | '박스'; memo?: string; }) => void;
}

export default function EditItemModal({ isOpen, item, onClose, onSave }: EditItemModalProps) {
    const [quantity, setQuantity] = useState<number | string>(1);
    const [unit, setUnit] = useState<'개' | '박스'>('개');
    const [memo, setMemo] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const modalContentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen && item) {
            setQuantity(item.quantity);
            setUnit(item.unit);
            setMemo(item.memo || '');
            setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            }, 150);
        }
    }, [isOpen, item]);

    if (!isOpen || !item) return null;

    const handleSave = () => {
        const finalQuantity = Number(quantity);
        if (isNaN(finalQuantity) || finalQuantity === 0) return;
        onSave({ quantity: finalQuantity, unit, memo: memo.trim() });
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSave();
        }
    };
    
    const changeQuantity = (delta: number) => {
        setQuantity(q => {
            const currentVal = Number(q) || 0;
            const newVal = currentVal + delta;
            return newVal;
        });
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        if (value === '' || value === '-') {
            setQuantity(value);
        } else {
            const num = parseInt(value, 10);
            if (!isNaN(num)) {
                setQuantity(num);
            }
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="editItemModalTitle">
            <div ref={modalContentRef} className="bg-white rounded-2xl shadow-2xl w-full max-w-md transition-transform duration-200 overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                    <h3 id="editItemModalTitle" className="text-xl font-bold text-gray-800 text-center mb-1 truncate" title={item.name}>{item.name}</h3>
                    <p className="text-center text-sm text-gray-500 mb-4">{item.price.toLocaleString()}원</p>
                    
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="edit-quantity" className="block text-sm font-medium text-gray-700 mb-2 text-center">수량 수정</label>
                            <div className="flex items-center justify-center space-x-3">
                                <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(-1)} className="w-14 h-14 bg-gray-200 text-gray-700 text-3xl font-bold rounded-lg transition hover:bg-gray-300 active:scale-95 flex-shrink-0" aria-label="수량 감소">-</button>
                                <input 
                                    ref={inputRef}
                                    id="edit-quantity"
                                    type="number" 
                                    value={quantity}
                                    onChange={handleInputChange}
                                    onKeyDown={handleKeyDown}
                                    className="w-24 h-14 text-center border-2 border-blue-500 bg-blue-50 rounded-lg text-gray-800 font-bold text-3xl focus:outline-none"
                                    autoComplete="off"
                                />
                                <button onMouseDown={(e) => e.preventDefault()} onClick={() => changeQuantity(1)} className="w-14 h-14 bg-gray-200 text-gray-700 text-3xl font-bold rounded-lg transition hover:bg-gray-300 active:scale-95 flex-shrink-0" aria-label="수량 증가">+</button>
                            </div>
                        </div>

                        <div>
                            <label htmlFor="edit-item-memo" className="block text-sm font-medium text-gray-700 mb-1.5">품목 메모 (선택)</label>
                            <input
                                id="edit-item-memo"
                                type="text"
                                value={memo}
                                onChange={(e) => setMemo(e.target.value)}
                                placeholder="예: 월요일 도착"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-base"
                                maxLength={50}
                            />
                        </div>

                        <div className="flex justify-center pt-2">
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

                <div className="bg-gray-50 p-3 flex gap-3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
                    <button
                        onClick={onClose}
                        className="w-1/3 px-4 h-16 flex items-center justify-center rounded-lg font-semibold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition text-lg"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleSave}
                        className="flex-grow text-white px-4 h-16 flex items-center justify-center rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-lg"
                    >
                        저장
                    </button>
                </div>
            </div>
        </div>
    );
}