import React, { useState, lazy, Suspense, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AppProvider, useModals, useScanner, useSyncState, useAlert } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import Header from './components/Header';
import { SpinnerIcon, CloudArrowDownIcon } from './components/Icons';
import LoginPage from './pages/LoginPage';
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
    const { isAlertOpen } = useAlert();
    const [isLocalInputModalOpen, setIsLocalInputModalOpen] = useState<boolean>(
        () => !!((window as any).__isReceiveItemModalOpen || (window as any).__isAuditItemModalOpen || (window as any).__isEventAddModalOpen)
    );

    useEffect(() => {
        if (!(window as any).__kjGhostGuardInit) {
            (window as any).__kjGhostGuardInit = true;
            const swallowIfGuarded = (e: Event) => {
                const now = Date.now();
                const waiting = !!(window as any).__kjWaitingFingerRelease;
                const until = Number((window as any).__kjGhostGuardUntil) || 0;
                if (!waiting && now >= until) return;
                if (e.type === 'touchend' || e.type === 'pointerup' || e.type === 'pointercancel' || e.type === 'touchcancel') {
                    (window as any).__kjWaitingFingerRelease = false;
                    (window as any).__kjGhostGuardUntil = Math.max(until, now + 320);
                }
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();
                if (typeof (e as any).stopImmediatePropagation === 'function') {
                    (e as any).stopImmediatePropagation();
                }
                if (e.type === 'click' && !(window as any).__kjWaitingFingerRelease) {
                    (window as any).__kjGhostGuardUntil = Math.min(Number((window as any).__kjGhostGuardUntil) || 0, now + 80);
                }
            };
            ['touchstart', 'touchend', 'touchcancel', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click'].forEach((type) => {
                window.addEventListener(type, swallowIfGuarded, { capture: true, passive: false });
            });
        }
        const syncModalFlag = () => {
            setIsLocalInputModalOpen(
                !!((window as any).__isReceiveItemModalOpen || (window as any).__isAuditItemModalOpen || (window as any).__isEventAddModalOpen)
            );
        };
        window.addEventListener('kjmart-modal-change', syncModalFlag);
        window.addEventListener('popstate', syncModalFlag);
        return () => {
            window.removeEventListener('kjmart-modal-change', syncModalFlag);
            window.removeEventListener('popstate', syncModalFlag);
        };
    }, []);

    const isAnyInputModalOpen = isAlertOpen || isLocalInputModalOpen || !!addItemModalProps || !!editItemModalProps || !!isClearHistoryModalOpen || !!isDeliveryModalOpen || window.history.state?.modal === 'receiveItem' || window.history.state?.modal === 'auditItem' || window.history.state?.modal === 'continuousEventAdd';
    
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
                      onSaveAndExit={options?.onSaveAndExit}
                      saveAndExitCount={options?.saveAndExitCount}
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
    const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
    const waitingWorkerRef = useRef<ServiceWorker | null>(null);
    const deferUpdateToNextForegroundRef = useRef<boolean>(false);

    const promptUserForUpdate = useCallback((worker: ServiceWorker) => {
        waitingWorkerRef.current = worker;
        if (!deferUpdateToNextForegroundRef.current) {
            setIsUpdateModalOpen(true);
        }
    }, []);

    const applyUpdateNow = useCallback(() => {
        setIsUpdateModalOpen(false);
        deferUpdateToNextForegroundRef.current = false;
        if (waitingWorkerRef.current) {
            waitingWorkerRef.current.postMessage({ type: 'SKIP_WAITING' });
        } else if (registration?.waiting) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
    }, [registration]);

    const handleContinueUsing = useCallback(() => {
        setIsUpdateModalOpen(false);
        deferUpdateToNextForegroundRef.current = true;
    }, []);
    
    useEffect(() => {
        if (!document.querySelector(`script[src="${ZXING_CDN}"]`)) {
            const script = document.createElement('script');
            script.src = ZXING_CDN;
            script.async = true;
            document.head.appendChild(script);
        }

        const isPreview = window.location.hostname.includes('usercontent.goog');
        if ('serviceWorker' in navigator && !IS_DEVELOPER_MODE && !isPreview) {
            const registerSW = () => {
                navigator.serviceWorker.register('/service-worker.js').then(reg => {
                    setRegistration(reg);
                    if (reg.waiting) {
                        promptUserForUpdate(reg.waiting);
                    }
                    reg.addEventListener('updatefound', () => {
                        const newWorker = reg.installing;
                        if (newWorker) {
                            newWorker.addEventListener('statechange', () => {
                                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                    promptUserForUpdate(newWorker);
                                }
                            });
                        }
                    });
                }).catch(err => {
                    console.warn('ServiceWorker registration failed:', err);
                });
            };

            if (document.readyState === 'complete' || document.readyState === 'interactive') {
                registerSW();
            } else {
                window.addEventListener('load', registerSW, { once: true });
            }

            let refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (!refreshing) {
                    refreshing = true;
                    window.location.reload();
                }
            });
        }
    }, [promptUserForUpdate]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                if (deferUpdateToNextForegroundRef.current && (waitingWorkerRef.current || registration?.waiting)) {
                    applyUpdateNow();
                    return;
                }
                if (registration) {
                    registration.update().catch(err => console.warn("SW update check failed", err));
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [registration, applyUpdateNow]);

    return (
        <AuthProvider>
            <AppProvider>
                <AppRouter />
                {isUpdateModalOpen && createPortal(
                    <div
                        className="fixed inset-0 bg-black/50 z-[350] flex items-center justify-center p-4 animate-fade-in-down"
                        role="dialog"
                        aria-modal="true"
                    >
                        <div
                            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-100"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="p-6 text-center space-y-2.5">
                                <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-2">
                                    <CloudArrowDownIcon className="w-7 h-7" />
                                </div>
                                <h3 className="text-lg font-extrabold text-slate-800">새 버전 업데이트 안내</h3>
                                <p className="text-xs text-slate-600 leading-relaxed">
                                    앱의 새로운 업데이트가 감지되었습니다.<br />
                                    작업 중이시라면 <strong>[계속 사용]</strong>을 누르시면 현재 화면을 유지하며, 다음번 앱 전환(포그라운드 복귀) 시 자동으로 업데이트됩니다.
                                </p>
                            </div>
                            <div className="bg-slate-50 p-3 grid grid-cols-2 gap-2.5 border-t border-slate-100">
                                <button
                                    type="button"
                                    onClick={handleContinueUsing}
                                    className="py-3 px-4 rounded-xl font-bold text-sm text-slate-700 bg-gray-200 hover:bg-gray-300 active:scale-95 transition-transform"
                                >
                                    계속 사용
                                </button>
                                <button
                                    type="button"
                                    onClick={applyUpdateNow}
                                    className="py-3 px-4 rounded-xl font-bold text-sm text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm active:scale-95 transition-transform"
                                >
                                    업데이트
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
            </AppProvider>
        </AuthProvider>
    );
};

export default App;
