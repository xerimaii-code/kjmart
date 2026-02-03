
import React, { useState, useEffect, useCallback } from 'react';
import { useDeviceSettings, useDataActions, useAlert, usePWAInstall, useModals, useSyncState } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { DevicePhoneMobileIcon, LogoutIcon, DatabaseIcon, SpinnerIcon, CloudArrowDownIcon, HistoryIcon, UndoIcon, XMarkIcon, ChevronRightIcon } from '../components/Icons';
import ToggleSwitch from '../components/ToggleSwitch';
import SyncHistoryModal from '../components/SyncHistoryModal';
import ResendModal from '../components/ResendModal';

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
        className={`flex items-center justify-between p-3 ${onClick ? 'cursor-pointer active:bg-gray-50' : ''}`}
    >
        <div className="flex flex-col">
            <span className={`text-[13px] font-bold ${isDestructive ? 'text-red-600' : 'text-gray-700'}`}>{label}</span>
            {subLabel && <span className="text-[10px] text-gray-400 mt-0.5 leading-tight">{subLabel}</span>}
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
    const [isResendModalOpen, setIsResendModalOpen] = useState(false);
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
                } catch (permErr) {}
            }
            setCameras(videoDevices);

            if (selectedCameraId && selectedCameraLabel) {
                const idExists = videoDevices.some(d => d.deviceId === selectedCameraId);
                if (!idExists) {
                    const labelMatch = videoDevices.find(d => d.label === selectedCameraLabel);
                    if (labelMatch) {
                        await setSelectedCameraId(labelMatch.deviceId, labelMatch.label);
                    }
                }
            }
        } catch (err) { 
            console.warn("Camera enumeration failed:", err); 
        } finally {
            setIsRefreshingCamera(false);
        }
    }, [selectedCameraId, selectedCameraLabel, setSelectedCameraId]);

    useEffect(() => {
        if (isActive) refreshCameras();
    }, [isActive, refreshCameras]);

    const handleCameraChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
        const cameraId = event.target.value;
        const selectedDevice = cameras.find(c => c.deviceId === cameraId);
        await setSelectedCameraId(cameraId === 'default' ? null : cameraId, selectedDevice?.label);
        showToast('카메라 설정이 저장되었습니다.', 'success');
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
        <>
            <div className="h-full flex flex-col bg-gray-50">
                <div className="scrollable-content p-2.5">
                    <div className="max-w-xl mx-auto w-full">
                        
                        <SettingsSection title="스캔 설정">
                            <SettingsRow label="기본 카메라" subLabel="바코드 인식용 카메라를 선택하세요">
                                <div className="flex gap-1.5 items-center justify-end w-full max-w-[200px]">
                                    <select 
                                        value={selectedCameraId || 'default'} 
                                        onChange={handleCameraChange}
                                        className="flex-grow p-1.5 text-sm font-bold border border-gray-300 bg-white rounded-lg focus:ring-1 focus:ring-blue-500 min-w-0 truncate text-gray-800"
                                    >
                                        <option value="default">기본 (후면)</option>
                                        {(!isSelectedCameraInList && selectedCameraId) && (
                                            <option value={selectedCameraId}>{selectedCameraLabel ? `${selectedCameraLabel} (ID 갱신 대기)` : '저장된 카메라'}</option>
                                        )}
                                        {cameras.map((camera, index) => (
                                            <option key={camera.deviceId} value={camera.deviceId}>
                                                {camera.label || `Camera ${index + 1}`}
                                            </option>
                                        ))}
                                    </select>
                                    <button onClick={refreshCameras} disabled={isRefreshingCamera} className="p-1.5 bg-gray-100 rounded-lg text-gray-500 active:scale-95 transition-transform flex-shrink-0">
                                        {isRefreshingCamera ? <SpinnerIcon className="w-4 h-4 animate-spin"/> : <UndoIcon className="w-4 h-4"/>}
                                    </button>
                                </div>
                            </SettingsRow>

                            <SettingsRow label="스캔 해상도" subLabel="720p(권장)는 인식이 잘 되고, 480p는 발열이 적습니다">
                                <div className="flex bg-gray-100 rounded-lg p-0.5">
                                    <button 
                                        onClick={() => setScanSettings({ scanResolution: '480p' })} 
                                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${scanSettings.scanResolution === '480p' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}
                                    >
                                        480p
                                    </button>
                                    <button 
                                        onClick={() => setScanSettings({ scanResolution: '720p' })} 
                                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${scanSettings.scanResolution === '720p' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}
                                    >
                                        720p
                                    </button>
                                </div>
                            </SettingsRow>

                            <SettingsRow label="수동 터치 스캔" subLabel="켜면 터치할 때만 5초간 스캔합니다">
                                <ToggleSwitch 
                                    id="use-scanner-button" 
                                    label="" 
                                    checked={scanSettings.useScannerButton} 
                                    onChange={(checked) => setScanSettings({ useScannerButton: checked })} 
                                />
                            </SettingsRow>

                            <SettingsRow label="스캔 알림음" subLabel="인식 성공 시 비프음을 재생합니다">
                                <ToggleSwitch id="sound-scan" label="" checked={scanSettings.soundOnScan} onChange={(checked) => setScanSettings({ soundOnScan: checked })} />
                            </SettingsRow>
                            
                            <SettingsRow label="키패드 터치음" subLabel="수량 입력 시 효과음을 재생합니다">
                                <ToggleSwitch id="sound-press" label="" checked={uiFeedback.soundOnPress} onChange={(checked) => setUiFeedback({ soundOnPress: checked })} color="blue" />
                            </SettingsRow>
                        </SettingsSection>

                        <SettingsSection title="데이터 관리">
                            <div className="p-2.5 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex flex-col"><span className="text-[12px] font-bold text-gray-700">데이터 소스</span></div>
                                    <div className="flex bg-gray-100 rounded-lg p-0.5">
                                        <button onClick={() => setDataSourceSettings({ newOrder: 'offline', productInquiry: 'offline' })} className={`px-2 py-1 rounded-md text-[10px] font-black transition-all ${dataSourceSettings.newOrder === 'offline' ? 'bg-white text-blue-600 shadow-xs' : 'text-gray-400'}`}>로컬</button>
                                        <button onClick={() => setDataSourceSettings({ newOrder: 'online', productInquiry: 'online' })} className={`px-2 py-1 rounded-md text-[10px] font-black transition-all ${dataSourceSettings.newOrder === 'online' ? 'bg-white text-blue-600 shadow-xs' : 'text-gray-400'}`}>서버</button>
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <button onClick={() => syncWithDb('incremental')} disabled={isSyncing} className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 text-white rounded-xl font-bold active:scale-95 disabled:bg-gray-300 shadow-sm transition-all text-sm">
                                        {isSyncing ? <SpinnerIcon className="w-4 h-4 animate-spin text-white" /> : <CloudArrowDownIcon className="w-4 h-4" />}
                                        <span>{isSyncing ? syncStatusText : '서버와 동기화'}</span>
                                    </button>
                                    <button onClick={() => showAlert('모든 데이터를 다시 다운로드하시겠습니까?', () => syncWithDb('full'), '전체 동기화')} disabled={isSyncing} className="w-full py-2 bg-white border border-gray-200 text-gray-500 rounded-xl text-[10px] font-black active:scale-95 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5">
                                        <DatabaseIcon className="w-3 h-3 text-gray-400" />
                                        전체 데이터 재수신
                                    </button>
                                </div>
                            </div>
                        </SettingsSection>
                        
                        <SettingsSection title="데이터 복구">
                            <SettingsRow 
                                label="입고내역 백업 불러오기" 
                                subLabel="서버 백업에서 기기로 복원"
                                onClick={() => setIsResendModalOpen(true)}
                            >
                                <ChevronRightIcon className="w-5 h-5 text-gray-400" />
                            </SettingsRow>
                        </SettingsSection>

                        <SettingsSection title="기타 관리">
                            <SettingsRow label="발주 이력 정리" onClick={openClearHistoryModal}><span className="text-[11px] font-bold text-gray-400">정리하기</span></SettingsRow>
                            <SettingsRow label="동기화 로그" onClick={() => setIsSyncHistoryModalOpen(true)}><HistoryIcon className="w-4 h-4 text-gray-400" /></SettingsRow>
                            <div className="flex border-t border-gray-100">
                                <button onClick={() => handleReset('customers')} className="flex-1 py-3 text-[11px] font-black text-red-500 hover:bg-red-50 border-r border-gray-50">거래처 초기화</button>
                                <button onClick={() => handleReset('products')} className="flex-1 py-3 text-[11px] font-black text-red-500 hover:bg-red-50">상품 초기화</button>
                            </div>
                        </SettingsSection>

                        <SettingsSection title="시스템 정보">
                            <SettingsRow label="SQL 실행 권한">
                                <ToggleSwitch id="allow-destructive" label="" checked={allowDestructiveQueries} onChange={setAllowDestructiveQueries} color="red" />
                            </SettingsRow>
                            {isInstallPromptAvailable && (
                                <SettingsRow label="앱 설치하기" onClick={triggerInstallPrompt}><DevicePhoneMobileIcon className="w-5 h-5 text-blue-600" /></SettingsRow>
                            )}
                            <SettingsRow label="로그아웃" subLabel={user?.email || ''} onClick={handleLogout} isDestructive={true}>
                                <LogoutIcon className="w-5 h-5 text-red-500" />
                            </SettingsRow>
                        </SettingsSection>
                    </div>
                </div>
                <SyncHistoryModal isOpen={isSyncHistoryModalOpen} onClose={() => setIsSyncHistoryModalOpen(false)} />
            </div>
            <ResendModal isOpen={isResendModalOpen} onClose={() => setIsResendModalOpen(false)} />
        </>
    );
};

export default SettingsPage;
