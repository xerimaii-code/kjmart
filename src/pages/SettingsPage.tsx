import React, { useState, useEffect, useCallback } from 'react';
import { useDeviceSettings, useDataActions, useAlert, usePWAInstall, useModals, useSyncState } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { DevicePhoneMobileIcon, LogoutIcon, DatabaseIcon, SpinnerIcon, CloudArrowDownIcon, HistoryIcon, UndoIcon, XMarkIcon, ChevronDownIcon } from '../components/Icons';
import ToggleSwitch from '../components/ToggleSwitch';
import SyncHistoryModal from '../components/SyncHistoryModal';

interface SettingsPageProps {
    isActive: boolean;
}

const SettingsSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="mb-3">
        <h3 className="text-[10px] font-black text-gray-400 px-2 mb-1 uppercase tracking-widest">{title}</h3>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden divide-y divide-gray-100">
            {children}
        </div>
    </div>
);

const SettingsRow: React.FC<{ 
    label: string; 
    subLabel?: string; 
    children: React.ReactNode; 
    onClick?: () => void;
    isDestructive?: boolean;
}> = ({ label, subLabel, children, onClick, isDestructive }) => (
    <div 
        onClick={onClick}
        className={`flex items-center justify-between p-2.5 ${onClick ? 'cursor-pointer active:bg-gray-50' : ''}`}
    >
        <div className="flex flex-col">
            <span className={`text-[12px] font-bold ${isDestructive ? 'text-red-600' : 'text-gray-700'}`}>{label}</span>
            {subLabel && <span className="text-[9px] text-gray-400 mt-0.5 leading-tight">{subLabel}</span>}
        </div>
        <div className="flex-shrink-0 ml-2">
            {children}
        </div>
    </div>
);

