
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { EventItem } from '../types';
import { DocumentIcon, PlayCircleIcon, StopCircleIcon, TrashIcon } from './Icons';

interface EventActionSelectModalProps {
    isOpen: boolean;
    onClose: () => void;
    event: EventItem | null;
    onViewDetails: () => void;
    onApply: () => void;
    onStop: () => void;
    onDelete: () => void;
}

const EventActionSelectModal: React.FC<EventActionSelectModalProps> = ({
    isOpen, onClose, event, onViewDetails, onApply, onStop, onDelete
}) => {
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

    const ActionButton: React.FC<{ icon: React.ReactNode; label: string; sublabel: string; onClick: () => void; className?: string }> = 
    ({ icon, label, sublabel, onClick, className }) => (
        <button
            onClick={onClick}
            className={`w-full flex items-center gap-4 p-4 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg transition-colors active:scale-95 ${className}`}
        >
            <div className="p-2 bg-gray-100 rounded-lg">{icon}</div>
            <div>
                <p className="font-bold text-gray-800 text-base text-left">{label}</p>
                <p className="text-xs text-gray-500 text-left">{sublabel}</p>
            </div>
        </button>
    );

    return createPortal(
        <div 
            className={`fixed inset-0 z-[65] flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-50' : 'bg-transparent'}`} 
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
                </div>
                <div className="p-4 space-y-3">
                    <ActionButton icon={<DocumentIcon className="w-5 h-5 text-gray-600" />} label="상세 조회/수정" sublabel="행사에 포함된 상품 목록을 확인합니다." onClick={onViewDetails} />
                    <ActionButton icon={<PlayCircleIcon className="w-5 h-5 text-green-600" />} label="전체 적용" sublabel="행사를 시작하고 상품 가격을 변경합니다." onClick={onApply} />
                    <ActionButton icon={<StopCircleIcon className="w-5 h-5 text-orange-600" />} label="전체 종료" sublabel="행사를 종료하고 가격을 복구합니다." onClick={onStop} />
                    <ActionButton icon={<TrashIcon className="w-5 h-5 text-red-600" />} label="전체 삭제" sublabel="행사 자체를 완전히 삭제합니다." onClick={onDelete} />
                </div>
                <div className="bg-gray-50 p-3 text-center rounded-b-xl border-t">
                    <button onClick={onClose} className="px-6 py-2 rounded-lg font-bold text-gray-700 bg-gray-200 hover:bg-gray-300">
                        취소
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default EventActionSelectModal;
