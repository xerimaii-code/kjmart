import React from 'react';
import { Page } from '../types';
import { HistoryIcon, NewOrderIcon, SettingsIcon, PowerIcon } from './Icons';
import { useUI } from '../context/AppContext';

interface BottomNavProps {
    activePage: Page;
    setActivePage: (page: Page) => void;
}

const NavButton: React.FC<{
    page: Page;
    label: string;
    Icon: React.FC;
    isActive: boolean;
    onClick: (page: Page) => void;
}> = ({ page, label, Icon, isActive, onClick }) => (
    <button
        onClick={() => onClick(page)}
        className={`flex flex-col items-center justify-center h-full w-full mx-1 rounded-lg transition-colors duration-200 ${isActive ? 'text-blue-600 bg-blue-100' : 'text-gray-500 hover:bg-gray-100'}`}
        aria-current={isActive ? 'page' : undefined}
    >
        <Icon />
        <span className={`text-xs mt-1 transition-all ${isActive ? 'font-bold' : 'font-medium'}`}>{label}</span>
    </button>
);

const BottomNav: React.FC<BottomNavProps> = ({ activePage, setActivePage }) => {
    const { showAlert } = useUI();

    const handleAppExit = () => {
        showAlert(
            '앱을 완전히 종료하시겠습니까?',
            () => {
                // This might not work in all browsers due to security restrictions,
                // but it's the most direct way to attempt closing the PWA window.
                window.close();
            },
            '종료',
            'bg-gray-700 hover:bg-gray-800 focus:ring-gray-600'
        );
    };

    return (
        <nav className="w-full bg-white/80 backdrop-blur-xl border-t border-gray-200/60 flex justify-around h-16 items-center flex-shrink-0 shadow-[0_-5px_25px_rgba(0,0,0,0.08)]">
            <div className="flex w-full justify-around items-center h-full px-2 py-2 gap-2">
                <NavButton
                    page="new-order"
                    label="신규발주"
                    Icon={NewOrderIcon}
                    isActive={activePage === 'new-order'}
                    onClick={setActivePage}
                />
                <NavButton
                    page="history"
                    label="발주내역"
                    Icon={HistoryIcon}
                    isActive={activePage === 'history'}
                    onClick={setActivePage}
                />
                <NavButton
                    page="settings"
                    label="설정"
                    Icon={SettingsIcon}
                    isActive={activePage === 'settings'}
                    onClick={setActivePage}
                />
                <button
                    onClick={handleAppExit}
                    className="flex flex-col items-center justify-center h-full w-full mx-1 rounded-lg transition-colors duration-200 text-gray-500 hover:bg-gray-100"
                    aria-label="앱 종료"
                >
                    <PowerIcon />
                    <span className="text-xs mt-1 font-medium">종료</span>
                </button>
            </div>
        </nav>
    );
};

export default BottomNav;