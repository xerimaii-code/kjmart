import React, { useState, useEffect, useRef } from 'react';

interface AlertModalProps {
    isOpen: boolean;
    message: string;
    closeHandler: () => void;
    onConfirm?: () => void;
    onCancel?: () => void;
    confirmText?: string;
    cancelText?: string;
    confirmButtonClass?: string;
    onThirdAction?: () => void;
    thirdActionText?: string;
}

const AlertModal: React.FC<AlertModalProps> = ({
    isOpen,
    message,
    closeHandler,
    onConfirm,
    onCancel,
    confirmText,
    cancelText,
    confirmButtonClass,
    onThirdAction,
    thirdActionText
}) => {
    const [isRendered, setIsRendered] = useState(false);
    const isActionHandledRef = useRef(false);

    useEffect(() => {
        if (isOpen) {
            isActionHandledRef.current = false;
            const timer = setTimeout(() => setIsRendered(true), 10);
            return () => clearTimeout(timer);
        } else {
            isActionHandledRef.current = false;
            setIsRendered(false);
            window.dispatchEvent(new CustomEvent('kjmart-alert-closed'));
        }
    }, [isOpen]);
    
    if (!isOpen) return null;

    const handleSafeCloseOnly = () => {
        if (isActionHandledRef.current) return;
        isActionHandledRef.current = true;
        closeHandler();
        window.dispatchEvent(new CustomEvent('kjmart-alert-closed'));
    };

    const handleConfirm = () => {
        if (isActionHandledRef.current) return;
        isActionHandledRef.current = true;
        if (onConfirm) {
            onConfirm();
        }
        closeHandler();
        window.dispatchEvent(new CustomEvent('kjmart-alert-closed'));
    };
    
    const handleCancel = () => {
        if (isActionHandledRef.current) return;
        isActionHandledRef.current = true;
        if (onCancel) {
            onCancel();
        }
        closeHandler();
        window.dispatchEvent(new CustomEvent('kjmart-alert-closed'));
    };

    const handleThirdAction = () => {
        if (isActionHandledRef.current) return;
        isActionHandledRef.current = true;
        if (onThirdAction) {
            onThirdAction();
        }
        closeHandler();
        window.dispatchEvent(new CustomEvent('kjmart-alert-closed'));
    };

    return (
        <div className={`fixed inset-0 bg-black z-[200] flex items-center justify-center p-4 transition-opacity duration-300 ${isRendered ? 'bg-opacity-50' : 'bg-opacity-0'}`} role="dialog" aria-modal="true" aria-labelledby="alert-dialog-title" onClick={handleSafeCloseOnly}>
            <div
                className={`bg-white rounded-xl shadow-lg w-full max-w-sm overflow-hidden transition-[opacity,transform] duration-300 will-change-[opacity,transform] ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
                onClick={e => e.stopPropagation()}
            >
                <div className="p-8 text-center">
                    <p id="alert-dialog-title" className="text-lg text-slate-800 whitespace-pre-line font-medium leading-relaxed">{message}</p>
                </div>
                <div className={`bg-slate-50 p-3 ${onConfirm && !onThirdAction ? 'grid grid-cols-2 gap-3' : 'flex flex-col gap-2 text-center'}`}>
                    {onConfirm && onThirdAction ? (
                        <>
                            <button
                                type="button"
                                onClick={handleConfirm}
                                className={`w-full py-2.5 px-4 rounded-lg font-bold text-white focus:outline-none focus:ring-2 focus:ring-opacity-75 transition-transform active:scale-95 ${confirmButtonClass || 'bg-blue-500 hover:bg-blue-600 focus:ring-blue-500'}`}
                            >
                                {confirmText || '재스캔'}
                            </button>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={handleThirdAction}
                                    className="py-2 px-3 rounded-lg font-bold text-sm text-slate-700 bg-gray-200 hover:bg-gray-300 focus:outline-none transition-transform active:scale-95"
                                >
                                    {thirdActionText || '취소'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCancel}
                                    className="py-2 px-3 rounded-lg font-bold text-sm text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 focus:outline-none transition-transform active:scale-95"
                                >
                                    {cancelText || '미등록 계속 입력'}
                                </button>
                            </div>
                        </>
                    ) : onConfirm ? (
                        <>
                            <button
                                type="button"
                                onClick={handleCancel}
                                className="px-6 py-2 rounded-lg font-bold text-slate-700 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-opacity-75 transition-transform active:scale-95"
                            >
                                {cancelText || '취소'}
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirm}
                                className={`text-white px-6 py-2 rounded-lg font-bold focus:outline-none focus:ring-2 focus:ring-opacity-75 transition-transform active:scale-95 ${confirmButtonClass || 'bg-blue-500 hover:bg-blue-600 focus:ring-blue-500'}`}
                            >
                                {confirmText || '확인'}
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={handleSafeCloseOnly}
                            className="bg-blue-500 text-white w-full px-6 py-2 rounded-lg font-bold hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 transition-transform active:scale-95"
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