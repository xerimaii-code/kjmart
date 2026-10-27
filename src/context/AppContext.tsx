import React, { createContext, useState, useCallback, useEffect, ReactNode, useContext, useMemo, useRef } from 'react';
import { DeviceSettings, ScannerContext as ScannerContextType, ScannerOptions, ReceivingDraft } from '../types';
import { useAuth } from './AuthContext';
import { checkSqlConnection } from '../services/sqlService';
import { syncAndCacheDbSchema } from '../services/schemaService';
import * as cache from '../services/cacheDbService';
import { cleanupOldReceivingBatches } from '../services/dbService';
import * as receiveDb from '../services/receiveDbService';
import * as db from '../services/dbService';
import { getDraft } from '../services/draftDbService';
import { DATA_SCHEMA_VERSION } from '../config';

// Re-export all necessary hooks from their source files for easy access
import { AlertProvider, useAlert } from './AlertContext';
import { SyncProvider, useSyncState, useSyncSetters } from './SyncContext';
import { DataProvider, useDataState, useDataActions } from './DataContext';
import { DeviceSettingsProvider, useDeviceSettings } from './DeviceSettingsContext';
import { ModalsProvider, useModals } from './ModalsContext';

export { useAlert, useSyncState, useDataState, useDataActions, useDeviceSettings, useModals };

// --- TYPE DEFINITIONS FOR REMAINING CONTEXTS ---
type SqlServerStatus = 'unknown' | 'connected' | 'error' | 'checking';

interface MiscUIState {
    lastModifiedOrderId: number | null;
    setLastModifiedOrderId: React.Dispatch<React.SetStateAction<number | null>>;
    activeMenuOrderId: number | null;
    setActiveMenuOrderId: React.Dispatch<React.SetStateAction<number | null>>;
    sqlStatus: SqlServerStatus;
    checkSql: () => Promise<boolean>;
    receivingBadgeCount: number;
    hasActiveReceivingDraft: boolean;
    refreshReceivingState: () => Promise<void>;
    receivingUpdateVersion: number;
}
const MiscUIContext = createContext<MiscUIState | undefined>(undefined);

interface ScannerContextValue {
    isScannerOpen: boolean;
    scannerContext: ScannerContextType;
    onScanSuccess: (barcode: string) => void;
    options: ScannerOptions;
    openScanner: (context: ScannerContextType, onScan: (barcode: string) => void, optionsOrContinuous: boolean | ScannerOptions) => void;
    closeScanner: () => void;
    selectedCameraId: string | null;
    scanSettings: DeviceSettings['scanSettings'];
}
const ScannerContext = createContext<ScannerContextValue | undefined>(undefined);

interface PWAInstallState {
    isInstallPromptAvailable: boolean;
    triggerInstallPrompt: () => void;
}
const PWAInstallContext = createContext<PWAInstallState | undefined>(undefined);


