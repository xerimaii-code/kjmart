
import React, { useState, useEffect, useMemo } from 'react';
import { SyncLog } from '../types';
import * as db from '../services/dbService';
import { SpinnerIcon, XMarkIcon, PencilSquareIcon, TrashIcon, HistoryIcon, UserCircleIcon } from './Icons';

const formatTimeAgo = (timestamp: number): string => {
    const now = new Date();
    const then = new Date(timestamp);
    const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

    if (seconds < 60) return `${seconds}초 전`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}분 전`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}시간 전`;
    
    return then.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
};

const LogItem: React.FC<{ log: SyncLog }> = ({ log }) => {
    const isDeletion = log._deleted;
    const actionText = isDeletion ? '삭제됨' : '업데이트됨';
    const ActionIcon = isDeletion ? TrashIcon : PencilSquareIcon;
    const iconColor = isDeletion ? 'text-red-500' : 'text-blue-500';

    const itemName = log.name || log.barcode || log.comcode;

    return (
        <div className="p-4 flex items-start gap-4">
            <div className={`mt-1 flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full ${isDeletion ? 'bg-red-100' : 'bg-blue-100'}`}>
                <ActionIcon className={`w-4 h-4 ${iconColor}`} />
            </div>
            <div className="flex-grow min-w-0">
                <p className="font-semibold text-gray-800 truncate" title={itemName}>{itemName}</p>
                <div className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex items-center gap-1">
                        <UserCircleIcon className="w-3.5 h-3.5" />
                        <span>{log.user || '시스템'}</span>
                    </span>
                    <span className="flex items-center gap-1">
                        <HistoryIcon className="w-3.5 h-3.5" />
                        <span>{formatTimeAgo(log.timestamp)}</span>
                    </span>
                </div>
                 <p className="text-sm text-gray-600 mt-2">상태: {actionText}</p>
            </div>
        </div>
    );
};


interface SyncHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type TabType = 'customers' | 'products';

const SyncHistoryModal: React.FC<SyncHistoryModalProps> = ({ isOpen, onClose }) => {
    const [isRendered, setIsRendered] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [logs, setLogs] = useState<{ customers: SyncLog[], products: SyncLog[] }>({ customers: [], products: [] });
    const [activeTab, setActiveTab] = useState<TabType>('customers');

    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => setIsRendered(true), 10);
            
            const fetchLogs = async () => {
                setIsLoading(true);
                try {
                    const [customerLogs, productLogs] = await Promise.all([
                        db.getSyncLogs('customers', 100),
                        db.getSyncLogs('products', 100)
                    ]);
                    setLogs({ customers: customerLogs, products: productLogs });
                } catch (error) {
                    console.error("Failed to fetch sync logs:", error);
                    // Optionally show an error message to the user
                } finally {
                    setIsLoading(false);
                }
            };
            fetchLogs();

            return () => clearTimeout(timer);
        } else {
            setIsRendered(false);
        }
    }, [isOpen]);
    
    const displayedLogs = useMemo(() => logs[activeTab], [logs, activeTab]);

    if (!isOpen) return null;

    return (
        <div 
            className={`fixed inset-0 bg-black z-[80] transition-opacity duration-300 ${isRendered ? 'bg-opacity-50' : 'bg-opacity-0'}`}
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            <div 
                style={{ top: 'calc(env(safe-area-inset-top) + 1rem)', bottom: '1rem' }}
                className={`absolute left-1/2 -translate-x-1/2 w-[95%] max-w-2xl flex flex-col bg-gray-50 shadow-lg transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.32,1.25,0.37,1.02)] ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'} rounded-xl will-change-[opacity,transform]`}
                onClick={e => e.stopPropagation()}
            >
                <header className="relative bg-white p-4 flex-shrink-0 border-b border-gray-200 z-20 rounded-t-xl flex items-center justify-center">
                    <h2 className="text-lg font-bold text-gray-800">동기화 이력</h2>
                    <button onClick={onClose} className="absolute top-1/2 right-4 -translate-y-1/2 p-2 text-gray-500 hover:bg-gray-200 rounded-full transition-colors" aria-label="닫기">
                        <XMarkIcon className="w-6 h-6"/>
                    </button>
                </header>
                
                <div className="p-2 bg-white border-b border-gray-200 flex-shrink-0">
                    <div className="flex items-center justify-center bg-gray-100 rounded-lg p-1">
                        <button onClick={() => setActiveTab('customers')} className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-colors ${activeTab === 'customers' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>
                            거래처
                        </button>
                        <button onClick={() => setActiveTab('products')} className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-colors ${activeTab === 'products' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>
                            상품
                        </button>
                    </div>
                </div>

                <main className="flex-grow overflow-y-auto">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-full">
                            <SpinnerIcon className="w-10 h-10 text-blue-500" />
                        </div>
                    ) : displayedLogs.length === 0 ? (
                        <div className="text-center p-8 text-gray-500">
                            <p className="font-semibold">이력 정보가 없습니다.</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-200 bg-white">
                            {displayedLogs.map(log => (
                                <LogItem key={log._key} log={log} />
                            ))}
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};

export default SyncHistoryModal;
