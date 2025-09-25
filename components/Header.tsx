
import React, { useState, useEffect } from 'react';

const Header: React.FC = () => {
    const [currentDateTime, setCurrentDateTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentDateTime(new Date());
        }, 1000);

        return () => {
            clearInterval(timer);
        };
    }, []);

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
        <header className="bg-white border-b border-slate-200 p-4 flex justify-between items-center h-20 flex-shrink-0">
            <h1 className="text-xl font-bold text-slate-800">발주 관리</h1>
            <div className="text-right">
                <p className="text-sm font-medium text-slate-700">{formatDate(currentDateTime)}</p>
                <p className="text-lg font-bold text-sky-600 tabular-nums">{formatTime(currentDateTime)}</p>
            </div>
        </header>
    );
};

export default Header;