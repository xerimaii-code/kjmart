
import React, { useState, lazy, Suspense } from 'react';
import ActionModal from '../components/ActionModal';
import MenuPage from './MenuPage';
import CustomerSearchModal from '../components/CustomerSearchModal';
import { SpinnerIcon } from '../components/Icons';

// Lazy loading for better performance
const ProductInquiryPage = lazy(() => import('./ProductInquiryPage'));
const NewOrderPage = lazy(() => import('./NewOrderPage'));
const OrderHistoryPage = lazy(() => import('./OrderHistoryPage'));
const SettingsPage = lazy(() => import('./SettingsPage'));
const SqlRunnerView = lazy(() => import('../components/SqlRunnerView').then(module => ({ default: module.SqlRunnerView })));

// Loading Spinner for Suspense
const LoadingFallback = () => (
    <div className="w-full h-full flex items-center justify-center">
        <SpinnerIcon className="w-10 h-10 text-blue-500" />
    </div>
);

type ActiveModal = 'none' | 'customer' | 'productInquiry' | 'newOrder' | 'orderHistory' | 'sqlRunner' | 'report' | 'settings';

const SqlRunnerPage: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const [activeModal, setActiveModal] = useState<ActiveModal>('none');

    const handleNavigate = (feature: string) => {
        setActiveModal(feature as ActiveModal);
    };

    const handleClose = () => {
        setActiveModal('none');
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
                <Suspense fallback={<LoadingFallback />}>
                    <ProductInquiryPage isActive={activeModal === 'productInquiry'} />
                </Suspense>
            </ActionModal>

            <ActionModal
                isOpen={activeModal === 'newOrder'}
                onClose={handleClose}
                title="신규 발주"
                disableBodyScroll={true}
                zIndexClass="z-30"
            >
                <Suspense fallback={<LoadingFallback />}>
                    <NewOrderPage isActive={activeModal === 'newOrder'} />
                </Suspense>
            </ActionModal>

            <ActionModal
                isOpen={activeModal === 'orderHistory'}
                onClose={handleClose}
                title="발주 내역"
                disableBodyScroll={true}
                zIndexClass="z-30"
            >
                <Suspense fallback={<LoadingFallback />}>
                    <OrderHistoryPage isActive={activeModal === 'orderHistory'} />
                </Suspense>
            </ActionModal>

            <ActionModal
                isOpen={activeModal === 'sqlRunner' || activeModal === 'report'}
                onClose={handleClose}
                title={activeModal === 'report' ? "실시간 매출 속보" : "SQL Runner (AI)"}
                disableBodyScroll={true}
                zIndexClass="z-30"
            >
                <Suspense fallback={<LoadingFallback />}>
                    <SqlRunnerView 
                        isActive={activeModal === 'sqlRunner' || activeModal === 'report'} 
                        onBack={handleClose} 
                        isModal={true}
                        initialMode={activeModal === 'report' ? 'report' : undefined}
                    />
                </Suspense>
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

export default SqlRunnerPage;
