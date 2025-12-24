
import React, { useState, useEffect } from 'react';
import { useFullscreenStatus } from '../hooks/useFullscreenStatus';
import { ExitFullscreenIcon } from './Icons';

const Header: React.FC = () => {
    const isFullscreen = useFullscreenStatus();
    const [currentTime, setCurrentTime] = useState(new Date());

    useEffect(() => {
        const timeTimerId = setInterval(() => setCurrentTime(new Date()), 10000);

        return () => {
            clearInterval(timeTimerId);
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

    return (
        <header id="app-header" className="bg-white/90 backdrop-blur-md px-4 flex justify-between items-center h-14 flex-shrink-0 border-b border-gray-100 sticky top-0 z-30 transition-all duration-300">
            <div className="flex items-center gap-3 min-w-0">
                <h1 className="text-xl font-extrabold text-slate-800 tracking-tight flex-shrink-0">KJ Mart</h1>
            </div>
            
            <div className="flex items-center space-x-3">
                <div className="text-sm font-medium text-slate-500 text-right tabular-nums">
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
                        className="text-slate-400 hover:text-slate-700 rounded-full p-1.5 transition-colors"
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
