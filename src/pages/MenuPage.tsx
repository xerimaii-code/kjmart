
import React, { memo, useState, useEffect } from 'react';
import { 
    ChartBarIcon, SearchIcon, PencilSquareIcon, HistoryIcon, 
    UserCircleIcon, CurrencyDollarIcon, BriefcaseIcon, 
    SparklesIcon, SettingsIcon, ChevronRightIcon,
    DocumentIcon, ClipboardIcon, SpinnerIcon, DatabaseIcon, BarcodeScannerIcon,
    StarIcon, TableCellsIcon
} from '../components/Icons';
import { useMiscUI, useAlert, useSyncState } from '../context/AppContext';
import { SW_VERSION } from '../config';

interface MenuPageProps {
    onNavigate: (feature: string) => void;
}

interface MenuButtonProps {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    subText?: string;
    className?: string;
    badge?: number;
}

const MenuButton = memo(({ label, icon, onClick, subText, className, badge }: MenuButtonProps) => {
    return (
        <button 
            onClick={onClick} 
            // Optimized: Removed hover:shadow-md, replaced transition-all with specific properties
            className={`w-full px-2 py-2 rounded-xl border border-slate-100 bg-white flex items-center justify-between active:scale-[0.98] transition-transform duration-100 hover:border-slate-300 group ${className || ''}`}
        >
            <div className="flex items-center gap-2 overflow-hidden flex-grow min-w-0">
                <div className="text-indigo-500 flex-shrink-0 bg-indigo-50/80 p-1.5 rounded-lg group-hover:bg-indigo-100 transition-colors">
                    {/* Icon container kept tight */}
                    {icon}
                </div>
                <div className="text-left flex flex-col justify-center min-w-0 flex-grow">
                    <span className="text-[13px] font-bold text-slate-800 leading-tight mb-0.5 whitespace-nowrap truncate">{label}</span>
                    {subText && <span className="text-[10px] text-slate-400 leading-none truncate font-medium">{subText}</span>}
                </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0 ml-1">
                {badge !== undefined && badge > 0 && (
                    <span className="bg-rose-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full min-w-[1.2rem] text-center shadow-sm animate-pulse">
                        {badge}
                    </span>
                )}
                <ChevronRightIcon className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-400 transition-colors" />
            </div>
        </button>
    );
});

MenuButton.displayName = 'MenuButton';

const SectionHeader: React.FC<{ title: string }> = ({ title }) => (
    <div className="px-1 pt-0.5 mt-0.5 mb-1 flex items-center">
        <span className="text-[9px] font-bold text-slate-400 tracking-wider uppercase">{title}</span>
        <div className="h-px bg-slate-200 flex-grow ml-2"></div>
    </div>
);

