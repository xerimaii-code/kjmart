
import React, { useEffect } from 'react';
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
    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => {
                onClose();
            }, 2000); // 2초 후 자동으로 닫힘
            return () => clearTimeout(timer);
        }
    }, [isOpen, onClose]);
    
    if (!isOpen) return null;

    const isSuccess = type === 'success';
    const bgColor = isSuccess ? 'bg-green-500' : 'bg-red-500';
    const Icon = isSuccess ? CheckCircleIcon : WarningIcon;

    return (
        <div 
             style={{ top: `calc(var(--header-height, 4rem) + 0.5rem)` }}
             className={`fixed inset-x-0 mx-auto z-[300] w-[90%] max-w-sm p-2 rounded-lg shadow-2xl text-white font-semibold flex items-center gap-2 animate-fade-in-down ${bgColor}`}
        >
            <Icon className="w-5 h-5 flex-shrink-0" />
            <span className="whitespace-pre-line text-xs">{message}</span>
        </div>
    );
};

export default Toast;