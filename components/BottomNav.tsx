
import React from 'react';
import { Page } from '../types.ts';
import { HistoryIcon, NewOrderIcon, SettingsIcon } from './Icons.tsx';

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
        className={`nav-btn flex flex-col items-center justify-center w-full h-full transition-colors duration-200 ${isActive ? 'text-sky-500' : 'text-slate-500 hover:text-sky-500'}`}
        aria-current={isActive ? 'page' : undefined}
    >
        <Icon />
        <span className={`text-xs mt-1 ${isActive ? 'font-semibold' : 'font-medium'}`}>{label}</span>
    </button>
);

const BottomNav: React.FC<BottomNavProps> = ({ activePage, setActivePage }) => {
    return (
        <nav className="w-full bg-slate-200 border-t border-slate-300 flex justify-around h-16 items-center flex-shrink-0 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
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
        </nav>
    );
};

export default BottomNav;