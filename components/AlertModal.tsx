import React from 'react';

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
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="alert-dialog-title">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden">
                <div className="p-6 text-center">
                    <p id="alert-dialog-title" className="text-lg text-slate-700">{message}</p>
                </div>
                <div className={`bg-slate-50 p-3 ${onConfirm ? 'flex justify-around items-center' : 'text-center'}`}>
                    {onConfirm ? (
                        <>
                            <button
                                onClick={handleCancel}
                                className="px-6 py-2 rounded-md font-semibold text-slate-600 bg-slate-200 hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-opacity-50 transition"
                            >
                                취소
                            </button>
                            <button
                                onClick={handleConfirm}
                                className={`text-white px-6 py-2 rounded-md font-semibold focus:outline-none focus:ring-2 focus:ring-opacity-50 transition ${confirmButtonClass || 'bg-sky-500 hover:bg-sky-600 focus:ring-sky-500'}`}
                            >
                                {confirmText || '확인'}
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={onClose}
                            className="bg-sky-500 text-white px-6 py-2 rounded-md font-semibold hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-opacity-50 transition"
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