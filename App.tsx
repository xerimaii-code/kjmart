
import React, { useState, useContext } from 'react';
import { AppProvider, AppContext } from './context/AppContext.tsx';
import { Page } from './types.ts';
import NewOrderPage from './pages/NewOrderPage.tsx';
import OrderHistoryPage from './pages/OrderHistoryPage.tsx';
import SettingsPage from './pages/SettingsPage.tsx';
import BottomNav from './components/BottomNav.tsx';
import AlertModal from './components/AlertModal.tsx';
import OrderDetailModal from './components/OrderDetailModal.tsx';
import ScannerModal from './components/ScannerModal.tsx';
import Header from './components/Header.tsx';

const AppContent: React.FC = () => {
    const [isAppStarted, setIsAppStarted] = useState(false);
    const [activePage, setActivePage] = useState<Page>('new-order');
    const { 
        alert, 
        hideAlert, 
        isDetailModalOpen, 
        isScannerOpen,
        onScanSuccess,
        closeScanner,
        hasUnsavedChanges,
        showAlert,
        closeDetailModal,
        setHasUnsavedChanges,
     } = useContext(AppContext);

    const handleStartApp = () => {
        const element = document.documentElement;
        if (element.requestFullscreen) {
            element.requestFullscreen().catch(err => {
                console.warn(`Error attempting to enable full-screen mode: ${err.message}`);
            });
        }
        setIsAppStarted(true);
    };

    const handleNavigation = (targetPage: Page) => {
        if (hasUnsavedChanges) {
            const message = isDetailModalOpen
                ? '수정중인 발주 내역이 있습니다. 저장하지 않고 이동하시겠습니까?'
                : '작성중인 발주 내역이 있습니다. 저장하지 않고 이동하시겠습니까?';
            
            showAlert(
                message,
                () => { // onConfirm
                    if (isDetailModalOpen) {
                        // Closing the modal will trigger its own cleanup effect to reset hasUnsavedChanges
                        closeDetailModal();
                    } else {
                        // For NewOrderPage, which doesn't unmount on navigation, we must manually reset the flag
                        setHasUnsavedChanges(false);
                    }
                    setActivePage(targetPage);
                },
                '이동',
                'bg-red-500 hover:bg-red-600 focus:ring-red-500'
            );
        } else {
            setActivePage(targetPage);
        }
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

    if (!isAppStarted) {
        return (
            <div className="h-full w-full flex flex-col items-center justify-center bg-white p-8 text-center">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 text-sky-500 mb-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
                <h1 className="text-4xl font-bold text-slate-800 mb-4">발주 관리 앱</h1>
                <p className="text-lg text-slate-600 mb-10">버튼을 눌러 전체 화면으로 시작하세요.</p>
                <button
                    onClick={handleStartApp}
                    className="bg-sky-500 text-white font-bold py-4 px-10 rounded-full shadow-lg text-xl hover:bg-sky-600 focus:outline-none focus:ring-4 focus:ring-sky-300 transition-all transform hover:scale-105"
                    aria-label="Start the application in fullscreen mode"
                >
                    앱 시작하기
                </button>
            </div>
        );
    }

    return (
        <div className="h-full w-full flex flex-col">
            <Header />
            <main className="main-content flex-grow relative">
                {renderPage()}
            </main>
            <BottomNav activePage={activePage} setActivePage={handleNavigation} />

            {/* Global Modals */}
            <AlertModal
                isOpen={alert.isOpen}
                message={alert.message}
                onClose={hideAlert}
                onConfirm={alert.onConfirm}
                onCancel={alert.onCancel}
                confirmText={alert.confirmText}
                confirmButtonClass={alert.confirmButtonClass}
            />
            {isDetailModalOpen && <OrderDetailModal />}
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