
import React, { memo, useState, useEffect } from 'react';
import { 
    ChartBarIcon, SearchIcon, PencilSquareIcon, HistoryIcon, 
    UserCircleIcon, CurrencyDollarIcon, BriefcaseIcon, 
    SparklesIcon, SettingsIcon, ChevronRightIcon,
    DocumentIcon, ClipboardIcon, SpinnerIcon, DatabaseIcon, BarcodeScannerIcon
} from '../components/Icons';
import { useMiscUI, useAlert, useSyncState } from '../context/AppContext';

interface MenuPageProps {
    onNavigate: (feature: string) => void;
}

interface MenuButtonProps {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    subText?: string;
    className?: string;
}

const MenuButton = memo(({ label, icon, onClick, subText, className }: MenuButtonProps) => {
    return (
        <button 
            onClick={onClick} 
            className={`w-full px-2.5 py-3 rounded-xl shadow-sm border border-gray-200 bg-white flex items-center justify-between active:scale-[0.98] transition-all group ${className || ''}`}
        >
            <div className="flex items-center gap-2 overflow-hidden flex-grow min-w-0">
                <div className="text-blue-600 flex-shrink-0 bg-blue-50 p-1.5 rounded-lg">
                    {icon}
                </div>
                <div className="text-left overflow-hidden flex flex-col justify-center min-w-0">
                    <span className="text-[15px] font-bold text-gray-800 leading-none mb-0.5 whitespace-nowrap truncate">{label}</span>
                    {subText && <span className="text-[11px] text-gray-400 leading-none truncate">{subText}</span>}
                </div>
            </div>
            <ChevronRightIcon className="w-4 h-4 flex-shrink-0 text-gray-300 ml-1" />
        </button>
    );
});

MenuButton.displayName = 'MenuButton';