// --- CORE PROVIDER COMPONENT ---
const CoreAppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const { showToast } = useAlert();
    const { isSyncing, initialSyncCompleted } = useSyncState();
    const { setInitialSyncCompleted, setSyncStatusText } = useSyncSetters();
    const { syncWithDb, loadLocalData } = useDataActions();

    const { selectedCameraId, scanSettings } = useDeviceSettings();
    const { isScannerOpen, scannerContext, onScanSuccess, options, openScanner, closeScanner } = useModals();

    const [lastModifiedOrderId, setLastModifiedOrderId] = useState<number | null>(null);
    const [activeMenuOrderId, setActiveMenuOrderId] = useState<number | null>(null);
    const [isInstallPromptAvailable, setInstallPromptAvailable] = useState(false);
    const deferredInstallPrompt = useRef<any>(null);
    const [sqlStatus, setSqlStatus] = useState<SqlServerStatus>('unknown');
    const checkingSqlPromiseRef = useRef<Promise<boolean> | null>(null);
    const [receivingBadgeCount, setReceivingBadgeCount] = useState(0);
    const [hasActiveReceivingDraft, setHasActiveReceivingDraft] = useState(false);
    const [receivingUpdateVersion, setReceivingUpdateVersion] = useState(0);
    const pendingForegroundSyncRef = useRef(false);

    const refreshReceivingState = useCallback(async () => {
        try {
            const count = await receiveDb.getDraftBatchesCount();
            setReceivingBadgeCount(count);

            const localDraft = await getDraft<ReceivingDraft>('receiving-new-draft');
            setHasActiveReceivingDraft(!!localDraft && (localDraft.items.length > 0 || !!localDraft.selectedSupplier));
            setReceivingUpdateVersion(v => v + 1);
        } catch (e) {
            console.error("Failed to refresh receiving state:", e);
        }
    }, []);

    // --- SQL Connection Check (Concurrent-safe Promise sharing) ---
    const checkSql = useCallback(async (): Promise<boolean> => {
        if (checkingSqlPromiseRef.current) {
            return checkingSqlPromiseRef.current;
        }
        setSqlStatus('checking');
        const promise = (async () => {
            try {
                const result = await checkSqlConnection();
                const status = result.success ? 'connected' : 'error';
                setSqlStatus(status);
                return result.success;
            } catch (e) {
                setSqlStatus('error');
                return false;
            } finally {
                checkingSqlPromiseRef.current = null;
            }
        })();
        checkingSqlPromiseRef.current = promise;
        return promise;
    }, []);
    
    // --- PWA Install ---
    useEffect(() => {
        const handler = (e: any) => { e.preventDefault(); deferredInstallPrompt.current = e; setInstallPromptAvailable(true); };
        window.addEventListener('beforeinstallprompt', handler);
        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);
    const triggerInstallPrompt = useCallback(async () => {
        if (!deferredInstallPrompt.current) return;
        deferredInstallPrompt.current.prompt();
        const { outcome } = await deferredInstallPrompt.current.userChoice;
        if (outcome === 'accepted') setInstallPromptAvailable(false);
        deferredInstallPrompt.current = null;
    }, []);

    // --- MAIN INITIALIZATION EFFECT ---
    useEffect(() => {
        if (!user || initialSyncCompleted) return;
        const initApp = async () => {
            // 1. Establish DB connection & check interrupted flags BEFORE resetting them
            await cache.initializeCacheDb();
            setSyncStatusText('로컬 데이터 불러오는 중');
            const syncInterrupted = await cache.isSyncInterrupted('products') || await cache.isSyncInterrupted('customers');
            const cachedSchemaVer = await cache.getSetting<string>('dataSchemaVersion');
            const schemaVerChanged = cachedSchemaVer !== DATA_SCHEMA_VERSION;
            await cache.resetAllSyncFlags();
            
            // 1.5 Perform maintenance: Cleanup old receiving data (local & remote)
            try {
                await cleanupOldReceivingBatches(2);
                await receiveDb.cleanupOldLocalBatches(2);
            } catch (cleanupError) {
                console.warn("Error during old data cleanup:", cleanupError);
            }

            // 2. Load existing local data IMMEDIATELY to prevent empty state
            await loadLocalData();
            await refreshReceivingState();
            
            // 3. Mark initial load as done so user can start working immediately
            setInitialSyncCompleted(true);
            
            // 4. Background Sync (Only if SQL server is reachable)
            setTimeout(async () => {
                const isConnected = await checkSql();
                if (isConnected) {
                    const products = await cache.getCachedData('products');
                    
                    if (!products?.length || syncInterrupted || schemaVerChanged) {
                        await syncWithDb('full', true);
                        await cache.setSetting('dataSchemaVersion', DATA_SCHEMA_VERSION);
                    } else {
                        const dbSchemaChanged = await syncAndCacheDbSchema();
                        await syncWithDb(dbSchemaChanged ? 'full' : 'incremental', true);
                    }
                }
            }, 300);
        };
        initApp().catch(err => {
            console.error("Initialization error:", err); 
            showToast('앱 초기화 오류', 'error');
            setInitialSyncCompleted(true);
        });
    }, [user, initialSyncCompleted, checkSql, syncWithDb, loadLocalData, showToast, setInitialSyncCompleted, setSyncStatusText, refreshReceivingState]);
    
    // --- Foreground Incremental Sync (Always run on foreground if SQL is connected; stay cleanly offline if not) ---
    const isSyncingRef = useRef(isSyncing);
    useEffect(() => {
        isSyncingRef.current = isSyncing;
        if (!isSyncing && pendingForegroundSyncRef.current) {
            pendingForegroundSyncRef.current = false;
            checkSql().then(connected => {
                if (connected) syncWithDb('incremental', true);
            });
        }
    }, [isSyncing, checkSql, syncWithDb]);
    
    useEffect(() => {
        if (!user || !initialSyncCompleted) return;
        const triggerForegroundSync = async () => {
            if (document.visibilityState !== 'visible') return;
            refreshReceivingState();
            const connected = await checkSql();
            if (!connected) {
                // SQL 서버 연결이 안 되어 있으면 에러 팝업 없이 조용히 오프라인(로컬 캐시) 모드 유지
                return;
            }
            if (isSyncingRef.current) {
                pendingForegroundSyncRef.current = true;
            } else {
                await syncWithDb('incremental', true);
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                triggerForegroundSync();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('pageshow', handleVisibilityChange);
        window.addEventListener('online', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('pageshow', handleVisibilityChange);
            window.removeEventListener('online', handleVisibilityChange);
        };
    }, [user, initialSyncCompleted, checkSql, syncWithDb, refreshReceivingState]);

    // --- Single centralized real-time listener for receiving batches (prevents duplicate 100x IndexedDB storm) ---
    useEffect(() => {
        if (!user || !initialSyncCompleted) return;

        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        const scheduleRefresh = () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                refreshReceivingState();
            }, 80);
        };

        const unsubscribe = db.listenToReceivingBatchChanges({
            onAdd: async (batch) => {
                if (batch.status === 'sent') {
                    await receiveDb.deleteBatch(batch.id);
                } else {
                    await receiveDb.saveOrUpdateBatch(batch);
                }
                scheduleRefresh();
            },
            onChange: async (batch) => {
                if (batch.status === 'sent') {
                    await receiveDb.deleteBatch(batch.id);
                } else {
                    await receiveDb.saveOrUpdateBatch(batch);
                }
                scheduleRefresh();
            },
            onRemove: async (batchId) => {
                await receiveDb.deleteBatch(Number(batchId));
                scheduleRefresh();
            }
        });

        return () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            unsubscribe();
        };
    }, [user, initialSyncCompleted, refreshReceivingState]);

    // --- Memoized Context Values ---
    const miscUIValue = useMemo(() => ({
        lastModifiedOrderId,
        setLastModifiedOrderId,
        activeMenuOrderId,
        setActiveMenuOrderId,
        sqlStatus,
        checkSql,
        receivingBadgeCount,
        hasActiveReceivingDraft,
        refreshReceivingState,
        receivingUpdateVersion
    }), [lastModifiedOrderId, activeMenuOrderId, sqlStatus, checkSql, receivingBadgeCount, hasActiveReceivingDraft, refreshReceivingState, receivingUpdateVersion]);

    const scannerValue = useMemo(() => ({ isScannerOpen, scannerContext, onScanSuccess, options, openScanner, closeScanner, selectedCameraId, scanSettings }), [isScannerOpen, scannerContext, onScanSuccess, options, openScanner, closeScanner, selectedCameraId, scanSettings]);
    const pwaValue = useMemo(() => ({ isInstallPromptAvailable, triggerInstallPrompt }), [isInstallPromptAvailable, triggerInstallPrompt]);

    return (
        <MiscUIContext.Provider value={miscUIValue}>
            <ScannerContext.Provider value={scannerValue}>
                <PWAInstallContext.Provider value={pwaValue}>
                    {children}
                </PWAInstallContext.Provider>
            </ScannerContext.Provider>
        </MiscUIContext.Provider>
    );
};

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    return (
        <AlertProvider>
            <SyncProvider>
                <DataProvider>
                    <DeviceSettingsProvider>
                        <ModalsProvider>
                            <CoreAppProvider>{children}</CoreAppProvider>
                        </ModalsProvider>
                    </DeviceSettingsProvider>
                </DataProvider>
            </SyncProvider>
        </AlertProvider>
    );
};

// --- HOOKS ---
export const useMiscUI = () => {
    const context = useContext(MiscUIContext);
    if (context === undefined) throw new Error('useMiscUI must be used within AppProvider');
    return context;
};
export const useScanner = () => {
    const context = useContext(ScannerContext);
    if (context === undefined) throw new Error('useScanner must be used within AppProvider');
    return context;
};
export const usePWAInstall = () => {
    const context = useContext(PWAInstallContext);
    if (context === undefined) throw new Error('usePWAInstall must be used within AppProvider');
    return context;
};
