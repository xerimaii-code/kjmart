import React, { useState, useEffect } from 'react';
import { GithubIcon } from './Icons';

const Header: React.FC = () => {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const week = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
    return `${year}년 ${month}월 ${day}일 (${week})`;
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  return (
    <header className="bg-white shadow-md p-4 flex justify-between items-center text-gray-700 w-full z-10">
      <div className="flex items-center">
        <h1 className="text-xl font-bold text-blue-600">발주 관리</h1>
        <a href="https://github.com/xerimaii-code/kjmart.git" target="_blank" rel="noopener noreferrer" className="ml-3 text-gray-500 hover:text-gray-800">
            <GithubIcon className="w-6 h-6" />
        </a>
      </div>
      <div className="text-right text-sm">
        <div>{formatDate(currentTime)}</div>
        <div className="font-semibold">{formatTime(currentTime)}</div>
      </div>
    </header>
  );
};

export default Header;
