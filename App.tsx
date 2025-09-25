
import React, { useState, useContext } from 'react';
import { AppProvider, AppContext } from './context/AppContext';
import { Page } from './types';
import NewOrderPage from './pages/NewOrderPage';
import OrderHistoryPage from './pages/OrderHistoryPage';
import SettingsPage from './pages/SettingsPage';
import BottomNav from './components/BottomNav';
import AlertModal from './components/AlertModal';
import OrderDetailModal from './components/OrderDetailModal';
import Header from './components/Header';

const AppContent: React.FC = () => {
    const [isAppStarted, setIsAppStarted] = useState(false);
    const [activePage, setActivePage] = useState<Page>('new-order');
    const { 
        alert, 
        hideAlert, 
        isDetailModalOpen,
        hasUnsavedChanges,
        showAlert,
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
        if (activePage === 'new-order' && hasUnsavedChanges) {
            showAlert(
                '작성중인 발주 내역이 있습니다. 페이지를 벗어나면 저장되지 않습니다. 정말로 이동하시겠습니까?',
                () => { // onConfirm
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
                confirmText={alert.confirmText}
                confirmButtonClass={alert.confirmButtonClass}
            />
            {isDetailModalOpen && <OrderDetailModal />}
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