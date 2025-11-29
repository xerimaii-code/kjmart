
import React, { useState, useEffect, useRef } from 'react';
import ActionModal from './ActionModal';
import { SearchIcon, UserCircleIcon, SpinnerIcon, ChevronDownIcon, CalendarIcon } from './Icons';
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
    
    // --- Main Search State ---
    const [searchInput, setSearchInput] = useState('');
    const [results, setResults] = useState<QuerySqlResponse | null>(null);
    const [status, setStatus] = useState<QueryStatus>('idle');

    // --- Detail Modal State ---
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [detailResults, setDetailResults] = useState<QuerySqlResponse | null>(null);
    const [detailStatus, setDetailStatus] = useState<QueryStatus>('idle');
    const [selectedCustomer, setSelectedCustomer] = useState<{name: string, id: string} | null>(null);
    
    // Dates for the filter (inside detail modal)
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // --- Accordion / Drill-down State ---
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [rowDetails, setRowDetails] = useState<Record<string, { status: QueryStatus, data: any[] }>>({});

    // Fetch saved queries
    useEffect(() => {
        const unsubscribe = subscribeToSavedQueries((queries: any[]) => setSavedQueries(queries));
        return () => unsubscribe();
    }, []);

    // Initialize/Reset
    useEffect(() => {
        if (isOpen) {
            setSearchInput('');
            setResults(null);
            setStatus('idle');
            setIsDetailOpen(false);
        }
    }, [isOpen]);

    // Set default dates to current month (1st to last day)
    const setDefaultDates = () => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
        
        setStartDate(`${year}-${month}-01`);
        setEndDate(`${year}-${month}-${String(lastDay).padStart(2, '0')}`);
    };

    const handleSearch = async () => {
        if (!searchInput.trim()) return;

        const targetQueryName = '고객검색';
        const savedQuery = savedQueries.find(q => q.name === targetQueryName);

        if (!savedQuery) {
            showAlert(`'${targetQueryName}' 쿼리를 찾을 수 없습니다.\n[설정] > [SQL Runner] 메뉴에서 해당 쿼리를 먼저 등록해주세요.`);
            return;
        }

        setStatus('loading');
        setResults(null);
        
        try {
            // The customer search query might expect dates, but for pure customer lookup, 
            // we usually just need the keyword. Providing dummy dates if the query demands it.
            const kw = searchInput.trim().replace(/'/g, "''");
            const dummyDate = new Date().toISOString().slice(0,10);

            let sql = savedQuery.query
                .replace(/@kw\b/g, kw)
                .replace(/@startDate\b/g, dummyDate)
                .replace(/@endDate\b/g, dummyDate);

            sql = sql.replace(/`/g, '');

            const data = await querySql(sql, new AbortController().signal);
            setResults(data);
            setStatus('success');
        } catch (err) {
            console.error(err);
            setStatus('error');
        }
    };

    const fetchSalesList = async (customerId: string, start: string, end: string) => {
        setDetailStatus('loading');
        setDetailResults(null);
        setExpandedRows(new Set()); // Reset expanded rows on new search
        setRowDetails({});

        const targetQueryName = '고객_기간별매출';
        const savedQuery = savedQueries.find(q => q.name === targetQueryName);

        if (!savedQuery) {
            setDetailStatus('error');
            showAlert(`'${targetQueryName}' 쿼리를 찾을 수 없습니다.\n[설정] > [SQL Runner]에서 쿼리를 등록해주세요.`);
            return;
        }

        try {
            const safeTarget = String(customerId).replace(/'/g, "''");
            const safeStart = String(start).replace(/'/g, "''");
            const safeEnd = String(end).replace(/'/g, "''");

            let sql = savedQuery.query;
            // Handle various quote styles in the stored query
            sql = sql.replace(/'@startDate'/gi, '@startDate');
            sql = sql.replace(/'@endDate'/gi, '@endDate');
            sql = sql.replace(/'@target'/gi, '@target');

            sql = sql
                .replace(/@startDate\b/gi, `'${safeStart}'`)
                .replace(/@endDate\b/gi, `'${safeEnd}'`)
                .replace(/@target\b/gi, `'${safeTarget}'`);
            
            sql = sql.replace(/`/g, '');

            const data = await querySql(sql, new AbortController().signal);
            setDetailResults(data);
            setDetailStatus('success');
        } catch (err) {
            console.error("Sales list query failed:", err);
            setDetailStatus('error');
        }
    };

    const handleCustomerClick = (row: any) => {
        const values = Object.values(row);
        if (values.length < 1) return;

        const customerId = String(values[0]);
        const customerName = values.length > 1 ? String(values[1]) : customerId;

        setSelectedCustomer({ name: customerName, id: customerId });
        
        // 1. Set Default Dates
        setDefaultDates();
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
        const start = `${year}-${month}-01`;
        const end = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

        // 2. Open Modal Immediately
        setIsDetailOpen(true);

        // 3. Auto Fetch
        fetchSalesList(customerId, start, end);
    };

    const handleDateSearch = () => {
        if (selectedCustomer) {
            fetchSalesList(selectedCustomer.id, startDate, endDate);
        }
    };

    // --- Accordion Logic ---
    const toggleRow = async (row: any, index: number) => {
        const values = Object.values(row).map(v => String(v).trim());
        const keys = Object.keys(row);

        // Helper validators: 정규식으로 값의 형태를 확인합니다.
        const isDateLike = (v: string) => /^(20\d{2})[-./]?(\d{2})[-./]?(\d{2})$/.test(v); // YYYY-MM-DD or YYYYMMDD
        const isPosLike = (v: string) => /^\d{1,4}$/.test(v); // 1~4자리 숫자
        const isJunnoLike = (v: string) => /^\d{4,10}$/.test(v); // 4자리 이상 숫자 (전표번호)

        // 1. 키워드 기반으로 1차 추정 (Attempt detection by Column Header Keywords)
        let date = values.find((v, i) => keys[i].includes('일자') || keys[i].includes('날짜') || keys[i].toLowerCase().includes('date') || keys[i].toLowerCase().includes('day')) || '';
        let pos = values.find((v, i) => keys[i].includes('포스') || keys[i].includes('기기') || keys[i].toLowerCase() === 'pos' || keys[i].toLowerCase() === 'posno') || '';
        let junno = values.find((v, i) => keys[i].includes('전표') || keys[i].includes('영수') || keys[i].includes('순번') || keys[i].toLowerCase().includes('jun') || keys[i].toLowerCase().includes('no')) || '';

        // 2. 값의 형태 기반으로 교정 (Fallback: Detection by Value Format)
        
        // 날짜가 없거나 형식이 이상하면, 값들 중에서 날짜처럼 생긴 것을 찾습니다.
        if (!date || !isDateLike(date)) {
            const found = values.find(v => isDateLike(v));
            if (found) date = found;
        }

        // 포스가 없거나, 포스가 날짜/전표번호처럼 생겼다면 다시 찾습니다.
        // 포스는 보통 1, 01, 11 처럼 짧습니다.
        if (!pos || isDateLike(pos) || pos.length > 4) {
            // 날짜가 아닌 값 중에서 짧은 숫자를 찾습니다.
            const found = values.find(v => isPosLike(v) && v !== date);
            if (found) pos = found;
            else pos = '01'; // 정말 못 찾겠으면 기본값 '01'
        }

        // 전표번호가 없거나, 날짜/포스와 겹친다면 다시 찾습니다.
        if (!junno || isDateLike(junno) || junno === pos) {
            const found = values.find(v => isJunnoLike(v) && v !== date && v !== pos);
            if (found) junno = found;
        }

        // 3. SQL 파라미터 주입을 위한 정제 (Final Sanitize)
        // 날짜는 하이픈을 제거하여 YYYYMMDD (8자리)로 만듭니다. (VARCHAR(8) 대응)
        const cleanDate = date.replace(/[-./]/g, '');
        const cleanPos = pos;
        const cleanJunno = junno;

        const rowKey = `${cleanDate}_${cleanPos}_${cleanJunno}`;

        const newExpanded = new Set(expandedRows);
        if (newExpanded.has(rowKey)) {
            newExpanded.delete(rowKey);
            setExpandedRows(newExpanded);
            return;
        }

        // Expand
        newExpanded.add(rowKey);
        setExpandedRows(newExpanded);

        // If data not loaded yet, fetch it
        if (!rowDetails[rowKey]) {
            setRowDetails(prev => ({ ...prev, [rowKey]: { status: 'loading', data: [] } }));

            const targetQueryName = '고객_기간별매출_상세';
            const savedQuery = savedQueries.find(q => q.name === targetQueryName);

            if (!savedQuery) {
                setRowDetails(prev => ({ ...prev, [rowKey]: { status: 'error', data: [] } }));
                showToast(`'${targetQueryName}' 쿼리가 없습니다.`, 'error');
                return;
            }

            try {
                let sql = savedQuery.query
                    .replace(/@date\b/gi, `'${cleanDate}'`)
                    .replace(/@pos\b/gi, `'${cleanPos}'`)
                    .replace(/@junno\b/gi, `'${cleanJunno}'`);
                
                sql = sql.replace(/`/g, '');

                const data = await querySql(sql, new AbortController().signal);
                setRowDetails(prev => ({ 
                    ...prev, 
                    [rowKey]: { status: 'success', data: data.recordset || [] } 
                }));
            } catch (err) {
                console.error("Detail item query failed:", err);
                setRowDetails(prev => ({ ...prev, [rowKey]: { status: 'error', data: [] } }));
            }
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
                                    placeholder="고객명 또는 번호 (예: 1234)"
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
                            </div>
                        )}
                        {status === 'loading' && (
                            <div className="flex flex-col items-center justify-center h-full pb-10">
                                <SpinnerIcon className="w-10 h-10 text-blue-500" />
                                <p className="text-gray-500 mt-3 font-medium">검색 중...</p>
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
                                        <thead className="bg-gray-50 text-gray-700 font-bold border-b sticky top-0 z-10 shadow-sm">
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

            {/* Consolidated Detail Modal */}
            <ActionModal
                isOpen={isDetailOpen}
                onClose={() => setIsDetailOpen(false)}
                title={`${selectedCustomer?.name} 매출 내역`}
                zIndexClass="z-[100]"
            >
                <div className="flex flex-col h-full bg-gray-50">
                    {/* Header Controls (Date Picker) */}
                    <div className="flex-shrink-0 bg-white p-3 border-b shadow-sm z-20">
                        <div className="flex items-center justify-center gap-2 max-w-lg mx-auto">
                            <div className="flex items-center gap-1 flex-grow bg-gray-50 rounded-lg border border-gray-200 p-1">
                                <input 
                                    type="date" 
                                    value={startDate} 
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className="w-full bg-transparent border-none text-sm font-semibold text-gray-700 focus:ring-0 text-center p-1"
                                />
                                <span className="text-gray-400 font-bold text-xs">~</span>
                                <input 
                                    type="date" 
                                    value={endDate} 
                                    onChange={(e) => setEndDate(e.target.value)}
                                    className="w-full bg-transparent border-none text-sm font-semibold text-gray-700 focus:ring-0 text-center p-1"
                                />
                            </div>
                            <button 
                                onClick={handleDateSearch} 
                                className="h-9 px-4 bg-blue-600 text-white text-sm font-bold rounded-lg transition hover:bg-blue-700 active:scale-95 shadow-md shadow-blue-500/30 whitespace-nowrap"
                            >
                                조회
                            </button>
                        </div>
                    </div>

                    {/* Master List */}
                    <div className="flex-grow overflow-hidden relative bg-gray-50">
                        {detailStatus === 'loading' && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center space-y-3 z-20">
                                <SpinnerIcon className="w-8 h-8 text-blue-500" />
                                <p className="text-gray-500 font-medium">매출 내역 조회 중...</p>
                            </div>
                        )}
                        {detailStatus === 'error' && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4 z-20">
                                <p className="text-red-500 font-bold mb-2">조회 실패</p>
                                <p className="text-sm text-gray-500">
                                    오류가 발생했습니다.
                                </p>
                            </div>
                        )}
                        {detailStatus === 'success' && detailResults?.recordset && (
                            <div className="absolute inset-0 overflow-auto">
                                <table className="w-full text-xs text-left border-collapse">
                                    <thead className="bg-gray-200 text-gray-800 font-bold sticky top-0 z-10 shadow-sm border-b border-gray-300">
                                        <tr>
                                            <th className="p-3 w-8 bg-gray-200"></th> {/* Expand Icon Column */}
                                            {Object.keys(detailResults.recordset[0] || {}).map((key) => (
                                                <th key={key} className={`p-3 whitespace-nowrap bg-gray-200 ${key.includes('매출') || key.includes('금액') || key === '카드' || key === '포인트' ? 'text-right' : ''}`}>{key}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white">
                                        {detailResults.recordset.length === 0 ? (
                                            <tr>
                                                <td colSpan={10} className="p-8 text-center text-gray-500 font-medium">조회된 기간에 매출 내역이 없습니다.</td>
                                            </tr>
                                        ) : (
                                            detailResults.recordset.map((row, idx) => {
                                                // Extract values for the key, but use the same logic as toggleRow for expanding
                                                const values = Object.values(row).map(v => String(v).trim());
                                                const keys = Object.keys(row);
                                                
                                                const isDateLike = (v: string) => /^(20\d{2})[-./]?(\d{2})[-./]?(\d{2})$/.test(v);
                                                const isPosLike = (v: string) => /^\d{1,4}$/.test(v);
                                                const isJunnoLike = (v: string) => /^\d{4,10}$/.test(v);

                                                let date = values.find((v, i) => keys[i].includes('일자') || keys[i].includes('날짜') || keys[i].toLowerCase().includes('date')) || '';
                                                let pos = values.find((v, i) => keys[i].includes('포스') || keys[i].includes('기기') || keys[i].toLowerCase() === 'pos') || '';
                                                let junno = values.find((v, i) => keys[i].includes('전표') || keys[i].includes('영수') || keys[i].includes('순번') || keys[i].toLowerCase().includes('jun') || keys[i].toLowerCase().includes('no')) || '';

                                                if (!date || !isDateLike(date)) {
                                                    const found = values.find(v => isDateLike(v));
                                                    if (found) date = found;
                                                }
                                                if (!pos || isDateLike(pos) || pos.length > 4) {
                                                    const found = values.find(v => isPosLike(v) && v !== date);
                                                    if (found) pos = found;
                                                    else pos = '01';
                                                }
                                                if (!junno || isDateLike(junno) || junno === pos) {
                                                    const found = values.find(v => isJunnoLike(v) && v !== date && v !== pos);
                                                    if (found) junno = found;
                                                }

                                                const rowKey = `${date.replace(/[-./]/g, '')}_${pos}_${junno}`;
                                                const isExpanded = expandedRows.has(rowKey);
                                                const detail = rowDetails[rowKey];

                                                return (
                                                    <React.Fragment key={idx}>
                                                        <tr 
                                                            className={`cursor-pointer transition-colors border-b border-gray-100 ${isExpanded ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                                                            onClick={() => toggleRow(row, idx)}
                                                        >
                                                            <td className="p-3 text-center text-gray-400">
                                                                <ChevronDownIcon className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180 text-blue-600' : ''}`} />
                                                            </td>
                                                            {Object.entries(row).map(([key, val], vIdx) => (
                                                                <td key={vIdx} className={`p-3 whitespace-nowrap font-mono text-gray-600 ${key.includes('매출') || key.includes('금액') || key === '카드' || key === '포인트' ? 'text-right' : ''}`}>
                                                                    {String(val)}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                        {isExpanded && (
                                                            <tr className="bg-blue-50/30 shadow-inner">
                                                                <td colSpan={Object.keys(row).length + 1} className="p-2 sm:p-4">
                                                                    <div className="bg-white rounded-lg border border-blue-200 overflow-hidden shadow-sm">
                                                                        {(!detail || detail.status === 'loading') && (
                                                                            <div className="p-4 flex justify-center text-blue-500 gap-2 items-center">
                                                                                <SpinnerIcon className="w-4 h-4" />
                                                                                <span className="text-xs">상세 품목 불러오는 중...</span>
                                                                            </div>
                                                                        )}
                                                                        {detail?.status === 'error' && (
                                                                            <div className="p-4 text-center text-red-500 text-xs">상세 내역 로드 실패</div>
                                                                        )}
                                                                        {detail?.status === 'success' && (
                                                                            <table className="w-full text-xs">
                                                                                <thead className="bg-blue-100/50 text-blue-800 border-b border-blue-100">
                                                                                    <tr>
                                                                                        {Object.keys(detail.data[0] || {}).map(k => (
                                                                                            <th key={k} className="p-2 text-left font-semibold">{k}</th>
                                                                                        ))}
                                                                                    </tr>
                                                                                </thead>
                                                                                <tbody className="divide-y divide-gray-100">
                                                                                    {detail.data.length === 0 ? (
                                                                                        <tr><td colSpan={5} className="p-3 text-center text-gray-400">품목 정보 없음</td></tr>
                                                                                    ) : (
                                                                                        detail.data.map((dRow: any, dIdx: number) => (
                                                                                            <tr key={dIdx} className="hover:bg-gray-50">
                                                                                                {Object.values(dRow).map((v: any, i) => (
                                                                                                    <td key={i} className="p-2 font-mono text-gray-600 truncate max-w-[150px]">{String(v)}</td>
                                                                                                ))}
                                                                                            </tr>
                                                                                        ))
                                                                                    )}
                                                                                </tbody>
                                                                            </table>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </ActionModal>
        </>
    );
};

export default CustomerSearchModal;