const MenuPage: React.FC<MenuPageProps> = ({ onNavigate }) => {
    const { sqlStatus, checkSql, receivingBadgeCount, hasActiveReceivingDraft } = useMiscUI();
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

    useEffect(() => {
        if (sqlStatus === 'unknown' || sqlStatus === 'error') {
            checkSql();
        }
    }, [checkSql, sqlStatus]);

    const iconClass = "w-4 h-4";

    const renderStatusIndicator = () => {
        if (isSyncing) {
            return (
                <div className="flex items-center gap-2 text-indigo-600 animate-pulse">
                    <SpinnerIcon className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-bold truncate">
                        {syncStatusText} {syncProgress > 0 && `(${Math.round(syncProgress)}%)`}
                    </span>
                </div>
            );
        }

        let statusColor = 'bg-slate-400';
        let statusText = '연결 확인 필요';
        
        switch (sqlStatus) {
            case 'connected': 
                statusColor = 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]'; 
                statusText = '서버 온라인'; 
                break;
            case 'error': 
                statusColor = 'bg-rose-500'; 
                statusText = '오프라인 모드'; 
                break;
            case 'checking': 
                statusColor = 'bg-amber-400 animate-pulse'; 
                statusText = '연결 확인 중...'; 
                break;
        }

        return (
            <div className="flex items-center gap-2 text-slate-600">
                <div className="relative">
                    <div className={`w-2 h-2 rounded-full transition-all duration-300 ${statusColor}`} />
                </div>
                <span className={`text-[10px] font-bold transition-colors ${sqlStatus === 'connected' ? 'text-emerald-600' : 'text-slate-500'}`}>
                    {statusText}
                </span>
            </div>
        );
    };

    return (
        <div className="absolute inset-0 bg-slate-50 flex flex-col overflow-hidden">
            <div className="flex-grow flex flex-col px-3 py-3 overflow-y-auto">
                <div className="max-w-7xl mx-auto w-full pb-safe">
                    
                    <div className="mb-2.5">
                        <MenuButton 
                            label="실시간 매출 속보" 
                            icon={<ChartBarIcon className={iconClass} />} 
                            onClick={() => onNavigate('report')}
                            subText="매장 현황 대시보드"
                            className="border-indigo-100 bg-indigo-50/30"
                        />
                    </div>

                    <div className="mb-2.5">
                        <MenuButton 
                            className={`${hasActiveReceivingDraft ? "border-orange-200 bg-orange-50/30" : ""}`}
                            label={hasActiveReceivingDraft ? "입고 (이어서)" : "입고 등록"} 
                            icon={<BarcodeScannerIcon className={iconClass} />} 
                            onClick={() => onNavigate('receiveGoods')}
                            badge={receivingBadgeCount}
                            subText={receivingBadgeCount > 0 ? `미전송 ${receivingBadgeCount}건` : "스캔으로 입고 등록 및 관리"}
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        <div className="flex flex-col gap-1.5">
                            <SectionHeader title="Main Tasks" />
                            <div className="grid grid-cols-2 gap-1.5">
                                <MenuButton 
                                    label="신규 발주" 
                                    icon={<PencilSquareIcon className={iconClass} />} 
                                    onClick={() => onNavigate('newOrder')}
                                />
                                <MenuButton 
                                    label="발주 내역" 
                                    icon={<HistoryIcon className={iconClass} />} 
                                    onClick={() => onNavigate('orderHistory')}
                                />
                            </div>
                             <div className="grid grid-cols-2 gap-1.5">
                                <MenuButton 
                                    label="행사 조회/수정" 
                                    icon={<StarIcon className={iconClass} />} 
                                    onClick={() => onNavigate('eventManagement')}
                                />
                                <MenuButton 
                                    label="신규 행사 등록" 
                                    icon={<PencilSquareIcon className={iconClass} />} 
                                    onClick={() => onNavigate('eventRegistration')}
                                />
                            </div>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <SectionHeader title="Products" />
                            <MenuButton 
                                label="상품 등록/수정" 
                                icon={<DocumentIcon className={iconClass} />} 
                                onClick={() => onNavigate('productEdit')}
                                subText="신상품 및 가격 변경"
                            />
                            <div className="grid grid-cols-2 gap-1.5">
                                <MenuButton 
                                    label="상품 조회" 
                                    icon={<SearchIcon className={iconClass} />} 
                                    onClick={() => onNavigate('productInquiry')}
                                    subText="단순 조회"
                                />
                                <MenuButton 
                                    label="재고 실사" 
                                    icon={<ClipboardIcon className={iconClass} />} 
                                    onClick={() => onNavigate('inventoryAudit')}
                                    subText="전산 재고 조정"
                                />
                            </div>
                        </div>
                        
                        <div className="flex flex-col gap-3 md:gap-2">
                            <div className="flex flex-col gap-1.5">
                                <SectionHeader title="Business" />
                                <MenuButton 
                                    label="매입 내역" 
                                    icon={<TableCellsIcon className={iconClass} />} 
                                    onClick={() => onNavigate('purchaseHistory')}
                                    subText="기간별 입고 조회"
                                />
                                <MenuButton 
                                    label="고객 관리" 
                                    icon={<UserCircleIcon className={iconClass} />} 
                                    onClick={() => onNavigate('customer')}
                                    subText="회원 조회"
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <SectionHeader title="System" />
                                <div className="grid grid-cols-2 gap-1.5">
                                    <MenuButton 
                                        label="설정"
                                        icon={<SettingsIcon className={iconClass} />} 
                                        onClick={() => onNavigate('settings')}
                                    />
                                    <MenuButton 
                                        label="SQL Runner" 
                                        icon={<SparklesIcon className={iconClass} />} 
                                        onClick={() => onNavigate('sqlRunner')}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0 safe-area-pb bg-white border-t border-slate-100 z-10 relative">
                <button
                    type="button"
                    onClick={() => { if(!isSyncing) checkSql(); }}
                    disabled={isSyncing || sqlStatus === 'checking'}
                    className="flex items-center gap-2 rounded-full px-2 py-1 -ml-1 transition-all hover:bg-slate-50 active:bg-slate-100 disabled:opacity-80"
                >
                    <DatabaseIcon className={`w-3.5 h-3.5 ${sqlStatus === 'connected' ? 'text-emerald-500' : 'text-slate-400'}`} />
                    {renderStatusIndicator()}
                </button>

                <div className="absolute left-1/2 -translate-x-1/2 bottom-3 text-[9px] text-slate-300 font-bold font-mono select-none tracking-widest">
                    {SW_VERSION}
                </div>

                <div className="flex items-center gap-1.5 text-[9px] font-semibold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-100">
                    <div className={`w-1 h-1 rounded-full ${isOnline ? 'bg-indigo-400' : 'bg-slate-300'}`}></div>
                    <span>{isOnline ? 'NET ON' : 'NET OFF'}</span>
                </div>
            </div>
        </div>
    );
};

export default MenuPage;