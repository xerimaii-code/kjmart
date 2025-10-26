import React, { createContext, useState, useCallback, useEffect, ReactNode, useContext, useMemo, useRef } from 'react';
import { Customer, Product, Order, OrderItem, ScannerContext } from '../types';
import * as db from '../services/dbService';
import * as cache from '../services/cacheDbService';
import AlertModal from '../components/AlertModal';
import { useAuth } from './AuthContext';
import * as googleDrive from '../services/googleDriveService';
import { getDeviceId } from '../services/deviceService';
import Toast from '../components/Toast';
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
    scanSettings: { vibrateOnScan: boolean; soundOnScan: boolean; };
}
interface DataActions {
    smartSyncCustomers: (customers: Customer[], userEmail: string, onProgress?: (message: string) => void, options?: { bypassMassDeleteCheck?: boolean }) => Promise<void>;
    smartSyncProducts: (products: Product[], userEmail: string, onProgress?: (message: string) => void, options?: { bypassMassDeleteCheck?: boolean }) => Promise<void>;
    addOrder: (orderData: { customer: Customer; items: OrderItem[]; total: number; memo?: string; }) => Promise<number>;
    updateOrder: (updatedOrder: Order) => Promise<void>;
    updateOrderStatus: (orderId: number, completionDetails: Order['completionDetails']) => Promise<void>;
    deleteOrder: (orderId: number) => Promise<void>;
    setSelectedCameraId: (id: string | null) => Promise<void>;
    setScanSettings: (settings: Partial<{ vibrateOnScan: boolean; soundOnScan: boolean; }>) => Promise<void>;
    clearOrders: () => Promise<void>;
    forceFullSync: () => Promise<void>;
    syncFromFile: (file: Blob, dataType: 'customers' | 'products', source: 'local' | 'drive') => Promise<DiffResult<Customer | Product>>;
}

// Alert Context
interface AlertState { isOpen: boolean; message: string; onConfirm?: () => void; onCancel?: () => void; confirmText?: string; confirmButtonClass?: string; }
interface ToastState { isOpen: boolean; message: string; type: 'success' | 'error'; }
interface AlertContextValue {
    alert: AlertState;
    toast: ToastState;
    showAlert: (message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string, onCancel?: () => void) => void;
    hideAlert: () => void;
    showToast: (message: string, type: 'success' | 'error') => void;
    hideToast: () => void;
}

// Modal Context
interface ModalContextValue {
    isDetailModalOpen: boolean;
    editingOrder: Order | null;
    openDetailModal: (order: Order) => void;
    closeDetailModal: () => void;
    isDeliveryModalOpen: boolean;
    orderToExport: Order | null;
    openDeliveryModal: (order: Order) => void;
    closeDeliveryModal: () => void;

    // New modal properties
    addItemModalProps: AddItemModalPayload | null;
    editItemModalProps: EditItemModalPayload | null;
    memoModalProps: MemoModalPayload | null;
    openAddItemModal: (data: AddItemModalPayload) => void;
    closeAddItemModal: () => void;
    openEditItemModal: (data: EditItemModalPayload) => void;
    closeEditItemModal: () => void;
    openMemoModal: (data: MemoModalPayload) => void;
    closeMemoModal: () => void;
    isHistoryModalOpen: boolean;
    openHistoryModal: () => void;
    closeHistoryModal: () => void;
}

// Scanner Context
interface ScannerContextValue {
    isScannerOpen: boolean;
    scannerContext: ScannerContext;
    isContinuousScan: boolean;
    onScanSuccess: (barcode: string) => void;
    openScanner: (context: ScannerContext, onScan: (barcode: string) => void, continuous?: boolean) => void;
    closeScanner: () => void;
}

// Sync Context
interface SyncContextValue {
    isSyncing: boolean;
    syncProgress: number;
    initialSyncCompleted: boolean;
    syncStatusText: string;
    syncDataType: 'customers' | 'products' | null;
}

