import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useDeviceSettings, useDataActions, useAlert, usePWAInstall, useModals, useSyncState } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import * as db from '../services/dbService';
import { CameraIcon, SpinnerIcon, DevicePhoneMobileIcon, DocumentIcon, GoogleDriveIcon, LogoutIcon, TrashIcon, DatabaseIcon, HistoryIcon, UserCircleIcon, WarningIcon, SettingsIcon } from '../components/Icons';
import { SyncSettings } from '../types';
import ToggleSwitch from '../components/ToggleSwitch';
import * as googleDrive from '../services/googleDriveService';
import CollapsibleCard from '../components/CollapsibleCard';
import { IS_DEVELOPER_MODE } from '../config';

interface SettingsPageProps {
    isActive: boolean;
}

// --- Reusable Sync Section Component ---
const SyncSection: React.FC<{
    dataType: 'customers' | 'products';
    settings: SyncSettings | null;
    onSettingsChange: (settings: SyncSettings | null) => void;
}> = ({ dataType, settings, onSettingsChange }) => {
    const { showToast, showAlert } = useAlert();
    const { syncWithFile } = useDataActions();
    const { isSyncing, syncStatusText, syncDataType, syncSource } = useSyncState();
    const [isPicking, setIsPicking] = useState(false);
    const [isApiReady, setIsApiReady] = useState(false);

    const dataTypeKorean = dataType === 'customers' ? '거래처' : '상품';
    const isCurrentSyncForThisType = isSyncing && syncDataType === dataType;
    const fileInputRef = useRef<HTMLInputElement>(null);

    const initializeApi = useCallback(async () => {
        if (isApiReady) return true;
        try {
            await googleDrive.initGoogleApi();
            setIsApiReady(true);
            return true;
        } catch (err) {
            console.error("Google API initialization failed:", err);
            showToast('Google API 초기화에 실패했습니다.', 'error');
            return false;
        }
    }, [isApiReady, showToast]);

    const handleSelectFile = async () => {
        setIsPicking(true);
        try {
            if (!await initializeApi()) return;
            const fileId = await googleDrive.showPicker();
            const metadata = await googleDrive.getFileMetadata(fileId);
            onSettingsChange({
                fileId,
                fileName: metadata.name,
                lastSyncTime: null,
                autoSync: settings?.autoSync || false,
            });
        } catch (err) {
            if (err instanceof Error && (err.message.includes("cancelled") || err.message.includes("popup_closed"))) {
                // User cancelled the picker, this is not an error.
            } else {
                console.error("File selection error:", err);
                showToast('파일 선택 중 오류가 발생했습니다.', 'error');
            }
        } finally {
            setIsPicking(false);
        }
    };

    const handleSyncFromDrive = async () => {
        if (!settings?.fileId) {
            showToast("먼저 동기화할 파일을 선택해주세요.", 'error');
            return;
        }

        try {
            if (!await initializeApi()) return;
            const metadata = await googleDrive.getFileMetadata(settings.fileId);
            const fileBlob = await googleDrive.getFileContent(settings.fileId, metadata.mimeType);

            await syncWithFile(fileBlob, dataType, 'drive');
            
            onSettingsChange({ ...settings, lastSyncTime: metadata.modifiedTime });

        } catch (err: any) {
             if (err.message === 'MASS_DELETION_DETECTED') {
                const { numExisting, numDeletions, proceed } = err.details;
                showAlert(
                    `경고: 대량 삭제가 감지되었습니다.\n\n기존 데이터: ${numExisting.toLocaleString()}건\n결과적으로 ${numDeletions.toLocaleString()}건의 데이터가 삭제됩니다. 계속하시겠습니까?`,
                    async () => {
                        try {
                            await proceed();
                            if (settings?.fileId) {
                                const metadata = await googleDrive.getFileMetadata(settings.fileId);
                                onSettingsChange({ ...settings, lastSyncTime: metadata.modifiedTime });
                            }
                        } catch (proceedError) {
                             // Error is handled by the syncWithFile action
                        }
                    },
                    '삭제 진행',
                    'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500',
                    () => showToast('동기화 작업이 취소되었습니다.', 'error')
                );
            }
        }
    };
    
    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files.length > 0) {
            const file = event.target.files[0];
            try {
                await syncWithFile(file, dataType, 'local');
            } catch (err: any) {
                 if (err.message === 'MASS_DELETION_DETECTED') {
                    const { numExisting, numDeletions, proceed } = err.details;
                    showAlert(
                        `경고: 대량 삭제가 감지되었습니다.\n\n기존 데이터: ${numExisting.toLocaleString()}건\n결과적으로 ${numDeletions.toLocaleString()}건의 데이터가 삭제됩니다. 계속하시겠습니까?`,
                        async () => {
                            try {
                                await proceed();
                            } catch (proceedError) {
                               // Error is handled by the syncWithFile action
                            }
                        },
                        '삭제 진행', 'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500',
                        () => showToast('동기화 작업이 취소되었습니다.', 'error')
                    );
                }
            } finally {
                if (fileInputRef.current) fileInputRef.current.value = "";
            }
        }
    };
    
    const handleAutoSyncToggle = (isChecked: boolean) => {
        if (settings) {
            onSettingsChange({ ...settings, autoSync: isChecked });
        }
    };
    
    const handleDisconnect = () => {
        showAlert(
            `'${settings?.fileName}' 파일과의 연결을 해제하시겠습니까? 자동 동기화도 비활성화됩니다.`,
            () => onSettingsChange(null),
            '연결 해제',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    };

    const isOperationInProgress = isSyncing || isPicking;

    return (
        <div className="space-y-4">
            <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileChange}
                accept=".xlsx, .xls"
            />
            <h4 className="text-base font-bold text-gray-700">{dataTypeKorean} 데이터</h4>
        </div>
    );
};

