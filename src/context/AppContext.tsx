import React, { createContext, useState, useCallback, useEffect, ReactNode, useContext, useMemo, useRef } from 'react';
import { Customer, Product, Order, OrderItem, ScannerContext as ScannerContextType, SyncLog } from '../types';
import * as db from '../services/dbService';
import * as cache from '../services/cacheDbService';
import AlertModal from '../components/AlertModal';
import { useAuth } from './AuthContext';
import * as googleDrive from '../services/googleDriveService';
import { getDeviceId } from '../services/deviceService';
import Toast, { ToastState } from '../components/Toast';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { processExcelFileInWorker, DiffResult } from '../services/dataService';
import firebase from 'firebase/compat/app';
import 'firebase/compat/database';

// --- TYPE DEFINITIONS ---

// Create types for the data passed to open functions to avoid circular dependencies
export interface AddItemModalPayload {
    product: Product;
    existingItem: OrderItem | null;
    onAdd: (details: { quantity: number; unit: '개' | '박스'; memo?: string }) => void;
    onNextScan?: () => void;
    trigger: 'scan' | 'search';
    initialSettings?: { unit: '개' | '박스' };
}
export interface EditItemModalPayload {
    item: OrderItem;
    onSave: (details: { quantity: number; unit: '개' | '박스'; memo?: string; }) => void;
}
export interface MemoModalPayload {
    initialMemo: string;
    onSave: (memo: string) => void;
}

interface SyncSettings {
    fileId: string;
    fileName: string;
    lastSyncTime: string | null;
    autoSync: boolean;
}

// Data Context
interface DataState {
    customers: Customer[];
    products: Product[];
    selectedCameraId: string | null;
    scanSettings: {
        vibrateOnScan: boolean;
        soundOnScan: boolean;
    };
}

interface DataActions {
    addOrder: (orderData: Omit<Order, 'id' | 'date' | 'createdAt' | 'updatedAt' | 'itemCount' | 'completedAt' | 'completionDetails' | 'items'> & { items: OrderItem[] }) => Promise<number>;
    updateOrder: (order: Order) => Promise<void>;
    deleteOrder: (orderId: number) => Promise<void>;
    updateOrderStatus: (orderId: number, completionDetails: Order['completionDetails']) => Promise<void>;
    clearOrders: () => Promise<void>;
    clearOrdersBeforeDate: (date: Date) => Promise<number>;
    syncFromFile: (file: File | Blob, dataType: 'customers' | 'products', source: 'local' | 'drive') => Promise<DiffResult<Customer | Product>>;
    forceFullSync: () => Promise<void>;
    setSelectedCameraId: (id: string | null) => Promise<void>;
    setScanSettings: (settings: Partial<DataState['scanSettings']>) => Promise<void>;
}

const DataStateContext = createContext<DataState | undefined>(undefined);
const DataActionsContext = createContext<DataActions | undefined>(undefined);

// --- Sync Context ---
interface SyncState {
    isSyncing: boolean;
    syncProgress: number;
    syncStatusText: string;
    syncDataType: 'customers' | 'products' | 'full' | null;
    initialSyncCompleted: boolean;
}

const SyncStateContext = createContext<SyncState | undefined>(undefined);

// --- UI Contexts (Modals, Alerts, etc.) ---
interface AlertState {
    isOpen: boolean;
    message: string;
    onConfirm?: () => void;
    onCancel?: () => void;
    confirmText?: string;
    confirmButtonClass?: string;
}

interface ModalsState {
    isDetailModalOpen: boolean;
    editingOrder: Order | null;
    isDeliveryModalOpen: boolean;
    orderToExport: Order | null;
    addItemModalProps: AddItemModalPayload | null;
    editItemModalProps: EditItemModalPayload | null;
    memoModalProps: MemoModalPayload | null;
    isHistoryModalOpen: boolean;
    isClearHistoryModalOpen: boolean;
}

