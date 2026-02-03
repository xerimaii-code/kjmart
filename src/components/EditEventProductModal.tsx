
import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAlert } from '../context/AppContext';
import { SpinnerIcon } from './Icons';

interface EditEventProductModalProps {
    isOpen: boolean;
    onClose: () => void;
    product: any;
    onSuccess: (updatedItem: any) => void;
    editContext?: 'management' | 'new';
    onDelete?: () => void;
}

type ItemStatus = '1' | '0' | 'D';

const EditEventProductModal: React.FC<EditEventProductModalProps> = ({ isOpen, onClose, product, onSuccess, editContext = 'new', onDelete }) => {
    const [isRendered, setIsRendered] = useState(false);
    const [saleCost, setSaleCost] = useState<number | string>('');
    const [salePrice, setSalePrice] = useState<number | string>('');
    const [itemStatus, setItemStatus] = useState<ItemStatus>('0');
    const [isSaving, setIsSaving] = useState(false);

    const statusMap: Record<ItemStatus, { text: string; className: string }> = {
        '1': { text: '적용중', className: 'bg-blue-600 text-white border-blue-600' },
        '0': { text: '대기', className: 'bg-yellow-500 text-white border-yellow-500' },
        'D': { text: '삭제/종료', className: 'bg-gray-700 text-white border-gray-700' }
    };

    useEffect(() => {
        if (isOpen) {
            setIsRendered(true);
            if (product) {
                setSaleCost(product['행사매입가'] || 0);
                setSalePrice(product['행사판매가'] || 0);
                
                const currentStatus = String(product['isappl'] || '0').trim().toUpperCase();
                if (currentStatus === '1' || currentStatus === '0' || currentStatus === 'D') {
                    setItemStatus(currentStatus as ItemStatus);
                } else {
                    setItemStatus('0'); // Fallback to 'waiting'
                }
            }
        } else {
            setIsRendered(false);
        }
    }, [isOpen, product]);

    const marginRate = useMemo(() => {
        const cost = Number(saleCost);
        const price = Number(salePrice);
        if (!price || price === 0) return 0;
        return ((price - cost) / price) * 100;
    }, [saleCost, salePrice]);

    const handleSave = () => {
        setIsSaving(true);
        const updatedItem = {
            ...product,
            '행사매입가': Number(saleCost),
            '행사판매가': Number(salePrice),
            'isappl': itemStatus
        };
        onSuccess(updatedItem);
        setIsSaving(false);
        onClose();
    };

    const handleStatusCycle = () => {
        setItemStatus(current => {
            if (current === '0') return '1';
            if (current === '1') return 'D';
            return '0'; // from 'D' back to '0'
        });
    };

    if (!isOpen || !product) return null;
    
    return createPortal(
        <div className={`fixed inset-0 z-[110] flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-50' : 'bg-transparent'}`} onClick={onClose}>
            <div className={`bg-white rounded-xl shadow-lg w-full max-w-sm flex flex-col transition-all duration-300 ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`} onClick={e => e.stopPropagation()}>
                <div className="p-3 border-b">
                    <h3 className="text-xs font-bold text-gray-500 text-center uppercase tracking-tight">행사 상품 수정</h3>
                </div>
                <div className="p-3 space-y-3">
                    <div className="bg-gray-50 rounded-lg p-2 border border-gray-200">
                        <p className="font-bold text-gray-800 text-sm">{product['상품명']}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5 uppercase font-bold">정상판매가: {Number(product['이전판매가'] || product['orgmoney1']).toLocaleString()}</p>
                    </div>
                    
                    <div className="flex flex-col gap-1.5 pt-1">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold text-gray-400 uppercase">행사매입</label>
                            <input type="number" value={saleCost} onChange={(e) => setSaleCost(e.target.value)} onFocus={e => e.target.select()} className="w-1/2 h-10 px-3 border border-gray-200 rounded-lg text-right font-bold text-base focus:ring-1 focus:ring-indigo-500"/>
                        </div>
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold text-blue-400 uppercase">행사판매</label>
                            <input type="number" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} onFocus={e => e.target.select()} className="w-1/2 h-10 px-3 border border-indigo-200 rounded-lg text-right font-bold text-base text-blue-600 focus:ring-1 focus:ring-blue-500"/>
                        </div>
                    </div>

                    <div className="text-right px-1">
                         <span className="text-[10px] font-bold text-gray-400 mr-2 tracking-tight">예상 마진율</span>
                         <span className="font-bold text-sm text-gray-700">{marginRate.toFixed(1)}%</span>
                    </div>

                    <div className="flex justify-center pt-1">
                        {editContext === 'management' && (
                            <button 
                                onClick={handleStatusCycle} 
                                className={`w-full py-2.5 rounded-lg text-sm font-bold transition-all shadow-sm border ${statusMap[itemStatus].className}`}
                            >
                                현재 상태: {statusMap[itemStatus].text}
                            </button>
                        )}
                    </div>
                </div>
                <div className="bg-gray-50 p-3 grid grid-cols-2 gap-2 border-t rounded-b-xl">
                    <button onClick={onClose} className="h-10 rounded-lg font-bold text-gray-500 bg-white border border-gray-200 text-sm">취소</button>
                    {/* 상태가 'D'이고 삭제 핸들러가 있을 때 삭제 버튼 표시 */}
                    {editContext === 'management' && itemStatus === 'D' && onDelete ? (
                        <button onClick={() => { onClose(); onDelete(); }} className="h-10 rounded-lg font-bold text-white bg-rose-600 shadow-sm active:scale-95 transition-all text-sm">
                            삭제
                        </button>
                    ) : (
                        <button onClick={handleSave} disabled={isSaving} className="h-10 rounded-lg font-bold text-white bg-blue-600 disabled:bg-gray-300 text-sm shadow-sm active:scale-95 transition-all">
                            {isSaving ? <SpinnerIcon className="w-5 h-5 mx-auto animate-spin" /> : "수정 저장"}
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default EditEventProductModal;