// PWA Install Context
interface PWAInstallContextValue {
    isInstallPromptAvailable: boolean;
    triggerInstallPrompt: () => void;
}

// Misc UI Context
interface MiscUIContextValue {
    lastModifiedOrderId: number | null;
    setLastModifiedOrderId: (id: number | null) => void;
}

// --- CONTEXT CREATION ---
const DataStateContext = createContext<DataState>({} as DataState);
const DataActionsContext = createContext<DataActions>({} as DataActions);
const AlertContext = createContext<AlertContextValue>({} as AlertContextValue);
const ModalContext = createContext<ModalContextValue>({} as ModalContextValue);
const ScannerContext = createContext<ScannerContextValue>({} as ScannerContextValue);
const SyncContext = createContext<SyncContextValue>({} as SyncContextValue);
const PWAInstallContext = createContext<PWAInstallContextValue>({} as PWAInstallContextValue);
const MiscUIContext = createContext<MiscUIContextValue>({} as MiscUIContextValue);


// --- HOOKS for easier context consumption ---
export const useDataState = () => useContext(DataStateContext);
export const useDataActions = () => useContext(DataActionsContext);
export const useAlert = () => useContext(AlertContext);
export const useModals = () => useContext(ModalContext);
export const useScanner = () => useContext(ScannerContext);
export const useSyncState = () => useContext(SyncContext);
export const usePWAInstall = () => useContext(PWAInstallContext);
export const useMiscUI = () => useContext(MiscUIContext);


