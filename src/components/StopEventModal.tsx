
import React, { useState, useEffect } from 'react';
import { EventItem } from '../types';

interface StopEventModalProps {
    isOpen: boolean;
    onClose: () => void;
    event: EventItem | null;
    onConfirm: (status: '0' | '2') => void;
}

const StopEventModal: React.FC<StopEventModalProps> = ({ isOpen, onClose, event, onConfirm }) => {
    const [isRendered, setIsRendered] = useState(false);

    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => setIsRendered(true), 10);
            return () => clearTimeout(timer);
        } else {
            setIsRendered(false);
        }
    }, [isOpen]);
    
    if (!isOpen || !event) return null;

    return (
        <div 
            className={`fixed inset-0 z-[90] flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-50' : 'bg-transparent'}`} 
            onClick={onClose} 
            role="dialog" 
            aria-modal="true"
        >
            <div 
                className={`bg-white rounded-xl shadow-lg w-full max-w-sm transition-[opacity,transform] duration-300 will-change-[opacity,transform] ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`} 
                onClick={e => e.stopPropagation()}
            >
                <div className="p-5 border-b">
                    <h3 className="text-xl font-bold text-gray-800 text-center truncate" title={event.salename}>{event.salename}</h3>
                    <p className="text-sm text-gray-500 text-center mt-1">행사 중지 옵션</p>
                </div>
                <div className="p-4 space-y-3">
                    <button
                        onClick={() => onConfirm('0')}
                        className="w-full text-left bg-yellow-50 p-4 rounded-xl border-2 border-yellow-200 hover:border-yellow-400 transition-all active:scale-95"
                    >
                        <h4 className="font-bold text-yellow-800">미적용으로 변경 (대기 상태)</h4>
                        <p className="text-xs text-yellow-700 mt-1 leading-relaxed">
                            행사를 일시적으로 중지하고 가격을 원복합니다. 나중에 다시 '전체 적용'할 수 있습니다.
                        </p>
                    </button>
                    <button
                        onClick={() => onConfirm('2')}
                        className="w-full text-left bg-gray-100 p-4 rounded-xl border-2 border-gray-200 hover:border-gray-400 transition-all active:scale-95"
                    >
                        <h4 className="font-bold text-gray-800">완전 종료</h4>
                        <p className="text-xs text-gray-700 mt-1 leading-relaxed">
                            행사를 영구적으로 종료합니다. 이 행사는 다시 시작할 수 없습니다.
                        </p>
                    </button>
                </div>
                 <div className="bg-gray-50 p-3 text-center rounded-b-xl border-t">
                    <button onClick={onClose} className="px-6 py-2 rounded-lg font-bold text-gray-700 bg-gray-200 hover:bg-gray-300 focus:outline-none transition active:scale-95">
                        취소
                    </button>
                </div>
            </div>
        </div>
    );
};

export default StopEventModal;
