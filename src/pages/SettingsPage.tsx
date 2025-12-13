
import React, { useState, useEffect } from 'react';
import { useDeviceSettings, useDataActions, useAlert, usePWAInstall, useModals, useSyncState } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { DevicePhoneMobileIcon, LogoutIcon, DatabaseIcon, ShieldCheckIcon, SpinnerIcon, CloudArrowDownIcon, CheckSquareIcon, CancelSquareIcon } from '../components/Icons';
import ToggleSwitch from '../components/ToggleSwitch';
import { getReceivingBatchesByDateRange } from '../services/dbService';
import { saveOrUpdateBatch } from '../services/receiveDbService';
import { ReceivingBatch } from '../types';
import ActionModal from '../components/ActionModal';

interface SettingsPageProps {
    isActive: boolean;
}

// 심플한 섹션 컴포넌트
const SettingsSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="mb-4">
        <h3 className="text-xs font-bold text-gray-500 px-1 mb-2 ml-1 uppercase tracking-wider">{title}</h3>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden divide-y divide-gray-100">
            {children}
        </div>
    </div>
);

// 설정 항목 행 컴포넌트
const SettingsRow: React.FC<{ 
    label: string; 
    subLabel?: string; 
    children: React.ReactNode; 
    onClick?: () => void;
    isDestructive?: boolean;
}> = ({ label, subLabel, children, onClick, isDestructive }) => (
    <div 
        onClick={onClick}
        className={`flex items-center justify-between p-4 ${onClick ? 'cursor-pointer active:bg-gray-50' : ''}`}
    >
        <div className="flex flex-col">
            <span className={`text-sm font-bold ${isDestructive ? 'text-red-600' : 'text-gray-800'}`}>{label}</span>
            {subLabel && <span className="text-xs text-gray-400 mt-0.5">{subLabel}</span>}
        </div>
        <div className="flex-shrink-0 ml-4">
            {children}
        </div>
    </div>
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

    // 입고 백업 불러오기 관련 State
    const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
    const [loadDate, setLoadDate] = useState(new Date().toISOString().slice(0, 10));
    const [remoteBatches, setRemoteBatches] = useState<ReceivingBatch[]>([]);
    const [isLoadingRemote, setIsLoadingRemote] = useState(false);
    const [selectedRemoteBatches, setSelectedRemoteBatches] = useState<Set<number>>(new Set());

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

    // 입고 백업 불러오기 핸들러
    const handleFetchRemoteBatches = async () => {
        setIsLoadingRemote(true);
        setRemoteBatches([]);
        setSelectedRemoteBatches(new Set());
        try {
            const data = await getReceivingBatchesByDateRange(loadDate, loadDate);
            setRemoteBatches(data);
            if (data.length === 0) {
                showToast('해당 날짜에 저장된 입고 내역이 없습니다.', 'error');
            }
        } catch (e) {
            console.error(e);
            showAlert('서버에서 데이터를 불러오는데 실패했습니다.');
        } finally {
            setIsLoadingRemote(false);
        }
    };

    const handleImportBatches = async () => {
        if (selectedRemoteBatches.size === 0) return;
        const toImport = remoteBatches.filter(b => selectedRemoteBatches.has(b.id));
        try {
            const now = Date.now();
            for (let i = 0; i < toImport.length; i++) {
                const batch = toImport[i];
                // [FIX] Restore as a NEW draft with a new ID.
                // This prevents the "Auto-delete sent items" logic in ReceiveManagerPage from immediately deleting it upon sync.
                const restoredBatch: ReceivingBatch = {
                    ...batch,
                    id: now + i, // New Unique ID
                    status: 'draft', // Reset status to draft so it's editable and visible
                    sentAt: undefined // Clear sent timestamp
                };
                await saveOrUpdateBatch(restoredBatch);
            }
            showToast(`${toImport.length}건을 미전송 상태로 복원했습니다. 입고 등록 메뉴를 확인하세요.`, 'success');
            setIsLoadModalOpen(false);
        } catch (e) {
            console.error(e);
            showAlert('저장 중 오류가 발생했습니다.');
        }
    };

    const toggleRemoteSelect = (id: number) => {
        const newSet = new Set(selectedRemoteBatches);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedRemoteBatches(newSet);
    };

    return (
        <div className="h-full flex flex-col bg-gray-50">
            <div className="scrollable-content p-4">
                <div className="max-w-xl mx-auto w-full">
                    
                    {/* 1. 기기 및 스캔 설정 */}
                    <SettingsSection title="기기 및 스캔">
                        <SettingsRow label="기본 카메라" subLabel="바코드 스캔 시 사용할 카메라">
                            <select 
                                value={selectedCameraId || 'default'} 
                                onChange={handleCameraChange}
                                className="p-1.5 text-sm border border-gray-300 bg-gray-50 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 max-w-[150px]"
                            >
                                <option value="default">시스템 기본값</option>
                                {cameras.map((camera, index) => (
                                    <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `카메라 ${index + 1}`}</option>
                                ))}
                            </select>
                        </SettingsRow>
                        <SettingsRow label="스캔 성공 시 진동">
                            <ToggleSwitch 
                                id="vibrate-scan"
                                label=""
                                checked={scanSettings.vibrateOnScan}
                                onChange={(checked) => setScanSettings({ vibrateOnScan: checked })}
                                color="blue"
                            />
                        </SettingsRow>
                        <SettingsRow label="스캔 성공 시 효과음">
                            <ToggleSwitch 
                                id="sound-scan"
                                label=""
                                checked={scanSettings.soundOnScan}
                                onChange={(checked) => setScanSettings({ soundOnScan: checked })}
                                color="blue"
                            />
                        </SettingsRow>
                        <SettingsRow label="스캔 버튼 사용" subLabel="화면 터치 시에만 스캔 활성화">
                            <ToggleSwitch 
                                id="use-scan-button"
                                label=""
                                checked={scanSettings.useScannerButton}
                                onChange={(checked) => setScanSettings({ useScannerButton: checked })}
                                color="blue"
                            />
                        </SettingsRow>
                    </SettingsSection>

                    {/* 3. 데이터 소스 설정 */}
                    <SettingsSection title="데이터 연결 모드">
                        <div className="p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-bold text-gray-800">신규 발주 모드</span>
                                <div className="flex bg-gray-100 rounded-lg p-0.5">
                                    <button onClick={() => setDataSourceSettings({ newOrder: 'offline' })} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${dataSourceSettings.newOrder === 'offline' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}>오프라인</button>
                                    <button onClick={() => setDataSourceSettings({ newOrder: 'online' })} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${dataSourceSettings.newOrder === 'online' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}>온라인</button>
                                </div>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-bold text-gray-800">상품 조회 모드</span>
                                <div className="flex bg-gray-100 rounded-lg p-0.5">
                                    <button onClick={() => setDataSourceSettings({ productInquiry: 'offline' })} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${dataSourceSettings.productInquiry === 'offline' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}>오프라인</button>
                                    <button onClick={() => setDataSourceSettings({ productInquiry: 'online' })} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${dataSourceSettings.productInquiry === 'online' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}>온라인</button>
                                </div>
                            </div>
                        </div>
                        <SettingsRow label="자동 오프라인 전환" subLabel="인터넷 연결 불안정 시 자동으로 전환">
                            <ToggleSwitch 
                                id="auto-switch"
                                label=""
                                checked={dataSourceSettings.autoSwitch}
                                onChange={(checked) => setDataSourceSettings({ autoSwitch: checked })}
                                color="blue"
                            />
                        </SettingsRow>
                    </SettingsSection>

                    {/* 4. 데이터 동기화 */}
                    <SettingsSection title="데이터 동기화">
                        <div className="p-4 bg-blue-50/50">
                            <div className="flex gap-2 mb-3">
                                <button 
                                    onClick={() => setSyncType('incremental')} 
                                    className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all ${syncType === 'incremental' ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-500'}`}
                                >
                                    증분 동기화 (빠름)
                                </button>
                                <button 
                                    onClick={() => setSyncType('full')} 
                                    className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all ${syncType === 'full' ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-500'}`}
                                >
                                    전체 동기화 (초기화)
                                </button>
                            </div>
                            <button
                                onClick={handleDbSync}
                                disabled={isSyncing}
                                className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 text-white rounded-lg font-bold shadow-md active:scale-95 disabled:bg-gray-400 transition-colors"
                            >
                                {isSyncing ? (
                                    <>
                                        <SpinnerIcon className="w-4 h-4 animate-spin" />
                                        <span>{syncStatusText}</span>
                                    </>
                                ) : (
                                    <>
                                        <DatabaseIcon className="w-4 h-4" />
                                        <span>동기화 실행</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </SettingsSection>

                    {/* 5. 데이터 관리 (위험 구역) */}
                    <SettingsSection title="데이터 관리">
                        <SettingsRow label="발주 내역 정리" subLabel="오래된 발주 내역을 삭제합니다" onClick={openClearHistoryModal}>
                            <div className="p-2 bg-gray-100 rounded-full text-gray-500">
                                <span className="text-xs font-bold px-1">정리</span>
                            </div>
                        </SettingsRow>
                        
                        <SettingsRow label="입고 백업 불러오기" subLabel="서버에 저장된 입고 내역을 복구합니다" onClick={() => setIsLoadModalOpen(true)}>
                            <div className="p-2 bg-blue-50 rounded-full text-blue-600">
                                <CloudArrowDownIcon className="w-5 h-5" />
                            </div>
                        </SettingsRow>

                        <div className="flex border-t border-gray-100">
                            <button onClick={() => handleReset('customers')} className="flex-1 p-4 text-sm font-bold text-red-600 hover:bg-red-50 transition-colors border-r border-gray-100">
                                거래처 초기화
                            </button>
                            <button onClick={() => handleReset('products')} className="flex-1 p-4 text-sm font-bold text-red-600 hover:bg-red-50 transition-colors">
                                상품 초기화
                            </button>
                        </div>
                    </SettingsSection>

                    {/* 6. 시스템 설정 */}
                    <SettingsSection title="시스템">
                        <SettingsRow label="SQL 쓰기 허용 (위험)" subLabel="INSERT, DELETE, UPDATE 쿼리 실행 허용">
                            <div className="flex items-center gap-2">
                                <ShieldCheckIcon className="w-4 h-4 text-orange-500" />
                                <ToggleSwitch 
                                    id="allow-destructive"
                                    label=""
                                    checked={allowDestructiveQueries}
                                    onChange={handleAllowDestructiveChange}
                                    color="red"
                                />
                            </div>
                        </SettingsRow>
                        {isInstallPromptAvailable && (
                            <SettingsRow label="앱 설치" subLabel="홈 화면에 앱 아이콘 추가" onClick={triggerInstallPrompt}>
                                <DevicePhoneMobileIcon className="w-6 h-6 text-blue-600" />
                            </SettingsRow>
                        )}
                        <SettingsRow label="로그아웃" subLabel={user?.email || ''} onClick={handleLogout} isDestructive={true}>
                            <LogoutIcon className="w-6 h-6 text-red-500" />
                        </SettingsRow>
                    </SettingsSection>

                    <div className="text-center pb-8 pt-4 text-[10px] text-gray-300 font-mono">
                        Build Version: {process.env.NODE_ENV === 'development' ? 'DEV' : 'PROD'}
                    </div>
                </div>
            </div>

            {/* 입고 백업 불러오기 모달 */}
            <ActionModal
                isOpen={isLoadModalOpen}
                onClose={() => setIsLoadModalOpen(false)}
                title="입고 백업 불러오기"
                disableBodyScroll
                zIndexClass="z-[60]"
            >
                <div className="flex flex-col h-full bg-gray-50">
                    <div className="p-3 bg-white border-b flex gap-2 items-center">
                        <input 
                            type="date" 
                            value={loadDate} 
                            onChange={e => setLoadDate(e.target.value)} 
                            className="flex-grow border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 bg-white shadow-sm"
                        />
                        <button onClick={handleFetchRemoteBatches} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm shadow active:scale-95 whitespace-nowrap hover:bg-blue-700 transition-colors">
                            조회
                        </button>
                    </div>
                    <div className="flex-grow overflow-y-auto p-2">
                        {isLoadingRemote ? (
                            <div className="flex justify-center items-center h-40"><SpinnerIcon className="w-8 h-8 text-blue-500" /></div>
                        ) : remoteBatches.length === 0 ? (
                            <div className="text-center text-gray-400 mt-10">조회된 데이터가 없습니다.</div>
                        ) : (
                            <div className="space-y-2">
                                {remoteBatches.map(batch => (
                                    <div key={batch.id} className={`bg-white p-3 rounded-xl border shadow-sm flex items-center gap-3 cursor-pointer transition-colors ${selectedRemoteBatches.has(batch.id) ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50/10' : 'border-gray-200 hover:bg-gray-50'}`} onClick={() => toggleRemoteSelect(batch.id)}>
                                        <div className="text-gray-400">
                                            {selectedRemoteBatches.has(batch.id) ? <CheckSquareIcon className="w-6 h-6 text-blue-600" /> : <CancelSquareIcon className="w-6 h-6" />}
                                        </div>
                                        <div className="flex-grow">
                                            <div className="flex justify-between items-center mb-1">
                                                <h3 className="font-bold text-gray-800">{batch.supplier.name}</h3>
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${batch.status === 'sent' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                                    {batch.status === 'sent' ? '전송됨' : '작성중'}
                                                </span>
                                            </div>
                                            <div className="text-xs text-gray-500 flex gap-2">
                                                <span>{batch.itemCount}품목</span>
                                                <span className="text-gray-300">|</span>
                                                <span className="font-bold text-gray-700">{batch.totalAmount.toLocaleString()}원</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="p-3 bg-white border-t safe-area-pb">
                        <button 
                            onClick={handleImportBatches} 
                            disabled={selectedRemoteBatches.size === 0}
                            className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold text-lg shadow-md active:scale-95 disabled:bg-gray-400 hover:bg-blue-700 transition-colors"
                        >
                            {selectedRemoteBatches.size}건 기기로 가져오기
                        </button>
                    </div>
                </div>
            </ActionModal>
        </div>
    );
};

export default SettingsPage;