// --- MAIN PROVIDER ---
export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user, loading: authLoading } = useAuth();

    // States
    const [alert, setAlert] = useState<AlertState>({ isOpen: false, message: '' });
    const [toast, setToast] = useState<ToastState>({ isOpen: false, message: '', type: 'success' });
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncProgress, setSyncProgress] = useState(0);
    const [syncStatusText, setSyncStatusText] = useState('초기화 중...');
    const [syncDataType, setSyncDataType] = useState<'customers' | 'products' | null>(null);
    const [initialSyncCompleted, setInitialSyncCompleted] = useState(false);
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [editingOrder, setEditingOrder] = useState<Order | null>(null);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [scannerContext, setScannerContext] = useState<ScannerContext>(null);
    const [isContinuousScan, setIsContinuousScan] = useState(false);
    const onScanCallbackRef = useRef<(barcode: string) => void>(() => {});
    const [lastModifiedOrderId, setLastModifiedOrderId] = useState<number | null>(null);
    const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);
    const [orderToExport, setOrderToExport] = useState<Order | null>(null);
    const [addItemModalProps, setAddItemModalProps] = useState<AddItemModalPayload | null>(null);
    const [editItemModalProps, setEditItemModalProps] = useState<EditItemModalPayload | null>(null);
    const [memoModalProps, setMemoModalProps] = useState<MemoModalPayload | null>(null);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [lastSyncKeys, setLastSyncKeys] = useLocalStorage<{ customers: string | null, products: string | null }>('last-sync-log-keys', { customers: null, products: null });
    const [initialSyncSucceeded, setInitialSyncSucceeded] = useLocalStorage<boolean>('initial-sync-succeeded', false);
    const [isAppVisible, setIsAppVisible] = useState(!document.hidden);
    
    // States for PWA installation
    const [installPromptEvent, setInstallPromptEvent] = useState<Event | null>(null);
    const [showIosInstall, setShowIosInstall] = useState(false);

    const isSyncingRef = useRef(isSyncing);
    useEffect(() => {
        isSyncingRef.current = isSyncing;
    }, [isSyncing]);

    // Alert Actions
    const showAlert = useCallback((message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string, onCancel?: () => void) => {
        setAlert({ isOpen: true, message, onConfirm, confirmText, confirmButtonClass, onCancel });
    }, []);
    const hideAlert = useCallback(() => setAlert(prev => ({ ...prev, isOpen: false })), []);
    const showToast = useCallback((message: string, type: 'success' | 'error') => setToast({ isOpen: true, message, type }), []);
    const hideToast = useCallback(() => setToast(prev => ({...prev, isOpen: false})), []);

    // PWA Install logic
    useEffect(() => {
        // Platform detection logic moved inside useEffect to ensure it runs client-side
        const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;

        if (isIos && !isStandalone) {
            setShowIosInstall(true);
        } else if (!isIos) {
            const handleBeforeInstallPrompt = (e: Event) => {
                e.preventDefault();
                setInstallPromptEvent(e);
            };
            window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            return () => {
                window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            };
        }
    }, []); // Empty dependency array ensures this runs once on mount.

    const onScanSuccess = useCallback((barcode: string) => {
        onScanCallbackRef.current?.(barcode);
    }, []);

    // Background/Foreground detection for efficient data syncing
    useEffect(() => {
        const handleVisibilityChange = () => {
            setIsAppVisible(!document.hidden);
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);
    
    // --- Context Value Objects ---
    const alertContextValue = useMemo(() => ({ alert, toast, showAlert, hideAlert, showToast, hideToast }), [alert, toast, showAlert, hideAlert, showToast, hideToast]);
    
    const modalContextValue = useMemo(() => ({
        isDetailModalOpen, editingOrder,
        openDetailModal: (order: Order) => { setEditingOrder(order); setIsDetailModalOpen(true); },
        closeDetailModal: () => { setIsDetailModalOpen(false); setEditingOrder(null); },
        isDeliveryModalOpen, orderToExport,
        openDeliveryModal: (order: Order) => { setOrderToExport(order); setIsDeliveryModalOpen(true); },
        closeDeliveryModal: () => { setIsDeliveryModalOpen(false); setOrderToExport(null); },

        addItemModalProps,
        editItemModalProps,
        memoModalProps,
        openAddItemModal: (data) => setAddItemModalProps(data),
        closeAddItemModal: () => setAddItemModalProps(null),
        openEditItemModal: (data) => setEditItemModalProps(data),
        closeEditItemModal: () => setEditItemModalProps(null),
        openMemoModal: (data) => setMemoModalProps(data),
        closeMemoModal: () => setMemoModalProps(null),
        isHistoryModalOpen,
        openHistoryModal: () => setIsHistoryModalOpen(true),
        closeHistoryModal: () => setIsHistoryModalOpen(false),
    }), [isDetailModalOpen, editingOrder, isDeliveryModalOpen, orderToExport, addItemModalProps, editItemModalProps, memoModalProps, isHistoryModalOpen]);
    
    const scannerContextValue = useMemo(() => ({
        isScannerOpen, scannerContext, isContinuousScan, onScanSuccess,
        openScanner: (context, onScan, continuous = false) => {
            setScannerContext(context);
            onScanCallbackRef.current = onScan;
            setIsContinuousScan(continuous);
            setIsScannerOpen(true);
        },
        closeScanner: () => { setIsScannerOpen(false); setIsContinuousScan(false); setScannerContext(null); },
    }), [isScannerOpen, scannerContext, isContinuousScan, onScanSuccess]);
    
    const syncContextValue = useMemo(() => ({ isSyncing, syncProgress, initialSyncCompleted, syncStatusText, syncDataType }), [isSyncing, syncProgress, initialSyncCompleted, syncStatusText, syncDataType]);
    
    const pwaInstallContextValue = useMemo(() => ({
        isInstallPromptAvailable: !!installPromptEvent || showIosInstall,
        triggerInstallPrompt: () => {
            if (installPromptEvent) {
                (installPromptEvent as any).prompt();
                setInstallPromptEvent(null);
            } else if (showIosInstall) {
                showAlert(
                    "앱을 홈 화면에 추가하려면, 브라우저의 공유 버튼을 누른 뒤 '홈 화면에 추가'를 선택하세요.",
                    undefined, // No confirm action, just close
                    "확인"
                );
            } else {
                 showAlert('앱을 설치할 수 없습니다. 브라우저가 이 기능을 지원하는지 확인해주세요.');
            }
        },
    }), [installPromptEvent, showIosInstall, showAlert]);

    const miscUIContextValue = useMemo(() => ({ lastModifiedOrderId, setLastModifiedOrderId }), [lastModifiedOrderId]);
    
    // --- DATA STATE & ACTIONS ---
    const [dataState, setDataState] = useState<DataState>({ customers: [], products: [], selectedCameraId: null, scanSettings: { vibrateOnScan: true, soundOnScan: true } });

    useEffect(() => {
        // This effect handles device-specific settings from Firebase
        if (!user || !db.isInitialized() || !db.db) return;
        
        const deviceId = getDeviceId();
        const settingsRef = db.db.ref(`device-settings/${deviceId}`);
        
        const listener = settingsRef.on('value', (snapshot) => {
            const settings = snapshot.val();
            setDataState(prevState => ({
                ...prevState,
                selectedCameraId: settings?.selectedCameraId ?? null,
                scanSettings: {
                    vibrateOnScan: settings?.scanSettings?.vibrateOnScan ?? true,
                    soundOnScan: settings?.scanSettings?.soundOnScan ?? true,
                }
            }));
        });
        
        return () => settingsRef.off('value', listener);
    }, [user]);

    const dataActions: DataActions = useMemo(() => ({
        smartSyncCustomers: (customers, userEmail, onProgress, options) => db.smartSyncData('customers', customers, userEmail, onProgress, options),
        smartSyncProducts: (products, userEmail, onProgress, options) => db.smartSyncData('products', products, userEmail, onProgress, options),
        addOrder: ({ customer, items, total, memo }) => db.addOrderWithItems({ customer, total, memo }, items),
        updateOrder: async (updatedOrder) => {
            const { items, ...orderData } = updatedOrder;
            await db.updateOrderAndItems(orderData, items || []);
        },
        updateOrderStatus: (orderId, completionDetails) => db.updateOrderStatus(orderId, completionDetails),
        deleteOrder: (orderId) => db.deleteOrderAndItems(orderId),
        setSelectedCameraId: async (id) => {
            if (!user || !db.isInitialized() || !db.db) return;
            const deviceId = getDeviceId();
            await db.db.ref(`device-settings/${deviceId}/selectedCameraId`).set(id);
        },
        setScanSettings: async (settings) => {
            if (!user || !db.isInitialized() || !db.db) return;
            const deviceId = getDeviceId();
            const updates: { [key: string]: any } = {};
            if (settings.vibrateOnScan !== undefined) updates[`device-settings/${deviceId}/scanSettings/vibrateOnScan`] = settings.vibrateOnScan;
            if (settings.soundOnScan !== undefined) updates[`device-settings/${deviceId}/scanSettings/soundOnScan`] = settings.soundOnScan;
            if (Object.keys(updates).length > 0) await db.db.ref().update(updates);
        },
        clearOrders: () => db.clearOrders(),
        forceFullSync: async () => {
            setIsSyncing(true);
            setSyncDataType(null);
            try {
                const customers = await db.getStore<Customer>('customers');
                const products = await db.getStore<Product>('products');
                await Promise.all([
                    cache.setCachedData('customers', customers),
                    cache.setCachedData('products', products)
                ]);
                setDataState(prev => ({...prev, customers, products }));
                const lastCustomerKey = await db.getLastSyncLogKey('customers');
                const lastProductKey = await db.getLastSyncLogKey('products');
                setLastSyncKeys({ customers: lastCustomerKey, products: lastProductKey });
                showToast("데이터 강제 동기화가 완료되었습니다.", "success");
            } catch (error) {
                console.error("Force full sync failed:", error);
                showAlert("데이터 강제 동기화에 실패했습니다.");
            } finally {
                setIsSyncing(false);
            }
        },
        syncFromFile: async (file, dataType, source) => {
            if (!user?.email) {
                showAlert("동기화를 진행하려면 로그인이 필요합니다.");
                throw new Error("User not logged in");
            }

            setIsSyncing(true);
            setSyncDataType(dataType);
            setSyncStatusText('준비 중...');
            setSyncProgress(0);

            const proceedWithUpdate = async (diffResult: DiffResult<Customer | Product>): Promise<DiffResult<Customer | Product>> => {
                if (!user?.email || !db.db) throw new Error("DB or user not available");
        
                const keyField = dataType === 'customers' ? 'comcode' : 'barcode';
                const storeName = dataType;
                const logUser = user.email.split('@')[0];
                const nowISO = new Date().toISOString();
            
                const CHUNK_SIZE = 250;
                const totalItems = diffResult.toAddOrUpdate.length + diffResult.toDelete.length;
                let processedCount = 0;
            
                const processAndWriteChunk = async (items: any[], isDeletion: boolean) => {
                    const chunkUpdates: { [key: string]: any } = {};
                    for (const item of items) {
                        const key = isDeletion ? item[keyField] : (item as any)[keyField];
                        const logRefKey = db.db.ref(`/sync-logs/${storeName}`).push().key;
            
                        if (key && logRefKey) {
                            if (isDeletion) {
                                chunkUpdates[`/${storeName}/${key}`] = null;
                                chunkUpdates[`/sync-logs/${storeName}/${logRefKey}`] = {
                                    [keyField]: key, name: item.name, _deleted: true,
                                    timestamp: firebase.database.ServerValue.TIMESTAMP, user: logUser
                                };
                            } else {
                                const itemWithMeta = { ...item, lastModified: nowISO };
                                chunkUpdates[`/${storeName}/${key}`] = itemWithMeta;
                                chunkUpdates[`/sync-logs/${storeName}/${logRefKey}`] = {
                                    ...itemWithMeta, timestamp: firebase.database.ServerValue.TIMESTAMP, user: logUser
                                };
                            }
                        }
                    }
                    if (Object.keys(chunkUpdates).length > 0) {
                        await db.db.ref().update(chunkUpdates);
                    }
                };
            
                setSyncStatusText('DB 업데이트 준비 중...');
                setSyncProgress(0);

                for (let i = 0; i < diffResult.toAddOrUpdate.length; i += CHUNK_SIZE) {
                    const chunk = diffResult.toAddOrUpdate.slice(i, i + CHUNK_SIZE);
                    await processAndWriteChunk(chunk, false);
                    processedCount += chunk.length;
                    setSyncStatusText(`추가/수정 중... (${processedCount}/${totalItems})`);
                    setSyncProgress(Math.round((processedCount / totalItems) * 100));
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            
                for (let i = 0; i < diffResult.toDelete.length; i += CHUNK_SIZE) {
                    const chunk = diffResult.toDelete.slice(i, i + CHUNK_SIZE);
                    await processAndWriteChunk(chunk, true);
                    processedCount += chunk.length;
                    setSyncStatusText(`삭제 중... (${processedCount}/${totalItems})`);
                    setSyncProgress(Math.round((processedCount / totalItems) * 100));
                    await new Promise(resolve => setTimeout(resolve, 10));
                }

                setSyncStatusText('로컬 데이터 업데이트 중...');
                await new Promise(resolve => setTimeout(resolve, 10));
                
                // FIX: This block is refactored for type safety to address the error.
                if (dataType === 'customers') {
                    const existingData = dataState.customers;
                    const dataMap = new Map(existingData.map(item => [item.comcode, item]));
                    (diffResult.toAddOrUpdate as Customer[]).forEach(item => {
                        const itemWithMeta = { ...item, lastModified: nowISO };
                        dataMap.set(item.comcode, itemWithMeta);
                    });
                    diffResult.toDelete.forEach(item => {
                        dataMap.delete((item as any).comcode);
                    });
                    const updatedData = Array.from(dataMap.values());
                    setDataState(prev => ({ ...prev, customers: updatedData }));
                    await cache.setCachedData('customers', updatedData);
                } else {
                    const existingData = dataState.products;
                    const dataMap = new Map(existingData.map(item => [item.barcode, item]));
                    (diffResult.toAddOrUpdate as Product[]).forEach(item => {
                        const itemWithMeta = { ...item, lastModified: nowISO };
                        dataMap.set(item.barcode, itemWithMeta);
                    });
                    diffResult.toDelete.forEach(item => {
                        dataMap.delete((item as any).barcode);
                    });
                    const updatedData = Array.from(dataMap.values());
                    setDataState(prev => ({ ...prev, products: updatedData }));
                    await cache.setCachedData('products', updatedData);
                }

                const latestLogKey = await db.getLastSyncLogKey(dataType);
                if (latestLogKey) {
                    setLastSyncKeys(prevKeys => ({ ...(prevKeys || { customers: null, products: null }), [dataType]: latestLogKey }));
                }

                return diffResult;
            };

            try {
                const diffResult = await (async () => {
                    if (dataType === 'customers') {
                        return processExcelFileInWorker(
                            file, 'customer', dataState.customers, user.email,
                            (message: string) => setSyncStatusText(message)
                        );
                    } else {
                        return processExcelFileInWorker(
                            file, 'product', dataState.products, user.email,
                            (message: string) => setSyncStatusText(message)
                        );
                    }
                })();
    
                return await proceedWithUpdate(diffResult);
    
            } catch (error) {
                if (error instanceof Error && error.message === 'MASS_DELETION_DETECTED') {
                    const newError = new Error(error.message);
                    (newError as any).details = (error as any).details;
                    (newError as any).details.proceed = () => proceedWithUpdate((error as any).details.diffResult);
                    throw newError;
                } else {
                    console.error("File processing error:", error);
                    showAlert(`파일 처리 중 오류가 발생했습니다: ${(error as Error).message}`);
                    throw error;
                }
            } finally {
                setIsSyncing(false);
                setSyncDataType(null);
                setSyncStatusText('');
                setSyncProgress(0);
            }
        },
    }), [user, dataState, showAlert, showToast, setLastSyncKeys]);

    useEffect(() => {
        if (authLoading) {
            return; // Wait for authentication to resolve before doing anything.
        }

        if (!user) {
            // This now only runs AFTER auth is resolved and we know for sure there is no user.
            setDataState({ customers: [], products: [], selectedCameraId: null, scanSettings: { vibrateOnScan: true, soundOnScan: true } });
            if (lastSyncKeys?.customers || lastSyncKeys?.products) {
                 setLastSyncKeys({ customers: null, products: null });
            }
            setInitialSyncCompleted(false); 
            return;
        }
    
        let isMounted = true;
    
        const performSync = async () => {
            if (!isMounted) return;
            setIsSyncing(true);
            setSyncDataType(null);
            setSyncProgress(0);
            setSyncStatusText('동기화 시작...');
    
            try {
                if (isMounted) {
                    setSyncProgress(10);
                    setSyncStatusText('로컬 캐시 로딩 중...');
                }
                const [cachedCustomers, cachedProducts] = await Promise.all([
                    cache.getCachedData<Customer>('customers'),
                    cache.getCachedData<Product>('products'),
                ]);

                // Safety Net: Check for cleared cache after initial sync has succeeded once.
                if (isMounted && initialSyncSucceeded && cachedCustomers.length === 0 && cachedProducts.length === 0) {
                     setSyncStatusText('캐시가 비어있어 전체 데이터를 다시 동기화합니다...');
                }

                if (isMounted) {
                    setDataState(prev => ({ ...prev, customers: cachedCustomers, products: cachedProducts }));
                    setSyncProgress(20);
                    setSyncStatusText('서버와 변경사항 확인 중...');
                }
    
                const syncDataType = async (dataType: 'customers' | 'products'): Promise<void> => {
                    let localData = dataType === 'customers' ? cachedCustomers : cachedProducts;
                    const keyField = dataType === 'customers' ? 'comcode' : 'barcode';
                    const lastKey = lastSyncKeys?.[dataType] ?? null;
                    console.log(`[Sync] Starting sync for '${dataType}' from key: ${lastKey || 'beginning'}`);

                    if (localData.length === 0) {
                        console.log(`[Sync] Cache for ${dataType} is empty. Performing initial full sync.`);
                        const fullData = await db.getStore<Customer | Product>(dataType);

                        if (isMounted && fullData.length > 0) {
                            await cache.setCachedData(dataType, fullData as any);
                            setDataState(prev => ({ ...prev, [dataType]: fullData }));
                            
                            const latestLogKey = await db.getLastSyncLogKey(dataType);
                            if (latestLogKey) {
                                console.log(`[Sync] Full sync for '${dataType}' complete. New last key: ${latestLogKey}`);
                                setLastSyncKeys(prevKeys => ({ ...(prevKeys || { customers: null, products: null }), [dataType]: latestLogKey }));
                            }
                        }
                        return;
                    }

                    const { items: changes, newLastKey } = await db.getSyncLogChanges(dataType, lastKey);
                    console.log(`[Sync] Found ${changes.length} new changes for '${dataType}'. New last key will be: ${newLastKey}`);
    
                    if (isMounted && changes.length > 0) {
                        const dataMap = new Map(localData.map(item => [(item as any)[keyField], item]) as [string, Customer | Product][]);
                        
                        for (const change of changes) {
                            const key = (change as any)[keyField];
                            if (!key) {
                                console.warn(`[Sync] Change for ${dataType} is missing keyField '${keyField}'. Change:`, change);
                                continue;
                            }
                            if ((change as any)._deleted) {
                                dataMap.delete(key);
                            } else {
                                dataMap.set(key, change);
                            }
                        }
                        const updatedLocalData = Array.from(dataMap.values());
                        
                        await cache.setCachedData(dataType, updatedLocalData as any);
                        setDataState(prev => ({ ...prev, [dataType]: updatedLocalData }));
                    }
    
                    if (isMounted && newLastKey !== lastKey) {
                        setLastSyncKeys(prevKeys => ({ ...(prevKeys || { customers: null, products: null }), [dataType]: newLastKey }));
                    }
                };
    
                const customerSyncPromise = syncDataType('customers').then(() => {
                    if (isMounted) {
                        setSyncProgress(prev => prev + 40);
                        setSyncStatusText('상품 정보 동기화...');
                    }
                });
                const productSyncPromise = syncDataType('products').then(() => {
                    if (isMounted) {
                        setSyncProgress(prev => prev + 40);
                        setSyncStatusText('마무리 중...');
                    }
                });

                await Promise.all([customerSyncPromise, productSyncPromise]);

                if (isMounted) {
                    setSyncProgress(100);
                    setInitialSyncCompleted(true);
                    setInitialSyncSucceeded(true); // Mark that the first sync has succeeded at least once
                }
    
            } catch (error) {
                console.error("Incremental sync failed:", error);
                if (isMounted) {
                    showAlert("데이터 동기화에 실패했습니다. 오프라인 데이터로 앱을 시작합니다.");
                    setInitialSyncCompleted(true); // Allow app to start with cached data
                }
            } finally {
                if (isMounted) {
                    setIsSyncing(false);
                    setTimeout(() => {
                        if (isMounted) setSyncProgress(0);
                    }, 1000);
                }
            }
        };

        const performMaintenance = async () => {
            try {
                const retentionDays = await db.getValue<number>('settings/sync-logs/retentionDays', 30);
                if (retentionDays > 0) {
                    await Promise.all([
                        db.cleanupSyncLogs('customers', retentionDays),
                        db.cleanupSyncLogs('products', retentionDays)
                    ]);
                }
            } catch (error) {
                console.warn("Sync log cleanup failed:", error);
            }
        };
    
        performSync();
        performMaintenance();
    
        return () => {
            isMounted = false;
        };
    }, [user, authLoading, showAlert, lastSyncKeys, setLastSyncKeys, initialSyncSucceeded, setInitialSyncSucceeded]);

    // This effect handles live updates AFTER the initial sync and manages background/foreground state.
    useEffect(() => {
        if (!initialSyncCompleted || !user || !isAppVisible) {
            return;
        }
    
        let isMounted = true;
    
        const handleNewLog = async (
            dataType: 'customers' | 'products',
            logItem: any,
            newKey: string
        ) => {
            if (!isMounted) return;
    
            // Briefly show syncing indicator for user feedback
            setIsSyncing(true);
    
            const keyField = dataType === 'customers' ? 'comcode' : 'barcode';
            const itemKey = logItem[keyField];
    
            if (!itemKey) {
                console.warn(`[Live Sync] Received log for ${dataType} without a key.`, logItem);
                setIsSyncing(false);
                return;
            }
    
            // Update main data state
            let updatedData: (Customer[] | Product[]) = [];
            setDataState(prevState => {
                const currentData = prevState[dataType];
                const dataMap = new Map(currentData.map(item => [(item as any)[keyField], item]) as [string, Customer | Product][]);
    
                if (logItem._deleted) {
                    dataMap.delete(itemKey);
                } else {
                    // Remove internal sync properties before saving to state
                    const { timestamp, user, _deleted, ...itemData } = logItem;
                    dataMap.set(itemKey, itemData);
                }
                
                updatedData = Array.from(dataMap.values());
                return { ...prevState, [dataType]: updatedData };
            });
    
            // Update cache and the last sync key
            try {
                await cache.setCachedData(dataType, updatedData as any);
                setLastSyncKeys(prevKeys => ({ ...(prevKeys || { customers: null, products: null }), [dataType]: newKey }));
            } catch (error) {
                console.error(`[Live Sync] Failed to update cache or sync key for ${dataType}:`, error);
            } finally {
                // Hide syncing indicator after a short delay
                setTimeout(() => {
                    if(isMounted) setIsSyncing(false);
                }, 500);
            }
        };
    
        const unsubCustomers = db.listenForNewLogs('customers', lastSyncKeys?.customers ?? null, (item, key) => {
            handleNewLog('customers', item, key);
        });
    
        const unsubProducts = db.listenForNewLogs('products', lastSyncKeys?.products ?? null, (item, key) => {
            handleNewLog('products', item, key);
        });
    
        return () => {
            isMounted = false;
            unsubCustomers();
            unsubProducts();
        };
    }, [initialSyncCompleted, user, lastSyncKeys, setLastSyncKeys, isAppVisible]);


    return (
        <DataStateContext.Provider value={dataState}>
            <DataActionsContext.Provider value={dataActions}>
                <AlertContext.Provider value={alertContextValue}>
                    <ModalContext.Provider value={modalContextValue}>
                        <ScannerContext.Provider value={scannerContextValue}>
                            <SyncContext.Provider value={syncContextValue}>
                                <PWAInstallContext.Provider value={pwaInstallContextValue}>
                                    <MiscUIContext.Provider value={miscUIContextValue}>
                                        {children}
                                        <AlertModal
                                            isOpen={alert.isOpen}
                                            message={alert.message}
                                            onClose={hideAlert}
                                            onConfirm={alert.onConfirm}
                                            onCancel={alert.onCancel}
                                            confirmText={alert.confirmText}
                                            confirmButtonClass={alert.confirmButtonClass}
                                        />
                                        <Toast 
                                            isOpen={toast.isOpen}
                                            message={toast.message}
                                            type={toast.type}
                                            onClose={hideToast}
                                        />
                                    </MiscUIContext.Provider>
                                </PWAInstallContext.Provider>
                            </SyncContext.Provider>
                        </ScannerContext.Provider>
                    </ModalContext.Provider>
                </AlertContext.Provider>
            </DataActionsContext.Provider>
        </DataStateContext.Provider>
    );
};