const SettingsPage: React.FC<SettingsPageProps> = ({ isActive }) => {
    const { 
        selectedCameraId, 
        selectedCameraLabel,
        scanSettings, 
        dataSourceSettings,
        allowDestructiveQueries,
        uiFeedback,
        setSelectedCameraId, 
        setScanSettings,
        setDataSourceSettings,
        setAllowDestructiveQueries,
        setUiFeedback,
    } = useDeviceSettings();

    const { resetData, syncWithDb } = useDataActions();
    const { showAlert, showToast } = useAlert();
    const { logout, user } = useAuth();
    const { openClearHistoryModal } = useModals();
    const { isInstallPromptAvailable, triggerInstallPrompt } = usePWAInstall();
    const { isSyncing, syncStatusText } = useSyncState();
    
    const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
    const [isSyncHistoryModalOpen, setIsSyncHistoryModalOpen] = useState(false);
    const [isRefreshingCamera, setIsRefreshingCamera] = useState(false);

    const refreshCameras = useCallback(async () => {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        setIsRefreshingCamera(true);
        try {
            let devices = await navigator.mediaDevices.enumerateDevices();
            let videoDevices = devices.filter(device => device.kind === 'videoinput');
            const hasLabels = videoDevices.some(d => d.label && d.label.length > 0);
            if (videoDevices.length === 0 || !hasLabels) {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                    stream.getTracks().forEach(track => track.stop());
                    devices = await navigator.mediaDevices.enumerateDevices();
                    videoDevices = devices.filter(device => device.kind === 'videoinput');
                } catch (permErr) {
                    console.warn("Camera permission denied:", permErr);
                }
            }
            setCameras(videoDevices);
        } catch (err) { 
            console.warn("Camera enumeration failed:", err); 
        } finally {
            setIsRefreshingCamera(false);
        }
    }, []);

    useEffect(() => {
        if (isActive) refreshCameras();
    }, [isActive, refreshCameras]);

    const handleCameraChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
        const cameraId = event.target.value;
        const selectedDevice = cameras.find(c => c.deviceId === cameraId);
        await setSelectedCameraId(cameraId === 'default' ? null : cameraId, selectedDevice?.label);
        showToast('설정 저장됨', 'success');
    };

    const handleReset = (type: 'customers' | 'products') => {
        const label = type === 'customers' ? '거래처' : '상품';
        showAlert(`${label} 데이터를 초기화하시겠습니까?`, () => resetData(type), '초기화', 'bg-rose-500');
    };

    const handleLogout = () => {
        showAlert("로그아웃 하시겠습니까?", async () => {
            try { await logout(); showToast("로그아웃 되었습니다."); } catch (e: any) { showAlert(e.message); }
        });
    };

    const isSelectedCameraInList = selectedCameraId && cameras.find(c => c.deviceId === selectedCameraId);

    return (
        <div className="h-full flex flex-col bg-gray-50">
            <div className="scrollable-content p-2.5">
                <div className="max-w-xl mx-auto w-full">
                    <SettingsSection title="스캔 최적화">
                        <SettingsRow label="기본 카메라">
                            <div className="flex gap-1.5 items-center justify-end w-full max-w-[170px]">
                                <select 
                                    value={selectedCameraId || 'default'} 
                                    onChange={handleCameraChange}
                                    className="flex-grow p-1 text-[10px] font-black border border-gray-300 bg-white rounded-lg focus:ring-1 focus:ring-blue-500 min-w-0 truncate text-gray-700"
                                >
                                    <option value="default">기본 (후면)</option>
                                    {(!isSelectedCameraInList && selectedCameraId) && (
                                        <option value={selectedCameraId}>{selectedCameraLabel ? `${selectedCameraLabel}` : '저장됨'}</option>
                                    )}
                                    {cameras.map((camera, index) => (
                                        <option key={camera.deviceId} value={camera.deviceId}>
                                            {camera.label || `CAM ${index + 1}`}
                                        </option>
                                    ))}
                                </select>
                                <button 
                                    onClick={refreshCameras}
                                    disabled={isRefreshingCamera}
                                    className="p-1.5 bg-gray-100 rounded-lg text-gray-500 active:scale-95 transition-transform flex-shrink-0"
                                >
                                    {isRefreshingCamera ? <SpinnerIcon className="w-3 h-3 animate-spin"/> : <UndoIcon className="w-3 h-3"/>}
                                </button>
                            </div>
                        </SettingsRow>

                        <div className="p-2 bg-slate-50 border-t border-b border-gray-100">
                            <div className="grid grid-cols-3 gap-1.5">
                                <button 
                                    onClick={() => setScanSettings({ scanResolution: '720p', scanFps: 30, enableDownscaling: true })}
                                    className={`relative flex flex-col items-center py-1.5 rounded-lg border-2 transition-all ${scanSettings.scanResolution === '720p' && scanSettings.scanFps === 30 && scanSettings.enableDownscaling ? 'bg-white border-emerald-500 shadow-sm ring-1 ring-emerald-50' : 'bg-gray-100 border-transparent opacity-60'}`}
                                >
                                    <div className="absolute -top-1.5 -right-0.5">
                                        <div className="bg-emerald-600 text-white text-[6px] font-black px-1 py-0.5 rounded-full shadow-sm animate-pulse">BEST</div>
                                    </div>
                                    <span className="text-[11px] font-black text-slate-800">에코 모드</span>
                                    <span className="text-[8px] font-bold text-emerald-600 mt-0.5 uppercase tracking-tighter">연산 68%↓</span>
                                </button>
                                <button 
                                    onClick={() => setScanSettings({ scanResolution: '720p', scanFps: 'auto', enableDownscaling: false })}
                                    className={`relative flex flex-col items-center py-1.5 rounded-lg border-2 transition-all ${scanSettings.scanResolution === '720p' && scanSettings.scanFps === 'auto' && !scanSettings.enableDownscaling ? 'bg-white border-indigo-600 shadow-sm ring-1 ring-indigo-50' : 'bg-gray-100 border-transparent opacity-60'}`}
                                >
                                    <span className="text-[11px] font-black text-slate-800">가변 모드</span>
                                    <span className="text-[8px] font-bold text-indigo-600 mt-0.5 uppercase tracking-tighter">ML Kit 기반</span>
                                </button>
                                <button 
                                    onClick={() => setScanSettings({ scanResolution: '720p', scanFps: 30, enableDownscaling: false })}
                                    className={`flex flex-col items-center py-1.5 rounded-lg border-2 transition-all ${scanSettings.scanResolution === '720p' && scanSettings.scanFps === 30 && !scanSettings.enableDownscaling ? 'bg-white border-blue-500 shadow-sm ring-1 ring-blue-50' : 'bg-gray-100 border-transparent opacity-60'}`}
                                >
                                    <span className="text-[11px] font-black text-slate-800">정밀 모드</span>
                                    <span className="text-[8px] font-bold text-blue-500 mt-0.5 uppercase tracking-tighter">Full Data</span>
                                </button>
                            </div>
                        </div>

                        <SettingsRow label="스캔 알림음">
                            <ToggleSwitch id="sound-scan" label="" checked={scanSettings.soundOnScan} onChange={(checked) => setScanSettings({ soundOnScan: checked })} />
                        </SettingsRow>
                        <SettingsRow label="터치 스캔 전용">
                            <ToggleSwitch id="use-scan-button" label="" checked={scanSettings.useScannerButton} onChange={(checked) => setScanSettings({ useScannerButton: checked })} />
                        </SettingsRow>
                        <SettingsRow label="키패드 터치음">
                            <ToggleSwitch id="sound-press" label="" checked={uiFeedback.soundOnPress} onChange={(checked) => setUiFeedback({ soundOnPress: checked })} color="blue" />
                        </SettingsRow>
                    </SettingsSection>

                    <SettingsSection title="데이터 동기화">
                         <div className="p-2.5 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col">
                                    <span className="text-[11px] font-bold text-gray-700">데이터 소스</span>
                                </div>
                                <div className="flex bg-gray-100 rounded-lg p-0.5">
                                    <button 
                                        onClick={() => setDataSourceSettings({ newOrder: 'offline', productInquiry: 'offline' })} 
                                        className={`px-2 py-1 rounded-md text-[9px] font-black transition-all ${dataSourceSettings.newOrder === 'offline' ? 'bg-white text-blue-600 shadow-xs' : 'text-gray-400'}`}
                                    >
                                        로컬
                                    </button>
                                    <button 
                                        onClick={() => setDataSourceSettings({ newOrder: 'online', productInquiry: 'online' })} 
                                        className={`px-2 py-1 rounded-md text-[9px] font-black transition-all ${dataSourceSettings.newOrder === 'online' ? 'bg-white text-blue-600 shadow-xs' : 'text-gray-400'}`}
                                    >
                                        서버
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <button 
                                    onClick={() => syncWithDb('incremental')} 
                                    disabled={isSyncing} 
                                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white rounded-xl font-bold active:scale-95 disabled:bg-gray-300 shadow-sm transition-all text-[13px]"
                                >
                                    {isSyncing ? <SpinnerIcon className="w-3.5 h-3.5 animate-spin text-white" /> : <CloudArrowDownIcon className="w-3.5 h-3.5" />}
                                    <span>{isSyncing ? syncStatusText : '최신 데이터 업데이트'}</span>
                                </button>
                                <button 
                                    onClick={() => showAlert('모든 데이터를 새로 다운로드하시겠습니까?', () => syncWithDb('full'), '전체 동기화')} 
                                    disabled={isSyncing} 
                                    className="w-full py-1.5 bg-white border border-gray-200 text-gray-500 rounded-xl text-[9px] font-black active:scale-95 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5"
                                >
                                    <DatabaseIcon className="w-2.5 h-2.5 text-gray-400" />
                                    데이터 전체 다시 받기
                                </button>
                            </div>
                        </div>
                    </SettingsSection>

                    <SettingsSection title="관리">
                        <SettingsRow label="발주 이력 삭제" onClick={openClearHistoryModal}><span className="text-[10px] font-bold text-gray-400">정리하기</span></SettingsRow>
                        <SettingsRow label="동기화 로그" onClick={() => setIsSyncHistoryModalOpen(true)}><HistoryIcon className="w-4 h-4 text-gray-400" /></SettingsRow>
                        <div className="flex border-t border-gray-100">
                            <button onClick={() => handleReset('customers')} className="flex-1 py-2.5 text-[10px] font-black text-red-500 hover:bg-red-50 border-r border-gray-50">거래처 초기화</button>
                            <button onClick={() => handleReset('products')} className="flex-1 py-2.5 text-[10px] font-black text-red-500 hover:bg-red-50">상품 초기화</button>
                        </div>
                    </SettingsSection>

                    <SettingsSection title="시스템">
                        <SettingsRow label="SQL 쓰기 권한">
                            <ToggleSwitch id="allow-destructive" label="" checked={allowDestructiveQueries} onChange={setAllowDestructiveQueries} color="red" />
                        </SettingsRow>
                        {isInstallPromptAvailable && (
                            <SettingsRow label="앱 설치" onClick={triggerInstallPrompt}><DevicePhoneMobileIcon className="w-5 h-5 text-blue-600" /></SettingsRow>
                        )}
                        <SettingsRow label="로그아웃" subLabel={user?.email || ''} onClick={handleLogout} isDestructive={true}>
                            <LogoutIcon className="w-5 h-5 text-red-500" />
                        </SettingsRow>
                    </SettingsSection>
                </div>
            </div>
            <SyncHistoryModal isOpen={isSyncHistoryModalOpen} onClose={() => setIsSyncHistoryModalOpen(false)} />
        </div>
    );
};

export default SettingsPage;