const ActionButton: React.FC<{
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    description: string;
    isDestructive?: boolean;
    disabled?: boolean;
}> = ({ onClick, icon, label, description, isDestructive = false, disabled = false }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        className={`w-full text-left p-3 rounded-lg flex items-center gap-4 transition-colors ${
            isDestructive 
                ? 'hover:bg-red-50' 
                : 'hover:bg-gray-100'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
        <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
            isDestructive ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'
        }`}>
            {icon}
        </div>
        <div className="flex-grow">
            <p className={`font-semibold ${isDestructive ? 'text-red-700' : 'text-gray-800'}`}>{label}</p>
            <p className="text-xs text-gray-500">{description}</p>
        </div>
    </button>
);


const SettingsPage: React.FC<SettingsPageProps> = ({ isActive }) => {
    const { 
        selectedCameraId, 
        scanSettings, 
        logRetentionDays,
        googleDriveSyncSettings,
        dataSourceSettings,
        setSelectedCameraId, 
        setScanSettings,
        setLogRetentionDays,
        setGoogleDriveSyncSettings,
        setDataSourceSettings,
    } = useDeviceSettings();

    const { resetData, forceFullSync, syncWithDb } = useDataActions();
    const { showAlert, showToast } = useAlert();
    const { logout, user } = useAuth();
    const { openHistoryModal, openClearHistoryModal } = useModals();
    const { isInstallPromptAvailable, triggerInstallPrompt } = usePWAInstall();
    const { isSyncing, syncDataType, syncStatusText } = useSyncState();
    const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
    const [isCleaning, setIsCleaning] = useState(false);
    
    useEffect(() => {
        const getCameras = async () => {
            try {
                 if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    console.warn("Camera API is not supported in this browser.");
                    return;
                }
                await navigator.mediaDevices.getUserMedia({ video: true });
                const devices = await navigator.mediaDevices.enumerateDevices();
                const videoDevices = devices.filter(device => device.kind === 'videoinput');
                setCameras(videoDevices);
            } catch (err) {
                console.warn("Could not enumerate cameras:", err);
            }
        };
        if (isActive) {
            getCameras();
        }
    }, [isActive]);

    const handleCameraChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
        const cameraId = event.target.value;
        await setSelectedCameraId(cameraId === 'default' ? null : cameraId);
        showToast('카메라 설정이 저장되었습니다.', 'success');
    };
    
    const handleLogout = () => {
        showAlert(
            "로그아웃 하시겠습니까?",
            async () => {
                try {
                    await logout();
                } catch (err) {
                    console.error("Logout failed:", err);
                    showToast('로그아웃에 실패했습니다.', 'error');
                }
            },
            '로그아웃',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    };
    
    const handleReset = (dataType: 'customers' | 'products') => {
        const typeKorean = dataType === 'customers' ? '거래처' : '상품';
        showAlert(
            `모든 ${typeKorean} 데이터를 초기화하시겠습니까?\n이 작업은 되돌릴 수 없으며, 모든 사용자의 데이터가 삭제됩니다.`,
            () => resetData(dataType),
            '초기화',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    };

    const handleRetentionChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
        const days = parseInt(event.target.value, 10);
        setLogRetentionDays(days);
        
        if (days > 0) {
            setIsCleaning(true);
            try {
                await Promise.all([
                    db.cleanupSyncLogs('customers', days),
                    db.cleanupSyncLogs('products', days)
                ]);
                showToast('오래된 동기화 로그가 정리되었습니다.', 'success');
            } catch (e) {
                showToast('로그 정리 중 오류가 발생했습니다.', 'error');
            } finally {
                setIsCleaning(false);
            }
        } else {
            showToast('로그 보관 기간이 저장되었습니다.', 'success');
        }
    };

    const handleForceFullSync = () => {
        showAlert(
            "서버의 모든 데이터를 기기로 강제 동기화합니다.\n\n로컬 캐시를 서버 데이터로 덮어씁니다. 계속하시겠습니까?",
            async () => {
                try {
                    await forceFullSync();
                } catch (e) {
                    console.error("Force sync failed from SettingsPage:", e);
                }
            },
            '동기화 실행',
            'bg-blue-500 hover:bg-blue-600 focus:ring-blue-500'
        );
    };

    const handleDbSync = () => {
        showAlert(
            "데이터베이스에서 직접 데이터를 동기화하시겠습니까?\n이 작업은 시간이 걸릴 수 있습니다.",
            async () => {
                try {
                    await syncWithDb();
                } catch (e) {
                    // error is already handled by syncWithDb
                }
            },
            "동기화 실행",
            'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
        );
    };

    return (
        <div className="h-full flex flex-col bg-gray-50">
            <div className="scrollable-content">
                <div className="p-3 space-y-4 max-w-2xl mx-auto w-full">

                    <CollapsibleCard title="앱 설정" icon={<SettingsIcon className="w-6 h-6 text-gray-500" />} initiallyOpen={true}>
                        <div className="space-y-3">
                            <h4 className="text-base font-bold text-gray-700">카메라 및 스캔</h4>
                            <div className="flex items-center gap-3">
                                <CameraIcon className="w-6 h-6 text-gray-400 flex-shrink-0" />
                                <select 
                                    value={selectedCameraId || 'default'} 
                                    onChange={handleCameraChange}
                                    className="w-full p-2.5 border border-gray-300 bg-white rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                >
                                    <option value="default">기본 카메라</option>
                                    {cameras.map((camera, index) => (
                                        <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `카메라 ${index + 1}`}</option>
                                    ))}
                                </select>
                            </div>
                             <div className="flex justify-between items-center p-3 bg-gray-50/80 rounded-lg">
                                <ToggleSwitch 
                                    id="vibrate-scan"
                                    label="스캔 시 진동"
                                    checked={scanSettings.vibrateOnScan}
                                    onChange={(checked) => setScanSettings({ vibrateOnScan: checked })}
                                    color="blue"
                                />
                             </div>
                             <div className="flex justify-between items-center p-3 bg-gray-50/80 rounded-lg">
                                <ToggleSwitch 
                                    id="sound-scan"
                                    label="스캔 시 효과음"
                                    checked={scanSettings.soundOnScan}
                                    onChange={(checked) => setScanSettings({ soundOnScan: checked })}
                                    color="blue"
                                />
                            </div>
                        </div>

                        {isInstallPromptAvailable && (
                             <div className="mt-4">
                                <ActionButton
                                    onClick={triggerInstallPrompt}
                                    icon={<DevicePhoneMobileIcon className="w-6 h-6" />}
                                    label="앱 설치"
                                    description="홈 화면에 앱을 추가하여 더 빠르게 접근하세요."
                                />
                            </div>
                        )}
                    </CollapsibleCard>

                    <CollapsibleCard title="데이터 소스 설정" icon={<DatabaseIcon className="w-6 h-6 text-gray-500" />}>
                        <div className="space-y-4">
                            <div>
                                <h4 className="font-bold text-gray-700 mb-2">신규 발주</h4>
                                <div className="flex bg-gray-100 rounded-lg p-1">
                                    <button onClick={() => setDataSourceSettings({ newOrder: 'offline' })} className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-colors ${dataSourceSettings.newOrder === 'offline' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>
                                        오프라인 우선
                                    </button>
                                    <button onClick={() => setDataSourceSettings({ newOrder: 'online' })} className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-colors ${dataSourceSettings.newOrder === 'online' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>
                                        온라인 우선
                                    </button>
                                </div>
                            </div>
                            <div>
                                <h4 className="font-bold text-gray-700 mb-2">상품 조회</h4>
                                <div className="flex bg-gray-100 rounded-lg p-1">
                                    <button onClick={() => setDataSourceSettings({ productInquiry: 'offline' })} className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-colors ${dataSourceSettings.productInquiry === 'offline' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>
                                        오프라인 우선
                                    </button>
                                    <button onClick={() => setDataSourceSettings({ productInquiry: 'online' })} className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-colors ${dataSourceSettings.productInquiry === 'online' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>
                                        온라인 우선
                                    </button>
                                </div>
                            </div>
                            <div className="border-t border-gray-200/80 my-2 pt-4">
                                <div className="flex justify-between items-center p-3 bg-gray-50/80 rounded-lg">
                                    <ToggleSwitch 
                                        id="auto-switch"
                                        label="통신 신호가 약할 때 자동 오프라인 전환"
                                        checked={dataSourceSettings.autoSwitch}
                                        onChange={(checked) => setDataSourceSettings({ autoSwitch: checked })}
                                        color="blue"
                                    />
                                </div>
                            </div>
                        </div>
                    </CollapsibleCard>

                    <CollapsibleCard title="데이터 동기화" icon={<DatabaseIcon className="w-6 h-6 text-gray-500" />}>
                        <div className="p-4 border border-blue-200 rounded-xl bg-blue-50/50 mb-4">
                            <div className="space-y-3">
                                <p className="text-sm text-center text-blue-800 font-semibold">버튼 하나로 데이터베이스의 모든 상품/거래처 데이터를 한번에 동기화합니다.</p>
                                <button
                                    onClick={handleDbSync}
                                    disabled={isSyncing}
                                    className="relative w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition active:scale-95 disabled:bg-gray-400 disabled:cursor-not-allowed shadow-lg shadow-blue-500/30"
                                >
                                    {isSyncing && syncDataType === 'full' ? (
                                        <div className="absolute inset-0 flex items-center justify-center gap-2">
                                            <SpinnerIcon className="w-5 h-5" />
                                            <span>{syncStatusText}</span>
                                        </div>
                                    ) : (
                                        <>
                                            <DatabaseIcon className="w-6 h-6" />
                                            <span>데이터베이스 직접 동기화</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </CollapsibleCard>
                    
                    <CollapsibleCard title="데이터 관리" icon={<UserCircleIcon className="w-6 h-6 text-gray-500" />}>
                        <ActionButton
                            onClick={openHistoryModal}
                            icon={<HistoryIcon className="w-6 h-6" />}
                            label="동기화 이력 보기"
                            description="최근 데이터 변경 내역을 확인합니다."
                        />

                        <div className="w-full text-left p-3 rounded-lg flex items-center gap-4">
                            <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-gray-100 text-gray-600">
                                <HistoryIcon className="w-6 h-6" />
                            </div>
                            <div className="flex-grow">
                                <label htmlFor="log-retention" className="font-semibold text-gray-800">동기화 로그 보관 기간</label>
                                <p className="text-xs text-gray-500">오래된 동기화 기록을 자동으로 정리합니다.</p>
                            </div>
                            <div className="flex-shrink-0">
                                {isCleaning ? (
                                    <SpinnerIcon className="w-5 h-5 text-blue-500" />
                                ) : (
                                    <select
                                        id="log-retention"
                                        value={logRetentionDays}
                                        onChange={handleRetentionChange}
                                        onClick={(e) => e.stopPropagation()}
                                        className="p-2 border border-gray-300 bg-white rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm"
                                    >
                                        <option value="7">7일</option>
                                        <option value="30">30일</option>
                                        <option value="90">90일</option>
                                        <option value="-1">영구 보관</option>
                                    </select>
                                )}
                            </div>
                        </div>

                         <ActionButton
                            onClick={openClearHistoryModal}
                            icon={<TrashIcon className="w-6 h-6" />}
                            label="발주 내역 정리"
                            description="오래된 발주 내역을 삭제하여 앱을 최적화합니다."
                        />
                        
                        <div className="border-t border-gray-200/80 my-2" />

                        <ActionButton
                            onClick={handleForceFullSync}
                            icon={<DatabaseIcon className="w-6 h-6" />}
                            label="서버 데이터로 강제 동기화"
                            description="서버의 최신 데이터로 기기 전체를 덮어씁니다."
                            disabled={isSyncing}
                        />

                        <p className="text-xs text-red-600 font-semibold px-3 py-1 mt-2">주의: 아래 작업은 되돌릴 수 없습니다.</p>

                        <ActionButton
                            onClick={() => handleReset('customers')}
                            icon={<WarningIcon className="w-6 h-6" />}
                            label="거래처 데이터 초기화"
                            description="모든 거래처 데이터를 영구적으로 삭제합니다."
                            isDestructive={true}
                        />
                        <ActionButton
                            onClick={() => handleReset('products')}
                            icon={<WarningIcon className="w-6 h-6" />}
                            label="상품 데이터 초기화"
                            description="모든 상품 데이터를 영구적으로 삭제합니다."
                            isDestructive={true}
                        />

                        <div className="border-t border-gray-200/80 my-2" />
                        
                        <ActionButton
                            onClick={handleLogout}
                            icon={<LogoutIcon className="w-6 h-6" />}
                            label="로그아웃"
                            description={`현재 ${user?.email} 계정으로 로그인되어 있습니다.`}
                            isDestructive={true}
                        />
                    </CollapsibleCard>
                </div>
            </div>
        </div>
    );
};

export default SettingsPage;