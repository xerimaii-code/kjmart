
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
        setDefaultDates();
        
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
        const start = `${year}-${month}-01`;
        const end = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

        setIsDetailOpen(true);
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

        // Regex Validators
        // 날짜: YYYY-MM-DD 또는 YYYYMMDD
        const isDateLike = (v: string) => /^(20\d{2})[-./]?(\d{2})[-./]?(\d{2})$/.test(v); 
        // 포스: 1~3자리 숫자 (보통 1, 2, 3 등 한자리수)
        const isPosLike = (v: string) => /^\d{1,3}$/.test(v); 
        // 전표번호: 숫자, 보통 4자리 이상이거나 0으로 시작하는 문자열
        const isJunnoLike = (v: string) => /^\d+$/.test(v) && v.length >= 1; 

        // 1. Column Name Detection (Prioritized)
        const dateKey = keys.find(k => {
            const lower = k.toLowerCase();
            return lower.includes('일자') || lower.includes('날짜') || lower.includes('date') || lower.includes('day');
        });
        
        const posKey = keys.find(k => {
            const lower = k.toLowerCase();
            return lower.includes('포스') || lower.includes('기기') || lower === 'pos' || lower === 'posno';
        });

        const junnoKey = keys.find(k => {
            const lower = k.toLowerCase();
            // Exclude 'pos' to avoid matching 'posno' as 'no'
            return lower.includes('전표') || lower.includes('영수') || lower.includes('순번') || lower.includes('jun') || (lower.includes('no') && !lower.includes('pos'));
        });

        let date = dateKey ? String(row[dateKey]).trim() : '';
        let pos = posKey ? String(row[posKey]).trim() : '';
        let junno = junnoKey ? String(row[junnoKey]).trim() : '';

        // 2. Value Format Detection (Fallback if keys failed or values are weird)
        // If date is missing or invalid format, scan all values
        if (!date || !isDateLike(date)) {
            const found = values.find(v => isDateLike(v));
            if (found) date = found;
        }

        // If pos is missing, scan remaining values
        if (!pos) {
            // Find a value that looks like a POS number (short digits) and is NOT the date we found
            const found = values.find(v => isPosLike(v) && v !== date);
            if (found) pos = found;
            else pos = '01'; // Default only if absolutely nothing found
        }

        // If junno is missing
        if (!junno) {
            // Find a value that looks like a Junno (numeric) and is NOT date. 
            // Note: We allow junno === pos if they are the same in the list (e.g. pos 1, receipt 1) but distinct columns.
            // But if we are searching values blindly, we try to find one that isn't the POS we just found, unless there's only one number.
            const found = values.find(v => isJunnoLike(v) && v !== date && (posKey ? true : v !== pos));
            if (found) junno = found;
        }

        // 3. Validation Check
        if (!date || !junno) {
            showToast(`상세 정보를 조회할 수 없습니다.\n(날짜: ${date || '없음'}, 전표: ${junno || '없음'})`, 'error');
            console.error("Row toggle failed. Extracted:", { date, pos, junno, row });
            return;
        }

        // 4. Sanitize for SQL
        // Remove separators from date: 2024-05-20 -> 20240520
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

        newExpanded.add(rowKey);
        setExpandedRows(newExpanded);

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
                // IMPORTANT: Replace the specific parameters expected by the query provided
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
                                <p className="text-sm text-gray-500">오류가 발생했습니다.</p>
                            </div>
                        )}
                        {detailStatus === 'success' && detailResults?.recordset && (
                            <div className="absolute inset-0 overflow-auto">
                                <table className="w-full text-xs text-left border-collapse">
                                    <thead className="bg-gray-200 text-gray-800 font-bold sticky top-0 z-10 shadow-sm border-b border-gray-300">
                                        <tr>
                                            <th className="p-3 w-8 bg-gray-200"></th>
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
                                                const values = Object.values(row).map(v => String(v).trim());
                                                const keys = Object.keys(row);
                                                
                                                // Re-use logic for row key generation to ensure consistency
                                                const isDateLike = (v: string) => /^(20\d{2})[-./]?(\d{2})[-./]?(\d{2})$/.test(v);
                                                const isPosLike = (v: string) => /^\d{1,3}$/.test(v);
                                                const isJunnoLike = (v: string) => /^\d+$/.test(v) && v.length >= 1;

                                                const dateKey = keys.find(k => { const l = k.toLowerCase(); return l.includes('일자') || l.includes('날짜') || l.includes('date') || l.includes('day'); });
                                                const posKey = keys.find(k => { const l = k.toLowerCase(); return l.includes('포스') || l.includes('기기') || l === 'pos' || l === 'posno'; });
                                                const junnoKey = keys.find(k => { const l = k.toLowerCase(); return l.includes('전표') || l.includes('영수') || l.includes('순번') || l.includes('jun') || (l.includes('no') && !l.includes('pos')); });

                                                let date = dateKey ? String(row[dateKey]).trim() : '';
                                                let pos = posKey ? String(row[posKey]).trim() : '';
                                                let junno = junnoKey ? String(row[junnoKey]).trim() : '';

                                                if (!date || !isDateLike(date)) { const f = values.find(v => isDateLike(v)); if (f) date = f; }
                                                
                                                // Fallback for POS: short number, not date
                                                if (!pos) { const f = values.find(v => isPosLike(v) && v !== date); if (f) pos = f; else pos='01'; }
                                                
                                                // Fallback for Junno: number, not date. 
                                                if (!junno) { const f = values.find(v => isJunnoLike(v) && v !== date && (posKey ? true : v !== pos)); if (f) junno = f; }

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
