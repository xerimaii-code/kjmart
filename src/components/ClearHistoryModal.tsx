
import React, { useState, useEffect } from 'react';
import { useDataActions, useAlert } from '../context/AppContext';
import { SpinnerIcon } from './Icons';

interface ClearHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const ClearHistoryModal: React.FC<ClearHistoryModalProps> = ({ isOpen, onClose }) => {
    const [isRendered, setIsRendered] = useState(false);
    const [clearOption, setClearOption] = useState<'all' | 'beforeDate'>('beforeDate');
    const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
    const [isLoading, setIsLoading] = useState(false);
    const { clearOrders, clearOrdersBeforeDate } = useDataActions();
    const { showAlert, showToast } = useAlert();

    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => setIsRendered(true), 10);
            // Reset state on open
            setDate(new Date().toISOString().slice(0, 10));
            setClearOption('beforeDate');
            setIsLoading(false);
            return () => clearTimeout(timer);
        } else {
            setIsRendered(false);
        }
    }, [isOpen]);

    const handleConfirm = () => {
        if (clearOption === 'all') {
            showAlert(
                "모든 발주 내역을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다!",
                async () => {
                    setIsLoading(true);
                    try {
                        await clearOrders();
                        showToast("모든 발주 내역이 삭제되었습니다.", 'success');
                        onClose();
                    } catch (err) {
                        showAlert("발주 내역 삭제에 실패했습니다.");
                    } finally {
                        setIsLoading(false);
                    }
                },
                '전체 삭제',
                'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
            );
        } else if (clearOption === 'beforeDate') {
            const targetDate = new Date(date);
            // Set time to end of day to include all orders on that day
            targetDate.setHours(23, 59, 59, 999); 
            
            const formattedDate = targetDate.toLocaleDateString('ko-KR');
            showAlert(
                `${formattedDate} 이전의 모든 발주 내역을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다!`,
                async () => {
                    setIsLoading(true);
                    try {
                        const count = await clearOrdersBeforeDate(targetDate);
                        showToast(`${count}건의 발주 내역이 삭제되었습니다.`, 'success');
                        onClose();
                    } catch (err) {
                        showAlert("발주 내역 삭제에 실패했습니다.");
                    } finally {
                        setIsLoading(false);
                    }
                },
                '삭제',
                'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
            );
        }
    };

    if (!isOpen) return null;

    const RadioOption: React.FC<{ value: 'all' | 'beforeDate'; label: string }> = ({ value, label }) => (
        <label
            htmlFor={`clear-${value}`}
            className={`flex items-center p-4 border-2 rounded-xl cursor-pointer transition-all duration-200 ${
                clearOption === value
                    ? 'bg-blue-50 border-blue-500 ring-2 ring-blue-500/50'
                    : 'bg-gray-50 border-gray-200 hover:border-gray-400'
            }`}
        >
            <input
                type="radio"
                id={`clear-${value}`}
                name="clearOption"
                value={value}
                checked={clearOption === value}
                onChange={() => setClearOption(value)}
                className="h-5 w-5 text-blue-600 border-gray-300 focus:ring-blue-500"
            />
            <span className="ml-4 text-base font-bold text-gray-800">{label}</span>
        </label>
    );

    return (
        <div className={`fixed inset-0 z-[80] flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-50' : 'bg-transparent'}`} role="dialog" aria-modal="true" onClick={onClose}>
            <div className={`bg-white rounded-xl shadow-lg w-full max-w-sm overflow-hidden transition-all duration-300 ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`} onClick={e => e.stopPropagation()}>
                <div className="p-6">
                    <h3 className="text-xl font-bold text-gray-800 text-center mb-6">발주 내역 정리</h3>
                    <div className="space-y-4">
                        <RadioOption value="beforeDate" label="기준일 이전 내역 삭제" />
                        {clearOption === 'beforeDate' && (
                            <div className="pl-4 animate-fade-in-down">
                                <input
                                    type="date"
                                    value={date}
                                    onChange={(e) => setDate(e.target.value)}
                                    className="w-full p-2 border border-gray-300 rounded-lg text-gray-700 bg-white"
                                    aria-label="기준일"
                                />
                                <p className="text-xs text-gray-500 mt-2">선택한 날짜를 포함하여 그 이전의 모든 발주 내역이 삭제됩니다.</p>
                            </div>
                        )}
                         <RadioOption value="all" label="전체 내역 삭제" />
                    </div>
                </div>
                <div className="bg-gray-50 p-3 grid grid-cols-2 gap-3">
                    <button
                        onClick={onClose}
                        disabled={isLoading}
                        className="px-6 py-2 rounded-lg font-bold text-gray-700 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition active:scale-95 disabled:opacity-50"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={isLoading || (clearOption === 'beforeDate' && !date)}
                        className="relative text-white px-6 py-2 rounded-lg font-bold bg-rose-600 hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500 transition active:scale-95 disabled:bg-rose-400 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                        <span className={isLoading ? 'opacity-0' : 'opacity-100'}>삭제 실행</span>
                        {isLoading && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <SpinnerIcon className="w-6 h-6"/>
                            </div>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ClearHistoryModal;
