
import React, { useState, lazy, Suspense, useMemo, useEffect } from 'react';
import { AppProvider, useModals, useScanner, useSyncState, useDataActions, useAlert, useMiscUI } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import Header from './components/Header';
import { SpinnerIcon } from './components/Icons';
import LoginPage from './pages/LoginPage';
import { exportToXLS } from './services/dataService';
import AddItemModal from './components/AddItemModal';
import EditItemModal from './components/EditItemModal';
import { IS_DEVELOPER_MODE } from './config';

// Lazy load pages and heavy modals
const MainView = lazy(() => import('./pages/MainView')); 
const OrderDetailModal = lazy(() => import('./components/OrderDetailModal') as Promise<{ default: React.ComponentType<any> }>);
const ScannerModal = lazy(() => import('./components/ScannerModal'));
const ClearHistoryModal = lazy(() => import('./components/ClearHistoryModal'));

const ZXING_CDN = "https://unpkg.com/@zxing/library@latest/umd/index.min.js";

const PageSuspenseFallback: React.FC = () => (
    <div className="w-full h-full flex items-center justify-center bg-transparent">
        <SpinnerIcon className="w-10 h-10 text-blue-500" />
    </div>
);

const InitialSyncLoader: React.FC = () => {
    const { syncStatusText, syncProgress } = useSyncState();
    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (syncProgress / 100) * circumference;

    return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-transparent p-4">
            <div className="relative w-32 h-32 flex items-center justify-center mb-6">
                <svg className="absolute w-full h-full" viewBox="0 0 120 120">
                    <circle className="text-gray-200" strokeWidth="8" stroke="currentColor" fill="transparent" r={radius} cx="60" cy="60" />
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
            <p className="text-lg font-semibold text-gray-700 animate-fade-in-up" key={syncStatusText}>{syncStatusText}...</p>
        </div>
    );
};

const AppContent: React.FC = () => {
    const { 
        addItemModalProps,
        closeAddItemModal,
        editItemModalProps,
        closeEditItemModal,
        isClearHistoryModalOpen,
        closeClearHistoryModal,
        isDeliveryModalOpen,
        editingOrder
     } = useModals();
    const { isScannerOpen, onScanSuccess, closeScanner, options } = useScanner();

    const isAnyInputModalOpen = !!addItemModalProps || !!editItemModalProps || !!isClearHistoryModalOpen || !!isDeliveryModalOpen || window.history.state?.modal === 'receiveItem' || window.history.state?.modal === 'auditItem' || window.history.state?.modal === 'continuousEventAdd';
    
    return (
        <div className="h-full w-full flex flex-col bg-transparent">
            <Header />
            <main className="main-content flex-grow relative overflow-y-auto">
                 <Suspense fallback={<PageSuspenseFallback />}>
                    <MainView isActive={true} />
                </Suspense>
            </main>

            <Suspense fallback={null}>
              <OrderDetailModal key={editingOrder ? `order-${editingOrder.id}` : 'no-order'} />
              {isScannerOpen && (
                  <ScannerModal 
                      isOpen={isScannerOpen} 
                      onClose={closeScanner} 
                      onScanSuccess={onScanSuccess} 
                      continuous={options?.continuous}
                      isPaused={isAnyInputModalOpen}
                  />
              )}
              {isClearHistoryModalOpen && <ClearHistoryModal isOpen={isClearHistoryModalOpen} onClose={closeClearHistoryModal} />}
            </Suspense>
            
            {addItemModalProps && (
                <AddItemModal
                    key={`add-${addItemModalProps.product.barcode}`}
                    isOpen={true}
                    product={addItemModalProps.product}
                    existingItem={addItemModalProps.existingItem}
                    onClose={() => {
                        addItemModalProps.onClose?.();
                        closeAddItemModal();
                    }}
                    onAdd={addItemModalProps.onAdd}
                    onNextScan={addItemModalProps.onNextScan}
                    trigger={addItemModalProps.trigger}
                    initialSettings={addItemModalProps.initialSettings}
                    timestamp={addItemModalProps.timestamp}
                />
            )}
            {editItemModalProps && (
                <EditItemModal
                    key="edit-item-modal"
                    isOpen={true}
                    item={editItemModalProps.item}
                    product={editItemModalProps.product}
                    onClose={closeEditItemModal}
                    onSave={editItemModalProps.onSave}
                />
            )}
        </div>
    );
};

const AccessDeniedPage: React.FC = () => {
    const { logout } = useAuth();
    return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-gray-100 p-4 text-center">
            <h2 className="text-2xl font-bold text-red-600 mb-4">접근 거부됨</h2>
            <p className="text-gray-700 mb-6">이 계정은 앱을 사용할 권한이 없습니다.</p>
            <button onClick={logout} className="bg-gray-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-gray-700 transition">로그아웃</button>
        </div>
    );
};

const AppRouter: React.FC = () => {
    const { user, loading, isAdmin } = useAuth();
    const { initialSyncCompleted } = useSyncState();
    if (loading) return <PageSuspenseFallback />;
    if (!user) return <LoginPage />;
    if (!isAdmin) return <AccessDeniedPage />;
    if (!initialSyncCompleted) return <InitialSyncLoader />;
    return <AppContent />;
};

const App: React.FC = () => {
    const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
    
    useEffect(() => {
        // ZXing 라이브러리 미리 로드 (아이폰/구형기기 폴백용)
        if (!document.querySelector(`script[src="${ZXING_CDN}"]`)) {
            const script = document.createElement('script');
            script.src = ZXING_CDN;
            script.async = true;
            document.head.appendChild(script);
        }

        const isPreview = window.location.hostname.includes('usercontent.goog');
        if ('serviceWorker' in navigator && !IS_DEVELOPER_MODE && !isPreview) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/service-worker.js').then(reg => {
                        setRegistration(reg);
                        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                        reg.addEventListener('updatefound', () => {
                            const newWorker = reg.installing;
                            if (newWorker) {
                                newWorker.addEventListener('statechange', () => {
                                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                        newWorker.postMessage({ type: 'SKIP_WAITING' });
                                    }
                                });
                            }
                        });
                    });
            });
            let refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (!refreshing) { refreshing = true; window.location.reload(); }
            });
        }
    }, []);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && registration) {
                registration.update().catch(err => console.warn("SW update check failed", err));
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [registration]);

    return (
        <AuthProvider>
            <AppProvider>
                <AppRouter />
            </AppProvider>
        </AuthProvider>
    );
};

export default App;
