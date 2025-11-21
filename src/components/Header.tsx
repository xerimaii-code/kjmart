import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useFullscreenStatus } from '../hooks/useFullscreenStatus';
import { ExitFullscreenIcon, SpinnerIcon, DatabaseIcon } from './Icons';
import { useSyncState } from '../context/AppContext';
import { checkSqlConnection } from '../services/sqlService';

type SqlServerStatus = 'unknown' | 'connected' | 'error' | 'checking';

const Header: React.FC = () => {
    const isFullscreen = useFullscreenStatus();
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const { isSyncing } = useSyncState();
    const [currentTime, setCurrentTime] = useState(new Date());
    const [sqlStatus, setSqlStatus] = useState<SqlServerStatus>('unknown');
    const isCheckingSql = useRef(false);

    const checkSql = useCallback(async () => {
        if (isCheckingSql.current) return;
        isCheckingSql.current = true;
        setSqlStatus('checking');
        try {
            await checkSqlConnection();
            setSqlStatus('connected');
        } catch (err) {
            console.error("SQL Connection Check Failed:", err);
            setSqlStatus('error');
        } finally {
            isCheckingSql.current = false;
        }
    }, []);

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        const timeTimerId = setInterval(() => setCurrentTime(new Date()), 10000);

        checkSql(); // Initial check
        const sqlTimerId = setInterval(checkSql, 60000); // Check every 60 seconds

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            clearInterval(timeTimerId);
            clearInterval(sqlTimerId);
        };
    }, [checkSql]);

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
    
    const StatusIndicator = () => {
        const getSqlStatusProps = () => {
            switch (sqlStatus) {
                case 'connected': return { color: 'bg-sky-500', title: 'SQL 서버 온라인 (클릭하여 재연결)', ping: true };
                case 'error': return { color: 'bg-red-500', title: 'SQL 서버 연결 실패 (클릭하여 재연결)', ping: false };
                case 'checking': return { color: 'bg-yellow-500', title: 'SQL 서버 확인 중...', ping: false };
                default: return { color: 'bg-gray-400', title: 'SQL 서버 상태 알 수 없음 (클릭하여 연결)', ping: false };
            }
        };
        const sqlProps = getSqlStatusProps();

        return (
            <div className="flex items-center gap-3">
                {/* Firebase Sync Indicator */}
                <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                    {isSyncing ? (
                        <SpinnerIcon className="w-4 h-4 text-blue-500" title="Firebase 동기화 중..." />
                    ) : (
                        <div 
                            className={`relative w-2.5 h-2.5 rounded-full transition-colors duration-500 ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`}
                            title={isOnline ? '인터넷 온라인' : '인터넷 오프라인'}
                            aria-label={isOnline ? '온라인 상태' : '오프라인 상태'}
                        >
                            {isOnline && <div className="absolute inset-0 w-full h-full bg-green-400 rounded-full animate-ping opacity-75"></div>}
                        </div>
                    )}
                </div>
                {/* SQL Server Status Indicator */}
                 <button
                    type="button"
                    onClick={checkSql}
                    disabled={sqlStatus === 'checking'}
                    className="p-1.5 rounded-full transition-colors hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-wait"
                    aria-label={sqlProps.title}
                    title={sqlProps.title}
                 >
                    <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                        {sqlStatus === 'checking' ? (
                            <SpinnerIcon className="w-4 h-4 text-yellow-500" />
                        ) : (
                            <div 
                                className={`relative w-2.5 h-2.5 rounded-full transition-colors duration-500 ${sqlProps.color}`}
                                aria-hidden="true"
                            >
                                {sqlProps.ping && <div className={`absolute inset-0 w-full h-full ${sqlProps.color} rounded-full animate-ping opacity-75`}></div>}
                            </div>
                        )}
                    </div>
                 </button>
            </div>
        );
    };

    return (
        <header id="app-header" className="bg-white px-4 flex justify-between items-center h-14 flex-shrink-0 border-b border-gray-200">
            <div className="flex items-center gap-3 min-w-0">
                <h1 className="text-xl font-extrabold text-gray-800 tracking-tight flex-shrink-0">발주관리</h1>
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