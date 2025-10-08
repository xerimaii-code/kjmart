import React, { useState, lazy, Suspense } from 'react';
import { AppProvider, DataProvider, useUI } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Page } from './types';
import BottomNav from './components/BottomNav';
import ScannerModal from './components/ScannerModal';
import Header from './components/Header';
import { SpinnerIcon } from './components/Icons';
import LoginPage from './pages/LoginPage';

// Lazy load pages and heavy modals
const NewOrderPage = lazy(() => import('./pages/NewOrderPage'));
const OrderHistoryPage = lazy(() => import('./pages/OrderHistoryPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const OrderDetailModal = lazy(() => import('./components/OrderDetailModal'));

// Fallback UI for suspense
const PageSuspenseFallback: React.FC = () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-50">
        <SpinnerIcon className="w-10 h-10 text-blue-500" />
    </div>
);

const AppContent: React.FC = () => {
    const [activePage, setActivePage] = useState<Page>('new-order');
    const { 
        isDetailModalOpen, 
        isScannerOpen,
        onScanSuccess,
        closeScanner,
        hideAlert,
     } = useUI();

    const handleNavigation = (targetPage: Page) => {
        if (targetPage === activePage) return;
        hideAlert(); // Dismiss any open alerts on main navigation
        setActivePage(targetPage);
    };


    const renderPage = () => {
        switch (activePage) {
            case 'new-order':
                return <NewOrderPage />;
            case 'history':
                return <OrderHistoryPage />;
            case 'settings':
                return <SettingsPage />;
            default:
                return <NewOrderPage />;
        }
    };

    return (
        <div className="h-full w-full flex flex-col bg-gray-50">
            <Header />
            <main className="main-content flex-grow relative overflow-y-auto">
                <Suspense fallback={<PageSuspenseFallback />}>
                    {renderPage()}
                </Suspense>
            </main>
            <BottomNav activePage={activePage} setActivePage={handleNavigation} />

            {/* Global Modals */}
            <Suspense fallback={null}>
              {isDetailModalOpen && <OrderDetailModal />}
            </Suspense>
            <ScannerModal isOpen={isScannerOpen} onClose={closeScanner} onScanSuccess={onScanSuccess} />
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
    
    return (
        <DataProvider>
            <AppContent />
        </DataProvider>
    );
};

const App: React.FC = () => {
    return (
        <AppProvider>
            <AuthProvider>
                <AppRouter />
            </AuthProvider>
        </AppProvider>
    );
};

export default App;