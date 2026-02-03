
import React, { useState, Suspense, useEffect, useRef } from 'react';
import ActionModal from '../components/ActionModal';
import MenuPage from './MenuPage';
import CustomerSearchModal from '../components/CustomerSearchModal';
import { SpinnerIcon } from '../components/Icons';
import ProductEditPage from './ProductEditPage';

// Static imports for major pages to prevent loading race conditions
import ProductInquiryPage from './ProductInquiryPage';
import NewOrderPage from './NewOrderPage';
import OrderHistoryPage from './OrderHistoryPage';
import SettingsPage from './SettingsPage';
import ReceiveManagerPage from './ReceiveManagerPage';
import { SqlRunnerView } from './SqlRunnerPage';
import RealtimeReportPage from './RealtimeReportPage'; // 분리된 보고서 페이지
import EventManagementPage from './EventManagementPage';
import PurchaseHistoryPage from './PurchaseHistoryPage';
import EventRegistrationPage from './EventRegistrationPage';
import InventoryAuditPage from './InventoryAuditPage';

// Loading Spinner for remaining Suspense boundaries (if any)
const LoadingFallback = () => (
    <div className="w-full h-full flex items-center justify-center">
        <SpinnerIcon className="w-10 h-10 text-blue-500" />
    </div>
);

type ActiveModal = 'none' | 'customer' | 'productInquiry' | 'newOrder' | 'orderHistory' | 'sqlRunner' | 'report' | 'settings' | 'productEdit' | 'receiveGoods' | 'eventManagement' | 'purchaseHistory' | 'eventRegistration' | 'inventoryAudit';

// Valid modes list for validation
const VALID_MODES: ActiveModal[] = ['customer', 'productInquiry', 'newOrder', 'orderHistory', 'sqlRunner', 'report', 'settings', 'productEdit', 'receiveGoods', 'eventManagement', 'purchaseHistory', 'eventRegistration', 'inventoryAudit'];

