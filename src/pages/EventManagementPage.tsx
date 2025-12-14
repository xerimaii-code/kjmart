
import React, { useState, useEffect, useRef } from 'react';
import { executeUserQuery } from '../services/sqlService';
import { useAlert } from '../context/AppContext';
import { SpinnerIcon, SearchIcon } from '../components/Icons';
import ActionModal from '../components/ActionModal';

interface EventItem {
    salename: string;   // 행사명
    startday: string;   // 시작일
    endday: string;     // 종료일
    isappl: string;     // 적용상태 (0:미적용, 1:적용, 2:완료)
    saletype?: string;  // 종류 (optional, if exists in SQL)
    gubun?: string;     // 종류 alternative
    inputdate: string;  // 등록일
    marginrate?: string | number; // 평균마진율
    junno?: string;     // 전표번호
    [key: string]: any; // Allow other props
}

const EventManagementPage: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const { showToast, showAlert } = useAlert();

    // Default dates: Start of current month to end of current month
    const [startDate, setStartDate] = useState(() => {
        const now = new Date();
        // 1st day of current month
        return new Date(now.getFullYear(), now.getMonth(), 1, 12).toISOString().slice(0, 10);
    });
    const [endDate, setEndDate] = useState(() => {
        const now = new Date();
        // Last day of current month (day 0 of next month)
        return new Date(now.getFullYear(), now.getMonth() + 1, 0, 12).toISOString().slice(0, 10);
    });

    const [statusFilter, setStatusFilter] = useState<'all' | '0' | '1' | '2'>('all');
    const [events, setEvents] = useState<EventItem[]>([]);
    
    // [MODIFIED] Set default loading to true to show spinner immediately on open (matches auto-search logic)
    const [isLoading, setIsLoading] = useState(true);
    const [isSearched, setIsSearched] = useState(true); // Default to true as we auto-search

    // Detail Modal State
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);
    const [detailData, setDetailData] = useState<any[]>([]);
    const [isDetailLoading, setIsDetailLoading] = useState(false);

    // Ref to prevent double auto-search on strict mode
    const hasAutoSearched = useRef(false);

    // SQL execution for Main List
    const handleSearch = async (silent: boolean = false) => {
        setIsLoading(true);
        setEvents([]);
        setIsSearched(true);

        try {
            // Pass parameters to the query
            const params = {
                startDate,
                endDate,
                status: statusFilter === 'all' ? '' : statusFilter
            };

            // Use built-in '행사목록' query directly from api/sql.ts
            const result = await executeUserQuery('행사목록', params);
            
            // Normalize keys to lowercase for safety
            const mappedResults = result.map(item => {
                const lowerItem: any = {};
                Object.keys(item).forEach(key => {
                    lowerItem[key.toLowerCase()] = item[key];
                });
                // Fallback mapping if exact keys don't match
                return {
                    ...lowerItem,
                    salename: lowerItem.salename || lowerItem.행사명 || '',
                    startday: lowerItem.startday || lowerItem.시작일 || '',
                    endday: lowerItem.endday || lowerItem.종료일 || '',
                    isappl: String(lowerItem.isappl ?? lowerItem.상태 ?? '0'),
                    saletype: lowerItem.itemcount || lowerItem.행사품목수 || lowerItem.saletype || lowerItem.gubun || lowerItem.종류 || '',
                    inputdate: lowerItem.appendday || lowerItem.inputdate || lowerItem.등록일자 || lowerItem.등록일 || '',
                    marginrate: lowerItem.marginrate || lowerItem.평균마진율 || 0,
                    junno: lowerItem.junno || lowerItem.전표번호 || ''
                } as EventItem;
            });

            setEvents(mappedResults);
            
            if (!silent) {
                if (mappedResults.length === 0) {
                    showToast('조건에 맞는 행사 내역이 없습니다.', 'error');
                } else {
                    showToast(`${mappedResults.length}건이 조회되었습니다.`, 'success');
                }
            }

        } catch (error: any) {
            console.error("Event search error:", error);
            if (!silent) showAlert(`검색 중 오류가 발생했습니다.\n${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    // Auto-search on mount
    useEffect(() => {
        if (isActive && !hasAutoSearched.current) {
            hasAutoSearched.current = true;
            handleSearch(true); // Silent search
        }
    }, [isActive]);

    // SQL execution for Details
    const handleRowClick = async (event: EventItem) => {
        if (!event.junno) {
            showToast('전표번호(junno)가 없어 상세 내역을 조회할 수 없습니다.', 'error');
            return;
        }

        setSelectedEvent(event);
        setDetailModalOpen(true);
        setIsDetailLoading(true);
        setDetailData([]);

        try {
            // Support multiple parameter names for junno
            const params = {
                junno: event.junno,
                전표번호: event.junno
            };

            // Use built-in '행사상세' query directly
            const result = await executeUserQuery('행사상세', params);
            
            // Client-side filtering as safeguard (though server query handles it)
            const filteredResult = result.filter(item => {
                const itemJunno = item.junno || item.Junno || item.JUNNO || item.전표번호;
                if (itemJunno !== undefined && itemJunno !== null) {
                    return String(itemJunno).trim() === String(event.junno).trim();
                }
                return true;
            });

            // Sort details by Product Name (상품명) Ascending
            const sortedResult = [...filteredResult].sort((a, b) => {
                const nameA = String(a['상품명'] || a['품명'] || a['descr'] || a['name'] || '').trim();
                const nameB = String(b['상품명'] || b['품명'] || b['descr'] || b['name'] || '').trim();
                return nameA.localeCompare(nameB, 'ko');
            });

            setDetailData(sortedResult);

        } catch (error: any) {
            console.error("Detail search error:", error);
            showAlert(`상세 조회 중 오류가 발생했습니다.\n${error.message}`);
        } finally {
            setIsDetailLoading(false);
        }
    };

    // Helper to format date (remove time if present)
    const formatDate = (dateStr: string) => {
        if (!dateStr) return '';
        return dateStr.split('T')[0];
    };

    // Helper for Status Badge
    const renderStatusBadge = (status: string) => {
        switch (status) {
            case '1': // 적용 (Applied)
                return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200 whitespace-nowrap">적용</span>;
            case '2': // 완료 (Completed)
                return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-500 border border-gray-200 whitespace-nowrap">완료</span>;
            case '0': // 미적용 (Unapplied)
            default:
                return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 whitespace-nowrap">미적용</span>;
        }
    };

    // Helper to detect numeric columns for alignment
    const isNumericColumn = (colName: string): boolean => {
        const numericKeywords = ['금액', '수량', '단가', '합계', '매출', '포인트', '가격', '마진', '율', '가'];
        return numericKeywords.some(keyword => colName.includes(keyword));
    };

    const formatNumericValue = (val: any): string => {
        if (typeof val === 'number') {
            return val.toLocaleString();
        }
        const strVal = String(val);
        const num = Number(strVal.replace(/,/g, ''));
        if (!isNaN(num) && isFinite(num)) {
            // Check if original string looks like a number
            if (/^-?\d+(\.\d+)?$/.test(strVal.replace(/,/g, ''))) {
                return num.toLocaleString();
            }
        }
        return strVal;
    };

    // Safe formatter for margin rate
    const formatMarginRate = (rate: any) => {
        const num = Number(rate);
        if (isNaN(num)) return '-';
        return num.toFixed(1) + '%';
    };

    return (
        <div className="flex flex-col h-full bg-gray-50">
            {/* Header: Filters & Search */}
            <div className="p-3 bg-white border-b border-gray-200 shadow-sm z-10 flex-shrink-0 space-y-2">
                <div className="flex items-center gap-2">
                    <input 
                        type="date" 
                        value={startDate} 
                        onChange={(e) => setStartDate(e.target.value)} 
                        className="flex-1 h-10 border border-gray-300 rounded-lg px-2 text-sm font-bold text-gray-700 bg-white shadow-sm focus:ring-2 focus:ring-indigo-500"
                    />
                    <span className="text-gray-400 font-bold">~</span>
                    <input 
                        type="date" 
                        value={endDate} 
                        onChange={(e) => setEndDate(e.target.value)} 
                        className="flex-1 h-10 border border-gray-300 rounded-lg px-2 text-sm font-bold text-gray-700 bg-white shadow-sm focus:ring-2 focus:ring-indigo-500"
                    />
                </div>
                <div className="flex gap-2">
                    <div className="relative flex-grow">
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as any)}
                            className="w-full h-10 pl-3 pr-8 border border-gray-300 rounded-lg appearance-none bg-white text-sm font-bold text-gray-700 focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="all">전체 상태</option>
                            <option value="1">적용 (진행중)</option>
                            <option value="2">완료 (종료)</option>
                            <option value="0">미적용 (대기)</option>
                        </select>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                        </div>
                    </div>
                    <button 
                        onClick={() => handleSearch(false)} 
                        disabled={isLoading}
                        className="h-10 px-5 bg-indigo-600 text-white rounded-lg font-bold text-sm shadow-md active:scale-95 flex items-center gap-2 disabled:bg-gray-400 transition-colors"
                    >
                        {isLoading ? <SpinnerIcon className="w-4 h-4 animate-spin"/> : <SearchIcon className="w-4 h-4"/>}
                        검색
                    </button>
                </div>
            </div>

            {/* Content: Fixed Header Table */}
            <div className="flex-grow overflow-auto relative">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-full">
                        <SpinnerIcon className="w-10 h-10 text-indigo-500 animate-spin" />
                        <p className="mt-4 text-gray-500 font-medium">행사 목록을 불러오는 중...</p>
                    </div>
                ) : events.length > 0 ? (
                    <div className="min-w-full inline-block align-middle">
                        <div className="border-b border-gray-200">
                            <table className="min-w-full text-sm text-left border-collapse">
                                <thead className="bg-gray-100 text-gray-600 font-bold sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th className="px-3 py-2.5 whitespace-nowrap border-b border-gray-200 text-center w-16">상태</th>
                                        <th className="px-3 py-2.5 whitespace-nowrap border-b border-gray-200">행사명</th>
                                        <th className="px-3 py-2.5 whitespace-nowrap border-b border-gray-200 text-center w-24">기간</th>
                                        <th className="px-3 py-2.5 whitespace-nowrap border-b border-gray-200 text-center">품목수</th>
                                        <th className="px-3 py-2.5 whitespace-nowrap border-b border-gray-200 text-right">마진율</th>
                                        <th className="px-3 py-2.5 whitespace-nowrap border-b border-gray-200 text-center">전표번호</th>
                                        <th className="px-3 py-2.5 whitespace-nowrap border-b border-gray-200 text-center">등록일</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 bg-white">
                                    {events.map((evt, idx) => (
                                        <tr 
                                            key={idx} 
                                            onClick={() => handleRowClick(evt)}
                                            className="hover:bg-indigo-50 transition-colors cursor-pointer active:bg-indigo-100"
                                        >
                                            <td className="px-3 py-2 text-center align-middle">
                                                {renderStatusBadge(evt.isappl)}
                                            </td>
                                            <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap align-middle">
                                                {evt.salename}
                                            </td>
                                            <td className="px-3 py-2 text-center text-xs whitespace-nowrap align-middle">
                                                <span className="text-gray-800 font-normal">
                                                    {formatDate(evt.startday)} ~ {formatDate(evt.endday)}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-center text-xs text-gray-600 whitespace-nowrap align-middle">
                                                {evt.saletype}
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono text-gray-700 whitespace-nowrap align-middle">
                                                {formatMarginRate(evt.marginrate)}
                                            </td>
                                            <td className="px-3 py-2 text-center text-xs text-gray-500 font-mono whitespace-nowrap align-middle">
                                                {evt.junno}
                                            </td>
                                            <td className="px-3 py-2 text-center text-xs text-gray-400 whitespace-nowrap align-middle">
                                                {formatDate(evt.inputdate)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 p-8 text-center">
                        {isSearched ? (
                            <>
                                <p className="font-bold text-lg">검색 결과가 없습니다.</p>
                                <p className="text-sm mt-1">기간이나 상태 조건을 변경해보세요.</p>
                            </>
                        ) : (
                            <>
                                <SearchIcon className="w-12 h-12 mb-3 opacity-20" />
                                <p className="font-bold">행사 상품 검색</p>
                                <p className="text-sm mt-1">기간을 선택하고 검색 버튼을 눌러주세요.</p>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Detail Modal */}
            <ActionModal
                isOpen={detailModalOpen}
                onClose={() => setDetailModalOpen(false)}
                // [MODIFIED] Show only the event name as the title, removing the transaction number
                title={selectedEvent ? selectedEvent.salename : '행사 상세 내역'}
                disableBodyScroll
                zIndexClass="z-[60]"
            >
                <div className="flex flex-col h-full bg-white relative">
                    {isDetailLoading ? (
                        <div className="flex flex-col items-center justify-center h-full">
                            <SpinnerIcon className="w-10 h-10 text-indigo-500 animate-spin" />
                            <p className="mt-4 text-gray-500 font-medium">상세 내역을 불러오는 중...</p>
                        </div>
                    ) : detailData.length > 0 ? (
                        <div className="flex-grow overflow-auto">
                            <table className="min-w-full text-sm text-left border-collapse">
                                <thead className="bg-gray-100 text-gray-700 font-bold sticky top-0 z-10 shadow-sm border-b border-gray-200">
                                    <tr>
                                        {Object.keys(detailData[0]).map((key) => (
                                            <th key={key} className={`px-4 py-3 whitespace-nowrap border-b border-gray-200 ${isNumericColumn(key) ? 'text-right' : ''}`}>
                                                {key}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {detailData.map((row, idx) => (
                                        <tr key={idx} className="hover:bg-gray-50">
                                            {Object.entries(row).map(([key, val], vIdx) => (
                                                <td key={vIdx} className={`px-4 py-3 whitespace-nowrap text-gray-700 ${isNumericColumn(key) ? 'text-right font-mono' : ''}`}>
                                                    {isNumericColumn(key) ? formatNumericValue(val) : String(val)}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-500">
                            상세 내역이 없습니다.
                        </div>
                    )}
                </div>
            </ActionModal>
        </div>
    );
};

export default EventManagementPage;
