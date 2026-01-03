
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircleIcon, WarningIcon } from './Icons';

export interface ToastState {
    isOpen: boolean;
    message: string;
    type: 'success' | 'error';
}

interface ToastProps extends ToastState {
    onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ isOpen, message, type, onClose }) => {
    const [isRendered, setIsRendered] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setIsRendered(true);
            const timer = setTimeout(() => {
                onClose();
            }, 2000); // 2초 후 자동으로 닫힘
            return () => clearTimeout(timer);
        } else {
            // 애니메이션을 위해 약간의 지연 후 언마운트
            const timer = setTimeout(() => setIsRendered(false), 300);
            return () => clearTimeout(timer);
        }
    }, [isOpen, onClose]);
    
    if (!isRendered) return null;

    const isSuccess = type === 'success';
    const bgColor = isSuccess ? 'bg-green-500' : 'bg-red-500';
    const Icon = isSuccess ? CheckCircleIcon : WarningIcon;

    // Portal을 사용하여 스캐너 모드일 때 #root가 숨겨져도 Toast는 보이도록 함
    return createPortal(
        <div 
             style={{ top: `calc(env(safe-area-inset-top) + 4.5rem)` }}
             className={`fixed inset-x-0 mx-auto z-[300] w-[90%] max-w-sm p-3 rounded-xl shadow-2xl text-white font-bold flex items-center gap-3 transition-all duration-300 ${isOpen ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'} ${bgColor}`}
        >
            <div className="bg-white/20 p-1 rounded-full flex-shrink-0">
                <Icon className="w-5 h-5 text-white" />
            </div>
            <span className="whitespace-pre-line text-sm leading-tight">{message}</span>
        </div>,
        document.body
    );
};

export default Toast;
