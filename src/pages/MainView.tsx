
import React, { useState, Suspense, useEffect } from 'react';
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
import { SqlRunnerView } from '../components/SqlRunnerView';
import EventManagementPage from './EventManagementPage';

// Loading Spinner for remaining Suspense boundaries (if any)
const LoadingFallback = () => (
    <div className="w-full h-full flex items-center justify-center">
        <SpinnerIcon className="w-10 h-10 text-blue-500" />
    </div>
);

type ActiveModal = 'none' | 'customer' | 'productInquiry' | 'newOrder' | 'orderHistory' | 'sqlRunner' | 'report' | 'settings' | 'productEdit' | 'receiveGoods' | 'eventManagement';

// Valid modes list for validation
const VALID_MODES: ActiveModal[] = ['customer', 'productInquiry', 'newOrder', 'orderHistory', 'sqlRunner', 'report', 'settings', 'productEdit', 'receiveGoods', 'eventManagement'];

const MainView: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const [activeModal, setActiveModal] = useState<ActiveModal>('none');

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
            
            // 1. 히스토리 상태에 유효한 메인 메뉴 이름이 있으면 해당 메뉴를 엽니다.
            if (modalState && VALID_MODES.includes(modalState as ActiveModal)) {
                setActiveModal(modalState as ActiveModal);
            } 
            // 2. 히스토리 상태가 비어있으면(메뉴 밖으로 나감) 메뉴를 닫습니다.
            // 주의: 'receiveEditor' 같은 하위 모달 상태일 때는 여기서 관여하지 않습니다.
            else if (!modalState) {
                setActiveModal('none');
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const handleNavigate = (feature: string) => {
        // 모달을 열 때 히스토리에 상태 추가
        window.history.pushState({ modal: feature }, '', '');
        setActiveModal(feature as ActiveModal);
    };

    const handleClose = () => {
        // 닫기 버튼 클릭 시 로직 개선
        if (activeModal !== 'none') {
            // 현재 히스토리 상태가 닫으려는 모달과 일치하면 뒤로가기 실행 (정상 케이스)
            if (window.history.state?.modal === activeModal) {
                window.history.back();
            } else {
                // 히스토리 상태가 꼬여있거나 일치하지 않으면 강제로 닫음 (Fallback)
                // 이렇게 해야 닫기 버튼이 먹통이 되는 현상을 방지할 수 있습니다.
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
                isOpen={activeModal === 'eventManagement'}
                onClose={handleClose}
                title="행사 상품 검색"
                disableBodyScroll={true}
                zIndexClass="z-30"
            >
                <Suspense fallback={<LoadingFallback />}>
                    <EventManagementPage isActive={activeModal === 'eventManagement'} />
                </Suspense>
            </ActionModal>

            <ActionModal
                isOpen={activeModal === 'sqlRunner' || activeModal === 'report'}
                onClose={handleClose}
                title={activeModal === 'report' ? "실시간 매출 속보" : "SQL Runner (AI)"}
                disableBodyScroll={true}
                zIndexClass="z-30"
            >
                <SqlRunnerView 
                    isActive={activeModal === 'sqlRunner' || activeModal === 'report'} 
                    onBack={handleClose} 
                    isModal={true}
                    initialMode={activeModal === 'report' ? 'report' : undefined}
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
