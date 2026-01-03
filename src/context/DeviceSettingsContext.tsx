
import React, { createContext, useState, useCallback, useEffect, ReactNode, useContext, useMemo, useRef } from 'react';
import { DeviceSettings, SyncSettings } from '../types';
import * as db from '../services/dbService';
import { getDeviceId } from '../services/deviceService';
import { useAuth } from './AuthContext';

// --- TYPE DEFINITIONS ---
interface DeviceSettingsActions {
    setSelectedCameraId: (id: string | null, label?: string) => Promise<void>;
    setScanSettings: (settings: Partial<DeviceSettings['scanSettings']>) => Promise<void>;
    setLogRetentionDays: (days: number) => Promise<void>;
    setGoogleDriveSyncSettings: (type: 'customers' | 'products', settings: SyncSettings | null) => Promise<void>;
    setDataSourceSettings: (settings: Partial<DeviceSettings['dataSourceSettings']>) => Promise<void>;
    setAllowDestructiveQueries: (allow: boolean) => Promise<void>;
    setUiFeedback: (settings: Partial<DeviceSettings['uiFeedback']>) => Promise<void>;
}

const DeviceSettingsStateContext = createContext<DeviceSettings | undefined>(undefined);
const DeviceSettingsActionsContext = createContext<DeviceSettingsActions | undefined>(undefined);

// Default settings - Smart Eco mode (720p / 30fps / Downscaling Enabled)
const defaultSettings: DeviceSettings = {
    selectedCameraId: null,
    selectedCameraLabel: undefined,
    scanSettings: { 
        soundOnScan: true, 
        useScannerButton: true,
        scanResolution: '720p',
        scanFps: 30, // Default to 30fps for Smart Eco
        enableDownscaling: true // Default to true (Smart Eco) for best performance/battery balance
    },
    logRetentionDays: 30,
    googleDriveSyncSettings: { customers: null, products: null },
    dataSourceSettings: { newOrder: 'online', productInquiry: 'online', autoSwitch: true },
    allowDestructiveQueries: true,
    uiFeedback: { vibrateOnPress: false, soundOnPress: true },
};

const SETTINGS_STORAGE_KEY = 'deviceSettings_v2';

export const DeviceSettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const loadedFromLocalRef = useRef(false);
    
    const [settings, setSettings] = useState<DeviceSettings>(() => {
        try {
            const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (stored) {
                loadedFromLocalRef.current = true;
                const parsed = JSON.parse(stored);
                // Ensure missing defaults like scanFps are filled
                return { 
                    ...defaultSettings, 
                    ...parsed,
                    scanSettings: { ...defaultSettings.scanSettings, ...parsed.scanSettings }
                };
            }
        } catch (e) {
            console.warn("Failed to load settings from localStorage:", e);
        }
        return defaultSettings;
    });

    useEffect(() => {
        if (!user) return;
        const syncSettings = async () => {
            const deviceId = getDeviceId();
            try {
                const [savedSettings, commonSettings] = await Promise.all([
                    db.getDeviceSettings(deviceId), 
                    db.getCommonSettings()
                ]);
                setSettings(curr => {
                    let merged: DeviceSettings;
                    if (loadedFromLocalRef.current) {
                        // [중요] 카메라 설정(ID/라벨)은 로컬 우선입니다.
                        // 기기마다 카메라 ID 체계가 다르므로 서버에서 덮어쓰지 않도록 보호합니다.
                        merged = { 
                            ...commonSettings, 
                            ...savedSettings, 
                            ...curr,
                            selectedCameraId: curr.selectedCameraId || savedSettings.selectedCameraId,
                            selectedCameraLabel: curr.selectedCameraLabel || savedSettings.selectedCameraLabel
                        };
                        
                        // 서버와 다르면 서버도 업데이트 (백업용)
                        if (JSON.stringify(merged) !== JSON.stringify(savedSettings)) {
                            db.setDeviceSettings(deviceId, merged).catch(() => {});
                        }
                    } else {
                        merged = { ...curr, ...commonSettings, ...savedSettings };
                    }
                    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
                    return merged;
                });
            } catch (e) { console.warn("Settings sync error:", e); }
        };
        syncSettings();
    }, [user]);

    const updateDeviceSetting = useCallback(async (updater: (prev: DeviceSettings) => DeviceSettings) => {
        const deviceId = getDeviceId();
        setSettings(prev => {
            const newSettings = updater(prev);
            try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings)); } catch (e) {}
            db.setDeviceSettings(deviceId, newSettings).catch(() => {});
            return newSettings;
        });
    }, []);

    const actions = useMemo(() => ({
        setSelectedCameraId: async (id: string | null, label?: string) => { await updateDeviceSetting(p => ({ ...p, selectedCameraId: id, selectedCameraLabel: label })); },
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

export const useDeviceSettings = (): DeviceSettings & DeviceSettingsActions => {
    return { ...useDeviceSettingsState(), ...useDeviceSettingsActions() };
};
