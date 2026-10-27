import React, { useState, useEffect } from 'react';
import { useFullscreenStatus } from '../hooks/useFullscreenStatus';
import { ExitFullscreenIcon, ArrowsPointingOutIcon, CloudArrowDownIcon } from './Icons';

const Header: React.FC = () => {
    const isFullscreen = useFullscreenStatus();
    const [currentTime, setCurrentTime] = useState(new Date());
    const [installPrompt, setInstallPrompt] = useState<any>(() => (window as any).__deferredInstallPrompt || null);
    const [isStandalone, setIsStandalone] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        return (
            window.matchMedia('(display-mode: fullscreen)').matches ||
            window.matchMedia('(display-mode: standalone)').matches ||
            (window.navigator as any).standalone === true
        );
    });

    useEffect(() => {
        const timeTimerId = setInterval(() => setCurrentTime(new Date()), 10000);

        const syncInstallPrompt = () => {
            setInstallPrompt((window as any).__deferredInstallPrompt || null);
        };
        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            (window as any).__deferredInstallPrompt = e;
            setInstallPrompt(e);
        };
        const handleAppInstalled = () => {
            (window as any).__deferredInstallPrompt = null;
            setInstallPrompt(null);
            setIsStandalone(true);
        };
        const standaloneMedia = window.matchMedia('(display-mode: standalone)');
        const handleDisplayModeChange = (e: MediaQueryListEvent) => {
            setIsStandalone(e.matches);
        };

        window.addEventListener('kjmart-install-available', syncInstallPrompt);
        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);
        window.addEventListener('kjmart-app-installed', handleAppInstalled);
        standaloneMedia.addEventListener?.('change', handleDisplayModeChange);

        return () => {
            clearInterval(timeTimerId);
            window.removeEventListener('kjmart-install-available', syncInstallPrompt);
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
            window.removeEventListener('kjmart-app-installed', handleAppInstalled);
            standaloneMedia.removeEventListener?.('change', handleDisplayModeChange);
        };
    }, []);

    const handleInstallApp = async () => {
        const promptEvent = installPrompt || (window as any).__deferredInstallPrompt;
        if (!promptEvent) return;
        try {
            promptEvent.prompt();
            const choiceResult = await promptEvent.userChoice;
            if (choiceResult && choiceResult.outcome === 'accepted') {
                (window as any).__deferredInstallPrompt = null;
                setInstallPrompt(null);
            }
        } catch (e) {
            console.warn('PWA install prompt error:', e);
        }
    };

    const handleEnterFullscreen = async () => {
        (window as any).__userExitedFullscreen = false;
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
        (window as any).__userExitedFullscreen = true;
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
            <div className="flex items-center gap-2.5 min-w-0">
                <h1 className="text-xl font-extrabold text-slate-800 tracking-tight flex-shrink-0">KJ Mart</h1>
                {!isStandalone && installPrompt && (
                    <button
                        type="button"
                        onClick={handleInstallApp}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold shadow-sm active:scale-95 transition-transform"
                        title="주소창 없는 전체화면 앱으로 설치"
                    >
                        <CloudArrowDownIcon className="w-3.5 h-3.5" />
                        <span>앱 설치</span>
                    </button>
                )}
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
