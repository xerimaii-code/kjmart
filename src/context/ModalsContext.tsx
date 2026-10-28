import React, { createContext, useState, useCallback, useEffect, ReactNode, useContext, useMemo, useRef } from 'react';
import { Order, AddItemModalPayload, EditItemModalPayload, ScannerContext as ScannerContextType, ScannerOptions } from '../types';

// --- TYPE DEFINITIONS ---
export interface ModalsState {
    isDetailModalOpen: boolean;
    editingOrder: Order | null;
    isDeliveryModalOpen: boolean;
    orderToExport: Order | null;
    addItemModalProps: AddItemModalPayload | null;
    editItemModalProps: EditItemModalPayload | null;
    isClearHistoryModalOpen: boolean;
    // Scanner states
    isScannerOpen: boolean;
    scannerContext: ScannerContextType;
    onScanSuccess: (barcode: string) => void;
    options: ScannerOptions;
}

export interface ModalsActions {
    openDetailModal: (order: Order) => void;
    closeDetailModal: () => void;
    openDeliveryModal: (order: Order) => void;
    closeDeliveryModal: () => void;
    openAddItemModal: (props: AddItemModalPayload) => void;
    closeAddItemModal: () => void;
    openEditItemModal: (props: EditItemModalPayload) => void;
    closeEditItemModal: () => void;
    openClearHistoryModal: () => void;
    closeClearHistoryModal: () => void;
    // Scanner actions
    openScanner: (context: ScannerContextType, onScan: (barcode: string) => void, optionsOrContinuous: boolean | ScannerOptions) => void;
    closeScanner: () => void;
}

// --- CONTEXTS ---
const ModalsContext = createContext<(ModalsState & ModalsActions) | undefined>(undefined);

// --- INITIAL STATE ---
const initialModalsState: ModalsState = {
    isDetailModalOpen: false,
    editingOrder: null,
    isDeliveryModalOpen: false,
    orderToExport: null,
    addItemModalProps: null,
    editItemModalProps: null,
    isClearHistoryModalOpen: false,
    // Scanner initial state
    isScannerOpen: false,
    scannerContext: null,
    onScanSuccess: () => {},
    options: { continuous: false, useHighPrecision: false },
};

// --- PROVIDER COMPONENT ---
export const ModalsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [modalsState, setModalsState] = useState<ModalsState>(initialModalsState);
    const navLock = useRef(false);

    // --- History Management for ALL Modals ---
    useEffect(() => {
        const handlePopState = (event: PopStateEvent) => {
            const modalState = event.state?.modal;
            setModalsState(prev => {
                const next = { ...prev };
                if (prev.isDetailModalOpen && !['detail', 'scanner', 'addItem', 'editItem'].includes(modalState)) {
                    next.isDetailModalOpen = false; next.editingOrder = null;
                }
                if (prev.isDeliveryModalOpen && modalState !== 'delivery') {
                    next.isDeliveryModalOpen = false; next.orderToExport = null;
                }
                if (prev.addItemModalProps && !['addItem', 'scanner'].includes(modalState)) {
                    prev.addItemModalProps.onClose?.();
                    next.addItemModalProps = null;
                }
                if (prev.editItemModalProps && modalState !== 'editItem') {
                    next.editItemModalProps = null;
                }
                if (prev.isScannerOpen && !['scanner', 'addItem', 'receiveItem', 'auditItem', 'continuousEventAdd'].includes(modalState)) {
                    next.isScannerOpen = false;
                }
                return next;
            });
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    // --- ACTIONS ---
    const openModalWithHistory = useCallback((modalName: string, stateUpdate: () => void) => {
        stateUpdate();
        if (navLock.current) return;
        if (window.history.state?.modal !== modalName) {
            navLock.current = true;
            setTimeout(() => { navLock.current = false; }, 300);
            window.history.pushState({ modal: modalName }, '', '');
        }
    }, []);
    
    const closeModalWithHistory = useCallback((modalName: string, stateUpdate: () => void) => {
        stateUpdate();
        if (window.history.state?.modal === modalName) {
            window.history.back();
        }
    }, []);

    const actions = useMemo(() => ({
        openDetailModal: (order: Order) => openModalWithHistory('detail', () => setModalsState(p => ({ ...p, isDetailModalOpen: true, editingOrder: order }))),
        closeDetailModal: () => closeModalWithHistory('detail', () => setModalsState(p => ({ ...p, isDetailModalOpen: false, editingOrder: null }))),
        openDeliveryModal: (order: Order) => openModalWithHistory('delivery', () => setModalsState(p => ({ ...p, isDeliveryModalOpen: true, orderToExport: order }))),
        closeDeliveryModal: () => closeModalWithHistory('delivery', () => setModalsState(p => ({ ...p, isDeliveryModalOpen: false, orderToExport: null }))),
        openAddItemModal: (props: AddItemModalPayload) => openModalWithHistory(props.trigger === 'scan' ? 'scanner' : 'addItem', () => setModalsState(p => ({ ...p, addItemModalProps: props }))),
        closeAddItemModal: () => closeModalWithHistory('addItem', () => setModalsState(p => ({ ...p, addItemModalProps: null }))),
        openEditItemModal: (props: EditItemModalPayload) => openModalWithHistory('editItem', () => setModalsState(p => ({ ...p, editItemModalProps: props }))),
        closeEditItemModal: () => closeModalWithHistory('editItem', () => setModalsState(p => ({ ...p, editItemModalProps: null }))),
        openClearHistoryModal: () => setModalsState(p => ({ ...p, isClearHistoryModalOpen: true })),
        closeClearHistoryModal: () => setModalsState(p => ({ ...p, isClearHistoryModalOpen: false })),
        // 스캐너를 열거나 닫을 때 혹시 남아 있을 수 있는 수량 입력창 상태(addItemModalProps)도 함께 정리하여 중복/잔상 팝업 방지
        openScanner: (context: ScannerContextType, onScan: (b: string) => void, opts: boolean | ScannerOptions) => {
            openModalWithHistory('scanner', () => setModalsState(p => ({ ...p, addItemModalProps: null, isScannerOpen: true, scannerContext: context, onScanSuccess: onScan, options: typeof opts === 'boolean' ? { continuous: opts, useHighPrecision: false } : opts })));
            setTimeout(() => window.dispatchEvent(new CustomEvent('kjmart-scanner-resume')), 0);
        },
        closeScanner: () => closeModalWithHistory('scanner', () => setModalsState(p => ({ ...p, addItemModalProps: null, isScannerOpen: false }))),
    }), [openModalWithHistory, closeModalWithHistory]);

    const contextValue = useMemo(() => ({ ...modalsState, ...actions }), [modalsState, actions]);

    return (
        <ModalsContext.Provider value={contextValue}>
            {children}
        </ModalsContext.Provider>
    );
};

// --- HOOK ---
export const useModals = () => {
    const context = useContext(ModalsContext);
    if (context === undefined) throw new Error('useModals must be used within ModalsProvider');
    return context;
};
