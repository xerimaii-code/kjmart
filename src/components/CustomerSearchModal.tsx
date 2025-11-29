
import React, { useState, useEffect } from 'react';
import ActionModal from './ActionModal';
import { SearchIcon, UserCircleIcon, SpinnerIcon, RemoveIcon } from './Icons';
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
    const { showAlert, showToast } = useAlert();
    const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
    
    const [searchInput, setSearchInput] = useState('');
    const [results, setResults] = useState<QuerySqlResponse | null>(null);
    const [status, setStatus] = useState<QueryStatus>('idle');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // --- Detail Modal State ---
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [detailResults, setDetailResults] = useState<QuerySqlResponse | null>(null);
    const [detailStatus, setDetailStatus] = useState<QueryStatus>('idle');
    const [selectedCustomerName, setSelectedCustomerName] = useState('');

    // Fetch saved queries
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
            setIsDetailOpen(false);
        }
    }, [isOpen]);

    const handleSearch = async () => {
        if (!searchInput.trim()) return;

        const targetQueryName = '고객검색';
        const savedQuery = savedQueries.find(q => q.name === targetQueryName);

        if (!savedQuery) {
            showAlert(`'${targetQueryName}' 쿼리를 찾을 수 없습니다.\n[저장된 쿼리] 메뉴에서 해당 쿼리를 먼저 등록해주세요.`);
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

    const handleCustomerClick = async (row: any) => {
        // Assume first column is Customer ID/Code, second is Name
        const values = Object.values(row);
        if (values.length < 1) return;

        const customerId = String(values[0]);
        const customerName = values.length > 1 ? String(values[1]) : customerId;

        setSelectedCustomerName(customerName);
        setIsDetailOpen(true);
        setDetailStatus('loading');
        setDetailResults(null);

        const targetQueryName = '고객_기간별매출';
        const savedQuery = savedQueries.find(q => q.name === targetQueryName);

        if (!savedQuery) {
            setDetailStatus('error'); // Will show error message in UI
            return;
        }

        try {
            // Replace variables: @startDate, @endDate, @target
            let sql = savedQuery.query
                .replace(/@startDate/g, `'${startDate}'`)
                .replace(/@endDate/g, `'${endDate}'`)
                .replace(/@target/g, `'${customerId}'`);
            
            sql = sql.replace(/`/g, '');

            const data = await querySql(sql, new AbortController().signal);
            setDetailResults(data);
            setDetailStatus('success');
        } catch (err) {
            console.error("Detail query failed:", err);
            setDetailStatus('error');
        }
    };

    return (
        <>
            <ActionModal
                isOpen={isOpen}
                onClose={onClose}
                title="고객 조회"
                zIndexClass="z-[90]"
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
                                    placeholder="고객명 또는 번호"
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
                                <p className="text-sm text-gray-500">오류가 발생했습니다.</p>
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
                                                <tr 
                                                    key={idx} 
                                                    onClick={() => handleCustomerClick(row)}
                                                    className="hover:bg-blue-50 transition-colors cursor-pointer active:bg-blue-100"
                                                >
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

            {/* Detail Drill-down Modal */}
            <ActionModal
                isOpen={isDetailOpen}
                onClose={() => setIsDetailOpen(false)}
                title={`${selectedCustomerName} 상세 내역`}
                zIndexClass="z-[100]"
            >
                <div className="flex flex-col h-full bg-gray-50">
                    <div className="flex-shrink-0 p-2 bg-gray-100 text-center text-xs text-gray-600 border-b">
                        기간: {startDate} ~ {endDate}
                    </div>
                    <div className="flex-grow overflow-auto p-2">
                        {detailStatus === 'loading' && (
                            <div className="flex flex-col items-center justify-center h-48 space-y-3">
                                <SpinnerIcon className="w-8 h-8 text-blue-500" />
                                <p className="text-gray-500 font-medium">상세 내역 조회 중...</p>
                            </div>
                        )}
                        {detailStatus === 'error' && (
                            <div className="flex flex-col items-center justify-center h-48 text-center p-4">
                                <p className="text-red-500 font-bold mb-2">조회 실패</p>
                                <p className="text-sm text-gray-500">
                                    '고객_기간별매출' 쿼리를 찾을 수 없거나<br/>실행 중 오류가 발생했습니다.
                                </p>
                            </div>
                        )}
                        {detailStatus === 'success' && detailResults?.recordset && (
                            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs text-left">
                                        <thead className="bg-gray-50 text-gray-700 font-semibold border-b">
                                            <tr>
                                                {Object.keys(detailResults.recordset[0] || {}).map((key) => (
                                                    <th key={key} className="p-3 whitespace-nowrap">{key}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {detailResults.recordset.map((row, idx) => (
                                                <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                                    {Object.values(row).map((val, vIdx) => (
                                                        <td key={vIdx} className="p-3 whitespace-nowrap font-mono text-gray-600">
                                                            {String(val)}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {detailResults.recordset.length === 0 && (
                                    <p className="p-8 text-center text-gray-500 font-medium">구매 내역이 없습니다.</p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </ActionModal>
        </>
    );
};

export default CustomerSearchModal;
