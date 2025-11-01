import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useDataState, useDataActions, useAlert, usePWAInstall, useModals, useSyncState } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import * as db from '../services/dbService';
import { CameraIcon, SpinnerIcon, DevicePhoneMobileIcon, DocumentIcon, GoogleDriveIcon, LogoutIcon, TrashIcon, DatabaseIcon, HistoryIcon, UserCircleIcon, WarningIcon, SettingsIcon } from '../components/Icons';
import { useLocalStorage } from '../hooks/useLocalStorage';
import ToggleSwitch from '../components/ToggleSwitch';
import * as googleDrive from '../services/googleDriveService';
import CollapsibleCard from '../components/CollapsibleCard';

// --- Types ---
interface SyncSettings {
    fileId: string;
    fileName: string;
    lastSyncTime: string | null; // ISO string for file modification time
    autoSync: boolean;
}

interface SettingsPageProps {
    isActive: boolean;
}

// --- Reusable Sync Section Component ---
const SyncSection: React.FC<{
    dataType: 'customers' | 'products';
}> = ({ dataType }) => {
    const { showToast, showAlert } = useAlert();
    const { syncWithFile } = useDataActions();
    const { isSyncing, syncStatusText, syncDataType, syncSource } = useSyncState();
    const [settings, setSettings] = useLocalStorage<SyncSettings>(`google-drive-sync-settings-${dataType}`, null, { deviceSpecific: true });
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
            setSettings({
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
            
            showToast(`${dataTypeKorean} Google Drive 동기화가 완료되었습니다.`, 'success');
            setSettings({ ...settings, lastSyncTime: metadata.modifiedTime });

        } catch (err: any) {
             if (err.message === 'MASS_DELETION_DETECTED') {
                const { numExisting, numDeletions, proceed } = err.details;
                showAlert(
                    `경고: 대량 삭제가 감지되었습니다.\n\n기존 데이터: ${numExisting.toLocaleString()}건\n결과적으로 ${numDeletions.toLocaleString()}건의 데이터가 삭제됩니다. 계속하시겠습니까?`,
                    async () => {
                        try {
                            await proceed();
                            showToast(`${dataTypeKorean} 동기화가 완료되었습니다.`, 'success');
                            if (settings?.fileId) {
                                const metadata = await googleDrive.getFileMetadata(settings.fileId);
                                setSettings({ ...settings, lastSyncTime: metadata.modifiedTime });
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
                showToast(`${dataTypeKorean} 로컬 파일 동기화가 완료되었습니다.`, 'success');
            } catch (err: any) {
                 if (err.message === 'MASS_DELETION_DETECTED') {
                    const { numExisting, numDeletions, proceed } = err.details;
                    showAlert(
                        `경고: 대량 삭제가 감지되었습니다.\n\n기존 데이터: ${numExisting.toLocaleString()}건\n결과적으로 ${numDeletions.toLocaleString()}건의 데이터가 삭제됩니다. 계속하시겠습니까?`,
                        async () => {
                            try {
                                await proceed();
                                showToast(`${dataTypeKorean} 동기화가 완료되었습니다.`, 'success');
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
            setSettings({ ...settings, autoSync: isChecked });
        }
    };
    
    const handleDisconnect = () => {
        showAlert(
            `'${settings?.fileName}' 파일과의 연결을 해제하시겠습니까? 자동 동기화도 비활성화됩니다.`,
            () => setSettings(null),
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
            {/* Google Drive Sync UI */}
            <div className="p-4 border border-gray-200 rounded-xl bg-gray-50/50">
                <div className="space-y-3">
                     <p className="text-xs text-center text-gray-500 -mt-1">Google Drive의 엑셀 파일과 동기화합니다.</p>
                    {settings?.fileId ? (
                        <>
                            <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-gray-200">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <DocumentIcon className="w-5 h-5 text-gray-500 flex-shrink-0" />
                                    <span className="text-sm text-gray-800 font-medium truncate" title={settings.fileName}>{settings.fileName}</span>
                                </div>
                                <button onClick={handleDisconnect} className="text-xs font-semibold text-red-600 hover:underline flex-shrink-0">연결 해제</button>
                            </div>
                            {settings.lastSyncTime && (
                                <p className="text-xs text-center text-gray-500">
                                    마지막 동기화: {new Date(settings.lastSyncTime).toLocaleString()}
                                </p>
                            )}
                            <div className="p-2.5 bg-white rounded-lg border border-gray-200 flex justify-center">
                                <ToggleSwitch
                                    id={`autosync-${dataType}`}
                                    label="자동 동기화 (미구현)"
                                    checked={settings.autoSync}
                                    onChange={handleAutoSyncToggle}
                                    color="blue"
                                    disabled
                                />
                            </div>
                        </>
                    ) : (
                        <p className="text-sm text-gray-500 text-center py-2">연결된 Google Drive 파일이 없습니다.</p>
                    )}
                    
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={handleSelectFile}
                            disabled={isOperationInProgress}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-300 text-gray-800 font-semibold rounded-lg hover:bg-gray-100 transition active:scale-95 disabled:bg-gray-200 disabled:cursor-not-allowed"
                        >
                            {isPicking ? <SpinnerIcon className="w-5 h-5" /> : <GoogleDriveIcon className="w-5 h-5" />}
                            <span>파일 선택</span>
                        </button>
                        <button
                            onClick={handleSyncFromDrive}
                            disabled={isOperationInProgress || !settings?.fileId}
                            className="relative w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition active:scale-95 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                            {isCurrentSyncForThisType && syncSource === 'drive' ? (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <SpinnerIcon className="w-5 h-5" />
                                </div>
                            ) : (
                                <>
                                    <GoogleDriveIcon className="w-5 h-5" />
                                    <span>동기화</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
             {/* Local File Sync UI */}
             <div className="p-4 border border-gray-200 rounded-xl bg-gray-50/50">
                <div className="space-y-3">
                    <p className="text-xs text-center text-gray-500">기기에 저장된 엑셀 파일로 1회성 동기화를 합니다.</p>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isOperationInProgress}
                        className="relative w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-300 text-gray-800 font-semibold rounded-lg hover:bg-gray-100 transition active:scale-95 disabled:bg-gray-200 disabled:cursor-not-allowed"
                    >
                        {isCurrentSyncForThisType && syncSource === 'local' ? (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <SpinnerIcon className="w-5 h-5" />
                            </div>
                        ) : (
                           <>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                <span>로컬 파일로 동기화</span>
                           </>
                        )}
                    </button>
                </div>
                {isCurrentSyncForThisType && (
                    <div className="mt-3 text-center text-sm text-blue-600 font-medium">
                        <p>{syncStatusText}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

// --- Settings Action Button ---
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
    const { selectedCameraId, scanSettings } = useDataState();
    const { setSelectedCameraId, setScanSettings, resetData } = useDataActions();
    const { showAlert, showToast } = useAlert();
    const { logout, user } = useAuth();
    const { openHistoryModal, openClearHistoryModal } = useModals();
    const { isInstallPromptAvailable, triggerInstallPrompt } = usePWAInstall();
    const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
    
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

                    <CollapsibleCard title="데이터 동기화" icon={<DatabaseIcon className="w-6 h-6 text-gray-500" />}>
                        <SyncSection dataType="customers" />
                        <div className="border-t border-gray-200/80 my-4" />
                        <SyncSection dataType="products" />
                    </CollapsibleCard>
                    
                    <CollapsibleCard title="데이터 관리" icon={<UserCircleIcon className="w-6 h-6 text-gray-500" />}>
                        <ActionButton
                            onClick={openHistoryModal}
                            icon={<HistoryIcon className="w-6 h-6" />}
                            label="동기화 이력 보기"
                            description="최근 데이터 변경 내역을 확인합니다."
                        />
                         <ActionButton
                            onClick={openClearHistoryModal}
                            icon={<TrashIcon className="w-6 h-6" />}
                            label="발주 내역 정리"
                            description="오래된 발주 내역을 삭제하여 앱을 최적화합니다."
                        />

                        <div className="border-t border-gray-200/80 my-2" />
                        <p className="text-xs text-red-600 font-semibold px-3 py-1">주의: 아래 작업은 되돌릴 수 없습니다.</p>

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