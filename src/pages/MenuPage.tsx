
import React, { memo } from 'react';
import { 
    ChartBarIcon, SearchIcon, PencilSquareIcon, HistoryIcon, 
    UserCircleIcon, CurrencyDollarIcon, BriefcaseIcon, 
    SparklesIcon, SettingsIcon, ChevronRightIcon 
} from '../components/Icons';
import { useMiscUI, useAlert } from '../context/AppContext';

interface MenuPageProps {
    onNavigate: (feature: string) => void;
}

interface MenuButtonProps {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    color?: string; 
    subText?: string;
    iconBgClass?: string;
    className?: string; // Allow external class injection for flex sizing
}

const MenuButton = memo(({ label, icon, onClick, color, subText, iconBgClass, className }: MenuButtonProps) => {
    // Default icon background logic
    const defaultIconBgClass = color ? 'bg-white/20 text-white' : 'bg-blue-50 text-blue-600';
    const finalIconBgClass = iconBgClass || defaultIconBgClass;
    
    // Text colors
    const titleColor = color ? 'text-white' : 'text-gray-800';
    const subtitleColor = color ? 'text-blue-100' : 'text-gray-400';
    const chevronColor = color ? 'text-white/70' : 'text-gray-400';

    return (
        <button 
            onClick={onClick} 
            className={`w-full px-4 py-2 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between ${color || 'bg-white'} active:scale-98 transition-transform group ${className || ''}`}
        >
            <div className="flex items-center gap-4 overflow-hidden flex-grow">
                <div className={`w-12 h-12 p-3 rounded-xl flex-shrink-0 flex items-center justify-center ${finalIconBgClass}`}>
                    {icon}
                </div>
                <div className="text-left overflow-hidden flex flex-col justify-center">
                    <span className={`text-base sm:text-lg font-bold leading-tight block truncate ${titleColor}`}>{label}</span>
                    {subText && <span className={`text-xs leading-tight block truncate mt-0.5 ${subtitleColor}`}>{subText}</span>}
                </div>
            </div>
            <ChevronRightIcon className={`w-5 h-5 flex-shrink-0 ${chevronColor}`} />
        </button>
    );
});

MenuButton.displayName = 'MenuButton';

const MenuPage: React.FC<MenuPageProps> = ({ onNavigate }) => {
    const { sqlStatus } = useMiscUI();
    const { showToast } = useAlert();

    // Standard icon size
    const iconClass = "w-6 h-6 sm:w-7 sm:h-7";

    return (
        <div className="absolute inset-0 bg-gray-50 flex flex-col overflow-hidden">
            <div className="flex-grow flex flex-col px-4 py-3 h-full overflow-y-auto">
                <div className="max-w-md mx-auto w-full h-full flex flex-col gap-3 pb-safe min-h-[600px]">
                    
                    {/* Group 1: Report & Product */}
                    <div className="flex flex-col gap-3 flex-1 min-h-0">
                        <MenuButton 
                            className="flex-1"
                            label="실시간매출속보" 
                            icon={<ChartBarIcon className={iconClass} />} 
                            onClick={() => onNavigate('report')}
                            subText="오늘의 매출 현황"
                        />
                        <MenuButton 
                            className="flex-1"
                            label="상품조회" 
                            icon={<SearchIcon className={iconClass} />} 
                            onClick={() => onNavigate('productInquiry')}
                            subText="상품 검색 및 재고"
                        />
                    </div>
                    
                    {/* Group 2: Order & Customer (Main Actions) - slightly larger flex ratio */}
                    <div className="flex flex-col gap-3 flex-[1.4] min-h-0">
                        <MenuButton 
                            className="flex-1"
                            label="신규 발주" 
                            icon={<PencilSquareIcon className={iconClass} />} 
                            onClick={() => onNavigate('newOrder')}
                            subText="발주서 작성"
                            // color="bg-blue-600" // Optional: Highlight primary action
                        />
                         <MenuButton 
                            className="flex-1"
                            label="발주 내역" 
                            icon={<HistoryIcon className={iconClass} />} 
                            onClick={() => onNavigate('orderHistory')}
                            subText="발주 내역 확인"
                        />
                        <MenuButton 
                            className="flex-1"
                            label="고객 관리" 
                            icon={<UserCircleIcon className={iconClass} />} 
                            onClick={() => onNavigate('customer')}
                            subText="고객 정보 조회"
                        />
                    </div>

                    {/* Group 3: Analysis & Work */}
                    <div className="flex flex-col gap-3 flex-1 min-h-0">
                         <MenuButton 
                            className="flex-1"
                            label="매입분석" 
                            icon={<CurrencyDollarIcon className={iconClass} />} 
                            onClick={() => showToast('준비 중인 기능입니다.', 'success')}
                            subText="준비중"
                        />
                         <MenuButton 
                            className="flex-1"
                            label="매장업무" 
                            icon={<BriefcaseIcon className={iconClass} />} 
                            onClick={() => showToast('준비 중인 기능입니다.', 'success')}
                            subText="준비중"
                        />
                    </div>
                    
                    {/* Group 4: Settings & SQL (Footer Actions) */}
                    <div className="flex flex-col gap-3 mt-1 flex-shrink-0">
                        <div className="grid grid-cols-2 gap-3">
                            <MenuButton 
                                label="설정"
                                icon={<SettingsIcon className={iconClass} />}
                                onClick={() => onNavigate('settings')}
                                iconBgClass="bg-gray-100 text-gray-600"
                            />
                            <MenuButton 
                                label="SQL Runner"
                                icon={<SparklesIcon className={iconClass} />}
                                onClick={() => onNavigate('sqlRunner')}
                                iconBgClass="bg-blue-50 text-blue-600"
                                subText="AI"
                            />
                        </div>
                    </div>
                </div>
            </div>
            <div className="p-2 text-center text-xs text-gray-400 flex-shrink-0 safe-area-pb bg-gray-50">
                DB 상태: {sqlStatus === 'connected' ? '온라인' : '오프라인/연결 중...'}
            </div>
        </div>
    );
};

export default MenuPage;
