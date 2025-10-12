import React, { useState, lazy, Suspense, useRef, useEffect } from 'react';
import { AppProvider, useUIActions, useUIState } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Page } from './types';
import ScannerModal from './components/ScannerModal';
import Header from './components/Header';
import { SpinnerIcon, HistoryIcon, NewOrderIcon, SettingsIcon } from './components/Icons';
import LoginPage from './pages/LoginPage';
import DeliveryTypeModal from './components/DeliveryTypeModal';
import { exportToXLS } from './services/dataService';
import { useDataActions } from './context/AppContext';
import { useSwipeNavigation } from './hooks/useSwipeNavigation';

// Lazy load pages and heavy modals
const NewOrderPage = lazy(() => import('./pages/NewOrderPage'));
const OrderHistoryPage = lazy(() => import('./pages/OrderHistoryPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const OrderDetailModal = lazy(() => import('./components/OrderDetailModal'));

// Page component mapping for dynamic rendering
const pageComponents: { [key in Page]: React.LazyExoticComponent<React.FC<{ isActive: boolean }>> } = {
    'history': OrderHistoryPage,
    'new-order': NewOrderPage,
    'settings': SettingsPage,
};


// Fallback UI for suspense
const PageSuspenseFallback: React.FC = () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-50">
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
        className={`flex-1 flex items-center justify-center gap-2 py-4 text-sm font-semibold transition-colors duration-300 focus:outline-none focus-visible:bg-gray-100 ${
            isActive 
                ? 'text-blue-600' 
                : 'text-gray-500 hover:text-gray-800'
        }`}
        aria-current={isActive ? 'page' : undefined}
    >
        <Icon className="w-5 h-5" />
        <span>{label}</span>
    </button>
);

const TopTabBar: React.FC<TopTabBarProps> = ({ activePage, setActivePage }) => {
    const navRef = useRef<HTMLElement>(null);
    const [indicatorStyle, setIndicatorStyle] = useState({});

    useEffect(() => {
        if (navRef.current) {
            const activeTabElement = navRef.current.querySelector(`button[aria-current="page"]`) as HTMLButtonElement;
            if (activeTabElement) {
                const { offsetLeft, clientWidth } = activeTabElement;
                setIndicatorStyle({
                    left: `${offsetLeft + clientWidth * 0.2}px`, // Center the 60% width indicator
                    width: `${clientWidth * 0.6}px`,
                });
            }
        }
    }, [activePage]);
    
    return (
        <nav ref={navRef} className="relative w-full bg-white flex justify-around items-center flex-shrink-0 shadow-sm">
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
                page="settings"
                label="설정"
                Icon={SettingsIcon}
                isActive={activePage === 'settings'}
                onClick={setActivePage}
            />
            {/* Sliding Indicator */}
            <div 
                className="absolute bottom-0 h-1 bg-blue-500 rounded-full"
                style={{
                    ...indicatorStyle,
                    transition: 'all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                }}
            />
        </nav>
    );
};
// --- End Top Tab Bar Component ---


const AppContent: React.FC = () => {
    const [activePage, setActivePage] = useState<Page>('new-order');
    const { 
        isDetailModalOpen, 
        isScannerOpen,
        onScanSuccess,
        isDeliveryModalOpen,
        orderToExport,
     } = useUIState();
    const { 
        closeScanner,
        hideAlert,
        closeDeliveryModal,
     } = useUIActions();
    const { updateOrder } = useDataActions();

    const handleExportConfirm = (deliveryType: '일반배송' | '택배배송') => {
        if (orderToExport) {
            exportToXLS(orderToExport, deliveryType);
            const timestamp = new Date().toISOString();
            updateOrder({
                ...orderToExport,
                completedAt: timestamp,
                completionDetails: { type: 'xls', timestamp }
            });
        }
        closeDeliveryModal();
    };

    const pages: Page[] = ['history', 'new-order', 'settings'];
    const currentPageIndex = pages.indexOf(activePage);
    const swipeContainerRef = useRef<HTMLDivElement>(null);

    const handleNavigation = (targetPage: Page) => {
        if (targetPage === activePage) return;
        hideAlert(); // Dismiss any open alerts on main navigation
        setActivePage(targetPage);
    };

    const { onTouchStart, onTouchMove, onTouchEnd, containerStyle } = useSwipeNavigation({
        items: pages,
        activeIndex: currentPageIndex,
        onNavigate: (page) => handleNavigation(page),
        containerRef: swipeContainerRef,
    });


    return (
        <div className="h-full w-full flex flex-col bg-gray-50">
            <Header />
            <TopTabBar activePage={activePage} setActivePage={handleNavigation} />
            <main
                className="main-content flex-grow relative overflow-x-hidden"
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
            >
                <div
                    ref={swipeContainerRef}
                    className="h-full flex absolute top-0 left-0"
                    style={{
                        width: `${pages.length * 100}%`,
                        ...containerStyle
                    }}
                >
                    {pages.map(page => {
                        const PageComponent = pageComponents[page];
                        return (
                            <div key={page} className="h-full" style={{ width: `${100 / pages.length}%` }}>
                                <Suspense fallback={<PageSuspenseFallback />}>
                                    <PageComponent isActive={activePage === page} />
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
            <ScannerModal isOpen={isScannerOpen} onClose={closeScanner} onScanSuccess={onScanSuccess} />
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