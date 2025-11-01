import React, { useState, useEffect } from 'react';

interface AlertModalProps {
    isOpen: boolean;
    message: string;
    onClose: () => void;
    onConfirm?: () => void;
    onCancel?: () => void;
    confirmText?: string;
    confirmButtonClass?: string;
}

const AlertModal: React.FC<AlertModalProps> = ({ isOpen, message, onClose, onConfirm, onCancel, confirmText, confirmButtonClass }) => {
    const [isRendered, setIsRendered] = useState(false);

    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => setIsRendered(true), 10);
            return () => clearTimeout(timer);
        } else {
            setIsRendered(false);
        }
    }, [isOpen]);
    
    if (!isOpen) return null;

    const handleConfirm = () => {
        if (onConfirm) {
            onConfirm();
        }
        onClose();
    };
    
    const handleCancel = () => {
        if (onCancel) {
            onCancel();
        }
        onClose();
    };

    return (
        <div className={`fixed inset-0 bg-black z-50 flex items-center justify-center p-4 transition-opacity duration-300 ${isRendered ? 'bg-opacity-50' : 'bg-opacity-0'}`} role="dialog" aria-modal="true" aria-labelledby="alert-dialog-title">
            <div
                className={`bg-white rounded-xl shadow-lg w-full max-w-sm overflow-hidden transition-[opacity,transform] duration-300 will-change-[opacity,transform] ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
            >
                <div className="p-8 text-center">
                    <p id="alert-dialog-title" className="text-lg text-slate-800 whitespace-pre-line font-medium leading-relaxed">{message}</p>
                </div>
                <div className={`bg-slate-50 p-3 ${onConfirm ? 'grid grid-cols-2 gap-3' : 'text-center'}`}>
                    {onConfirm ? (
                        <>
                            <button
                                onClick={handleCancel}
                                className="px-6 py-3 rounded-lg font-bold text-slate-700 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-opacity-75 transition-transform active:scale-95"
                            >
                                취소
                            </button>
                            <button
                                onClick={handleConfirm}
                                className={`text-white px-6 py-3 rounded-lg font-bold focus:outline-none focus:ring-2 focus:ring-opacity-75 transition-transform active:scale-95 ${confirmButtonClass || 'bg-blue-500 hover:bg-blue-600 focus:ring-blue-500'}`}
                            >
                                {confirmText || '확인'}
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={onClose}
                            className="bg-blue-500 text-white w-full px-6 py-3 rounded-lg font-bold hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 transition-transform active:scale-95"
                        >
                            확인
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AlertModal;