import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useDataState, useDataActions, useUIActions, useUIState } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import * as db from '../services/dbService';
import { parseExcelFile, processCustomerData, processProductData } from '../services/dataService';
import { CameraIcon, SpinnerIcon, DevicePhoneMobileIcon, BellIcon, DocumentIcon, GoogleDriveIcon, DownloadIcon, UploadIcon, LogoutIcon, TrashIcon, ArrowLongRightIcon } from '../components/Icons';
import { useLocalStorage } from '../hooks/useLocalStorage';
import ToggleSwitch from '../components/ToggleSwitch';
import * as googleDrive from '../services/googleDriveService';

// --- Types ---
interface SyncSettings {
    fileId: string;
    fileName: string;
    lastSyncTime: string | null; // ISO string for file modification time
    autoSync: boolean;
}

const LoadingSpinner: React.FC = () => (
    <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-20">
        <svg className="animate-spin h-8 w-8 text-sky-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
    </div>
);

// --- Reusable Sync Section Component ---
const SyncSection: React.FC<{
    dataType: 'customer' | 'product';
    title: string;
    description: string;
    settings: SyncSettings | null;
    onSettingsChange: (settings: SyncSettings | null) => void;
    isGoogleApiReady: boolean;
}> = ({ dataType, title, description, settings, onSettingsChange, isGoogleApiReady }) => {
    const [isLoading, setIsLoading] = useState(false);
    const { setCustomers, setProducts } = useDataActions();
    const { showAlert } = useUIActions();
    const customerInputRef = useRef<HTMLInputElement>(null);
    const productInputRef = useRef<HTMLInputElement>(null);

    const processAndShowResult = async (rows: any[], dataType: 'customer' | 'product') => {
        let resultMessage = '';
        if (dataType === 'customer') {
            const { valid, invalidCount, errors } = processCustomerData(rows);
            if (valid.length > 0) {
                await setCustomers(valid);
            }
            resultMessage = `거래처 데이터 가져오기 완료.\n성공: ${valid.length}건, 실패: ${invalidCount}건.`;
            if (invalidCount > 0) {
                const errorSummary = errors.slice(0, 3).join('\n');
                resultMessage += `\n\n[오류 예시]\n${errorSummary}`;
                if (errors.length > 3) resultMessage += `\n...등 ${errors.length - 3}개 추가 오류`;
            }
        } else { // product
            const { valid, invalidCount, errors } = processProductData(rows);
            if (valid.length > 0) {
                await setProducts(valid);
            }
            resultMessage = `상품 데이터 가져오기 완료.\n성공: ${valid.length}건, 실패: ${invalidCount}건.`;
            if (invalidCount > 0) {
                const errorSummary = errors.slice(0, 3).join('\n');
                resultMessage += `\n\n[오류 예시]\n${errorSummary}`;
                if (errors.length > 3) resultMessage += `\n...등 ${errors.length - 3}개 추가 오류`;
            }
        }
        showAlert(resultMessage);
    };
    
    const performSync = useCallback(async (force = false) => {
        if (!settings) {
            showAlert("동기화할 파일이 연결되어 있지 않습니다.");
            return;
        }
        setIsLoading(true);
        try {
            const metadata = await googleDrive.getFileMetadata(settings.fileId);
            const isModified = !settings.lastSyncTime || new Date(metadata.modifiedTime) > new Date(settings.lastSyncTime);

            if (isModified || force) {
                const fileBlob = await googleDrive.getFileContent(settings.fileId);
                const rows = await parseExcelFile(fileBlob);
                await processAndShowResult(rows, dataType);
                onSettingsChange({ ...settings, lastSyncTime: metadata.modifiedTime, fileName: metadata.name });
            } else {
                showAlert("데이터가 이미 최신 상태입니다.");
            }
        } catch (error) {
            if (error instanceof Error && error.message.includes("File not found")) {
                showAlert("연결된 파일을 Google Drive에서 찾을 수 없습니다. 파일이 삭제되었거나 접근 권한이 변경되었을 수 있습니다. 파일을 다시 연결해주세요.");
                onSettingsChange(null); // Unlink the file
            } else if (error instanceof Error && error.message !== "Picker was cancelled.") {
                showAlert(`동기화 실패: ${error.message}`);
            }
        } finally {
            setIsLoading(false);
        }
    }, [settings, dataType, onSettingsChange, showAlert, processAndShowResult]);

    const handleLinkFile = async () => {
        if (!isGoogleApiReady) {
            showAlert("Google Drive 연동이 준비되지 않았습니다. 잠시 후 다시 시도해주세요.");
            return;
        }
        setIsLoading(true);
        try {
            const fileId = await googleDrive.showPicker();
            const metadata = await googleDrive.getFileMetadata(fileId);
            const newSettings: SyncSettings = {
                fileId,
                fileName: metadata.name,
                lastSyncTime: null, // Force first sync
                autoSync: settings?.autoSync ?? true,
            };
            onSettingsChange(newSettings);
            // Immediately sync after linking
            const fileBlob = await googleDrive.getFileContent(fileId);
            const rows = await parseExcelFile(fileBlob);
            await processAndShowResult(rows, dataType);
            // Update last sync time after successful sync
            onSettingsChange({ ...newSettings, lastSyncTime: metadata.modifiedTime });
        } catch (error) {
            if (error instanceof Error && error.message !== "Picker was cancelled.") {
                console.error("Google Drive linking failed:", error);
                showAlert(`파일 연결에 실패했습니다: ${error.message}`);
            }
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleManualFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsLoading(true);
        try {
            const rows = await parseExcelFile(file);
            await processAndShowResult(rows, dataType);
        } catch (error) {
            console.error("Error during file import process:", error);
            showAlert(`파일 처리 중 오류 발생: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (event.target) event.target.value = '';
            setIsLoading(false);
        }
    };
    
    return (
        <div className="py-4 first:pt-0 last:pb-0 relative">
            {isLoading && <div className="absolute inset-0 bg-white/50 z-10" />}
            <h3 className="font-semibold text-slate-800">{title}</h3>
            <p className="text-sm text-slate-500 mt-1 mb-3">{description}</p>
            
            {settings ? (
                <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                        <GoogleDriveIcon className="w-5 h-5 text-gray-700 flex-shrink-0" />
                        <span className="font-semibold">연결된 파일:</span>
                        <span className="truncate font-mono text-xs bg-slate-200 px-2 py-1 rounded" title={settings.fileName}>{settings.fileName}</span>
                    </div>
                    <div className="text-xs text-slate-500">
                        마지막 동기화: {settings.lastSyncTime ? new Date(settings.lastSyncTime).toLocaleString() : '아직 동기화되지 않음'}
                    </div>
                    <div className="border-t border-slate-200 pt-3">
                        <ToggleSwitch
                            id={`autosync-${dataType}`}
                            label="앱 시작 시 자동 동기화"
                            checked={settings.autoSync}
                            onChange={(checked) => onSettingsChange({ ...settings, autoSync: checked })}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2">
                        <button onClick={() => performSync(true)} className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 text-white p-2.5 rounded-md font-bold transition shadow-sm text-sm">
                            <span>수동 동기화</span>
                        </button>
                        <button onClick={handleLinkFile} disabled={!isGoogleApiReady} className="w-full flex items-center justify-center gap-2 bg-slate-600 hover:bg-slate-700 text-white p-2.5 rounded-md font-bold transition shadow-sm disabled:bg-slate-400 text-sm">
                            <span>파일 변경</span>
                        </button>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                     <input type="file" ref={dataType === 'customer' ? customerInputRef : productInputRef} className="hidden" accept=".xlsx, .xls" onChange={handleManualFileUpload}/>
                     <button onClick={() => (dataType === 'customer' ? customerInputRef.current?.click() : productInputRef.current?.click())} className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 text-white p-3 rounded-md font-bold transition shadow-sm">
                        <UploadIcon className="w-5 h-5"/>
                        <span>기기에서 선택</span>
                    </button>
                    <button onClick={handleLinkFile} disabled={!isGoogleApiReady} className="w-full flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-800 text-white p-3 rounded-md font-bold transition shadow-sm disabled:bg-gray-400 disabled:cursor-not-allowed">
                        <GoogleDriveIcon className="w-5 h-5"/>
                        <span>Google Drive 연결</span>
                    </button>
                </div>
            )}
        </div>
    );
};

interface SettingsPageProps {
    isActive: boolean;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ isActive }) => {
    const { selectedCameraId } = useDataState();
    const { setSelectedCameraId, clearOrders } = useDataActions();
    const { isInstallPromptAvailable } = useUIState();
    const { showAlert, triggerInstallPrompt } = useUIActions();
    const { user, logout } = useAuth();
    
    const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
    const [currentCameraSelection, setCurrentCameraSelection] = useState<string>(selectedCameraId || '');
    const [isLoading, setIsLoading] = useState(false);
    const [isStandalone, setIsStandalone] = useState(false);
    const [isGoogleApiReady, setIsGoogleApiReady] = useState(false);
    
    const restoreInputRef = useRef<HTMLInputElement>(null);

    const [vibrateOnScan, setVibrateOnScan] = useLocalStorage<boolean>('setting:vibrateOnScan', true, { deviceSpecific: true });
    const [soundOnScan, setSoundOnScan] = useLocalStorage<boolean>('setting:soundOnScan', true, { deviceSpecific: true });

    const [customerSyncSettings, setCustomerSyncSettings] = useLocalStorage<SyncSettings | null>('google-drive-sync-settings-customer', null, { deviceSpecific: true });
    const [productSyncSettings, setProductSyncSettings] = useLocalStorage<SyncSettings | null>('google-drive-sync-settings-product', null, { deviceSpecific: true });


    useEffect(() => {
        if (isActive) {
            googleDrive.initGoogleApi()
                .then(() => setIsGoogleApiReady(true))
                .catch(err => {
                    console.error("Google API init failed:", err)
                    setIsGoogleApiReady(false);
                });
        }
    }, [isActive]);

    useEffect(() => {
        setCurrentCameraSelection(selectedCameraId || '');
    }, [selectedCameraId]);
    
    useEffect(() => {
        setIsStandalone(
            window.matchMedia('(display-mode: standalone)').matches ||
            (window.navigator as any).standalone === true
        );
    }, []);

    useEffect(() => {
        const loadCameras = async () => {
            if (!isActive) return;
            try {
                // Ensure permissions are granted before enumerating devices
                await navigator.mediaDevices.getUserMedia({ video: true });
                const devices = await navigator.mediaDevices.enumerateDevices();
                const videoDevices = devices.filter(device => device.kind === 'videoinput');
                setCameras(videoDevices);
                 if (videoDevices.length > 0 && !selectedCameraId) {
                    // Set a default camera if none is selected
                    setCurrentCameraSelection(videoDevices[0].deviceId);
                }
            } catch (err) {
                console.error("Error loading cameras:", err);
                if (err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError')) {
                    showAlert("사용 가능한 카메라를 찾을 수 없습니다. 기기에 카메라가 연결되어 있는지 확인해주세요.");
                } else if (err instanceof DOMException && err.name === 'NotAllowedError') {
                    showAlert("카메라 접근 권한이 거부되었습니다. 브라우저 설정에서 권한을 허용해주세요.");
                }
            }
        };
        loadCameras();
    }, [isActive, selectedCameraId, showAlert]);
    
    const handleSaveCamera = () => {
        setSelectedCameraId(currentCameraSelection);
        showAlert("카메라가 저장되었습니다.");
    };
    
    const handleFullBackup = async () => {
        showAlert(
            "모든 데이터를 백업 파일로 다운로드하시겠습니까?",
            async () => {
                setIsLoading(true);
                try {
                    const backupData = await db.createBackup();
                    const blob = new Blob([backupData], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
                    a.download = `kjmart_backup_${date}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    showAlert('백업 파일 다운로드가 시작되었습니다.');
                } catch (error) {
                    console.error("Backup failed:", error);
                    showAlert(error instanceof Error ? error.message : '백업 생성에 실패했습니다.');
                } finally {
                    setIsLoading(false);
                }
            },
            "백업 시작"
        );
    };

    const handleRestoreFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsLoading(true);
        try {
            const jsonString = await file.text();
            await db.restoreFromBackup(jsonString);
            showAlert('데이터가 성공적으로 복원되었습니다. 변경 사항을 적용하려면 앱을 새로고침합니다.', () => window.location.reload());
        } catch (error) {
            console.error("Restore failed:", error);
            showAlert(error instanceof Error ? error.message : '데이터 복원에 실패했습니다.');
        } finally {
            if (event.target) {
                event.target.value = ''; // Reset file input
            }
            setIsLoading(false);
        }
    };
    
    const triggerRestore = () => {
        showAlert(
            "백업 파일로 복원하시겠습니까? 현재 앱의 모든 데이터가 백업 파일의 데이터로 대체됩니다. 이 작업은 되돌릴 수 없습니다.",
            () => {
                restoreInputRef.current?.click();
            },
            "복원하기",
            'bg-orange-500 hover:bg-orange-600 focus:ring-orange-500'
        );
    };

    const handleLogout = () => {
        showAlert(
            '로그아웃 하시겠습니까?',
            logout,
            '로그아웃',
            'bg-red-500 hover:bg-red-600 focus:ring-red-500'
        );
    };

    const handleClearOrders = () => {
        showAlert(
            "모든 발주 내역을 영구적으로 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.",
            async () => {
                setIsLoading(true);
                try {
                    await clearOrders();
                    showAlert("모든 발주 내역이 삭제되었습니다.");
                } catch (error) {
                    console.error("Failed to clear orders:", error);
                    showAlert("발주 내역 삭제에 실패했습니다.");
                } finally {
                    setIsLoading(false);
                }
            },
            "내역 삭제",
            'bg-red-500 hover:bg-red-600 focus:ring-red-500'
        );
    };

    return (
        <div className="h-full overflow-y-auto bg-gray-200 relative pb-10">
            {isLoading && <LoadingSpinner />}
            <input
                type="file"
                ref={restoreInputRef}
                className="hidden"
                accept="application/json"
                onChange={handleRestoreFileSelected}
            />
            <div className="max-w-3xl mx-auto w-full p-4 md:p-6 space-y-8">

                {/* --- 앱 및 기기 설정 (App & Device Settings) --- */}
                <div>
                    <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider px-1 mb-3">앱 및 기기 설정</h2>
                    <div className="space-y-4">
                        <div className="bg-white rounded-xl shadow-lg shadow-slate-300/50">
                            <div className="p-4 flex items-center">
                                <div className="flex-shrink-0 w-10 h-10 bg-slate-200 text-slate-600 rounded-lg flex items-center justify-center">
                                    <CameraIcon className="w-6 h-6"/>
                                </div>
                                <div className="flex-grow ml-4">
                                    <h3 className="font-semibold text-slate-800">바코드 스캔 카메라</h3>
                                    <p className="text-sm text-slate-500">현재 기기에서 스캔에 사용할 카메라를 선택하세요.</p>
                                </div>
                            </div>
                            <div className="px-4 pb-4 space-y-3">
                                <select 
                                    id="camera-select" 
                                    value={currentCameraSelection} 
                                    onChange={e => setCurrentCameraSelection(e.target.value)} 
                                    className="block w-full p-3 border border-slate-300 rounded-md focus:ring-2 focus:ring-sky-500 bg-slate-50 shadow-inner shadow-gray-200/80"
                                    aria-label="사용할 카메라를 선택하세요"
                                >
                                    {cameras.length === 0 && <option value="">사용 가능한 카메라 없음</option>}
                                    {cameras.map((camera, index) => (
                                        <option key={camera.deviceId} value={camera.deviceId}>
                                            {camera.label || `카메라 ${index + 1}`}
                                        </option>
                                    ))}
                                </select>
                                <button 
                                    onClick={handleSaveCamera} 
                                    className="w-full bg-gradient-to-b from-sky-400 to-sky-500 text-white p-3 rounded-md font-bold hover:from-sky-500 hover:to-sky-600 transition shadow-sm disabled:bg-slate-300 disabled:from-slate-300 disabled:to-slate-300"
                                    disabled={!currentCameraSelection}
                                >
                                    선택 카메라로 저장
                                </button>
                            </div>

                             <div className="border-t border-slate-200 px-4 divide-y divide-slate-200">
                                <div className="py-3 flex items-center justify-between">
                                    <label htmlFor="vibrate-toggle" className="flex items-center cursor-pointer flex-grow">
                                        <DevicePhoneMobileIcon className="w-5 h-5 text-slate-500 mr-3" />
                                        <span className="font-medium text-slate-700">스캔 시 진동</span>
                                    </label>
                                    <ToggleSwitch id="vibrate-toggle" checked={vibrateOnScan ?? true} onChange={setVibrateOnScan} label="" size="small" />
                                </div>
                                <div className="py-3 flex items-center justify-between">
                                    <label htmlFor="sound-toggle" className="flex items-center cursor-pointer flex-grow">
                                        <BellIcon className="w-5 h-5 text-slate-500 mr-3" />
                                        <span className="font-medium text-slate-700">스캔 시 효과음</span>
                                    </label>
                                    <ToggleSwitch id="sound-toggle" checked={soundOnScan ?? true} onChange={setSoundOnScan} label="" size="small" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* --- 데이터 동기화 (Data Sync) --- */}
                <div>
                    <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider px-1 mb-3">데이터 동기화</h2>
                    <div className="bg-white rounded-xl shadow-lg shadow-slate-300/50 p-4 divide-y divide-slate-200">
                        <div className="text-center pb-4">
                            <p className="text-sm text-slate-600">Google Drive 파일을 기준으로 앱의 데이터를 업데이트합니다.</p>
                            <div className="mt-2 inline-flex items-center gap-2 text-xs font-semibold bg-slate-100 text-slate-700 px-3 py-1.5 rounded-full">
                                <GoogleDriveIcon className="w-4 h-4" />
                                <span>Google Drive</span>
                                <ArrowLongRightIcon className="w-4 h-4" />
                                <DevicePhoneMobileIcon className="w-4 h-4" />
                                <span>App</span>
                            </div>
                        </div>
                        <SyncSection 
                            dataType="customer"
                            title="거래처 자료 동기화"
                            description="Google Drive에 저장된 XLS 파일과 거래처 데이터를 동기화합니다."
                            settings={customerSyncSettings}
                            onSettingsChange={setCustomerSyncSettings}
                            isGoogleApiReady={isGoogleApiReady}
                        />
                         <SyncSection 
                            dataType="product"
                            title="상품 마스터 동기화"
                            description="Google Drive에 저장된 XLS 파일과 상품 데이터를 동기화합니다."
                            settings={productSyncSettings}
                            onSettingsChange={setProductSyncSettings}
                            isGoogleApiReady={isGoogleApiReady}
                        />
                    </div>
                </div>

                {/* --- 데이터 관리 (Data Management) --- */}
                <div>
                    <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider px-1 mb-3">데이터 관리</h2>
                    <div className="bg-white rounded-xl shadow-lg shadow-slate-300/50 p-4 divide-y divide-slate-200">
                        {/* Backup */}
                        <div className="py-4 first:pt-0 last:pb-0">
                            <h3 className="font-semibold text-slate-800">전체 데이터 백업</h3>
                            <p className="text-sm text-slate-500 mt-1 mb-3">모든 데이터를 로컬 파일로 다운로드합니다.</p>
                            <button onClick={handleFullBackup} className="w-full mt-2 flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white p-3 rounded-md font-bold transition shadow-sm">
                                <DownloadIcon className="w-5 h-5"/>
                                <span>백업 파일 생성</span>
                            </button>
                        </div>
                        {/* Restore */}
                        <div className="py-4 first:pt-0 last:pb-0">
                            <h3 className="font-semibold text-slate-800">백업에서 복원</h3>
                            <p className="text-sm text-slate-500 mt-1 mb-3">로컬 백업 파일에서 모든 데이터를 복원합니다.</p>
                             <button onClick={triggerRestore} className="w-full mt-2 flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white p-3 rounded-md font-bold transition shadow-sm">
                                <UploadIcon className="w-5 h-5"/>
                                <span>파일에서 복원</span>
                             </button>
                        </div>
                        {/* Clear Order History */}
                        <div className="py-4 first:pt-0 last:pb-0">
                            <h3 className="font-semibold text-slate-800 text-red-600">발주 내역 초기화</h3>
                            <p className="text-sm text-slate-500 mt-1 mb-3">모든 발주 기록을 영구적으로 삭제합니다. 거래처 및 상품 데이터는 유지됩니다.</p>
                             <button onClick={handleClearOrders} className="w-full mt-2 flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white p-3 rounded-md font-bold transition shadow-sm">
                                <TrashIcon className="w-5 h-5"/>
                                <span>모든 발주 내역 삭제</span>
                             </button>
                        </div>
                    </div>
                </div>
                
                {/* --- 계정 (Account) --- */}
                <div>
                    <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider px-1 mb-3">계정</h2>
                    <div className="bg-white rounded-xl shadow-lg shadow-slate-300/50 p-4">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <h3 className="font-semibold text-slate-800">로그인된 계정</h3>
                                <p className="text-sm text-slate-500">{user?.email}</p>
                            </div>
                            <div className="flex items-center flex-shrink-0 gap-2">
                                <button
                                    onClick={handleLogout}
                                    className="flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md font-bold transition shadow-sm"
                                    title="로그아웃"
                                >
                                    <LogoutIcon className="w-5 h-5"/>
                                    <span className="hidden sm:inline">로그아웃</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default SettingsPage;