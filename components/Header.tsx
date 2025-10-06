import React, { useState, useEffect } from 'react';
import { useFullscreenStatus, useStandaloneStatus } from '../hooks/useFullscreenStatus';
import { useUI } from '../context/AppContext';
import { ExitFullscreenIcon, PowerIcon } from './Icons';

const Header: React.FC = () => {
    const [currentDateTime, setCurrentDateTime] = useState(new Date());
    const isFullscreen = useFullscreenStatus();
    const isStandalone = useStandaloneStatus();
    const { showAlert } = useUI();

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentDateTime(new Date());
        }, 1000);

        return () => {
            clearInterval(timer);
        };
    }, []);

    const handleExitFullscreen = async () => {
        if (document.fullscreenElement) {
            try {
                await document.exitFullscreen();
            } catch (err) {
                 console.error(`Error attempting to exit fullscreen: ${(err as Error).message}`);
            }
        }
    };

    const handleExitApp = () => {
        showAlert(
            '앱을 종료하시겠습니까?',
            () => {
                window.close();
            },
            '종료',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    };

    const formatDate = (date: Date) => {
        return date.toLocaleString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long',
        });
    };
    
    const formatTime = (date: Date) => {
        return date.toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
    };

    return (
        <header id="app-header" className="bg-gradient-to-b from-white to-gray-100 px-4 flex justify-between items-center h-8 flex-shrink-0 shadow-lg">
            {/* Placeholder for centering */}
            <div className="w-12"></div>

            <div className="flex items-baseline space-x-2">
                <p className="text-xs font-semibold text-gray-700">{formatDate(currentDateTime)}</p>
                <p className="text-base font-bold text-gray-900 tabular-nums">{formatTime(currentDateTime)}</p>
            </div>
            
            <div className="w-12 flex items-center justify-end space-x-2">
                {isFullscreen && (
                    <button 
                        onClick={handleExitFullscreen}
                        className="text-gray-500 hover:bg-gray-200 rounded-full p-1 transition-colors"
                        aria-label="전체화면 종료"
                        title="전체화면 종료"
                    >
                        <ExitFullscreenIcon className="w-4 h-4" />
                    </button>
                )}
                {(isStandalone || isFullscreen) && (
                     <button 
                        onClick={handleExitApp}
                        className="text-red-500 hover:bg-red-100 rounded-full p-1 transition-colors"
                        aria-label="앱 종료"
                        title="앱 종료"
                    >
                        <PowerIcon className="w-4 h-4" />
                    </button>
                )}
            </div>
        </header>
    );
};

export default Header;