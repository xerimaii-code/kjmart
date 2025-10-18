import React, { useState, lazy, Suspense, useRef, useMemo } from 'react';
import { AppProvider, useModals, useScanner } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Page } from './types';
import Header from './components/Header';
import { SpinnerIcon, HistoryIcon, NewOrderIcon, SettingsIcon, SearchIcon } from './components/Icons';
import LoginPage from './pages/LoginPage';
import DeliveryTypeModal from './components/DeliveryTypeModal';
import { exportToXLS } from './services/dataService';
import { useDataActions } from './context/AppContext';
import { useSwipeNavigation } from './hooks/useSwipeNavigation';

// Lazy load pages and heavy modals
const NewOrderPage = lazy(() => import('./pages/NewOrderPage'));
const OrderHistoryPage = lazy(() => import('./pages/OrderHistoryPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ProductInquiryPage = lazy(() => import('./pages/ProductInquiryPage'));
const OrderDetailModal = lazy(() => import('./components/OrderDetailModal'));
const ScannerModal = lazy(() => import('./components/ScannerModal'));

const pages: Page[] = ['history', 'new-order', 'product-inquiry', 'settings'];

// Page component mapping for dynamic rendering
const pageComponents: { [key in Page]: React.LazyExoticComponent<React.FC<{ isActive: boolean }>> } = {
    'history': OrderHistoryPage,
    'new-order': NewOrderPage,
    'product-inquiry': ProductInquiryPage,
    'settings': SettingsPage,
};


// Fallback UI for suspense
const PageSuspenseFallback: React.FC = () => (
    <div className="w-full h-full flex items-center justify-center bg-transparent">
        <SpinnerIcon className="w-10 h-10 text-blue-500" />
    </div>
);

// --- Top Tab Bar Component ---
interface TopTabBarProps {
    activePage: Page;
    setActivePage: (page: Page) => void;
}

const TabButton: React.FC<{
    page: Page;
    label: string;
    Icon: React.FC<{className?: string}>;
    isActive: boolean;
    onClick: (page: Page) => void;
}> = ({ page, label, Icon, isActive, onClick }) => (
    <button
        onClick={() => onClick(page)}
        className={`relative flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 rounded-lg ${
            isActive 
                ? 'text-blue-600' 
                : 'text-gray-500 hover:text-gray-900'
        }`}
        aria-current={isActive ? 'page' : undefined}
    >
        <div className="relative z-10 flex items-center justify-center gap-2">
            <Icon className="w-5 h-5" />
            <span>{label}</span>
        </div>
        {isActive && (
            <div 
                className="absolute inset-0 bg-blue-100 rounded-lg"
            />
        )}
    </button>
);

const TopTabBar: React.FC<TopTabBarProps> = ({ activePage, setActivePage }) => {
    return (
        <nav className="w-full bg-white/60 backdrop-blur-lg flex justify-around items-center flex-shrink-0 p-2 border-b border-gray-200/80">
            <div className="flex w-full justify-around items-center h-full gap-2">
                <TabButton
                    page="history"
                    label="발주내역"
                    Icon={HistoryIcon}
                    isActive={activePage === 'history'}
                    onClick={setActivePage}
                />
                <TabButton
                    page="new-order"
                    label="신규발주"
                    Icon={NewOrderIcon}
                    isActive={activePage === 'new-order'}
                    onClick={setActivePage}
                />
                 <TabButton
                    page="product-inquiry"
                    label="상품조회"
                    Icon={SearchIcon}
                    isActive={activePage === 'product-inquiry'}
                    onClick={setActivePage}
                />
                <TabButton
                    page="settings"
                    label="설정"
                    Icon={SettingsIcon}
                    isActive={activePage === 'settings'}
                    onClick={setActivePage}
                />
            </div>
        </nav>
    );
};
// --- End Top Tab Bar Component ---

const AppContent: React.FC = () => {
    const [activePage, setActivePage] = useState<Page>('product-inquiry');
    const { 
        isDetailModalOpen,
        isDeliveryModalOpen,
        orderToExport,
        closeDeliveryModal,
     } = useModals();
    const { isScannerOpen, onScanSuccess, closeScanner } = useScanner();

    const { updateOrderStatus } = useDataActions();
    
    const swipeContainerRef = useRef<HTMLDivElement>(null);
    const activePageIndex = useMemo(() => pages.indexOf(activePage), [activePage]);

    const handleExportConfirm = (deliveryType: '일반배송' | '택배배송') => {
        if (orderToExport) {
            exportToXLS(orderToExport, deliveryType);
            const timestamp = new Date().toISOString();
            updateOrderStatus(orderToExport.id, { type: 'xls', timestamp });
        }
        closeDeliveryModal();
    };

    const handleNavigation = (targetPage: Page) => {
        if (targetPage === activePage) return;
        setActivePage(targetPage);
    };

    const { onTouchStart, onTouchMove, onTouchEnd, containerStyle } = useSwipeNavigation({
        items: pages,
        activeIndex: activePageIndex,
        onNavigate: handleNavigation,
        containerRef: swipeContainerRef,
    });

    return (
        <div className="h-full w-full flex flex-col bg-transparent">
            <Header />
            <TopTabBar activePage={activePage} setActivePage={handleNavigation} />
            <main className="main-content flex-grow relative overflow-x-hidden">
                <div
                    ref={swipeContainerRef}
                    className="h-full w-full flex"
                    style={{ ...containerStyle, width: `${pages.length * 100}%` }}
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                >
                    {pages.map((page, index) => {
                        const PageComponent = pageComponents[page];
                        return (
                            <div key={page} className="h-full w-full flex-shrink-0" style={{ width: `${100 / pages.length}%` }}>
                                <Suspense fallback={<PageSuspenseFallback />}>
                                    <PageComponent isActive={index === activePageIndex} />
                                </Suspense>
                            </div>
                        );
                    })}
                </div>
            </main>

            {/* Global Modals */}
            <Suspense fallback={null}>
              {isDetailModalOpen && <OrderDetailModal />}
            </Suspense>
            <Suspense fallback={null}>
                {isScannerOpen && <ScannerModal isOpen={isScannerOpen} onClose={closeScanner} onScanSuccess={onScanSuccess} />}
            </Suspense>
            <DeliveryTypeModal
                isOpen={isDeliveryModalOpen}
                onClose={closeDeliveryModal}
                onConfirm={handleExportConfirm}
            />
        </div>
    );
};

const AccessDeniedPage: React.FC = () => {
    const { logout } = useAuth();
    return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-gray-100 p-4 text-center">
            <h2 className="text-2xl font-bold text-red-600 mb-4">접근 거부됨</h2>
            <p className="text-gray-700 mb-6">이 계정은 앱을 사용할 권한이 없습니다.</p>
            <button
                onClick={logout}
                className="bg-gray-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-gray-700 transition"
            >
                로그아웃
            </button>
        </div>
    );
};

const AppRouter: React.FC = () => {
    const { user, loading, isAdmin } = useAuth();

    if (loading) {
        return <PageSuspenseFallback />;
    }

    if (!user) {
        return <LoginPage />;
    }

    if (!isAdmin) {
        return <AccessDeniedPage />;
    }
    
    return <AppContent />;
};

const App: React.FC = () => {
    return (
        <AuthProvider>
            <AppProvider>
                <AppRouter />
            </AppProvider>
        </AuthProvider>
    );
};

export default App;