const MainView: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const [activeModal, setActiveModal] = useState<ActiveModal>('none');
    
    // Navigation Lock to prevent double execution
    const navigationLock = useRef(false);

    // 앱 시작(또는 새로고침) 후 로직: 히스토리 상태가 있다면 복구
    useEffect(() => {
        const initialState = window.history.state?.modal;
        if (initialState && VALID_MODES.includes(initialState as ActiveModal)) {
            setActiveModal(initialState as ActiveModal);
        }
    }, []);

    // 뒤로가기 버튼(PopState) 처리
    useEffect(() => {
        const handlePopState = (event: PopStateEvent) => {
            const modalState = event.state?.modal;
            
            if (modalState && VALID_MODES.includes(modalState as ActiveModal)) {
                setActiveModal(modalState as ActiveModal);
            } 
            else if (!modalState) {
                setActiveModal('none');
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const handleNavigate = (feature: string) => {
        if (navigationLock.current) return;
        navigationLock.current = true;
        setTimeout(() => { navigationLock.current = false; }, 500);

        if (window.history.state?.modal === feature || activeModal === feature) {
            setActiveModal(feature as ActiveModal);
            return;
        }
        
        window.history.pushState({ modal: feature }, '', '');
        setActiveModal(feature as ActiveModal);
    };

    const handleClose = () => {
        if (activeModal !== 'none') {
            if (window.history.state?.modal === activeModal) {
                window.history.back();
            } else {
                setActiveModal('none');
            }
        }
    };

    return (
        <>
            {/* Main Menu Page (Always rendered as background) */}
            <MenuPage onNavigate={handleNavigate} />

            {/* Modals for each feature */}
            <CustomerSearchModal 
                isOpen={activeModal === 'customer'} 
                onClose={handleClose} 
            />

            <ActionModal
                isOpen={activeModal === 'productInquiry'}
                onClose={handleClose}
                title="상품 조회"
                disableBodyScroll={true}
                zIndexClass="z-30"
            >
                <ProductInquiryPage isActive={activeModal === 'productInquiry'} />
            </ActionModal>

            <ActionModal
                isOpen={activeModal === 'newOrder'}
                onClose={handleClose}
                title="신규 발주"
                disableBodyScroll={true}
                zIndexClass="z-30"
            >
                <NewOrderPage isActive={activeModal === 'newOrder'} />
            </ActionModal>

            <ActionModal
                isOpen={activeModal === 'orderHistory'}
                onClose={handleClose}
                title="발주 내역"
                disableBodyScroll={true}
                zIndexClass="z-30"
            >
                <OrderHistoryPage isActive={activeModal === 'orderHistory'} />
            </ActionModal>

            <ProductEditPage 
                isOpen={activeModal === 'productEdit'} 
                onClose={handleClose} 
            />
            
            <ActionModal
                isOpen={activeModal === 'receiveGoods'}
                onClose={handleClose}
                title="입고 등록"
                disableBodyScroll={true}
                zIndexClass="z-30"
            >
                <ReceiveManagerPage 
                    isActive={activeModal === 'receiveGoods'} 
                    onClose={handleClose} 
                />
            </ActionModal>

            <ActionModal
                isOpen={activeModal === 'inventoryAudit'}
                onClose={handleClose}
                title="재고 실사"
                disableBodyScroll={true}
                zIndexClass="z-30"
            >
                <InventoryAuditPage isActive={activeModal === 'inventoryAudit'} />
            </ActionModal>

            <ActionModal
                isOpen={activeModal === 'eventManagement'}
                onClose={handleClose}
                title="행사 관리"
                disableBodyScroll={true}
                zIndexClass="z-30"
            >
                <Suspense fallback={<LoadingFallback />}>
                    <EventManagementPage isActive={activeModal === 'eventManagement'} />
                </Suspense>
            </ActionModal>

            <ActionModal
                isOpen={activeModal === 'purchaseHistory'}
                onClose={handleClose}
                title="매입 내역"
                disableBodyScroll={true}
                zIndexClass="z-30"
            >
                <Suspense fallback={<LoadingFallback />}>
                    <PurchaseHistoryPage isActive={activeModal === 'purchaseHistory'} />
                </Suspense>
            </ActionModal>
            
            <ActionModal
                isOpen={activeModal === 'eventRegistration'}
                onClose={handleClose}
                title="신규 행사 등록"
                disableBodyScroll={false}
                zIndexClass="z-30"
            >
                <Suspense fallback={<LoadingFallback />}>
                    <EventRegistrationPage 
                        isActive={activeModal === 'eventRegistration'} 
                        onSuccess={() => handleClose()} 
                    />
                </Suspense>
            </ActionModal>

            {/* SQL Runner Page - Pure tool */}
            <ActionModal
                isOpen={activeModal === 'sqlRunner'}
                onClose={handleClose}
                title="SQL Runner (AI)"
                disableBodyScroll={true}
                zIndexClass="z-30"
            >
                <SqlRunnerView 
                    isActive={activeModal === 'sqlRunner'} 
                />
            </ActionModal>

            {/* Realtime Report Page - Structured report */}
            <ActionModal
                isOpen={activeModal === 'report'}
                onClose={handleClose}
                title="실시간 매출 속보"
                disableBodyScroll={true}
                zIndexClass="z-30"
            >
                <RealtimeReportPage 
                    isActive={activeModal === 'report'} 
                />
            </ActionModal>

            <ActionModal
                isOpen={activeModal === 'settings'}
                onClose={handleClose}
                title="설정"
                disableBodyScroll={true}
                zIndexClass="z-30"
            >
                <Suspense fallback={<LoadingFallback />}>
                    <SettingsPage isActive={activeModal === 'settings'} />
                </Suspense>
            </ActionModal>
        </>
    );
};

export default MainView;
