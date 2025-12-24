import React, { createContext, useState, useCallback, ReactNode, useContext, useMemo } from 'react';
import AlertModal from '../components/AlertModal';
import Toast, { ToastState } from '../components/Toast';

interface AlertState {
    isOpen: boolean;
    message: string;
    onConfirm?: () => void;
    onCancel?: () => void;
    confirmText?: string;
    confirmButtonClass?: string;
    cancelText?: string;
    onClose?: () => void;
}

interface AlertContextType {
    showAlert: (message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string, onCancel?: () => void, cancelText?: string, onClose?: () => void) => void;
    showToast: (message: string, type?: 'success' | 'error') => void;
}

export const AlertContext = createContext<AlertContextType | undefined>(undefined);

export const AlertProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [alertState, setAlertState] = useState<AlertState>({ isOpen: false, message: '' });
    const [toastState, setToastState] = useState<ToastState>({ isOpen: false, message: '', type: 'success' });

    const showAlert = useCallback((message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string, onCancel?: () => void, cancelText?: string, onClose?: () => void) => {
        setAlertState({ isOpen: true, message, onConfirm, confirmText, confirmButtonClass, onCancel, cancelText, onClose });
    }, []);

    const closeAlert = useCallback(() => {
        setAlertState(prev => {
            if (prev.onClose) prev.onClose();
            return { ...prev, isOpen: false };
        });
    }, []);

    const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToastState({ isOpen: true, message, type });
    }, []);

    const closeToast = useCallback(() => {
        setToastState(prev => ({ ...prev, isOpen: false }));
    }, []);

    const alertValue = useMemo(() => ({ showAlert, showToast }), [showAlert, showToast]);

    return (
        <AlertContext.Provider value={alertValue}>
            {children}
            <AlertModal
                isOpen={alertState.isOpen}
                message={alertState.message}
                closeHandler={closeAlert}
                onConfirm={alertState.onConfirm}
                onCancel={alertState.onCancel}
                confirmText={alertState.confirmText}
                cancelText={alertState.cancelText}
                confirmButtonClass={alertState.confirmButtonClass}
            />
            <Toast
                isOpen={toastState.isOpen}
                message={toastState.message}
                type={toastState.type}
                onClose={closeToast}
            />
        </AlertContext.Provider>
    );
};

export const useAlert = () => {
    const context = useContext(AlertContext);
    if (context === undefined) {
        throw new Error('useAlert must be used within an AlertProvider');
    }
    return context;
};
