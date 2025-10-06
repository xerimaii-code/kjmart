import React, { useMemo } from 'react';
import { SpinnerIcon } from './Icons';

interface LoadingOverlayProps {
    status: {
        connecting: boolean;
        customers: boolean;
        products: boolean;
        orders: boolean;
        settings: boolean;
    };
}

const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ status }) => {
    const completedCount = Object.values(status).filter(Boolean).length;
    const progress = (completedCount / Object.keys(status).length) * 100;

    const currentStatusText = useMemo(() => {
        if (!status.connecting) return '데이터베이스 연결 중...';
        if (!status.customers) return '고객 정보 로딩 중...';
        if (!status.products) return '상품 정보 로딩 중...';
        if (!status.orders) return '발주 내역 로딩 중...';
        if (!status.settings) return '앱 설정 로딩 중...';
        return '앱 준비 완료!';
    }, [status]);

    return (
        <div className="fixed inset-0 bg-gray-50 z-[100] flex flex-col items-center justify-center p-8 transition-opacity duration-300">
            <div className="w-full max-w-md flex flex-col items-center">
                <div className="text-center mb-8">
                    <h1 className="text-7xl font-black text-gray-700 leading-none tracking-tight">KJ</h1>
                    <h1 className="text-7xl font-black text-gray-700 leading-none tracking-tight">Mart</h1>
                </div>
                
                <div className="flex flex-col items-center justify-center h-24">
                    <SpinnerIcon className="w-8 h-8 text-blue-500 mb-4" />
                    <p className="text-base font-semibold text-gray-700 animate-pulse">{currentStatusText}</p>
                </div>
                
                <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden shadow-inner mt-4">
                    <div className="bg-gradient-to-r from-blue-400 to-blue-600 h-3 rounded-full transition-all duration-500 ease-out" style={{ width: `${progress}%` }}></div>
                </div>
            </div>
        </div>
    );
};

export default LoadingOverlay;