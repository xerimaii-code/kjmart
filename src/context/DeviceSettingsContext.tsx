
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

// Default settings
const defaultSettings: DeviceSettings = {
    selectedCameraId: null,
    selectedCameraLabel: undefined,
    scanSettings: { 
        soundOnScan: true, 
        useScannerButton: true,
        scanResolution: '720p', // Changed default to 720p (Better efficiency & recognition)
        scanFps: 30,
        enableDownscaling: true
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
    
    // 초기 로드 시 로컬 스토리지 값 우선 로드 (기기별 카메라 설정 보존)
    const [settings, setSettings] = useState<DeviceSettings>(() => {
        try {
            const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
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
                    // [중요] 카메라 설정은 기기별 고유값이므로 로컬 상태를 최우선으로 보존
                    const merged = { 
                        ...commonSettings, 
                        ...savedSettings, 
                        ...curr,
                        // 로컬에 이미 저장된 ID/라벨이 있다면 그것을 유지 (APK 초기화 방지)
                        selectedCameraId: curr.selectedCameraId || savedSettings.selectedCameraId || null,
                        selectedCameraLabel: curr.selectedCameraLabel || savedSettings.selectedCameraLabel || undefined
                    };
                    
                    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
                    db.setDeviceSettings(deviceId, merged).catch(() => {});
                    
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
        setSelectedCameraId: async (id: string | null, label?: string) => { 
            await updateDeviceSetting(p => ({ ...p, selectedCameraId: id, selectedCameraLabel: label })); 
        },
        setScanSettings: async (v: Partial<DeviceSettings['scanSettings']>) => { 
            await updateDeviceSetting(p => ({ ...p, scanSettings: { ...p.scanSettings, ...v } })); 
        },
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
