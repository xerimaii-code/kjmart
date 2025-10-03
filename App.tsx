import React, { useState, lazy, Suspense } from 'react';
import { AppProvider, useUI } from './context/AppContext';
import { Page } from './types';
import BottomNav from './components/BottomNav';
import ScannerModal from './components/ScannerModal';
import Header from './components/Header';
import { SpinnerIcon } from './components/Icons';

// Lazy load pages and heavy modals
const NewOrderPage = lazy(() => import('./pages/NewOrderPage'));
const OrderHistoryPage = lazy(() => import('./pages/OrderHistoryPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const OrderDetailModal = lazy(() => import('./components/OrderDetailModal'));

// Fallback UI for suspense
const PageSuspenseFallback: React.FC = () => (
    <div className="w-full h-full flex items-center justify-center">
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
     } = useUI();

    const handleNavigation = (targetPage: Page) => {
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
            {/* ScannerModal is not lazy loaded to avoid double spinners, but its heavy library is dynamically loaded */}
            <ScannerModal isOpen={isScannerOpen} onClose={closeScanner} onScanSuccess={onScanSuccess} />
        </div>
    );
};


const App: React.FC = () => {
    return (
        <AppProvider>
            <AppContent />
        </AppProvider>
    );
};

export default App;