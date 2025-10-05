import React from 'react';
import { SpinnerIcon, CheckCircleIcon } from './Icons';

interface LoadingOverlayProps {
    status: {
        connecting: boolean;
        customers: boolean;
        products: boolean;
        orders: boolean;
        settings: boolean;
    };
}

const LoadingItem: React.FC<{ label: string; done: boolean }> = ({ label, done }) => (
    <div className={`flex items-center justify-between w-full text-lg p-3 rounded-lg transition-colors duration-300 ${done ? 'bg-green-50' : 'bg-gray-100'}`}>
        <span className={`transition-colors duration-300 ${done ? "text-gray-500" : "text-gray-800 font-medium"}`}>{label}</span>
        {done ? <CheckCircleIcon className="w-6 h-6 text-green-500" /> : <SpinnerIcon className="w-6 h-6 text-blue-500" />}
    </div>
);

const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ status }) => {
    const steps = [
        { key: 'connecting', label: '데이터베이스 연결', done: status.connecting },
        { key: 'customers', label: '고객 정보 로딩', done: status.customers },
        { key: 'products', label: '상품 정보 로딩', done: status.products },
        { key: 'orders', label: '발주 내역 로딩', done: status.orders },
        { key: 'settings', label: '앱 설정 로딩', done: status.settings },
    ];
    
    const completedCount = Object.values(status).filter(Boolean).length;
    const progress = (completedCount / steps.length) * 100;

    return (
        <div className="fixed inset-0 bg-gray-50 z-[100] flex flex-col items-center justify-center p-8 transition-opacity duration-300">
            <div className="w-full max-w-md">
                <h2 className="text-2xl font-bold text-gray-800 text-center mb-2">앱 준비 중</h2>
                <p className="text-gray-600 text-center mb-8">데이터를 안전하게 불러오고 있습니다.</p>
                
                <div className="space-y-3 mb-8">
                    {steps.map(step => (
                         <LoadingItem key={step.key} label={step.label} done={step.done} />
                    ))}
                </div>

                <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden shadow-inner">
                    <div className="bg-gradient-to-r from-blue-400 to-blue-600 h-3 rounded-full transition-all duration-500 ease-out" style={{ width: `${progress}%` }}></div>
                </div>
            </div>
        </div>
    );
};

export default LoadingOverlay;
