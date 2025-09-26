import React, { useState, useContext, useEffect } from 'react';
import { AppContext } from './context/AppContext';
import Header from './components/Header';
import BottomNav from './components/BottomNav';
import NewOrderPage from './pages/NewOrderPage';
import OrderHistoryPage from './pages/OrderHistoryPage';
import SettingsPage from './pages/SettingsPage';
import AlertModal from './components/AlertModal';
import { OrderIcon } from './components/Icons';

const App: React.FC = () => {
  const { activePage, alert } = useContext(AppContext);
  const [isStarted, setIsStarted] = useState(false);

  const renderPage = () => {
    switch (activePage) {
      case 'new-order':
        return <NewOrderPage />;
      case 'order-history':
        return <OrderHistoryPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <NewOrderPage />;
    }
  };
  
  const handleStartApp = () => {
    setIsStarted(true);
    // Try to enter fullscreen mode on user interaction
    const docEl = document.documentElement;
    if (docEl.requestFullscreen) {
        docEl.requestFullscreen().catch(err => console.log(err));
    } else if ((docEl as any).mozRequestFullScreen) { /* Firefox */
        (docEl as any).mozRequestFullScreen();
    } else if ((docEl as any).webkitRequestFullscreen) { /* Chrome, Safari and Opera */
        (docEl as any).webkitRequestFullscreen();
    } else if ((docEl as any).msRequestFullscreen) { /* IE/Edge */
        (docEl as any).msRequestFullscreen();
    }
  };

  if (!isStarted) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-100 text-center p-4">
        <OrderIcon className="w-24 h-24 text-blue-500 mb-4" />
        <h1 className="text-3xl font-bold mb-2">발주 관리 앱</h1>
        <p className="text-gray-600 mb-8">엑셀 데이터 연동 및 바코드 스캔을 통한 간편한 발주 관리</p>
        <button
          onClick={handleStartApp}
          className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-8 rounded-lg shadow-lg transition-transform transform hover:scale-105"
        >
          앱 시작하기
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <Header />
      <main className="flex-1 overflow-y-auto pb-16">
        {renderPage()}
      </main>
      <BottomNav />
      {alert.isOpen && <AlertModal />}
    </div>
  );
};

export default App;
