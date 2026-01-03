
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
        enableDownscaling: true, // Default to true (Smart Eco) for best performance/battery balance
        nativeZoomLevel: 1.5 // [변경] 기본 1.5배 (약간 줌인) 시작
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
    const dbSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    
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

    // 1. 초기 로드: 로그인 시 클라우드 설정(기기별 + 공통)을 가져와 로컬 설정과 병합
    useEffect(() => {
        if (!user) return;
        const syncSettings = async () => {
            const deviceId = getDeviceId();
            try {
                // 기기별 설정(settings/devices/{deviceId})과 공통 설정(settings/common)을 동시에 가져옴
                const [savedSettings, commonSettings] = await Promise.all([
                    db.getDeviceSettings(deviceId), 
                    db.getCommonSettings()
                ]);
                
                setSettings(curr => {
                    let merged: DeviceSettings;
                    // 로컬에 저장된 값이 있다면 우선순위 적용 (로컬 > 기기별DB > 공통DB)
                    if (loadedFromLocalRef.current) {
                        merged = { ...commonSettings, ...savedSettings, ...curr };
                        // 로컬 값과 DB 값이 다르다면 DB를 업데이트 (단, 디바운스 적용은 updateDeviceSetting에서 처리)
                        if (JSON.stringify(merged) !== JSON.stringify(savedSettings)) {
                            db.setDeviceSettings(deviceId, merged).catch(() => {});
                        }
                    } else {
                        // 로컬 값이 없다면 DB 값을 전적으로 신뢰
                        merged = { ...curr, ...commonSettings, ...savedSettings };
                    }
                    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
                    return merged;
                });
            } catch (e) { console.warn("Settings sync error:", e); }
        };
        syncSettings();
    }, [user]);

    // 2. 설정 업데이트 함수 (디바운스 적용)
    // 줌 슬라이더 등 빈번한 업데이트가 발생할 때 DB 쓰기를 줄여 성능 및 비용 최적화
    const updateDeviceSetting = useCallback(async (updater: (prev: DeviceSettings) => DeviceSettings) => {
        const deviceId = getDeviceId();
        setSettings(prev => {
            const newSettings = updater(prev);
            
            // 로컬 스토리지에는 즉시 저장 (UI 반응성)
            try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings)); } catch (e) {}
            
            // 파이어베이스 저장: 디바운스 (1초 지연)
            // 연속적인 호출이 있을 경우 이전 타이머를 취소하고 마지막 값만 저장
            if (dbSaveTimerRef.current) {
                clearTimeout(dbSaveTimerRef.current);
            }
            dbSaveTimerRef.current = setTimeout(() => {
                db.setDeviceSettings(deviceId, newSettings).catch(err => console.warn("Cloud settings save failed:", err));
            }, 1000);

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