interface ModalsActions {
    openDetailModal: (order: Order) => void;
    closeDetailModal: () => void;
    openDeliveryModal: (order: Order) => void;
    closeDeliveryModal: () => void;
    openAddItemModal: (props: AddItemModalPayload) => void;
    closeAddItemModal: () => void;
    openEditItemModal: (props: EditItemModalPayload) => void;
    closeEditItemModal: () => void;
    openMemoModal: (props: MemoModalPayload) => void;
    closeMemoModal: () => void;
    openHistoryModal: () => void;
    closeHistoryModal: () => void;
    openClearHistoryModal: () => void;
    closeClearHistoryModal: () => void;
}

interface MiscUIState {
    lastModifiedOrderId: number | null;
}

interface MiscUIActions {
    setLastModifiedOrderId: (id: number | null) => void;
}

interface ScannerState {
    isScannerOpen: boolean;
    scannerContext: ScannerContextType;
    onScanSuccess: (barcode: string) => void;
    continuousScan: boolean;
}

interface ScannerActions {
    openScanner: (context: ScannerContextType, onScan: (barcode: string) => void, continuous: boolean) => void;
    closeScanner: () => void;
}

interface PWAInstallState {
    isInstallPromptAvailable: boolean;
    triggerInstallPrompt: () => void;
}

const AlertContext = createContext<((message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string, onCancel?: () => void) => void) | undefined>(undefined);
const ToastContext = createContext<((message: string, type: 'success' | 'error') => void) | undefined>(undefined);
const ModalsContext = createContext<(ModalsState & ModalsActions) | undefined>(undefined);
const MiscUIContext = createContext<(MiscUIState & MiscUIActions) | undefined>(undefined);
const ScannerContext = createContext<(ScannerState & ScannerActions) | undefined>(undefined);
const PWAInstallContext = createContext<PWAInstallState | undefined>(undefined);

// --- Initial States ---
const initialModalsState: ModalsState = {
    isDetailModalOpen: false, editingOrder: null,
    isDeliveryModalOpen: false, orderToExport: null,
    addItemModalProps: null, editItemModalProps: null,
    memoModalProps: null, isHistoryModalOpen: false,
    isClearHistoryModalOpen: false,
};

