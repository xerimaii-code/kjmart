
import React, { useState, useEffect } from 'react';
import { useDeviceSettings, useDataActions, useAlert, usePWAInstall, useModals, useSyncState } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { CameraIcon, SpinnerIcon, DevicePhoneMobileIcon, LogoutIcon, TrashIcon, DatabaseIcon, UserCircleIcon, WarningIcon, SettingsIcon, ShieldCheckIcon } from '../components/Icons';
import ToggleSwitch from '../components/ToggleSwitch';
import CollapsibleCard from '../components/CollapsibleCard';

interface SettingsPageProps {
    isActive: boolean;
}

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
        dataSourceSettings,
        allowDestructiveQueries,
        setSelectedCameraId, 
        setScanSettings,
        setDataSourceSettings,
        setAllowDestructiveQueries,
    } = useDeviceSettings();

    const { resetData, syncWithDb } = useDataActions();
    const { showAlert, showToast } = useAlert();
    const { logout, user } = useAuth();
    const { openClearHistoryModal } = useModals();
    const { isInstallPromptAvailable, triggerInstallPrompt } = usePWAInstall();
    const { isSyncing, syncDataType, syncStatusText } = useSyncState();
    const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
    const [syncType, setSyncType] = useState<'incremental' | 'full'>('incremental');

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
            `모든 로컬 ${typeKorean} 데이터를 초기화하시겠습니까?\n이 작업은 기기에 저장된 데이터만 삭제하며, 다음 동기화 시 서버에서 다시 데이터를 불러옵니다.`,
            () => resetData(dataType),
            '초기화',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    };

    const handleDbSync = () => {
        const syncTypeName = syncType === 'incremental' ? '증분' : '전체';
        showAlert(
            `데이터베이스에서 ${syncTypeName} 동기화를 실행하시겠습니까?\n이 작업은 시간이 걸릴 수 있습니다.`,
            async () => {
                try {
                    await syncWithDb(syncType);
                } catch (e) {
                    // error is already handled by syncWithDb
                }
            },
            "동기화 실행",
            'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
        );
    };

    const handleAllowDestructiveChange = async (checked: boolean) => {
        await setAllowDestructiveQueries(checked);
        showToast(`데이터 변경 쿼리 ${checked ? '허용' : '제한'}으로 설정되었습니다.`, 'success');
    };

    return (
        <div className="h-full flex flex-col bg-gray-50">
            <div className="scrollable-content">
                <div className="p-3 space-y-4 max-w-2xl mx-auto w-full">

                    <CollapsibleCard title="설정 (기기별 적용)" icon={<SettingsIcon className="w-6 h-6 text-gray-500" />} initiallyOpen={true}>
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

                        <div className="border-t border-gray-200/80 pt-4 mt-4">
                            <h4 className="text-base font-bold text-gray-700 mb-3">데이터 소스</h4>
                             <div>
                                <h5 className="font-semibold text-gray-700 mb-2 text-sm">신규 발주</h5>
                                <div className="flex bg-gray-100 rounded-lg p-1">
                                    <button onClick={() => setDataSourceSettings({ newOrder: 'offline' })} className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-colors ${dataSourceSettings.newOrder === 'offline' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>
                                        오프라인 우선
                                    </button>
                                    <button onClick={() => setDataSourceSettings({ newOrder: 'online' })} className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-colors ${dataSourceSettings.newOrder === 'online' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>
                                        온라인 우선
                                    </button>
                                </div>
                            </div>
                            <div className="mt-4">
                                <h5 className="font-semibold text-gray-700 mb-2 text-sm">상품 조회</h5>
                                <div className="flex bg-gray-100 rounded-lg p-1">
                                    <button onClick={() => setDataSourceSettings({ productInquiry: 'offline' })} className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-colors ${dataSourceSettings.productInquiry === 'offline' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>
                                        오프라인 우선
                                    </button>
                                    <button onClick={() => setDataSourceSettings({ productInquiry: 'online' })} className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-colors ${dataSourceSettings.productInquiry === 'online' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>
                                        온라인 우선
                                    </button>
                                </div>
                            </div>
                            <div className="mt-4 pt-4 border-t border-gray-200/80">
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

                    <CollapsibleCard title="데이터 동기화" icon={<DatabaseIcon className="w-6 h-6 text-gray-500" />} initiallyOpen>
                        <div className="p-4 border border-blue-200 rounded-xl bg-blue-50/50 mb-4">
                            <div className="space-y-4">
                                <div>
                                    <div className="flex bg-gray-200/70 rounded-lg p-1">
                                        <button 
                                            onClick={() => setSyncType('incremental')} 
                                            className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-all duration-300 ${
                                                syncType === 'incremental' ? 'bg-white text-blue-600 shadow' : 'text-gray-600 hover:bg-white/50'
                                            }`}
                                        >
                                            증분 동기화
                                        </button>
                                        <button 
                                            onClick={() => setSyncType('full')} 
                                            className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-all duration-300 ${
                                                syncType === 'full' ? 'bg-white text-blue-600 shadow' : 'text-gray-600 hover:bg-white/50'
                                            }`}
                                        >
                                            전체 동기화
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-600 mt-2 text-center px-2">
                                        {syncType === 'incremental' 
                                            ? '마지막 동기화 이후 변경된 데이터만 가져옵니다. (빠름)'
                                            : '모든 데이터를 새로 가져옵니다. 데이터가 맞지 않을 때 사용하세요.'
                                        }
                                    </p>
                                </div>
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
                                            <span>데이터베이스 {syncType === 'incremental' ? '증분' : '전체'} 동기화</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </CollapsibleCard>
                    
                    <CollapsibleCard title="데이터 관리" icon={<UserCircleIcon className="w-6 h-6 text-gray-500" />}>
                         <ActionButton
                            onClick={openClearHistoryModal}
                            icon={<TrashIcon className="w-6 h-6" />}
                            label="발주 내역 정리"
                            description="오래된 발주 내역을 삭제하여 앱을 최적화합니다."
                        />
                        
                        <div className="border-t border-gray-200/80 pt-4 mt-4">
                            <h4 className="text-base font-bold text-gray-700 mb-3 flex items-center gap-2">
                                <ShieldCheckIcon className="w-5 h-5 text-gray-400" />
                                <span>SQL 실행 설정 (전체 사용자 적용)</span>
                            </h4>
                            <div className="flex justify-between items-center p-3 bg-gray-50/80 rounded-lg">
                                <div>
                                    <p className="text-sm font-medium text-gray-800">데이터 변경 쿼리 허용</p>
                                    <p className="text-xs text-gray-500 mt-1">INSERT, DELETE, UPDATE 쿼리 허용</p>
                                </div>
                                <ToggleSwitch 
                                    id="allow-destructive"
                                    label=""
                                    checked={allowDestructiveQueries}
                                    onChange={handleAllowDestructiveChange}
                                    color="red"
                                />
                            </div>
                            <div className="p-3 mt-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
                                <strong>주의:</strong> 이 설정은 모든 사용자에게 적용됩니다. 활성화 시 데이터 손실의 위험이 있습니다.
                            </div>
                        </div>
                        
                        <div className="border-t border-gray-200/80 my-2" />

                        <p className="text-xs text-red-600 font-semibold px-3 py-1">주의: 아래 작업은 되돌릴 수 없습니다.</p>

                        <ActionButton
                            onClick={() => handleReset('customers')}
                            icon={<WarningIcon className="w-6 h-6" />}
                            label="거래처 데이터 초기화 (로컬)"
                            description="이 기기의 모든 거래처 캐시 데이터를 삭제합니다."
                            isDestructive={true}
                        />
                        <ActionButton
                            onClick={() => handleReset('products')}
                            icon={<WarningIcon className="w-6 h-6" />}
                            label="상품 데이터 초기화 (로컬)"
                            description="이 기기의 모든 상품 캐시 데이터를 삭제합니다."
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
