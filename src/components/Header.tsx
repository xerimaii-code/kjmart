import React, { useState, useEffect } from 'react';
import { useFullscreenStatus } from '../hooks/useFullscreenStatus';
import { ExitFullscreenIcon, SpinnerIcon } from './Icons';
import { useSyncState } from '../context/AppContext';

const Header: React.FC = () => {
    const isFullscreen = useFullscreenStatus();
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const { isSyncing } = useSyncState();
    const [currentTime, setCurrentTime] = useState(new Date());

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        const timerId = setInterval(() => setCurrentTime(new Date()), 10000); // Update every 10 seconds

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            clearInterval(timerId);
        };
    }, []);

    const handleExitFullscreen = async () => {
        const exitFullscreen =
            document.exitFullscreen ||
            (document as any).webkitExitFullscreen ||
            (document as any).mozCancelFullScreen ||
            (document as any).msExitFullscreen;
    
        if (document.fullscreenElement && exitFullscreen) {
            try {
                await exitFullscreen.call(document);
            } catch (err) {
                 console.error(`Error attempting to exit fullscreen: ${(err as Error).message}`);
            }
        }
    };
    
    const StatusIndicator = () => (
        <div className="w-4 h-4 flex items-center justify-center">
            {isSyncing ? (
                <SpinnerIcon className="w-4 h-4 text-blue-500" title="데이터 동기화 중..." />
            ) : (
                <div 
                    className={`relative w-2.5 h-2.5 rounded-full transition-colors duration-500 ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`}
                    title={isOnline ? '온라인' : '오프라인'}
                    aria-label={isOnline ? '온라인 상태' : '오프라인 상태'}
                >
                    {isOnline && <div className="absolute inset-0 w-full h-full bg-green-400 rounded-full animate-ping opacity-75"></div>}
                </div>
            )}
        </div>
    );

    return (
        <header id="app-header" className="bg-white/60 backdrop-blur-xl px-4 flex justify-between items-center h-14 flex-shrink-0 border-b border-gray-200/80">
            <div className="flex items-center gap-3">
                <h1 className="text-xl font-extrabold text-gray-800 tracking-tight">발주관리</h1>
                <StatusIndicator />
            </div>
            
            <div className="flex items-center space-x-3">
                <div className="text-sm font-medium text-gray-600 text-right tabular-nums">
                    {currentTime.toLocaleString('ko-KR', {
                        month: '2-digit',
                        day: '2-digit',
                        weekday: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    })}
                </div>
                {isFullscreen && (
                    <button 
                        onClick={handleExitFullscreen}
                        className="text-gray-500 hover:bg-gray-200 rounded-full p-1.5 transition-colors"
                        aria-label="전체화면 종료"
                        title="전체화면 종료"
                    >
                        <ExitFullscreenIcon className="w-5 h-5" />
                    </button>
                )}
            </div>
        </header>
    );
};

export default Header;