// --- AppProvider Component ---

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();

    // --- Data State ---
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [selectedCameraId, setSelectedCameraIdState] = useLocalStorage<string>('selectedCameraId', null, { deviceSpecific: true });
    const [scanSettings, setScanSettingsState] = useLocalStorage('scanSettings', { vibrateOnScan: true, soundOnScan: true });
    const [lastSyncKeys, setLastSyncKeys] = useLocalStorage('lastSyncKeys', { customers: null, products: null });

    // --- Sync State ---
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncProgress, setSyncProgress] = useState(0);
    const [syncStatusText, setSyncStatusText] = useState('');
    const [syncDataType, setSyncDataType] = useState<'customers' | 'products' | 'full' | null>(null);
    const [initialSyncCompleted, setInitialSyncCompleted] = useState(false);

    // --- UI State ---
    const [alertState, setAlertState] = useState<AlertState>({ isOpen: false, message: '' });
    const [toastState, setToastState] = useState<ToastState>({ isOpen: false, message: '', type: 'success' });
    const [modalsState, setModalsState] = useState<ModalsState>(initialModalsState);
    const [lastModifiedOrderId, setLastModifiedOrderId] = useState<number | null>(null);
    const [scannerState, setScannerState] = useState<ScannerState>({ isScannerOpen: false, scannerContext: null, onScanSuccess: () => {}, continuousScan: false });
    const [isInstallPromptAvailable, setInstallPromptAvailable] = useState(false);
    const deferredInstallPrompt = useRef<any>(null);

    // --- Alert & Toast Actions ---
    const showAlert = useCallback((message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string, onCancel?: () => void) => {
        setAlertState({ isOpen: true, message, onConfirm, confirmText, confirmButtonClass, onCancel });
    }, []);

    const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToastState({ isOpen: true, message, type });
    }, []);

    // --- Data Actions ---
    const addOrder = useCallback(async (orderData: Omit<Order, 'id' | 'date' | 'createdAt' | 'updatedAt' | 'itemCount' | 'completedAt' | 'completionDetails' | 'items'> & { items: OrderItem[] }) => {
        const newOrderId = await db.addOrderWithItems(orderData, orderData.items);
        return newOrderId;
    }, []);

    const updateOrder = useCallback(async (order: Order) => {
        if (!order.items) throw new Error("Order items are missing for update.");
        await db.updateOrderAndItems(order, order.items);
    }, []);

    const deleteOrder = useCallback(async (orderId: number) => {
        await db.deleteOrderAndItems(orderId);
    }, []);

    const updateOrderStatus = useCallback(async (orderId: number, completionDetails: Order['completionDetails']) => {
        await db.updateOrderStatus(orderId, completionDetails);
    }, []);

    const clearOrders = useCallback(async () => {
        await db.clearOrders();
    }, []);

    const clearOrdersBeforeDate = useCallback(async (date: Date) => {
        const isoString = date.toISOString();
        return await db.clearOrdersBeforeDate(isoString);
    }, []);

    const syncFromFile = useCallback(async (file: File | Blob, dataType: 'customers' | 'products', source: 'local' | 'drive') => {
        if (isSyncing) {
            showToast("이미 다른 동기화가 진행 중입니다.", 'error');
            throw new Error("Sync already in progress");
        }

        setIsSyncing(true);
        setSyncDataType(dataType);
        setSyncProgress(0);
        setSyncStatusText("기존 데이터 로딩 중...");

        const existingData = dataType === 'customers' ? customers : products;
        
        try {
            const onProgress = (message: string) => {
                setSyncStatusText(message);
            };

            const workerDataType = dataType.slice(0, -1) as 'customer' | 'product';
            const diffResult = await processExcelFileInWorker(file, workerDataType, existingData, user?.email || 'unknown', onProgress);
            
            const toAddOrUpdate = diffResult.toAddOrUpdate as (Customer[] | Product[]);
            const toDelete = diffResult.toDelete;

            if (toAddOrUpdate.length > 0 || toDelete.length > 0) {
                 setSyncStatusText("데이터베이스 업데이트 중...");
                 const updates: Partial<Record<'customers' | 'products', (Customer|Product)[]>> = {};
                 updates[dataType] = toAddOrUpdate as any;
                 
                 await db.replaceAll(dataType, toAddOrUpdate as any);

                 // This part is simplified; in a real app, you'd handle deletes too.
                 if (dataType === 'customers') setCustomers(toAddOrUpdate as Customer[]);
                 else setProducts(toAddOrUpdate as Product[]);
            }

            return diffResult;
        } catch (error) {
            console.error(`Sync from ${source} failed:`, error);
            showToast(`${dataType === 'customers' ? '거래처' : '상품'} 동기화 실패.`, 'error');
            throw error;
        } finally {
            setIsSyncing(false);
            setSyncDataType(null);
            setSyncStatusText("");
        }
    }, [isSyncing, customers, products, user, showToast]);

    const forceFullSync = useCallback(async () => {
        if (!db.isInitialized()) {
            showAlert("데이터베이스에 연결되지 않아 동기화할 수 없습니다.");
            return;
        }
        setIsSyncing(true);
        setSyncDataType('full');
        try {
            setSyncStatusText("거래처 데이터 동기화 중...");
            const remoteCustomers = await db.getStore<Customer>('customers');
            await cache.setCachedData('customers', remoteCustomers);
            setCustomers(remoteCustomers);

            setSyncStatusText("상품 데이터 동기화 중...");
            const remoteProducts = await db.getStore<Product>('products');
            await cache.setCachedData('products', remoteProducts);
            setProducts(remoteProducts);
            
            showToast("전체 데이터 동기화가 완료되었습니다.", 'success');
        } catch (err) {
            showAlert("전체 데이터 동기화에 실패했습니다.");
        } finally {
            setIsSyncing(false);
            setSyncDataType(null);
            setSyncStatusText("");
        }
    }, [showAlert, showToast]);

    const setSelectedCameraId = useCallback(async (id: string | null) => {
        setSelectedCameraIdState(id);
    }, [setSelectedCameraIdState]);

    const setScanSettings = useCallback(async (settings: Partial<DataState['scanSettings']>) => {
        setScanSettingsState(prev => ({ ...prev, ...settings }));
    }, [setScanSettingsState]);

    // --- Initial Data Load and Sync Effect ---
    useEffect(() => {
        if (!user || !db.isInitialized()) {
            setInitialSyncCompleted(!user);
            return;
        }
    
        const unsubscribers: (() => void)[] = [];
        let syncTimeout: number;
    
        const applyChanges = async (dataType: 'customers' | 'products', changes: SyncLog[]) => {
            if (changes.length === 0) return;
    
            const keyField = dataType === 'customers' ? 'comcode' : 'barcode';
            const setData = dataType === 'customers' ? setCustomers : setProducts;
    
            // Batch cache updates
            for (const change of changes) {
                const key = (change as any)[keyField];
                if (change._deleted) {
                    await cache.removeCachedItem(dataType, key);
                } else {
                    const { _key, timestamp, user, ...itemData } = change;
                    await cache.addOrUpdateCachedItem(dataType, itemData as any);
                }
            }
    
            // Batch state updates
            setData(prevData => {
                const dataMap = new Map(prevData.map(item => [(item as any)[keyField], item]));
                changes.forEach(change => {
                    const key = (change as any)[keyField];
                    if (change._deleted) {
                        dataMap.delete(key);
                    } else {
                        const { _key, timestamp, user, ...itemData } = change;
                        dataMap.set(key, itemData);
                    }
                });
                return Array.from(dataMap.values()) as any;
            });
        };
    
        const runInitialSync = async () => {
            setIsSyncing(true);
            setSyncDataType('full');
            setSyncProgress(0);
            setSyncStatusText("로컬 캐시 로딩 중...");
    
            const [cachedCustomers, cachedProducts] = await Promise.all([
                cache.getCachedData<Customer>('customers'),
                cache.getCachedData<Product>('products'),
            ]);
    
            setCustomers(cachedCustomers);
            setProducts(cachedProducts);
            setSyncProgress(10);
    
            syncTimeout = window.setTimeout(() => {
                if (!initialSyncCompleted) {
                    console.warn("Sync timed out. Using cached data.");
                    showAlert("서버 동기화에 시간이 초과되었습니다. 오프라인 데이터로 시작합니다.");
                    setInitialSyncCompleted(true);
                    setIsSyncing(false);
                }
            }, 20000);
    
            const syncDataType = async (dataType: 'customers' | 'products', lastKey: string | null) => {
                const typeName = dataType === 'customers' ? '거래처' : '상품';
                const hasCache = dataType === 'customers' ? cachedCustomers.length > 0 : cachedProducts.length > 0;
    
                if (!lastKey || !hasCache) { // Full Sync
                    setSyncStatusText(`${typeName} 전체 데이터 동기화 중...`);
                    const remoteData = await db.getStore<Customer | Product>(dataType);
                    if (dataType === 'customers') setCustomers(remoteData as Customer[]); else setProducts(remoteData as Product[]);
                    await cache.setCachedData(dataType, remoteData as any);
                    const newLastKey = await db.getLastSyncLogKey(dataType);
                    setLastSyncKeys(prev => ({ ...prev, [dataType]: newLastKey }));
                    return newLastKey;
                } else { // Incremental Sync
                    setSyncStatusText(`${typeName} 변경사항 확인 중...`);
                    const { items: changes, newLastKey } = await db.getSyncLogChanges(dataType, lastKey);
                    if (changes.length > 0) {
                        setSyncStatusText(`${typeName} ${changes.length}건 업데이트 중...`);
                        await applyChanges(dataType, changes);
                    }
                    if (newLastKey !== lastKey) {
                        setLastSyncKeys(prev => ({ ...prev, [dataType]: newLastKey }));
                    }
                    return newLastKey;
                }
            };
    
            try {
                const finalCustomerKey = await syncDataType('customers', lastSyncKeys.customers);
                setSyncProgress(55);
                unsubscribers.push(
                    db.listenForNewLogs('customers', finalCustomerKey, async (newItem, newKey) => {
                        await applyChanges('customers', [newItem]);
                        setLastSyncKeys(prev => ({ ...prev, customers: newKey }));
                    })
                );
    
                const finalProductKey = await syncDataType('products', lastSyncKeys.products);
                setSyncProgress(100);
                unsubscribers.push(
                    db.listenForNewLogs('products', finalProductKey, async (newItem, newKey) => {
                        await applyChanges('products', [newItem]);
                        setLastSyncKeys(prev => ({ ...prev, products: newKey }));
                    })
                );
    
                clearTimeout(syncTimeout);
                setSyncStatusText("동기화 완료");
                setTimeout(() => {
                    setInitialSyncCompleted(true);
                    setIsSyncing(false);
                }, 300);
    
            } catch (error) {
                console.error("Sync failed:", error);
                showAlert("데이터 동기화에 실패했습니다. 캐시된 데이터로 시작합니다.");
                clearTimeout(syncTimeout);
                setInitialSyncCompleted(true);
                setIsSyncing(false);
            }
        };
    
        runInitialSync();
    
        return () => {
            clearTimeout(syncTimeout);
            unsubscribers.forEach(unsub => unsub());
        };
    }, [user, showAlert, lastSyncKeys, setLastSyncKeys]);

    // --- Modal Actions ---
    const modalsActions = useMemo<ModalsActions>(() => ({
        openDetailModal: (order) => setModalsState(s => ({ ...s, isDetailModalOpen: true, editingOrder: order })),
        closeDetailModal: () => setModalsState(s => ({ ...s, isDetailModalOpen: false, editingOrder: null })),
        openDeliveryModal: (order) => setModalsState(s => ({ ...s, isDeliveryModalOpen: true, orderToExport: order })),
        closeDeliveryModal: () => setModalsState(s => ({ ...s, isDeliveryModalOpen: false, orderToExport: null })),
        openAddItemModal: (props) => setModalsState(s => ({ ...s, addItemModalProps: props })),
        closeAddItemModal: () => setModalsState(s => ({ ...s, addItemModalProps: null })),
        openEditItemModal: (props) => setModalsState(s => ({ ...s, editItemModalProps: props })),
        closeEditItemModal: () => setModalsState(s => ({ ...s, editItemModalProps: null })),
        openMemoModal: (props) => setModalsState(s => ({ ...s, memoModalProps: props })),
        closeMemoModal: () => setModalsState(s => ({ ...s, memoModalProps: null })),
        openHistoryModal: () => setModalsState(s => ({ ...s, isHistoryModalOpen: true })),
        closeHistoryModal: () => setModalsState(s => ({ ...s, isHistoryModalOpen: false })),
        openClearHistoryModal: () => setModalsState(s => ({ ...s, isClearHistoryModalOpen: true })),
        closeClearHistoryModal: () => setModalsState(s => ({ ...s, isClearHistoryModalOpen: false })),
    }), []);
    
    // --- Scanner Actions ---
    const scannerActions = useMemo<ScannerActions>(() => ({
        openScanner: (context, onScan, continuous) => setScannerState({ isScannerOpen: true, scannerContext: context, onScanSuccess: onScan, continuousScan: continuous }),
        closeScanner: () => setScannerState({ isScannerOpen: false, scannerContext: null, onScanSuccess: () => {}, continuousScan: false }),
    }), []);
    
    // --- PWA Install Effect ---
    useEffect(() => {
        const handler = (e: Event) => {
            e.preventDefault();
            deferredInstallPrompt.current = e;
            setInstallPromptAvailable(true);
        };
        window.addEventListener('beforeinstallprompt', handler);
        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    const triggerInstallPrompt = useCallback(() => {
        if (deferredInstallPrompt.current) {
            deferredInstallPrompt.current.prompt();
            deferredInstallPrompt.current.userChoice.then((choiceResult: { outcome: 'accepted' | 'dismissed' }) => {
                if (choiceResult.outcome === 'accepted') {
                    showToast('앱이 설치되었습니다!', 'success');
                }
                setInstallPromptAvailable(false);
                deferredInstallPrompt.current = null;
            });
        }
    }, [showToast]);

    // --- Context Values ---
    const dataStateValue = useMemo(() => ({ customers, products, selectedCameraId, scanSettings: scanSettings! }), [customers, products, selectedCameraId, scanSettings]);
    const dataActionsValue = useMemo(() => ({ addOrder, updateOrder, deleteOrder, updateOrderStatus, clearOrders, clearOrdersBeforeDate, syncFromFile, forceFullSync, setSelectedCameraId, setScanSettings }), [addOrder, updateOrder, deleteOrder, updateOrderStatus, clearOrders, clearOrdersBeforeDate, syncFromFile, forceFullSync, setSelectedCameraId, setScanSettings]);
    const syncStateValue = useMemo(() => ({ isSyncing, syncProgress, syncStatusText, syncDataType, initialSyncCompleted }), [isSyncing, syncProgress, syncStatusText, syncDataType, initialSyncCompleted]);
    const modalsValue = useMemo(() => ({ ...modalsState, ...modalsActions }), [modalsState, modalsActions]);
    const scannerValue = useMemo(() => ({ ...scannerState, ...scannerActions }), [scannerState, scannerActions]);
    const miscUIValue = useMemo(() => ({ lastModifiedOrderId, setLastModifiedOrderId }), [lastModifiedOrderId]);
    const pwaInstallValue = useMemo(() => ({ isInstallPromptAvailable, triggerInstallPrompt }), [isInstallPromptAvailable, triggerInstallPrompt]);

    return (
        <DataStateContext.Provider value={dataStateValue}>
            <DataActionsContext.Provider value={dataActionsValue}>
                <SyncStateContext.Provider value={syncStateValue}>
                    <ModalsContext.Provider value={modalsValue}>
                        <ScannerContext.Provider value={scannerValue}>
                            <MiscUIContext.Provider value={miscUIValue}>
                                <AlertContext.Provider value={showAlert}>
                                    <ToastContext.Provider value={showToast}>
                                        <PWAInstallContext.Provider value={pwaInstallValue}>
                                            {children}
                                            <AlertModal {...alertState} onClose={() => setAlertState(s => ({ ...s, isOpen: false }))} />
                                            <Toast {...toastState} onClose={() => setToastState(s => ({ ...s, isOpen: false }))} />
                                        </PWAInstallContext.Provider>
                                    </ToastContext.Provider>
                                </AlertContext.Provider>
                            </MiscUIContext.Provider>
                        </ScannerContext.Provider>
                    </ModalsContext.Provider>
                </SyncStateContext.Provider>
            </DataActionsContext.Provider>
        </DataStateContext.Provider>
    );
};

// --- Custom Hooks ---

// Hook for accessing data
export const useDataState = (): DataState => {
    const context = useContext(DataStateContext);
    if (context === undefined) throw new Error('useDataState must be used within an AppProvider');
    return context;
};

// Hook for accessing data modification actions
export const useDataActions = (): DataActions => {
    const context = useContext(DataActionsContext);
    if (context === undefined) throw new Error('useDataActions must be used within an AppProvider');
    return context;
};

// Hook for sync status
export const useSyncState = (): SyncState => {
    const context = useContext(SyncStateContext);
    if (context === undefined) throw new Error('useSyncState must be used within an AppProvider');
    return context;
};

// Hook for modals
export const useModals = (): ModalsState & ModalsActions => {
    const context = useContext(ModalsContext);
    if (context === undefined) throw new Error('useModals must be used within an AppProvider');
    return context;
};

// Hook for alerts and toasts
export const useAlert = () => {
    const showAlert = useContext(AlertContext);
    const showToast = useContext(ToastContext);
    if (showAlert === undefined || showToast === undefined) throw new Error('useAlert must be used within an AppProvider');
    return { showAlert, showToast };
};

// Hook for misc UI state
export const useMiscUI = (): MiscUIState & MiscUIActions => {
    const context = useContext(MiscUIContext);
    if (context === undefined) throw new Error('useMiscUI must be used within an AppProvider');
    return context;
};

// Hook for scanner
export const useScanner = (): ScannerState & ScannerActions => {
    const context = useContext(ScannerContext);
    if (context === undefined) throw new Error('useScanner must be used within an AppProvider');
    return context;
};

// Hook for PWA installation
export const usePWAInstall = (): PWAInstallState => {
    const context = useContext(PWAInstallContext);
    if (context === undefined) throw new Error('usePWAInstall must be used within an AppProvider');
    return context;
};