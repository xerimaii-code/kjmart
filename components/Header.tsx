import React, { useState, useEffect } from 'react';
import { useFullscreenStatus } from '../hooks/useFullscreenStatus';
import { ExitFullscreenIcon } from './Icons';

const Header: React.FC = () => {
    const [currentDateTime, setCurrentDateTime] = useState(new Date());
    const isFullscreen = useFullscreenStatus();

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
            <div className="w-6"></div>

            <div className="flex items-baseline space-x-2">
                <p className="text-xs font-semibold text-gray-700">{formatDate(currentDateTime)}</p>
                <p className="text-base font-bold text-gray-900 tabular-nums">{formatTime(currentDateTime)}</p>
            </div>
            
            <div className="w-6 flex items-center justify-center">
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
            </div>
        </header>
    );
};

export default Header;