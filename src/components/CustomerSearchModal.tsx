
import React, { useState, useEffect } from 'react';
import ActionModal from './ActionModal';
import { SearchIcon, UserCircleIcon, SpinnerIcon } from './Icons';
import { querySql } from '../services/sqlService';
import { useAlert } from '../context/AppContext';
import { subscribeToSavedQueries } from '../services/dbService';

interface CustomerSearchModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface SavedQuery {
    id: string;
    name: string;
    query: string;
}

interface QuerySqlResponse {
    recordset?: any[];
}

type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

const CustomerSearchModal: React.FC<CustomerSearchModalProps> = ({ isOpen, onClose }) => {
    const { showAlert } = useAlert();
    const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
    
    const [searchInput, setSearchInput] = useState('');
    const [results, setResults] = useState<QuerySqlResponse | null>(null);
    const [status, setStatus] = useState<QueryStatus>('idle');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // Fetch saved queries for '고객검색'
    useEffect(() => {
        const unsubscribe = subscribeToSavedQueries((queries: any[]) => setSavedQueries(queries));
        return () => unsubscribe();
    }, []);

    // Initialize dates when opened
    useEffect(() => {
        if (isOpen) {
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
            
            setStartDate(`${year}-${month}-01`);
            setEndDate(`${year}-${month}-${String(lastDay).padStart(2, '0')}`);
            setSearchInput('');
            setResults(null);
            setStatus('idle');
        }
    }, [isOpen]);

    const handleSearch = async () => {
        if (!searchInput.trim()) return;

        const targetQueryName = '고객검색';
        const savedQuery = savedQueries.find(q => q.name === targetQueryName);

        if (!savedQuery) {
            showAlert(`'${targetQueryName}'이라는 이름의 저장된 쿼리를 찾을 수 없습니다.\n[저장된 쿼리] 메뉴에서 해당 쿼리를 먼저 등록해주세요.`);
            return;
        }

        setStatus('loading');
        setResults(null);
        
        try {
            const kw = searchInput.trim().replace(/'/g, "''");
            
            let sql = savedQuery.query
                .replace(/@kw/g, kw)
                .replace(/@startDate/g, startDate)
                .replace(/@endDate/g, endDate);

            sql = sql.replace(/`/g, '');

            const data = await querySql(sql, new AbortController().signal);
            setResults(data);
            setStatus('success');
        } catch (err) {
            console.error(err);
            setStatus('error');
        }
    };

    return (
        <ActionModal
            isOpen={isOpen}
            onClose={onClose}
            title="고객 조회"
        >
            <div className="flex flex-col h-full bg-gray-50">
                {/* Date Selection Area */}
                <div className="flex-shrink-0 bg-white p-2 border-b flex justify-center items-center gap-2 z-20">
                    <input 
                        type="date" 
                        value={startDate} 
                        onChange={(e) => setStartDate(e.target.value)}
                        className="border border-gray-300 rounded-md px-2 py-1 text-sm font-semibold text-gray-700 bg-gray-50 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <span className="text-gray-400 font-bold">~</span>
                    <input 
                        type="date" 
                        value={endDate} 
                        onChange={(e) => setEndDate(e.target.value)}
                        className="border border-gray-300 rounded-md px-2 py-1 text-sm font-semibold text-gray-700 bg-gray-50 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>

                {/* Search Area */}
                <div className="flex-shrink-0 bg-white p-3 border-b shadow-sm z-10">
                    <div className="flex items-center gap-2 max-w-md mx-auto">
                        <div className="relative flex-grow">
                            <div className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400 pointer-events-none">
                                <SearchIcon className="w-5 h-5" />
                            </div>
                            <input
                                type="text"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                placeholder="고객명 또는 전화번호 (예: 1234)"
                                className="w-full h-11 pl-10 pr-3 border border-gray-300 bg-white rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors text-base placeholder:text-gray-400"
                                autoFocus
                            />
                        </div>
                        <button 
                            onClick={handleSearch} 
                            className="h-11 px-5 bg-blue-600 text-white font-bold rounded-lg transition hover:bg-blue-700 active:scale-95 shadow-md shadow-blue-500/30 whitespace-nowrap"
                        >
                            검색
                        </button>
                    </div>
                </div>

                {/* Result Area */}
                <div className="flex-grow overflow-hidden flex flex-col relative">
                    {status === 'idle' && (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 pb-10">
                            <UserCircleIcon className="w-16 h-16 text-gray-300 mb-3" />
                            <p className="text-lg font-medium">고객을 검색해주세요.</p>
                            <p className="text-xs text-gray-300 mt-2">'고객검색' 쿼리가 등록되어 있어야 합니다.</p>
                        </div>
                    )}
                    {status === 'loading' && (
                        <div className="flex flex-col items-center justify-center h-full pb-10">
                            <SpinnerIcon className="w-10 h-10 text-blue-500" />
                            <p className="text-gray-500 mt-3 font-medium">검색 중...</p>
                        </div>
                    )}
                    {status === 'error' && (
                        <div className="flex flex-col items-center justify-center h-full pb-10 text-center">
                            <p className="text-red-500 font-bold mb-2">검색 실패</p>
                            <p className="text-sm text-gray-500">
                                오류가 발생했습니다.<br/>잠시 후 다시 시도해주세요.
                            </p>
                        </div>
                    )}
                    {status === 'success' && results?.recordset && (
                        results.recordset.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-gray-500 pb-10">
                                <p>검색 결과가 없습니다.</p>
                            </div>
                        ) : (
                            <div className="absolute inset-0 overflow-auto">
                                <table className="w-full text-sm text-left border-collapse">
                                    <thead className="bg-gray-100 text-gray-700 font-bold border-b sticky top-0 z-10 shadow-sm">
                                        <tr>
                                            {Object.keys(results.recordset[0] || {}).map((key) => (
                                                <th key={key} className="p-3 whitespace-nowrap bg-gray-100">{key}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 bg-white">
                                        {results.recordset.map((row, idx) => (
                                            <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                                {Object.values(row).map((val, vIdx) => (
                                                    <td key={vIdx} className="p-3 whitespace-nowrap text-gray-700">
                                                        {String(val)}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )
                    )}
                </div>
            </div>
        </ActionModal>
    );
};

export default CustomerSearchModal;
