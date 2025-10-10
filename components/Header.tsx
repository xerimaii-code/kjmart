import React, { useState, useEffect } from 'react';
import { useFullscreenStatus } from '../hooks/useFullscreenStatus';
import { ExitFullscreenIcon } from './Icons';

const Header: React.FC = () => {
    const isFullscreen = useFullscreenStatus();
    const [currentDateTime, setCurrentDateTime] = useState(new Date());
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
        const timerId = setInterval(() => {
            setCurrentDateTime(new Date());
        }, 1000);

        return () => {
            clearInterval(timerId);
        };
    }, []);

    const formatDate = (date: Date) => {
        return date.toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            weekday: 'short',
        });
    };
    
    const formatTime = (date: Date) => {
        return date.toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        });
    };

    const handleExitFullscreen = async () => {
        // Add vendor prefixes for cross-browser compatibility
        const exitFullscreen =
            document.exitFullscreen ||
            (document as any).webkitExitFullscreen ||
            (document as any).mozCancelFullScreen ||
            (document as any).msExitFullscreen;
    
        if (document.fullscreenElement && exitFullscreen) {
            try {
                // Not all prefixed versions return a promise, but await is safe.
                await exitFullscreen.call(document);
            } catch (err) {
                 console.error(`Error attempting to exit fullscreen: ${(err as Error).message}`);
            }
        }
    };

    return (
        <header id="app-header" className="bg-gradient-to-b from-white to-gray-100 px-4 flex justify-between items-center h-12 flex-shrink-0 shadow-sm border-b border-gray-200">
            <div className="flex items-center gap-2.5">
                <h1 className="text-lg font-bold text-gray-800">경진마트 발주관리</h1>
                <span 
                    className={`w-3 h-3 rounded-full transition-colors duration-500 ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}
                    title={isOnline ? '온라인' : '오프라인'}
                    aria-label={isOnline ? '온라인 상태' : '오프라인 상태'}
                />
            </div>
            
            <div className="flex items-center space-x-3">
                <div className="text-right">
                    <div className="text-xs font-semibold text-gray-700">{formatDate(currentDateTime)}</div>
                    <div className="text-sm font-bold text-gray-800 tabular-nums">{formatTime(currentDateTime)}</div>
                </div>
                {isFullscreen && (
                    <button 
                        onClick={handleExitFullscreen}
                        className="text-gray-500 hover:bg-gray-200 rounded-full p-1 transition-colors"
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