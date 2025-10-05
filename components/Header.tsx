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
        <header id="app-header" className="bg-gradient-to-b from-white to-gray-100 px-1 flex justify-center items-center h-6 flex-shrink-0 shadow-lg">
            <div className="flex items-baseline space-x-2">
                <p className="text-xs font-semibold text-gray-700">{formatDate(currentDateTime)}</p>
                <p className="text-base font-bold text-gray-900 tabular-nums">{formatTime(currentDateTime)}</p>
            </div>
        </header>
    );
};

export default Header;