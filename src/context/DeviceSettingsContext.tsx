
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

// 기기별 고유 키를 생성하는 헬퍼 함수
const getDeviceSpecificSettingsKey = () => `deviceSettings_v2:${getDeviceId()}`;

export const DeviceSettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    
    // 초기 로드 시 기기별 로컬 스토리지 값 우선 로드 (기기별 카메라 설정 보존)
    const [settings, setSettings] = useState<DeviceSettings>(() => {
        try {
            const stored = localStorage.getItem(getDeviceSpecificSettingsKey());
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
                    // [동기화 로직]
                    // 1. 공통 설정(commonSettings)이 베이스
                    // 2. DB에 저장된 기기 설정(savedSettings)이 덮어씀
                    // 3. 로컬에 저장된 최신 설정(curr)이 가장 우선 (특히 카메라 ID 등 하드웨어 종속 설정)
                    const merged = { 
                        ...commonSettings, 
                        ...savedSettings, 
                        ...curr,
                        selectedCameraId: curr.selectedCameraId || savedSettings.selectedCameraId || null,
                        selectedCameraLabel: curr.selectedCameraLabel || savedSettings.selectedCameraLabel || undefined
                    };
                    
                    // 로컬 스토리지 업데이트
                    localStorage.setItem(getDeviceSpecificSettingsKey(), JSON.stringify(merged));
                    
                    // [중요] Firebase에도 최신 상태를 강제 동기화 (로컬 변경사항 전파)
                    db.setDeviceSettings(deviceId, merged).catch(err => {
                        console.error("Failed to sync settings to Firebase:", err);
                    });
                    
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
            
            // 1. 로컬 저장소 업데이트 (빠른 UI 반영 및 오프라인 지원)
            try { localStorage.setItem(getDeviceSpecificSettingsKey(), JSON.stringify(newSettings)); } catch (e) {}
            
            // 2. Firebase 업데이트 (비동기, 다른 기기/세션과 동기화)
            db.setDeviceSettings(deviceId, newSettings).catch(e => console.error("Firebase update failed:", e));
            
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
