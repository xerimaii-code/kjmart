import React, { useState, lazy, Suspense, useRef, useMemo, useEffect } from 'react';
import { AppProvider, useModals, useScanner, useSyncState, useDataState, useDataActions } from './context/AppContext';
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
const MemoModal = lazy(() => import('./components/MemoModal'));

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
        className={`flex-1 py-2 text-sm font-bold transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 rounded-lg ${
            isActive 
                ? 'text-blue-600' 
                : 'text-gray-500 hover:text-gray-900'
        }`}
        aria-current={isActive ? 'page' : undefined}
    >
        <div className="relative"> {/* Wrapper for positioning the underline */}
            <span>{label}</span>
            {isActive && (
                <div 
                    className="absolute -bottom-2 left-0 right-0 h-1 bg-blue-600 rounded-full"
                />
            )}
        </div>
    </button>
);

const TopTabBar: React.FC<TopTabBarProps> = ({ activePage, setActivePage }) => {
    return (
        <nav className="w-full bg-white/60 backdrop-blur-lg flex justify-around items-center flex-shrink-0 p-2 border-b border-gray-200/80">
            <div className="flex w-full justify-around items-center h-full gap-1">
                <TabButton
                    page="history"
                    label="발주내역"
                    isActive={activePage === 'history'}
                    onClick={setActivePage}
                />
                <TabButton
                    page="new-order"
                    label="신규발주"
                    isActive={activePage === 'new-order'}
                    onClick={setActivePage}
                />
                 <TabButton
                    page="product-inquiry"
                    label="상품조회"
                    isActive={activePage === 'product-inquiry'}
                    onClick={setActivePage}
                />
                <TabButton
                    page="settings"
                    label="설정"
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
        addItemModalProps,
        closeAddItemModal,
        editItemModalProps,
        closeEditItemModal,
        memoModalProps,
        closeMemoModal,
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
              {memoModalProps && (
                  <MemoModal
                      isOpen={true}
                      initialMemo={memoModalProps.initialMemo}
                      onClose={closeMemoModal}
                      onSave={memoModalProps.onSave}
                  />
              )}
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
    useEffect(() => {
        // Preload scanner library for faster modal opening.
        // The script is loaded once and cached by the browser and our loadScript utility.
        loadScript(ZXING_CDN).catch(err => console.warn("Failed to preload scanner library:", err));
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
