import React, { useState, useEffect } from 'react';
import { useFullscreenStatus } from '../hooks/useFullscreenStatus';
import { ExitFullscreenIcon, ArrowsPointingOutIcon } from './Icons';

const Header: React.FC = () => {
    const isFullscreen = useFullscreenStatus();
    const [currentTime, setCurrentTime] = useState(new Date());
    const isStandalone = typeof window !== 'undefined' && (
        window.matchMedia('(display-mode: fullscreen)').matches ||
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true
    );

    useEffect(() => {
        const timeTimerId = setInterval(() => setCurrentTime(new Date()), 10000);

        return () => {
            clearInterval(timeTimerId);
        };
    }, []);

    const handleEnterFullscreen = async () => {
        const docEl = document.documentElement as any;
        const requestFullscreen =
            docEl.requestFullscreen ||
            docEl.webkitRequestFullscreen ||
            docEl.mozRequestFullScreen ||
            docEl.msRequestFullscreen;

        if (!document.fullscreenElement && requestFullscreen) {
            try {
                await requestFullscreen.call(docEl, { navigationUI: 'hide' });
            } catch (err) {
                try {
                    await requestFullscreen.call(docEl);
                } catch (e) {
                    console.warn(`Fullscreen request failed: ${(e as Error).message}`);
                }
            }
        }
    };

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
        <header id="app-header" className="bg-white px-4 flex justify-between items-center h-14 flex-shrink-0 border-b border-gray-200 sticky top-0 z-30">
            <div className="flex items-center gap-3 min-w-0">
                <h1 className="text-xl font-extrabold text-slate-800 tracking-tight flex-shrink-0">KJ Mart</h1>
            </div>
            
            <div className="flex items-center space-x-2">
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
                {isFullscreen ? (
                    <button 
                        onClick={handleExitFullscreen}
                        className="text-slate-400 hover:text-slate-700 rounded-full p-1.5 transition-colors"
                        aria-label="전체화면 종료"
                        title="전체화면 종료"
                    >
                        <ExitFullscreenIcon className="w-5 h-5" />
                    </button>
                ) : !isStandalone && (
                    <button 
                        onClick={handleEnterFullscreen}
                        className="text-slate-400 hover:text-indigo-600 rounded-full p-1.5 transition-colors"
                        aria-label="전체화면 전환"
                        title="주소줄 숨기기 (전체화면)"
                    >
                        <ArrowsPointingOutIcon className="w-5 h-5" />
                    </button>
                )}
            </div>
        </header>
    );
};

export default Header;
