
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

// Helper to ensure date is always YYYY-MM-DD
const normalizeDate = (input: any): string => {
    if (!input) return '';
    let str = String(input).trim();
    
    // 1. Remove time part if exists (e.g. "2025-05-20 14:30:00")
    if (str.includes(' ')) {
        str = str.split(' ')[0];
    }
    
    // 2. Replace dots/slashes with hyphens (e.g. "2025.05.20" -> "2025-05-20")
    str = str.replace(/[./]/g, '-');
    
    // 3. Handle 8-digit string (e.g. "20250520" -> "2025-05-20")
    if (/^\d{8}$/.test(str)) {
        str = `${str.substring(0, 4)}-${str.substring(4, 6)}-${str.substring(6, 8)}`;
    }
    
    return str;
};

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
    // Updated type to include error message
    const [rowDetails, setRowDetails] = useState<Record<string, { status: QueryStatus, data: any[], error?: string }>>({});

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
        // Fallback to a basic search query if not saved
        const defaultSearchQuery = `SELECT comcode as [고객번호], comname as [고객명], tel as [전화번호], point as [포인트] FROM comp WITH(NOLOCK) WHERE isuse <> '0' AND (comname LIKE '%@kw%' OR comcode LIKE '%@kw%' OR tel LIKE '%@kw%')`;
        
        const savedQuery = savedQueries.find(q => q.name === targetQueryName);
        const queryToUse = savedQuery ? savedQuery.query : defaultSearchQuery;

        setStatus('loading');
        setResults(null);
        
        try {
            const kw = searchInput.trim().replace(/'/g, "''");
            const dummyDate = new Date().toISOString().slice(0,10);

            let sql = queryToUse
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
            showToast(`'${targetQueryName}' 쿼리가 없습니다.\n[설정 > SQL Runner]에서 쿼리를 추가해주세요.`, 'error');
            setDetailStatus('idle');
            return;
        }
        
        const queryToUse = savedQuery.query;

        try {
            const safeTarget = String(customerId).replace(/'/g, "''");
            const safeStart = String(start).replace(/'/g, "''");
            const safeEnd = String(end).replace(/'/g, "''");

            let sql = queryToUse;
            // Handle both styles of variables
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

        // Try to find correct column by name, otherwise fallback to index 0/1
        const keys = Object.keys(row);
        const codeKey = keys.find(k => k.includes('코드') || k.includes('번호') || k.includes('code'));
        const nameKey = keys.find(k => k.includes('명') || k.includes('name'));

        const customerId = codeKey ? String(row[codeKey]) : String(values[0]);
        const customerName = nameKey ? String(row[nameKey]) : (values.length > 1 ? String(values[1]) : customerId);

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
        // 1. Explicit Key Lookup (Priority)
        let date = row['판매일'] || row['일자'] || row['day1'] || row['date'] || '';
        let pos = row['포스'] || row['기기'] || row['posno'] || row['pos'] || '';
        let junno = row['전표'] || row['영수증'] || row['순번'] || row['junno'] || row['no'] || '';

        // 2. Fuzzy Lookup (Fallback if explicit keys are missing)
        const keys = Object.keys(row);
        if (!date) {
            const dateKey = keys.find(k => k.includes('판매일') || k.includes('일자') || k.toLowerCase().includes('date'));
            if (dateKey) date = row[dateKey];
        }
        if (!pos) {
            const posKey = keys.find(k => k.includes('포스') || k.toLowerCase().includes('pos'));
            if (posKey) pos = row[posKey];
        }
        if (!junno) {
            const junnoKey = keys.find(k => k.includes('전표') || k.toLowerCase().includes('jun'));
            if (junnoKey) junno = row[junnoKey];
        }

        // 3. Last Resort: Index based lookup
        const values = Object.values(row);
        if (!date && values.length > 0) date = values[0];

        // 4. Normalize values using the helper function
        date = normalizeDate(date);
        pos = String(pos || '').trim();
        junno = String(junno || '').trim();

        // Default '01' for POS if strictly missing (legacy fallback)
        if (!pos || pos === 'undefined') pos = '01';

        // 5. Generate Unique Key for Accordion
        const rowKey = `${date.replace(/[-]/g, '')}_${pos}_${junno}`;
        
        // 6. Validation Check
        if (!junno || !date || date.length < 10) { 
            console.warn("Detail Query Params Missing or Invalid:", { date, pos, junno, row });
            showToast(`상세 정보를 조회할 수 없습니다.\n필수 정보 누락 (날짜: ${date}, 전표: ${junno})`, 'error');
            return;
        }

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
                showToast(`'${targetQueryName}' 쿼리가 없습니다.\n[설정 > SQL Runner]에서 쿼리를 추가해주세요.`, 'error');
                setRowDetails(prev => ({ ...prev, [rowKey]: { status: 'error', data: [], error: '쿼리를 찾을 수 없습니다.' } }));
                return;
            }
            
            const queryToUse = savedQuery.query;

            try {
                // Pass values exactly as extracted
                let sql = queryToUse
                    .replace(/@searchDate\b/gi, `'${date}'`)
                    .replace(/@searchPos\b/gi, `'${pos}'`)
                    .replace(/@searchJunno\b/gi, `'${junno}'`)
                    .replace(/@date\b/gi, `'${date}'`)
                    .replace(/@pos\b/gi, `'${pos}'`)
                    .replace(/@junno\b/gi, `'${junno}'`);
                
                sql = sql.replace(/`/g, '');

                const data = await querySql(sql, new AbortController().signal);
                setRowDetails(prev => ({ 
                    ...prev, 
                    [rowKey]: { status: 'success', data: data.recordset || [] } 
                }));
            } catch (err: any) {
                console.error("Detail item query failed:", err);
                let errorMessage = err.message || '알 수 없는 오류가 발생했습니다.';
                
                // User-friendly error message for common table missing issue
                if (errorMessage.includes("Invalid object name")) {
                    errorMessage = `매출 상세 테이블(outd)을 찾을 수 없습니다.\n(날짜: ${date})`;
                }

                setRowDetails(prev => ({ ...prev, [rowKey]: { status: 'error', data: [], error: errorMessage } }));
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
                                    <table className="min-w-full text-base text-left border-collapse">
                                        <thead className="bg-gray-50 text-gray-700 font-bold border-b sticky top-0 z-10 shadow-sm">
                                            <tr>
                                                {Object.keys(results.recordset[0] || {}).map((key) => (
                                                    <th key={key} className="px-1 py-2 whitespace-nowrap bg-gray-100 text-center">{key}</th>
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
                                                        <td key={vIdx} className="px-1 py-2 whitespace-nowrap text-gray-700">
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
                        {detailStatus === 'idle' && (
                            <div className="flex flex-col items-center justify-center h-full text-gray-400">
                                <CalendarIcon className="w-16 h-16 text-gray-300 mb-3" />
                                <p className="text-lg font-medium">기간을 선택하고 조회해주세요.</p>
                            </div>
                        )}
                        {detailStatus === 'loading' && (
                            <div className="flex flex-col items-center justify-center h-full">
                                <SpinnerIcon className="w-10 h-10 text-blue-500" />
                                <p className="text-gray-500 mt-3 font-medium">매출 내역 조회 중...</p>
                            </div>
                        )}
                        {detailStatus === 'success' && detailResults?.recordset && (
                            detailResults.recordset.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                                    <p>선택한 기간에 매출 내역이 없습니다.</p>
                                </div>
                            ) : (
                                <div className="absolute inset-0 overflow-auto">
                                    <table className="min-w-full text-base text-left border-collapse">
                                        <thead className="bg-gray-50 text-gray-700 font-bold border-b sticky top-0 z-10 shadow-sm">
                                            <tr>
                                                <th className="px-1 py-2 w-8"></th>
                                                {Object.keys(detailResults.recordset[0] || {}).map((key) => (
                                                    <th key={key} className="px-1 py-2 whitespace-nowrap bg-gray-100 text-center">{key}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 bg-white">
                                            {detailResults.recordset.map((row, idx) => {
                                                let date = row['판매일'] || row['일자'] || row['day1'] || row['date'] || '';
                                                let pos = row['포스'] || row['기기'] || row['posno'] || row['pos'] || '';
                                                let junno = row['전표'] || row['영수증'] || row['순번'] || row['junno'] || row['no'] || '';
                                                const values = Object.values(row);
                                                if (!date && values.length > 0) date = values[0];
                                                date = normalizeDate(date);
                                                pos = String(pos || '').trim();
                                                junno = String(junno || '').trim();
                                                if (!pos || pos === 'undefined') pos = '01';

                                                const rowKey = `${date.replace(/[-]/g, '')}_${pos}_${junno}`;
                                                const isExpanded = expandedRows.has(rowKey);
                                                const details = rowDetails[rowKey];
                                                return (
                                                    <React.Fragment key={idx}>
                                                        <tr onClick={() => toggleRow(row, idx)} className="hover:bg-blue-50 transition-colors cursor-pointer active:bg-blue-100">
                                                            <td className="px-1 py-2 w-8 text-center">
                                                                <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform inline-block ${isExpanded ? 'rotate-180' : ''}`} />
                                                            </td>
                                                            {Object.values(row).map((val, vIdx) => (
                                                                <td key={vIdx} className="px-1 py-2 whitespace-nowrap text-gray-700">
                                                                    {String(val)}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                        {isExpanded && (
                                                            <tr>
                                                                <td colSpan={Object.keys(row).length + 1} className="p-0">
                                                                    <div className="p-4 bg-gray-100 border-y border-gray-200">
                                                                        {details?.status === 'loading' && <SpinnerIcon className="w-6 h-6 mx-auto text-blue-500" />}
                                                                        {details?.status === 'error' && <p className="text-center text-red-500 text-sm py-2">{details.error}</p>}
                                                                        {details?.status === 'success' && details.data.length > 0 && (
                                                                            <div className="overflow-x-auto">
                                                                                <table className="min-w-full text-sm text-left bg-white rounded-md shadow-inner overflow-hidden">
                                                                                    <thead className="bg-gray-200">
                                                                                        <tr>
                                                                                            {Object.keys(details.data[0] || {}).map(key => (
                                                                                                <th key={key} className="px-2 py-1.5 font-semibold text-gray-700 text-center whitespace-nowrap">{key}</th>
                                                                                            ))}
                                                                                        </tr>
                                                                                    </thead>
                                                                                    <tbody className="divide-y divide-gray-100">
                                                                                        {details.data.map((detailRow, dIdx) => (
                                                                                            <tr key={dIdx}>
                                                                                                {Object.values(detailRow).map((val, dvIdx) => (
                                                                                                    <td key={dvIdx} className="px-2 py-1.5 text-gray-800 font-mono whitespace-nowrap">
                                                                                                        {String(val)}
                                                                                                    </td>
                                                                                                ))}
                                                                                            </tr>
                                                                                        ))}
                                                                                    </tbody>
                                                                                </table>
                                                                            </div>
                                                                        )}
                                                                        {details?.status === 'success' && details.data.length === 0 && (
                                                                            <p className="text-center text-gray-500 text-sm py-2">상세 내역이 없습니다.</p>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )
                        )}
                    </div>
                </div>
            </ActionModal>
        </>
    );
};

export default CustomerSearchModal;
