import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useDataState, useDataActions, useAlert, usePWAInstall, useModals } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import * as db from '../services/dbService';
import { parseExcelFile, processCustomerData, processProductData } from '../services/dataService';
import { CameraIcon, SpinnerIcon, DevicePhoneMobileIcon, BellIcon, DocumentIcon, GoogleDriveIcon, DownloadIcon, UploadIcon, LogoutIcon, TrashIcon, ArrowLongRightIcon, DatabaseIcon, HistoryIcon } from '../components/Icons';
import { useLocalStorage } from '../hooks/useLocalStorage';
import ToggleSwitch from '../components/ToggleSwitch';
import * as googleDrive from '../services/googleDriveService';
import CollapsibleCard from '../components/CollapsibleCard';

const SyncHistoryModal = lazy(() => import('../components/SyncHistoryModal'));

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
    dataType: 'customer' | 'product';
}> = ({ dataType }) => {
    const { smartSyncCustomers, smartSyncProducts } = useDataActions();
    const { user } = useAuth();
    const { showToast, showAlert } = useAlert();
    const [settings, setSettings] = useLocalStorage<SyncSettings>(`google-drive-sync-settings-${dataType}`, null, { deviceSpecific: true });
    const [isSyncing, setIsSyncing] = useState(false);
    const [isPicking, setIsPicking] = useState(false);
    const [isApiReady, setIsApiReady] = useState(false);

    const dataTypeKorean = dataType === 'customer' ? '거래처' : '상품';

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
                lastSyncTime: null, // Reset sync time on new file selection
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

    const handleSync = async () => {
        if (!settings?.fileId) {
            showToast("먼저 동기화할 파일을 선택해주세요.", 'error');
            return;
        }
         if (!user?.email) {
            showToast("로그인 정보가 없어 동기화를 진행할 수 없습니다.", 'error');
            return;
        }

        setIsSyncing(true);
        try {
            if (!await initializeApi()) return;
            const metadata = await googleDrive.getFileMetadata(settings.fileId);
            const fileBlob = await googleDrive.getFileContent(settings.fileId, metadata.mimeType);
            const rows = await parseExcelFile(fileBlob);
            
            let result;
            if (dataType === 'customer') {
                result = processCustomerData(rows);
                if (result.valid.length > 0) await smartSyncCustomers(result.valid, user.email);
            } else {
                result = processProductData(rows);
                if (result.valid.length > 0) await smartSyncProducts(result.valid, user.email);
            }

            showToast(`${dataTypeKorean} 데이터 동기화가 완료되었습니다.`, 'success');

            if (result.errors.length > 0) {
                 showAlert(`${result.invalidCount}개의 행에서 오류가 발견되어 가져오지 못했습니다.\n\n오류 미리보기:\n${result.errors.slice(0, 5).join('\n')}`);
            }
            
            const newSettings = { ...settings, lastSyncTime: metadata.modifiedTime };
            setSettings(newSettings);

        } catch (err) {
            console.error(`Sync error for ${dataType}:`, err);
            showToast(`${dataTypeKorean} 데이터 동기화 중 오류가 발생했습니다.`, 'error');
        } finally {
            setIsSyncing(false);
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

    return (
        <div className="space-y-4">
            <h3 className="text-base font-bold text-gray-700 flex items-center gap-2">
                <GoogleDriveIcon className="w-6 h-6 text-gray-600" />
                <span>Google Drive {dataTypeKorean} 데이터 동기화</span>
            </h3>

            <div className="relative p-4 border-2 border-gray-200 rounded-xl bg-gray-50/50">
                <div className="space-y-4">
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
                                    label="자동 동기화"
                                    checked={settings.autoSync}
                                    onChange={handleAutoSyncToggle}
                                    color="blue"
                                />
                            </div>
                        </>
                    ) : (
                        <p className="text-sm text-gray-500 text-center py-4">Google Drive에 있는 엑셀 파일을 선택하여 데이터를 동기화하세요.</p>
                    )}
                    
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={handleSelectFile}
                            disabled={isSyncing || isPicking}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-300 text-gray-800 font-semibold rounded-lg hover:bg-gray-100 transition active:scale-95 disabled:bg-gray-200 disabled:cursor-not-allowed"
                        >
                            {isPicking ? (
                                <SpinnerIcon className="w-5 h-5" />
                            ) : (
                                <GoogleDriveIcon className="w-5 h-5" />
                            )}
                            <span className="truncate">
                                {isPicking
                                    ? '인증/선택...'
                                    : settings?.fileId
                                    ? '파일 변경'
                                    : '파일 선택'}
                            </span>
                        </button>
                        <button
                            onClick={handleSync}
                            disabled={!settings?.fileId || isSyncing || isPicking}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-sky-600 text-white font-semibold rounded-lg hover:bg-sky-700 transition active:scale-95 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                            {isSyncing ? (
                                <SpinnerIcon className="w-5 h-5" />
                            ) : (
                                <UploadIcon className="w-5 h-5" />
                            )}
                            <span>동기화</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};


const SettingsPage: React.FC<SettingsPageProps> = ({ isActive }) => {
    const { selectedCameraId, scanSettings } = useDataState();
    const { smartSyncCustomers, smartSyncProducts, setSelectedCameraId, setScanSettings, clearOrders, forceFullSync } = useDataActions();
    const { isInstallPromptAvailable, triggerInstallPrompt } = usePWAInstall();
    const { showAlert, showToast } = useAlert();
    const { openHistoryModal } = useModals();
    const { logout, user } = useAuth();

    const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
    const [cameraPermissionStatus, setCameraPermissionStatus] = useState<'prompt' | 'granted' | 'denied'>('prompt');
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [logRetentionDays, setLogRetentionDays] = useState<number>(30);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [fileImportType, setFileImportType] = useState<'customer' | 'product' | null>(null);
    const [isImporting, setIsImporting] = useState<'customer' | 'product' | null>(null);

    // --- Log Management ---
    useEffect(() => {
        if (isActive) {
            db.getValue<number>('settings/sync-logs/retentionDays', 30).then(days => setLogRetentionDays(days));
        }
    }, [isActive]);

    const handleLogRetentionChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const days = Number(e.target.value);
        setLogRetentionDays(days);
        try {
            await db.setValue('settings/sync-logs/retentionDays', days);
            showToast("동기화 로그 보관 기간이 저장되었습니다.", 'success');
        } catch (err) {
            showToast("설정 저장에 실패했습니다.", 'error');
        }
    };

    const fetchCameras = useCallback(async () => {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(device => device.kind === 'videoinput');
            setCameras(videoDevices);
        } catch (err) {
            console.error("Could not enumerate devices: ", err);
        }
    }, []);

    const requestCameraPermission = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            setCameraPermissionStatus('granted');
            await fetchCameras();
            stream.getTracks().forEach(track => track.stop());
        } catch (err) {
            console.error("Camera permission denied: ", err);
            setCameraPermissionStatus('denied');
            showAlert("카메라 접근 권한이 거부되었습니다. 브라우저 설정에서 권한을 허용해주세요.");
        }
    }, [fetchCameras, showAlert]);

    useEffect(() => {
        if (isActive && navigator.mediaDevices) {
            if (navigator.permissions && navigator.permissions.query) {
                 navigator.permissions.query({ name: 'camera' as PermissionName }).then((status) => {
                    setCameraPermissionStatus(status.state);
                    if (status.state === 'granted') {
                        fetchCameras();
                    }
                    status.onchange = () => {
                        setCameraPermissionStatus(status.state);
                        if (status.state === 'granted') {
                            fetchCameras();
                        } else {
                            setCameras([]);
                        }
                    };
                }).catch(err => {
                    console.warn("Permission query failed.", err)
                });
            }
        }
    }, [isActive, fetchCameras]);

    const handleCameraChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
        const cameraId = event.target.value || null; // Ensure null for "System Default"
        try {
            await setSelectedCameraId(cameraId);
            showToast("카메라 설정이 저장되었습니다.", 'success');
        } catch (error) {
            console.error("Failed to save camera setting:", error);
            showAlert("카메라 설정 저장에 실패했습니다.");
        }
    };
    
    const handleFileImportClick = (type: 'customer' | 'product') => {
        setFileImportType(type);
        fileInputRef.current?.click();
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files.length > 0 && fileImportType) {
            const file = event.target.files[0];
            if (!user?.email) {
                showAlert("로그인 정보가 없어 데이터를 가져올 수 없습니다.");
                return;
            }

            setIsImporting(fileImportType);
            
            try {
                const rows = await parseExcelFile(file);
                
                let result;
                if (fileImportType === 'customer') {
                    result = processCustomerData(rows);
                    await smartSyncCustomers(result.valid, user.email);
                } else {
                    result = processProductData(rows);
                    await smartSyncProducts(result.valid, user.email);
                }
                
                showToast(`데이터 동기화가 완료되었습니다.`, 'success');
                if (result.errors.length > 0) {
                     showAlert(`${result.invalidCount}개의 행에서 오류가 발견되어 가져오지 못했습니다.\n\n오류 미리보기:\n${result.errors.slice(0, 5).join('\n')}`);
                }

            } catch (error) {
                console.error("File processing error:", error);
                const errorMessage = (error instanceof Error) ? error.message : "알 수 없는 오류가 발생했습니다.";
                showAlert(`파일 처리 중 오류가 발생했습니다: ${errorMessage}`);
            } finally {
                setIsImporting(null);
                if(fileInputRef.current) fileInputRef.current.value = "";
            }
        }
    };
    
    const handleBackup = async () => {
        setIsLoading(true);
        setLoadingMessage('백업 파일 생성 중...');
        try {
            await new Promise(resolve => setTimeout(resolve, 50));
            const backupJson = await db.createBackup();
            const blob = new Blob([backupJson], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `kjmart_backup_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast("백업 파일이 다운로드되었습니다.", 'success');
        } catch (error) {
            console.error(error);
            showAlert("백업 생성에 실패했습니다.");
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };

    const handleRestore = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
                 showAlert(
                    "백업 파일을 복원하시겠습니까? 현재 모든 데이터가 백업 파일의 데이터로 대체됩니다. 이 작업은 되돌릴 수 없습니다.",
                    () => {
                        const reader = new FileReader();
                        reader.onload = async (event) => {
                            setIsLoading(true);
                            setLoadingMessage('백업 데이터 복원 중...');
                            try {
                                await new Promise(resolve => setTimeout(resolve, 50));
                                const json = event.target?.result as string;
                                await db.restoreFromBackup(json);
                                showToast("데이터가 성공적으로 복원되었습니다. 앱을 다시 시작하면 적용됩니다.", 'success');
                            } catch (err) {
                                showAlert("백업 복원에 실패했습니다. 파일이 유효한지 확인해주세요.");
                            } finally {
                                setIsLoading(false);
                                setLoadingMessage('');
                            }
                        };
                        reader.readAsText(file);
                    },
                    '복원',
                    'bg-orange-500 hover:bg-orange-600 focus:ring-orange-500'
                );
            }
        };
        input.click();
    };
    
    const handleClearOrders = () => {
        showAlert(
            "모든 발주 내역을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다!",
            () => {
                clearOrders()
                    .then(() => showToast("모든 발주 내역이 삭제되었습니다.", 'success'))
                    .catch(() => showAlert("발주 내역 삭제에 실패했습니다."));
            },
            '모두 삭제',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    };

    const handleForceSync = () => {
        showAlert(
            "이 작업은 서버의 최신 데이터로 로컬 데이터를 덮어씁니다. 계속하시겠습니까?",
            async () => {
                await forceFullSync();
            },
            '강제 동기화',
            'bg-blue-500 hover:bg-blue-600 focus:ring-blue-500'
        );
    };

    return (
        <div className="h-full flex flex-col bg-transparent">
            <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileChange}
                accept=".xlsx, .xls"
            />
            {isLoading && (
                 <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center z-50">
                    <SpinnerIcon className="w-10 h-10 text-blue-500" />
                    {loadingMessage && <p className="mt-4 text-lg font-semibold text-gray-700">{loadingMessage}</p>}
                </div>
            )}
            <div className="fixed-filter p-3 bg-white/60 backdrop-blur-lg border-b border-gray-200/80">
                <div className="max-w-2xl mx-auto w-full">
                    <h2 className="text-xl font-bold text-gray-800">설정</h2>
                </div>
            </div>
            <div className="scrollable-content p-3">
                <div className="space-y-3 max-w-2xl mx-auto w-full">
                    <CollapsibleCard title="앱 설정" icon={<DevicePhoneMobileIcon className="w-5 h-5 text-gray-500"/>} initiallyOpen={true}>
                        <div className="flex items-center justify-between">
                            <label htmlFor="camera-select" className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                <CameraIcon className="w-5 h-5 text-gray-500"/>
                                <span>기본 카메라 선택</span>
                            </label>
                            {cameraPermissionStatus === 'granted' ? (
                                <select
                                    id="camera-select"
                                    value={selectedCameraId || ''}
                                    onChange={handleCameraChange}
                                    className="text-sm border-2 border-gray-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 max-w-[50%] bg-white"
                                >
                                    <option value="">시스템 기본값</option>
                                    {cameras.length > 0 ? (
                                        cameras.map((camera, index) => (
                                            <option key={camera.deviceId} value={camera.deviceId}>
                                                {camera.label || `카메라 ${index + 1}`}
                                            </option>
                                        ))
                                    ) : (
                                        <option disabled>카메라 없음</option>
                                    )}
                                </select>
                            ) : (
                                <button
                                    onClick={requestCameraPermission}
                                    className="text-sm font-semibold text-blue-600 bg-blue-100 px-3 py-1.5 rounded-lg hover:bg-blue-200 transition active:scale-95"
                                >
                                    {cameraPermissionStatus === 'denied' ? '권한 필요' : '카메라 목록 불러오기'}
                                </button>
                            )}
                        </div>
                         {isInstallPromptAvailable && (
                            <button
                                onClick={triggerInstallPrompt}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 transition active:scale-95"
                            >
                                <DownloadIcon className="w-5 h-5" />
                                <span>홈 화면에 앱 설치</span>
                            </button>
                        )}
                    </CollapsibleCard>

                    <CollapsibleCard title="스캔 알림" icon={<BellIcon className="w-5 h-5 text-gray-500"/>}>
                        <div className="flex justify-between items-center bg-gray-50 p-3 rounded-lg">
                             <span className="text-sm font-medium text-gray-700">스캔 시 진동</span>
                             <ToggleSwitch
                                id="vibrate-scan"
                                checked={scanSettings.vibrateOnScan}
                                onChange={(checked) => setScanSettings({ vibrateOnScan: checked })}
                                label=""
                             />
                        </div>
                        <div className="flex justify-between items-center bg-gray-50 p-3 rounded-lg">
                             <span className="text-sm font-medium text-gray-700">스캔 시 효과음</span>
                             <ToggleSwitch
                                id="sound-scan"
                                checked={scanSettings.soundOnScan}
                                onChange={(checked) => setScanSettings({ soundOnScan: checked })}
                                label=""
                             />
                        </div>
                    </CollapsibleCard>

                    <CollapsibleCard title="데이터 관리" icon={<DocumentIcon className="w-5 h-5 text-gray-500"/>}>
                        <div className="pt-4 mt-4 border-t border-gray-200">
                             <div className="flex items-center justify-between">
                                <label htmlFor="log-retention" className="text-sm font-medium text-gray-700">동기화 로그 보관 기간</label>
                                <select
                                    id="log-retention"
                                    value={logRetentionDays}
                                    onChange={handleLogRetentionChange}
                                    className="text-sm border-2 border-gray-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                                >
                                    <option value="7">7일</option>
                                    <option value="30">30일</option>
                                    <option value="90">90일</option>
                                    <option value="-1">영구</option>
                                </select>
                            </div>
                             <button
                                onClick={openHistoryModal}
                                className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 text-gray-800 font-semibold rounded-lg hover:bg-gray-200 transition active:scale-95"
                            >
                                <HistoryIcon className="w-5 h-5" />
                                <span>동기화 이력 보기</span>
                            </button>
                        </div>
                        <div className="pt-4 mt-4 border-t-2 border-dashed border-gray-200">
                            <h4 className="text-sm font-bold text-gray-600 mb-2">강제 동기화</h4>
                            <p className="text-xs text-gray-500 mb-3">
                                서버의 <span className="font-bold">거래처 및 상품</span> 데이터를 로컬 기기로 가져와 덮어씁니다. 데이터가 올바르게 표시되지 않을 때 사용하세요.
                            </p>
                            <button
                                onClick={handleForceSync}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-100 text-blue-800 font-semibold rounded-lg hover:bg-blue-200 transition active:scale-95"
                            >
                                <UploadIcon className="w-5 h-5" />
                                <span>전체 데이터 강제 동기화</span>
                            </button>
                        </div>
                        <div className="pt-4 mt-4 border-t-2 border-dashed border-gray-200">
                            <SyncSection dataType="customer" />
                        </div>
                         <div className="pt-4 mt-4 border-t-2 border-dashed border-gray-200">
                           <SyncSection dataType="product" />
                        </div>
                        <div className="pt-4 mt-4 border-t-2 border-dashed border-gray-200">
                            <h4 className="text-sm font-bold text-gray-600 mb-2">로컬 파일로 데이터 업데이트</h4>
                             <p className="text-xs text-gray-500 mb-3">
                                로컬 엑셀 파일을 사용하여 데이터를 동기화합니다. 이 방식은 데이터 변경 로그를 기록합니다.
                            </p>
                            <div className="grid grid-cols-2 gap-3">
                                 <button
                                    onClick={() => handleFileImportClick('customer')}
                                    disabled={isImporting !== null}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-300 text-gray-800 font-semibold rounded-lg hover:bg-gray-100 transition active:scale-95 disabled:bg-gray-200 disabled:cursor-not-allowed"
                                >
                                    {isImporting === 'customer' ? <SpinnerIcon className="w-5 h-5" /> : <span>거래처 가져오기</span>}
                                </button>
                                <button
                                    onClick={() => handleFileImportClick('product')}
                                    disabled={isImporting !== null}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-300 text-gray-800 font-semibold rounded-lg hover:bg-gray-100 transition active:scale-95 disabled:bg-gray-200 disabled:cursor-not-allowed"
                                >
                                     {isImporting === 'product' ? <SpinnerIcon className="w-5 h-5" /> : <span>상품 가져오기</span>}
                                </button>
                            </div>
                        </div>
                        <div className="pt-4 mt-4 border-t-2 border-dashed border-gray-200">
                            <h4 className="text-sm font-bold text-gray-600 mb-2">백업 및 복원</h4>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={handleBackup}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 transition active:scale-95"
                                >
                                    <DownloadIcon className="w-5 h-5" />
                                    <span>백업</span>
                                </button>
                                <button
                                    onClick={handleRestore}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 transition active:scale-95"
                                >
                                    <UploadIcon className="w-5 h-5" />
                                    <span>복원</span>
                                </button>
                            </div>
                        </div>
                        <div className="pt-4 mt-4 border-t-2 border-dashed border-gray-200">
                            <h4 className="text-sm font-bold text-gray-600 mb-2">데이터 초기화</h4>
                             <p className="text-xs text-gray-500 mb-3">
                                모든 발주 내역을 삭제합니다. 이 작업은 되돌릴 수 없습니다. 거래처 및 상품 데이터는 유지됩니다.
                            </p>
                            <button
                                onClick={handleClearOrders}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-100 text-red-800 font-semibold rounded-lg hover:bg-red-200 transition active:scale-95"
                            >
                                <TrashIcon className="w-5 h-5" />
                                <span>발주 내역 전체 삭제</span>
                            </button>
                        </div>
                         <div className="pt-4 mt-4 border-t-2 border-dashed border-gray-200">
                             <h4 className="text-sm font-bold text-gray-600 mb-2">계정</h4>
                             <div className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
                                <span className="text-sm font-medium text-gray-700">{user?.email}</span>
                                <button onClick={logout} className="text-sm font-semibold text-gray-600 bg-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-300 transition active:scale-95">로그아웃</button>
                            </div>
                        </div>
                    </CollapsibleCard>
                </div>
            </div>
        </div>
    );
};

export default SettingsPage;