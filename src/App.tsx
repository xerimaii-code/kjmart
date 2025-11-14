import React, { useState, lazy, Suspense, useRef, useMemo, useEffect } from 'react';
import { AppProvider, useModals, useScanner, useSyncState, useDataState, useDataActions, useAlert, useMiscUI } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Page } from './types';
import Header from './components/Header';
import { SpinnerIcon } from './components/Icons';
import LoginPage from './pages/LoginPage';
import DeliveryTypeModal from './components/DeliveryTypeModal';
import { exportToXLS, loadScript } from './services/dataService';
import { useSwipeNavigation } from './hooks/useSwipeNavigation';

// Lazy load pages and heavy modals
const NewOrderPage = lazy(() => import('./pages/NewOrderPage'));
const OrderHistoryPage = lazy(() => import('./pages/OrderHistoryPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ProductInquiryPage = lazy(() => import('./pages/ProductInquiryPage'));
const OrderDetailModal = lazy(() => import('./components/OrderDetailModal'));
const ScannerModal = lazy(() => import('./components/ScannerModal'));
const AddItemModal = lazy(() => import('./components/AddItemModal'));
const EditItemModal = lazy(() => import('./components/EditItemModal'));
const SyncHistoryModal = lazy(() => import('./components/SyncHistoryModal'));
const ClearHistoryModal = lazy(() => import('./components/ClearHistoryModal'));


const ZXING_CDN = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.0/umd/index.min.js";

const pages: Page[] = [ 'history', 'new-order', 'product-inquiry', 'settings'];

// Page component mapping for dynamic rendering
const pageComponents: { [key in Page]: React.LazyExoticComponent<React.FC<{ isActive: boolean }>> } = {
    'new-order': NewOrderPage,
    'product-inquiry': ProductInquiryPage,
    'history': OrderHistoryPage,
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
    isActive: boolean;
    onClick: (page: Page) => void;
}> = ({ page, label, isActive, onClick }) => (
    <button
        onClick={() => onClick(page)}
        className={`z-10 relative flex-1 py-3 text-sm font-semibold transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 rounded-lg ${
            isActive 
                ? 'text-blue-600' 
                : 'text-gray-500 hover:text-gray-900'
        }`}
        aria-current={isActive ? 'page' : undefined}
    >
        <span>{label}</span>
    </button>
);

const TopTabBar: React.FC<TopTabBarProps> = ({ activePage, setActivePage }) => {
    const tabs = useMemo(() => [
        { page: "history" as Page, label: "발주내역" },
        { page: "new-order" as Page, label: "신규발주" },
        { page: "product-inquiry" as Page, label: "상품조회" },
        { page: "settings" as Page, label: "설정" },
    ], []);

    const activeIndex = useMemo(() => tabs.findIndex(tab => tab.page === activePage), [tabs, activePage]);

    return (
        <nav className="relative w-full bg-white flex items-center flex-shrink-0 p-1 border-b border-gray-200">
            {tabs.map(tab => (
                <TabButton
                    key={tab.page}
                    page={tab.page}
                    label={tab.label}
                    isActive={activePage === tab.page}
                    onClick={setActivePage}
                />
            ))}
            {activeIndex !== -1 && (
                <div
                    className="absolute left-0 -bottom-0.5 h-1 bg-blue-600 rounded-full transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
                    style={{
                        width: `calc(100% / ${tabs.length})`,
                        transform: `translateX(calc(${activeIndex * 100}%))`,
                        willChange: 'transform'
                    }}
                />
            )}
        </nav>
    );
};
// --- End Top Tab Bar Component ---


const InitialSyncLoader: React.FC = () => {
    const { syncStatusText, syncProgress } = useSyncState();
    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (syncProgress / 100) * circumference;

    return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-transparent p-4">
            <div className="relative w-32 h-32 flex items-center justify-center mb-6">
                <svg className="absolute w-full h-full" viewBox="0 0 120 120">
                    <circle
                        className="text-gray-200"
                        strokeWidth="8"
                        stroke="currentColor"
                        fill="transparent"
                        r={radius}
                        cx="60"
                        cy="60"
                    />
                    <circle
                        className="text-blue-500"
                        strokeWidth="8"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="transparent"
                        r={radius}
                        cx="60"
                        cy="60"
                        transform="rotate(-90 60 60)"
                        style={{ transition: 'stroke-dashoffset 0.35s ease', willChange: 'stroke-dashoffset' }}
                    />
                </svg>
                <span className="text-2xl font-bold text-blue-600 tabular-nums">{Math.round(syncProgress)}%</span>
            </div>
            <p className="text-lg font-semibold text-gray-700 animate-fade-in-up" key={syncStatusText}>
                {syncStatusText}...
            </p>
        </div>
    );
};


const AppContent: React.FC = () => {
    const [activePage, setActivePage] = useState<Page>('product-inquiry');
    const { 
        isDetailModalOpen,
        isDeliveryModalOpen,
        orderToExport,
        closeDeliveryModal,
        addItemModalProps,
        closeAddItemModal,
        editItemModalProps,
        closeEditItemModal,
        isHistoryModalOpen,
        closeHistoryModal,
        isClearHistoryModalOpen,
        closeClearHistoryModal,
     } = useModals();
    const { isScannerOpen, onScanSuccess, closeScanner } = useScanner();
    const { updateOrderStatus } = useDataActions();
    const { showToast } = useAlert();
    const { activeMenuOrderId } = useMiscUI();
    
    const swipeContainerRef = useRef<HTMLDivElement>(null);
    const activePageIndex = useMemo(() => pages.indexOf(activePage), [activePage]);
    
    const handleExportConfirm = (deliveryType: '일반배송' | '택배배송') => {
        if (orderToExport) {
            exportToXLS(orderToExport, deliveryType);
            const timestamp = new Date().toISOString();
            updateOrderStatus(orderToExport.id, { type: 'xls', timestamp });
            showToast(`${orderToExport.customer.name} 발주서가 XLS 파일로 저장되었습니다.`, 'success');
        }
        closeDeliveryModal();
    };

    const handleNavigation = (targetPage: Page) => {
        if (targetPage === activePage) return;
        setActivePage(targetPage);
    };

    const isAnyModalOpen = useMemo(() => (
        isDetailModalOpen || 
        isDeliveryModalOpen || 
        isScannerOpen || 
        !!addItemModalProps || 
        !!editItemModalProps || 
        isHistoryModalOpen ||
        isClearHistoryModalOpen ||
        activeMenuOrderId !== null
    ), [isDetailModalOpen, isDeliveryModalOpen, isScannerOpen, addItemModalProps, editItemModalProps, isHistoryModalOpen, isClearHistoryModalOpen, activeMenuOrderId]);

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
            <main className={`main-content flex-grow relative ${activeMenuOrderId !== null ? '' : 'overflow-x-hidden'}`}>
                <div
                    ref={swipeContainerRef}
                    className="h-full w-full flex"
                    style={{ ...containerStyle, width: `${pages.length * 100}%` }}
                    onTouchStart={!isAnyModalOpen ? onTouchStart : undefined}
                    onTouchMove={!isAnyModalOpen ? onTouchMove : undefined}
                    onTouchEnd={!isAnyModalOpen ? onTouchEnd : undefined}
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
              {isScannerOpen && <ScannerModal isOpen={isScannerOpen} onClose={closeScanner} onScanSuccess={onScanSuccess} />}
              {addItemModalProps && (
                  <AddItemModal
                      isOpen={true}
                      product={addItemModalProps.product}
                      existingItem={addItemModalProps.existingItem}
                      onClose={closeAddItemModal}
                      onAdd={addItemModalProps.onAdd}
                      onNextScan={addItemModalProps.onNextScan}
                      trigger={addItemModalProps.trigger}
                      initialSettings={addItemModalProps.initialSettings}
                  />
              )}
              {editItemModalProps && (
                  <EditItemModal
                      isOpen={true}
                      item={editItemModalProps.item}
                      onClose={closeEditItemModal}
                      onSave={editItemModalProps.onSave}
                  />
              )}
              {isHistoryModalOpen && <SyncHistoryModal isOpen={isHistoryModalOpen} onClose={closeHistoryModal} />}
              {isClearHistoryModalOpen && <ClearHistoryModal isOpen={isClearHistoryModalOpen} onClose={closeClearHistoryModal} />}
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
    const { initialSyncCompleted } = useSyncState();

    if (loading) {
        return <PageSuspenseFallback />;
    }

    if (!user) {
        return <LoginPage />;
    }

    if (!isAdmin) {
        return <AccessDeniedPage />;
    }

    if (!initialSyncCompleted) {
        return <InitialSyncLoader />;
    }
    
    return <AppContent />;
};

const App: React.FC = () => {
    useEffect(() => {
        // Preload scanner library for faster modal opening.
        loadScript(ZXING_CDN).catch(err => console.warn("Failed to preload scanner library:", err));

        // Register the service worker.
        if ('serviceWorker' in navigator) {
            const registerSW = () => {
                // Construct an absolute URL for the service worker to avoid cross-origin issues
                // that can occur in sandboxed environments like AI Studio's iframes.
                const swUrl = `${window.location.origin}/service-worker.js`;
                navigator.serviceWorker.register(swUrl)
                  .then(registration => {
                    console.log('Service Worker registered successfully with scope:', registration.scope);
                  })
                  .catch(err => {
                    console.error('Service Worker registration failed:', err);
                  });
            };

            // If the page is already loaded, register the service worker immediately.
            // Otherwise, wait for the 'load' event. This prevents the "invalid state" error.
            if (document.readyState === 'complete') {
                registerSW();
            } else {
                window.addEventListener('load', registerSW, { once: true });
            }
        }
    }, []);

    return (
        <AuthProvider>
            <AppProvider>
                <AppRouter />
            </AppProvider>
        </AuthProvider>
    );
};

export default App;