const MenuPage: React.FC<MenuPageProps> = ({ onNavigate }) => {
    const { sqlStatus, checkSql } = useMiscUI();
    const { showToast } = useAlert();
    const { isSyncing, syncStatusText, syncProgress } = useSyncState();
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Standard icon size
    const iconClass = "w-5 h-5";

    const handleNotImplemented = (featureName: string) => {
        showToast(`'${featureName}' 메뉴는 준비 중입니다.`, 'success');
    };

    // 상태 표시 로직 통합
    const renderStatusIndicator = () => {
        if (isSyncing) {
            return (
                <div className="flex items-center gap-2 text-blue-600 animate-pulse">
                    <SpinnerIcon className="w-4 h-4" />
                    <span className="text-xs font-bold truncate">
                        {syncStatusText} {syncProgress > 0 && `(${Math.round(syncProgress)}%)`}
                    </span>
                </div>
            );
        }

        let statusColor = 'bg-gray-400';
        let statusText = '연결 확인 필요';
        
        switch (sqlStatus) {
            case 'connected': 
                statusColor = 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]'; 
                statusText = '서버 온라인'; 
                break;
            case 'error': 
                statusColor = 'bg-red-500'; 
                statusText = '오프라인 모드'; 
                break;
            case 'checking': 
                statusColor = 'bg-yellow-400 animate-pulse'; 
                statusText = '연결 확인 중...'; 
                break;
        }

        return (
            <div className="flex items-center gap-2 text-gray-600">
                <div className="relative">
                    <div className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${statusColor}`} />
                </div>
                <span className={`text-xs font-bold transition-colors ${sqlStatus === 'connected' ? 'text-green-700' : 'text-gray-600'}`}>
                    {statusText}
                </span>
            </div>
        );
    };

    return (
        <div className="absolute inset-0 bg-gray-50 flex flex-col overflow-hidden">
            <div className="flex-grow flex flex-col px-3 py-2 overflow-y-auto">
                <div className="max-w-md mx-auto w-full flex flex-col gap-2 pb-safe">
                    
                    {/* 1. Dashboard */}
                    <MenuButton 
                        label="실시간 매출 속보" 
                        icon={<ChartBarIcon className={iconClass} />} 
                        onClick={() => onNavigate('report')}
                        subText="매장 현황 대시보드"
                    />
                    
                    {/* 2. Order & Receiving Management */}
                    <div className="flex flex-col gap-2 mt-1">
                        <div className="px-1 pt-1 border-t border-gray-200/50 mt-1">
                            <span className="text-xs font-bold text-gray-400">주요 업무</span>
                        </div>
                        <div className="flex gap-2">
                            <MenuButton 
                                className="flex-1"
                                label="신규 발주" 
                                icon={<PencilSquareIcon className={iconClass} />} 
                                onClick={() => onNavigate('newOrder')}
                            />
                            <MenuButton 
                                className="flex-1"
                                label="발주 내역" 
                                icon={<HistoryIcon className={iconClass} />} 
                                onClick={() => onNavigate('orderHistory')}
                            />
                        </div>
                         <MenuButton 
                            label="입고 등록" 
                            icon={<BarcodeScannerIcon className={iconClass} />} 
                            onClick={() => onNavigate('receiveGoods')}
                        />
                    </div>

                    {/* 3. Product & Stock */}
                    <div className="flex flex-col gap-2 mt-1">
                        <div className="px-1 pt-1 border-t border-gray-200/50 mt-1">
                            <span className="text-xs font-bold text-gray-400">상품 관리</span>
                        </div>
                        <MenuButton 
                            label="상품 등록/수정" 
                            icon={<DocumentIcon className={iconClass} />} 
                            onClick={() => onNavigate('productEdit')}
                            subText="신상품 및 가격 변경"
                        />
                        <MenuButton 
                            label="상품 조회" 
                            icon={<SearchIcon className={iconClass} />} 
                            onClick={() => onNavigate('productInquiry')}
                            subText="단순 조회"
                        />
                        <MenuButton 
                            label="재고 실사" 
                            icon={<ClipboardIcon className={iconClass} />} 
                            onClick={() => handleNotImplemented('재고 실사')}
                            subText="매장/창고 재고 조사 (준비중)"
                        />
                    </div>
                    
                    {/* 4. Business & Customers */}
                    <div className="flex flex-col gap-2 mt-1">
                        <div className="px-1 pt-1 border-t border-gray-200/50 mt-1">
                            <span className="text-xs font-bold text-gray-400">영업/고객</span>
                        </div>
                        <MenuButton 
                            label="고객 관리" 
                            icon={<UserCircleIcon className={iconClass} />} 
                            onClick={() => onNavigate('customer')}
                            subText="회원 조회"
                        />
                        <MenuButton 
                            label="행사 등록" 
                            icon={<CurrencyDollarIcon className={iconClass} />} 
                            onClick={() => handleNotImplemented('행사 등록')}
                            subText="할인 행사 관리 (준비중)"
                        />
                    </div>

                    {/* 5. System */}
                    <div className="flex gap-2 mt-3">
                        <MenuButton 
                            className="flex-1"
                            label="설정"
                            icon={<SettingsIcon className={iconClass} />}
                            onClick={() => onNavigate('settings')}
                        />
                        <MenuButton 
                            className="flex-1"
                            label="SQL Runner" 
                            icon={<SparklesIcon className={iconClass} />} 
                            onClick={() => onNavigate('sqlRunner')}
                        />
                    </div>
                </div>
            </div>
            
            {/* Improved Bottom Status Bar */}
            <div className="flex items-center justify-between px-4 py-3 flex-shrink-0 safe-area-pb bg-white shadow-[0_-2px_10px_rgba(0,0,0,0.05)] border-t border-gray-100 z-10">
                <button
                    type="button"
                    onClick={() => { if(!isSyncing) checkSql(); }}
                    disabled={isSyncing || sqlStatus === 'checking'}
                    className="flex items-center gap-2 rounded-lg px-2 py-1 -ml-2 transition-all hover:bg-gray-50 active:bg-gray-100 disabled:opacity-80"
                >
                    <DatabaseIcon className={`w-4 h-4 ${sqlStatus === 'connected' ? 'text-green-600' : 'text-gray-400'}`} />
                    {renderStatusIndicator()}
                </button>

                <div className="flex items-center gap-2 text-[10px] font-semibold text-gray-400 bg-gray-50 px-2 py-1 rounded-full border border-gray-100">
                    <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-blue-400' : 'bg-gray-300'}`}></div>
                    <span>{isOnline ? 'NET ON' : 'NET OFF'}</span>
                </div>
            </div>
        </div>
    );
};

export default MenuPage;
