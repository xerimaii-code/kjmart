import React, { createContext, useState, ReactNode, useContext, useMemo } from 'react';

interface SyncState {
    isSyncing: boolean;
    syncProgress: number;
    syncStatusText: string;
    syncDataType: 'customers' | 'products' | 'full' | 'background' | 'incremental' | null;
    syncSource: 'local' | 'drive' | null;
    initialSyncCompleted: boolean;
}

// We need a setter context as well so DataContext can trigger sync state changes
interface SyncStateSetters {
    setIsSyncing: React.Dispatch<React.SetStateAction<boolean>>;
    setSyncProgress: React.Dispatch<React.SetStateAction<number>>;
    setSyncStatusText: React.Dispatch<React.SetStateAction<string>>;
    setSyncDataType: React.Dispatch<React.SetStateAction<'customers' | 'products' | 'full' | 'background' | 'incremental' | null>>;
    setSyncSource: React.Dispatch<React.SetStateAction<'local' | 'drive' | null>>;
    setInitialSyncCompleted: React.Dispatch<React.SetStateAction<boolean>>;
}

export const SyncStateContext = createContext<SyncState | undefined>(undefined);
export const SyncSettersContext = createContext<SyncStateSetters | undefined>(undefined);

export const SyncProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncProgress, setSyncProgress] = useState(0);
    const [syncStatusText, setSyncStatusText] = useState('');
    const [syncDataType, setSyncDataType] = useState<'customers' | 'products' | 'full' | 'background' | 'incremental' | null>(null);
    const [syncSource, setSyncSource] = useState<'local' | 'drive' | null>(null);
    const [initialSyncCompleted, setInitialSyncCompleted] = useState(false);

    const state = useMemo(() => ({
        isSyncing, syncProgress, syncStatusText, syncDataType, syncSource, initialSyncCompleted
    }), [isSyncing, syncProgress, syncStatusText, syncDataType, syncSource, initialSyncCompleted]);

    const setters = useMemo(() => ({
        setIsSyncing, setSyncProgress, setSyncStatusText, setSyncDataType, setSyncSource, setInitialSyncCompleted
    }), []);

    return (
        <SyncStateContext.Provider value={state}>
            <SyncSettersContext.Provider value={setters}>
                {children}
            </SyncSettersContext.Provider>
        </SyncStateContext.Provider>
    );
};

export const useSyncState = () => {
    const context = useContext(SyncStateContext);
    if (context === undefined) {
        throw new Error('useSyncState must be used within a SyncProvider');
    }
    return context;
};

export const useSyncSetters = () => {
    const context = useContext(SyncSettersContext);
    if (context === undefined) {
        throw new Error('useSyncSetters must be used within a SyncProvider');
    }
    return context;
};
