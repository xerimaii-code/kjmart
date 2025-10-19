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
            }, 5000); // 5초 후 자동으로 닫힘
            return () => clearTimeout(timer);
        }
    }, [isOpen, onClose]);
    
    if (!isOpen) return null;

    const isSuccess = type === 'success';
    const bgColor = isSuccess ? 'bg-green-500' : 'bg-red-500';
    const Icon = isSuccess ? CheckCircleIcon : WarningIcon;

    return (
        <div 
             className={`fixed top-20 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-lg p-3 rounded-lg shadow-2xl text-white font-semibold flex items-center gap-3 animate-fade-in-down ${bgColor}`}
        >
            <Icon className="w-6 h-6 flex-shrink-0" />
            <span className="whitespace-pre-line text-sm">{message}</span>
        </div>
    );
};

export default Toast;