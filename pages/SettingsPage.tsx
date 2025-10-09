import React, { useState, useEffect, useRef } from 'react';
import { useData, useUI } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import * as db from '../services/dbService';
import { parseExcelFile, processCustomerData, processProductData } from '../services/dataService';
import { CameraIcon, SpinnerIcon, DevicePhoneMobileIcon, DocumentIcon, ArrowLongRightIcon, DownloadIcon, UploadIcon, ArrowDownTrayIcon, LogoutIcon, TrashIcon } from '../components/Icons';

const LoadingSpinner: React.FC = () => (
    <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-20">
        <svg className="animate-spin h-8 w-8 text-sky-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
    </div>
);

const SettingsPage: React.FC = () => {
    const { 
        selectedCameraId, 
        setSelectedCameraId,
        setCustomers,
        setProducts,
        clearOrders,
    } = useData();
    const { showAlert, triggerInstallPrompt, isInstallPromptAvailable } = useUI();
    const { user, logout } = useAuth();
    
    const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
    const [currentCameraSelection, setCurrentCameraSelection] = useState<string>(selectedCameraId || '');
    const [isLoading, setIsLoading] = useState(false);
    const [isStandalone, setIsStandalone] = useState(false);
    
    const restoreInputRef = useRef<HTMLInputElement>(null);
    const customerInputRef = useRef<HTMLInputElement>(null);
    const productInputRef = useRef<HTMLInputElement>(null);

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
            }
        };
        loadCameras();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    
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
    
    const handleMasterFileSelected = async (
        event: React.ChangeEvent<HTMLInputElement>,
        dataType: 'customer' | 'product'
    ) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsLoading(true);
        try {
            const rows = await parseExcelFile(file);
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
                    if (errors.length > 3) {
                        resultMessage += `\n...등 ${errors.length - 3}개 추가 오류`;
                    }
                }
                showAlert(resultMessage);

            } else { // product
                const { valid, invalidCount, errors } = processProductData(rows);
                if (valid.length > 0) {
                    await setProducts(valid);
                }

                resultMessage = `상품 데이터 가져오기 완료.\n성공: ${valid.length}건, 실패: ${invalidCount}건.`;
                if (invalidCount > 0) {
                    const errorSummary = errors.slice(0, 3).join('\n');
                    resultMessage += `\n\n[오류 예시]\n${errorSummary}`;
                    if (errors.length > 3) {
                        resultMessage += `\n...등 ${errors.length - 3}개 추가 오류`;
                    }
                }
                showAlert(resultMessage);
            }
        } catch (error) {
            console.error("Error during file import process:", error);
            showAlert(`파일 처리 중 오류 발생: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (event.target) {
                event.target.value = ''; // Reset file input
            }
            setIsLoading(false);
        }
    };

    const triggerMasterFileUpload = (type: 'customer' | 'product') => {
        showAlert(
            `XLS 파일로 ${type === 'customer' ? '거래처' : '상품'} 데이터를 가져옵니다. 현재 기기의 데이터는 덮어쓰기 됩니다. 계속하시겠습니까?`,
            () => {
                if (type === 'customer') {
                    customerInputRef.current?.click();
                } else {
                    productInputRef.current?.click();
                }
            },
            "가져오기",
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
                ref={customerInputRef}
                className="hidden"
                accept=".xlsx, .xls"
                onChange={(e) => handleMasterFileSelected(e, 'customer')}
            />
            <input
                type="file"
                ref={productInputRef}
                className="hidden"
                accept=".xlsx, .xls"
                onChange={(e) => handleMasterFileSelected(e, 'product')}
            />
            <input
                type="file"
                ref={restoreInputRef}
                className="hidden"
                accept="application/json"
                onChange={handleRestoreFileSelected}
            />
            <div className="max-w-3xl mx-auto w-full p-4 md:p-6 space-y-8">
                
                {/* --- 초기 데이터 설정 (Initial Data Setup) --- */}
                <div>
                    <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider px-1 mb-3">초기 데이터 설정</h2>
                    <div className="bg-white rounded-xl shadow-lg shadow-slate-300/50 p-4 divide-y divide-slate-200">
                        {/* Customer */}
                        <div className="py-4 first:pt-0 last:pb-0">
                            <h3 className="font-semibold text-slate-800">거래처 자료 등록</h3>
                            <p className="text-sm text-slate-500 mt-1 mb-3">XLS 파일을 통해 모든 거래처 데이터를 한번에 등록/수정합니다.</p>
                            <button onClick={() => triggerMasterFileUpload('customer')} className="w-full mt-2 flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 text-white p-3 rounded-md font-bold transition shadow-sm">
                                <UploadIcon className="w-5 h-5"/>
                                <span>거래처 파일 선택</span>
                            </button>
                        </div>
                        {/* Product */}
                        <div className="py-4 first:pt-0 last:pb-0">
                            <h3 className="font-semibold text-slate-800">상품 마스터 등록</h3>
                            <p className="text-sm text-slate-500 mt-1 mb-3">XLS 파일을 통해 모든 상품 데이터를 한번에 등록/수정합니다.</p>
                            <button onClick={() => triggerMasterFileUpload('product')} className="w-full mt-2 flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 text-white p-3 rounded-md font-bold transition shadow-sm">
                                <UploadIcon className="w-5 h-5"/>
                                <span>상품 파일 선택</span>
                            </button>
                        </div>
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
                                    <p className="text-sm text-slate-500">스캔에 사용할 카메라를 선택하세요.</p>
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