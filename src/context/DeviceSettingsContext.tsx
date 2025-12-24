import React, { createContext, useState, useCallback, useEffect, ReactNode, useContext, useMemo } from 'react';
import { DeviceSettings, SyncSettings } from '../types';
import * as db from '../services/dbService';
import * as cache from '../services/cacheDbService';
import { getDeviceId } from '../services/deviceService';
import { useAuth } from './AuthContext';

// --- TYPE DEFINITIONS ---
interface DeviceSettingsActions {
    setSelectedCameraId: (id: string | null) => Promise<void>;
    setScanSettings: (settings: Partial<DeviceSettings['scanSettings']>) => Promise<void>;
    setLogRetentionDays: (days: number) => Promise<void>;
    setGoogleDriveSyncSettings: (type: 'customers' | 'products', settings: SyncSettings | null) => Promise<void>;
    setDataSourceSettings: (settings: Partial<DeviceSettings['dataSourceSettings']>) => Promise<void>;
    setAllowDestructiveQueries: (allow: boolean) => Promise<void>;
    setUiFeedback: (settings: Partial<DeviceSettings['uiFeedback']>) => Promise<void>;
}

// Separate contexts for state and actions to prevent unnecessary re-renders
const DeviceSettingsStateContext = createContext<DeviceSettings | undefined>(undefined);
const DeviceSettingsActionsContext = createContext<DeviceSettingsActions | undefined>(undefined);

// Default settings
const defaultSettings: DeviceSettings = {
    selectedCameraId: null,
    scanSettings: { soundOnScan: true, useScannerButton: false },
    logRetentionDays: 30,
    googleDriveSyncSettings: { customers: null, products: null },
    dataSourceSettings: { newOrder: 'online', productInquiry: 'online', autoSwitch: true },
    allowDestructiveQueries: true,
    uiFeedback: { vibrateOnPress: true, soundOnPress: true },
};

// --- PROVIDER COMPONENT ---
export const DeviceSettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const [settings, setSettings] = useState<DeviceSettings>(defaultSettings);

    // Initialization effect to load settings from cache and remote
    useEffect(() => {
        if (!user) return;
        
        const loadSettings = async () => {
            try {
                // 1. Load from local cache first for speed
                const cachedSettings = await cache.getSetting<DeviceSettings>('deviceSettings');
                if (cachedSettings) {
                    setSettings(s => ({ ...s, ...cachedSettings }));
                }
                
                // 2. Then, fetch from remote and merge
                const [savedSettings, commonSettings] = await Promise.all([
                    db.getDeviceSettings(getDeviceId()), 
                    db.getCommonSettings()
                ]);

                setSettings(curr => {
                    const merged = { ...curr, ...savedSettings, ...commonSettings };
                    // Persist merged settings back to cache
                    cache.setSetting('deviceSettings', merged);
                    return merged;
                });
            } catch (e) {
                console.warn("Could not load device settings:", e);
            }
        };

        loadSettings();
    }, [user]);

    // --- ACTIONS ---
    const updateDeviceSetting = useCallback(async (updater: (prev: DeviceSettings) => DeviceSettings) => {
        const deviceId = getDeviceId();
        setSettings(prev => {
            const newSettings = updater(prev);
            // Update cache immediately for responsiveness
            cache.setSetting('deviceSettings', newSettings);
            // Sync to Firebase in the background
            db.setDeviceSettings(deviceId, newSettings).catch(err => console.warn(`Firebase settings sync failed:`, err));
            return newSettings;
        });
    }, []);

    const actions = useMemo(() => ({
        setSelectedCameraId: async (id: string | null) => { await updateDeviceSetting(p => ({ ...p, selectedCameraId: id })); },
        setScanSettings: async (v: Partial<DeviceSettings['scanSettings']>) => { await updateDeviceSetting(p => ({ ...p, scanSettings: { ...p.scanSettings, ...v } })); },
        setLogRetentionDays: async (d: number) => { await updateDeviceSetting(p => ({ ...p, logRetentionDays: d })); },
        setGoogleDriveSyncSettings: async (t: 'customers' | 'products', v: SyncSettings | null) => { await updateDeviceSetting(p => ({ ...p, googleDriveSyncSettings: { ...p.googleDriveSyncSettings, [t]: v } })); },
        setDataSourceSettings: async (v: Partial<DeviceSettings['dataSourceSettings']>) => { await updateDeviceSetting(p => ({ ...p, dataSourceSettings: { ...p.dataSourceSettings, ...v } })); },
        setAllowDestructiveQueries: async (a: boolean) => { await updateDeviceSetting(p => ({ ...p, allowDestructiveQueries: a })); },
        setUiFeedback: async (v: Partial<DeviceSettings['uiFeedback']>) => { await updateDeviceSetting(p => ({ ...p, uiFeedback: { ...p.uiFeedback, ...v } })); },
    }), [updateDeviceSetting]);
    
    return (
        <DeviceSettingsStateContext.Provider value={settings}>
            <DeviceSettingsActionsContext.Provider value={actions}>
                {children}
            </DeviceSettingsActionsContext.Provider>
        </DeviceSettingsStateContext.Provider>
    );
};

// --- HOOKS ---
export const useDeviceSettingsState = () => {
    const context = useContext(DeviceSettingsStateContext);
    if (context === undefined) throw new Error('useDeviceSettingsState must be used within DeviceSettingsProvider');
    return context;
};

export const useDeviceSettingsActions = () => {
    const context = useContext(DeviceSettingsActionsContext);
    if (context === undefined) throw new Error('useDeviceSettingsActions must be used within DeviceSettingsProvider');
    return context;
};

// Combined hook for convenience
export const useDeviceSettings = (): DeviceSettings & DeviceSettingsActions => {
    return { ...useDeviceSettingsState(), ...useDeviceSettingsActions() };
};
