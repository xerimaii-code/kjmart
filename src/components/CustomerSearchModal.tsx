
import React, { useState, useEffect } from 'react';
import ActionModal from './ActionModal';
import { SearchIcon, UserCircleIcon, SpinnerIcon, ChevronDownIcon, CalendarIcon } from './Icons';
import { querySql } from '../services/sqlService';
import { useAlert } from '../context/AppContext';
import { subscribeToUserQueries } from '../services/dbService';

interface CustomerSearchModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface UserQuery {
    id: string;
    name: string;
    query: string;
}

interface QuerySqlResponse {
    recordset?: any[];
}

type QueryStatus = 'idle' | 'loading' | 'success' | 'error';
type View = 'search' | 'detail';

// Helper to ensure date is always YYYY-MM-DD
const normalizeDate = (input: any): string => {
    if (!input) return '';
    let str = String(input).trim();
    
    if (str.includes(' ')) str = str.split(' ')[0];
    str = str.replace(/[./]/g, '-');
    if (/^\d{8}$/.test(str)) {
        str = `${str.substring(0, 4)}-${str.substring(4, 6)}-${str.substring(6, 8)}`;
    }
    return str;
};

const CustomerSearchModal: React.FC<CustomerSearchModalProps> = ({ isOpen, onClose }) => {
    const { showToast } = useAlert();
    const [userQueries, setUserQueries] = useState<UserQuery[]>([]);
    const [view, setView] = useState<View>('search');
    
    // --- Main Search State ---
    const [searchInput, setSearchInput] = useState('');
    const [results, setResults] = useState<QuerySqlResponse | null>(null);
    const [status, setStatus] = useState<QueryStatus>('idle');

    // --- Detail State ---
    const [detailResults, setDetailResults] = useState<QuerySqlResponse | null>(null);
    const [detailStatus, setDetailStatus] = useState<QueryStatus>('idle');
    const [selectedCustomer, setSelectedCustomer] = useState<{name: string, id: string} | null>(null);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    
    // --- Accordion State ---
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [rowDetails, setRowDetails] = useState<Record<string, { status: QueryStatus, data: any[], error?: string }>>({});

    useEffect(() => {
        const unsubscribe = subscribeToUserQueries((queries: any[]) => setUserQueries(queries));
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (isOpen) {
            setView('search');
            setSearchInput('');
            setResults(null);
            setStatus('idle');
            setDetailResults(null);
            setDetailStatus('idle');
            setSelectedCustomer(null);
        }
    }, [isOpen]);

    const handleBack = () => {
        setView('search');
        setDetailResults(null);
        setDetailStatus('idle');
        setExpandedRows(new Set());
        setRowDetails({});
    };

    const handleSearch = async () => {
        if (!searchInput.trim()) return;

        const targetQueryName = '고객검색';
        const defaultSearchQuery = `SELECT comcode as [고객번호], comname as [고객명], tel as [전화번호], point as [포인트] FROM comp WITH(NOLOCK) WHERE isuse <> '0' AND (comname LIKE '%@kw%' OR comcode LIKE '%@kw%' OR tel LIKE '%@kw%')`;
        
        const userQuery = userQueries.find(q => q.name === targetQueryName);
        const queryToUse = userQuery ? userQuery.query : defaultSearchQuery;

        setStatus('loading');
        setResults(null);
        
        try {
            const kw = searchInput.trim().replace(/'/g, "''");
            let sql = queryToUse.replace(/@kw\b/g, kw);
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
        setExpandedRows(new Set());
        setRowDetails({});

        const targetQueryName = '고객_기간별매출';
        const userQuery = userQueries.find(q => q.name === targetQueryName);
        
        if (!userQuery) {
            showToast(`'${targetQueryName}' 쿼리가 등록되지 않았습니다.\n[설정 > SQL Runner > 추천]에서 쿼리를 추가해주세요.`, 'error');
            setDetailStatus('idle');
            return;
        }
        
        try {
            // Case-insensitive replace for parameters used in the template
            let sql = userQuery.query
                .replace(/@startDate\b/gi, `'${start.replace(/'/g, "''")}'`)
                .replace(/@endDate\b/gi, `'${end.replace(/'/g, "''")}'`)
                .replace(/@target\b/gi, `'${customerId.replace(/'/g, "''")}'`);
            
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

        const keys = Object.keys(row);
        const codeKey = keys.find(k => k.includes('코드') || k.includes('번호') || k.includes('code'));
        const nameKey = keys.find(k => k.includes('명') || k.includes('name'));

        const customerId = codeKey ? String(row[codeKey]) : String(values[0]);
        const customerName = nameKey ? String(row[nameKey]) : (values.length > 1 ? String(values[1]) : customerId);

        setSelectedCustomer({ name: customerName, id: customerId });
        
        const endObj = new Date();
        const startObj = new Date();
        startObj.setMonth(startObj.getMonth() - 1);
        if (startObj.getDate() !== endObj.getDate()) startObj.setDate(0); 

        const formatDateStr = (d: Date) => d.toISOString().slice(0, 10);
        const start = formatDateStr(startObj);
        const end = formatDateStr(endObj);
        
        setStartDate(start);
        setEndDate(end);

        setView('detail');
        fetchSalesList(customerId, start, end);
    };

    const handleDateSearch = () => {
        if (selectedCustomer) fetchSalesList(selectedCustomer.id, startDate, endDate);
    };

    const toggleRow = async (row: any) => {
        const keys = Object.keys(row);
        const dateKey = keys.find(k => k.toLowerCase().includes('판매일') || k.toLowerCase().includes('일자') || k.toLowerCase().includes('date'));
        const posKey = keys.find(k => k.toLowerCase().includes('포스') || k.toLowerCase().includes('pos'));
        const junnoKey = keys.find(k => k.toLowerCase().includes('전표') || k.toLowerCase().includes('jun'));

        let date = dateKey ? row[dateKey] : Object.values(row)[0];
        let pos = posKey ? row[posKey] : '01';
        let junno = junnoKey ? row[junnoKey] : '';
        
        date = normalizeDate(date);
        pos = String(pos || '01').trim();
        junno = String(junno || '').trim();

        if (!junno || !date) { 
            showToast(`상세 정보를 조회할 수 없습니다. (필수 정보 누락)`, 'error');
            return;
        }

        const rowKey = `${date.replace(/-/g, '')}_${pos}_${junno}`;
        const newExpanded = new Set(expandedRows);
        
        if (newExpanded.has(rowKey)) {
            newExpanded.delete(rowKey);
            setExpandedRows(newExpanded);
            return;
        }
        
        newExpanded.add(rowKey);
        setExpandedRows(newExpanded);

        if (rowDetails[rowKey]) return;

        setRowDetails(prev => ({ ...prev, [rowKey]: { status: 'loading', data: [] } }));
        const targetQueryName = '고객_기간별매출_상세';
        const userQuery = userQueries.find(q => q.name === targetQueryName);
        
        if (!userQuery) {
            showToast(`'${targetQueryName}' 쿼리가 없습니다.`, 'error');
            setRowDetails(prev => ({ ...prev, [rowKey]: { status: 'error', data: [], error: '쿼리를 찾을 수 없습니다.' } }));
            return;
        }
        
        try {
            let sql = userQuery.query
                .replace(/@searchDate\b|@date\b/gi, `'${date}'`)
                .replace(/@searchPos\b|@pos\b/gi, `'${pos}'`)
                .replace(/@searchJunno\b|@junno\b/gi, `'${junno}'`);
            sql = sql.replace(/`/g, '');

            const data = await querySql(sql, new AbortController().signal);
            setRowDetails(prev => ({ ...prev, [rowKey]: { status: 'success', data: data.recordset || [] } }));
        } catch (err: any) {
            setRowDetails(prev => ({ ...prev, [rowKey]: { status: 'error', data: [], error: err.message || '오류 발생' } }));
        }
    };

    return (
        <ActionModal
            isOpen={isOpen}
            onClose={onClose}
            title={view === 'search' ? "고객 조회" : `${selectedCustomer?.name || ''} 매출 내역`}
            onBack={view === 'detail' ? handleBack : undefined}
            zIndexClass="z-[90]"
        >
            <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
                <div className="flex-grow relative">
                    {/* Search Panel */}
                    <div className={`absolute inset-0 flex flex-col transition-transform duration-300 ease-in-out ${view === 'search' ? 'translate-x-0' : '-translate-x-full'}`}>
                        <div className="flex-shrink-0 bg-white p-3 border-b shadow-sm z-10">
                            <div className="flex items-center gap-2 max-w-md mx-auto">
                                <div className="relative flex-grow">
                                    <SearchIcon className="w-5 h-5 absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
                                    <input 
                                        type="text" 
                                        value={searchInput} 
                                        onChange={(e) => setSearchInput(e.target.value)} 
                                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()} 
                                        placeholder="고객명 또는 번호" 
                                        className="w-full h-11 pl-10 pr-3 border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500" 
                                    />
                                </div>
                                <button onClick={handleSearch} className="h-11 w-11 bg-blue-600 text-white font-bold rounded-lg transition hover:bg-blue-700 active:scale-95 shadow-md flex items-center justify-center flex-shrink-0" aria-label="검색">
                                    <SearchIcon className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                        <div className="flex-grow overflow-hidden flex flex-col relative">
                            {status === 'idle' && <div className="flex flex-col items-center justify-center h-full text-gray-400"><UserCircleIcon className="w-16 h-16 text-gray-300 mb-3" /><p>고객을 검색해주세요.</p></div>}
                            {status === 'loading' && <div className="flex flex-col items-center justify-center h-full"><SpinnerIcon className="w-10 h-10 text-blue-500" /><p className="mt-3">검색 중...</p></div>}
                            {status === 'success' && results?.recordset && (
                                results.recordset.length === 0 
                                ? <div className="flex items-center justify-center h-full"><p>검색 결과가 없습니다.</p></div>
                                : <div className="absolute inset-0 overflow-auto">
                                    <table className="min-w-full text-sm text-left border-collapse">
                                        <thead className="bg-gray-100 text-gray-700 font-bold border-b sticky top-0 z-10">
                                            <tr>{Object.keys(results.recordset[0] || {}).map(k => <th key={k} className="px-3 py-2 text-center whitespace-nowrap">{k}</th>)}</tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 bg-white">{results.recordset.map((row, i) => <tr key={i} onClick={() => handleCustomerClick(row)} className="hover:bg-blue-50 cursor-pointer">{Object.values(row).map((v, j) => <td key={j} className="px-3 py-2 whitespace-nowrap">{String(v)}</td>)}</tr>)}</tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Detail Panel */}
                    <div className={`absolute inset-0 flex flex-col transition-transform duration-300 ease-in-out ${view === 'detail' ? 'translate-x-0' : 'translate-x-full'}`}>
                        <div className="flex-shrink-0 bg-white p-3 border-b shadow-sm z-20">
                            <div className="flex items-center justify-center gap-2 max-w-lg mx-auto">
                                <div className="flex items-center gap-1 flex-grow bg-gray-50 rounded-lg border p-1">
                                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full bg-transparent border-none text-sm font-semibold focus:ring-0 text-center"/>
                                    <span className="text-gray-400">~</span>
                                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full bg-transparent border-none text-sm font-semibold focus:ring-0 text-center"/>
                                </div>
                                <button onClick={handleDateSearch} className="h-9 px-4 bg-blue-600 text-white text-sm font-bold rounded-lg transition hover:bg-blue-700 active:scale-95 shadow-md">조회</button>
                            </div>
                        </div>
                        <div className="flex-grow overflow-hidden relative bg-gray-50">
                            {detailStatus === 'idle' && <div className="flex flex-col items-center justify-center h-full text-gray-400"><CalendarIcon className="w-16 h-16 text-gray-300 mb-3" /><p>기간을 선택하고 조회해주세요.</p></div>}
                            {detailStatus === 'loading' && <div className="flex flex-col items-center justify-center h-full"><SpinnerIcon className="w-10 h-10 text-blue-500" /><p className="mt-3">매출 내역 조회 중...</p></div>}
                            {detailStatus === 'success' && detailResults?.recordset && (
                                detailResults.recordset.length === 0 
                                ? <div className="flex items-center justify-center h-full"><p>선택한 기간에 매출 내역이 없습니다.</p></div>
                                : <div className="absolute inset-0 overflow-auto">
                                    <table className="min-w-full text-sm text-left border-collapse">
                                        <thead className="bg-gray-100 text-gray-700 font-bold border-b sticky top-0 z-10">
                                            <tr>
                                                <th className="px-3 py-2 w-8"></th>
                                                {Object.keys(detailResults.recordset[0] || {}).map(k => <th key={k} className="px-3 py-2 text-center whitespace-nowrap">{k}</th>)}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 bg-white">
                                            {detailResults.recordset.map((row, idx) => {
                                                const keys = Object.keys(row);
                                                const dateKey = keys.find(k => k.toLowerCase().includes('일자')); const posKey = keys.find(k => k.toLowerCase().includes('포스')); const junnoKey = keys.find(k => k.toLowerCase().includes('전표'));
                                                const date = normalizeDate(dateKey ? row[dateKey] : Object.values(row)[0]); const pos = String((posKey ? row[posKey] : '01') || '01').trim(); const junno = String((junnoKey ? row[junnoKey] : '') || '').trim();
                                                const rowKey = `${date.replace(/-/g, '')}_${pos}_${junno}`;
                                                const isExpanded = expandedRows.has(rowKey); const details = rowDetails[rowKey];
                                                return <React.Fragment key={idx}>
                                                    <tr onClick={() => toggleRow(row)} className="hover:bg-blue-50 cursor-pointer">
                                                        <td className="px-3 py-2 w-8 text-center"><ChevronDownIcon className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} /></td>
                                                        {Object.values(row).map((v, i) => <td key={i} className="px-3 py-2 whitespace-nowrap">{String(v)}</td>)}
                                                    </tr>
                                                    {isExpanded && <tr><td colSpan={Object.keys(row).length + 1} className="p-0"><div className="p-4 bg-gray-100 border-y">
                                                        {details?.status === 'loading' && <SpinnerIcon className="w-6 h-6 mx-auto text-blue-500" />}
                                                        {details?.status === 'error' && <p className="text-center text-red-500">{details.error}</p>}
                                                        {details?.status === 'success' && details.data.length > 0 && 
                                                            <div className="overflow-x-auto">
                                                                <table className="min-w-full text-xs bg-white rounded-md shadow-inner">
                                                                    <thead className="bg-gray-200">
                                                                        <tr>{Object.keys(details.data[0] || {}).map(k => <th key={k} className="px-2 py-1.5 font-semibold text-center whitespace-nowrap">{k}</th>)}</tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-gray-100">
                                                                        {details.data.map((dr, i) => <tr key={i}>{Object.values(dr).map((v, j) => <td key={j} className="px-2 py-1.5 font-mono whitespace-nowrap">{String(v)}</td>)}</tr>)}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        }
                                                        {details?.status === 'success' && details.data.length === 0 && <p className="text-center text-gray-500">상세 내역이 없습니다.</p>}
                                                    </div></td></tr>}
                                                </React.Fragment>
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </ActionModal>
    );
};

export default CustomerSearchModal;
