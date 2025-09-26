
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
        <header className="bg-slate-100 p-3 grid grid-cols-3 items-center h-16 flex-shrink-0 border-b border-slate-200 shadow-sm">
            <div></div>
            <h1 className="text-lg font-bold text-slate-800 text-center whitespace-nowrap">발주 관리</h1>
            <div className="text-right">
                <p className="text-xs font-medium text-slate-600">{formatDate(currentDateTime)}</p>
                <p className="text-base font-bold text-slate-900 tabular-nums">{formatTime(currentDateTime)}</p>
            </div>
        </header>
    );
};

export default Header;
