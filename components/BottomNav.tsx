import React, { useContext } from 'react';
import { AppContext } from '../context/AppContext';
import { OrderIcon, HistoryIcon, SettingsIcon } from './Icons';

const BottomNav: React.FC = () => {
  const { activePage, setActivePage } = useContext(AppContext);

  const navItems = [
    { id: 'new-order', label: '신규발주', icon: OrderIcon },
    { id: 'order-history', label: '발주내역', icon: HistoryIcon },
    { id: 'settings', label: '설정', icon: SettingsIcon },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white shadow-lg border-t border-gray-200 flex justify-around">
      {navItems.map(item => (
        <button
          key={item.id}
          onClick={() => setActivePage(item.id as any)}
          className={`flex flex-col items-center justify-center w-full pt-2 pb-1 text-sm transition-colors duration-200 ${
            activePage === item.id ? 'text-blue-600' : 'text-gray-500 hover:text-blue-500'
          }`}
          aria-current={activePage === item.id ? 'page' : undefined}
        >
          <item.icon className="w-6 h-6 mb-1" />
          <span>{item.label}</span>
          {activePage === item.id && <div className="w-8 h-1 bg-blue-600 rounded-full mt-1"></div>}
        </button>
      ))}
    </nav>
  );
};

export default BottomNav;
