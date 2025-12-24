
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAlert, useDataState } from '../context/AppContext';
import { SpinnerIcon, CalendarIcon, ChevronDownIcon } from '../components/Icons';
import { executeUserQuery } from '../services/sqlService';
import ActionModal from '../components/ActionModal';

// --- Helper Functions ---
const isNumericColumn = (colName: string): boolean => {
    const numericKeywords = ['금액', '수량', '단가', '합계', '매출', '포인트', '가격', '금'];
    return numericKeywords.some(keyword => colName.includes(keyword));
};

const isBarcodeColumn = (colName: string): boolean => {
    if (!colName) return false;
    const lowerColName = colName.toLowerCase();
    return lowerColName.includes('barcode') || lowerColName.includes('바코드');
};

const formatNumericValue = (val: any): string => {
    if (typeof val === 'number') return val.toLocaleString();
    const strVal = String(val);
    const num = Number(strVal.replace(/,/g, ''));
    if (!isNaN(num) && isFinite(num) && /^-?\d+(\.\d+)?$/.test(strVal.replace(/,/g, ''))) {
        return num.toLocaleString();
    }
    return strVal;
};

const getLocalTodayString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

const RealtimeReportPage: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const { showAlert } = useAlert();
    const { userQueries } = useDataState();

    // --- State ---
    const [selectedDate, setSelectedDate] = useState(getLocalTodayString());
    const [activeTab, setActiveTab] = useState<'hourly' | 'customer' | 'category'>('hourly');
    const [reportData, setReportData] = useState<any[] | null>(null);
    const [status, setStatus] = useState<QueryStatus>('idle');
    const [error, setError] = useState<string | null>(null);

    // --- Detail Modal State ---
    const [isDetailOpen, setDetailOpen] = useState(false);
    const [detailResult, setDetailResult] = useState<any[] | null>(null);
    const [detailStatus, setDetailStatus] = useState<QueryStatus>('idle');
    const [detailError, setDetailError] = useState<string | null>(null);
    const [detailTitle, setDetailTitle] = useState('');

    // --- Main Report Query ---
    const runReportQuery = useCallback(async (tab: string, date: string) => {
        const config = {
            hourly: { name: '시간대별매출', label: '시간대별 매출' },
            customer: { name: '거래처별매출', label: '거래처별 매출' },
            category: { name: '대분류별매출', label: '대분류별 매출' },
        };
        const target = config[tab as keyof typeof config];
        const query = userQueries.find(q => q.isImportant && q.name === target.name);

        if (!query) {
            setError(`'${target.label}' 조회를 위한 중요 쿼리('${target.name}')가 없습니다.\nSQL Runner에서 쿼리를 추가하고 '중요'를 체크해주세요.`);
            setReportData(null);
            setStatus('error');
            return;
        }

        setStatus('loading');
        setError(null);
        try {
            // 다양한 쿼리 변수명 대응을 위해 파라미터 확장
            const params = { 
                date, 
                일자: date, 
                searchDate: date, 
                reportDate: date, 
                startDate: date, 
                endDate: date,
                start: date,
                end: date,
                dt: date
            };
            const result = await executeUserQuery(query.name, params, query.query);
            setReportData(result);
            setStatus('success');
        } catch (e: any) {
            setError(e.message || '데이터를 불러오는 데 실패했습니다.');
            setStatus('error');
        }
    }, [userQueries]);

    useEffect(() => {
        if (isActive) runReportQuery(activeTab, selectedDate);
    }, [isActive, activeTab, selectedDate, runReportQuery]);

    // --- Detail (Drill-down) Click Handler ---
    const handleRowClick = async (row: any) => {
        if (!row) return;

        const config = {
            hourly: { name: '시간대별매출_상세', suffix: '시 상세' },
            customer: { name: '거래처별매출_상세', suffix: ' 상세' },
            category: { name: '대분류별매출_상세', suffix: ' 상세' },
        };
        const target = config[activeTab];
        const detailQuery = userQueries.find(q => q.isImportant && q.name === target.name);

        if (!detailQuery) {
            showAlert(`상세 조회를 위한 중요 쿼리('${target.name}')가 없습니다.`);
            return;
        }

        const keys = Object.keys(row);
        let keyForDetail = keys[0];
        let titleForDetail = String(row[keyForDetail]);

        // 탭별 주요 키 찾기 로직
        if (activeTab === 'customer' || activeTab === 'category') {
            const codeKey = keys.find(k => k.toLowerCase().includes('code') || k.includes('코드'));
            const nameKey = keys.find(k => k.toLowerCase().includes('name') || k.includes('명'));
            if (codeKey) keyForDetail = codeKey;
            if (nameKey) titleForDetail = String(row[nameKey]);
        }

        let paramValue = row[keyForDetail];
        
        // 시간대별의 경우 숫자만 추출 (예: "09시" -> "09")
        if (activeTab === 'hourly') {
            const hourDigits = String(paramValue).match(/\d+/);
            paramValue = hourDigits ? hourDigits[0] : paramValue;
        }

        setDetailTitle(`${titleForDetail}${target.suffix}`);
        setDetailOpen(true);
        setDetailStatus('loading');
        setDetailError(null);
        setDetailResult(null);
        
        try {
            // --- 파라미터 바인딩 강화 ---
            // 클릭한 행의 모든 컬럼 값을 파라미터 베이스로 사용 (예: @매출액, @거래처명 등 자동 대응)
            const baseParams: Record<string, any> = {};
            Object.entries(row).forEach(([k, v]) => {
                // 콤마 제거된 순수 값 전달
                baseParams[k] = typeof v === 'string' ? v.replace(/,/g, '') : v;
            });

            // 공통 변수 및 별칭(Alias) 주입
            const finalParams = { 
                ...baseParams,
                [keyForDetail]: paramValue, 
                value: paramValue, 
                code: paramValue,
                target: paramValue,
                // 탭별 특화 변수
                comcode: activeTab === 'customer' ? paramValue : (baseParams.comcode || baseParams.거래처코드 || ''),
                gubun1: activeTab === 'category' ? paramValue : (baseParams.gubun1 || baseParams.대분류코드 || ''),
                hour: activeTab === 'hourly' ? paramValue : '',
                시간: activeTab === 'hourly' ? paramValue : '',
                // 날짜 관련 모든 변수명 대응
                date: selectedDate, 
                일자: selectedDate, 
                searchDate: selectedDate,
                reportDate: selectedDate,
                startDate: selectedDate,
                endDate: selectedDate,
                start: selectedDate,
                end: selectedDate
            };

            const result = await executeUserQuery(detailQuery.name, finalParams, detailQuery.query);
            setDetailResult(result);
            setDetailStatus('success');
        } catch (e: any) {
            setDetailError(e.message);
            setDetailStatus('error');
        }
    };

    const d = new Date(selectedDate + 'T00:00:00');
    const formattedDateDisplay = `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}.`;

    return (
        <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
            {/* 상단 필터/탭 */}
            <div className="p-3 bg-white border-b border-gray-200 space-y-3 flex-shrink-0">
                <div className="relative flex items-center justify-center h-12 border border-gray-200 rounded-xl bg-white shadow-sm">
                    <CalendarIcon className="absolute left-4 w-5 h-5 text-gray-400 pointer-events-none" />
                    <span className="text-lg font-bold text-gray-800">{formattedDateDisplay}</span>
                    <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                    <ChevronDownIcon className="absolute right-4 w-5 h-5 text-gray-400 pointer-events-none" />
                </div>
                <div className="flex bg-gray-100 rounded-lg p-1">
                    {(['hourly', 'customer', 'category'] as const).map((tab) => (
                        <button 
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`flex-1 py-2 px-2 rounded-md text-xs font-bold transition-all ${activeTab === tab ? 'bg-white text-blue-600 shadow' : 'text-gray-500'}`}
                        >
                            {tab === 'hourly' ? '시간대별' : tab === 'customer' ? '거래처별' : '대분류별'}
                        </button>
                    ))}
                </div>
            </div>

            {/* 본문 테이블 */}
            <div className="flex-grow overflow-y-auto p-2">
                {status === 'loading' && <div className="flex items-center justify-center h-full"><SpinnerIcon className="w-8 h-8 text-blue-500 animate-spin" /></div>}
                {status === 'error' && <div className="p-4 text-center text-red-600 bg-red-50 rounded-xl whitespace-pre-line text-sm border border-red-100">{error}</div>}
                {status === 'success' && reportData && (
                    reportData.length > 0 ? (
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-50 text-gray-500 border-b border-gray-100">
                                    <tr>
                                        {Object.keys(reportData[0]).filter(k => !isBarcodeColumn(k)).map((k, i) => (
                                            <th key={k} className={`px-4 py-2.5 font-bold ${i === 0 ? 'text-left' : 'text-right'}`}>{k}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {reportData.map((row, i) => (
                                        <tr key={i} className="hover:bg-blue-50 active:bg-blue-100 cursor-pointer transition-colors" onClick={() => handleRowClick(row)}>
                                            {Object.entries(row).filter(([k]) => !isBarcodeColumn(k)).map(([k, v], j) => (
                                                <td key={j} className={`px-4 py-3 whitespace-nowrap ${j === 0 ? 'text-left font-bold text-gray-700' : 'text-right font-mono text-gray-600'}`}>
                                                    {isNumericColumn(k) ? formatNumericValue(v) : String(v)}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-64 text-gray-400"><p>조회된 내역이 없습니다.</p></div>
                    )
                )}
            </div>

            {/* 상세 내역 모달 */}
            <ActionModal isOpen={isDetailOpen} onClose={() => setDetailOpen(false)} title={detailTitle} zIndexClass="z-[100]" disableBodyScroll>
                <div className="flex flex-col h-full bg-gray-50">
                    <div className="flex-grow overflow-auto p-2">
                        {detailStatus === 'loading' && <div className="flex items-center justify-center h-40"><SpinnerIcon className="w-8 h-8 text-blue-500 animate-spin" /></div>}
                        {detailStatus === 'error' && <div className="p-4 text-red-600 text-center font-bold bg-white rounded-xl border border-red-100 m-2 shadow-sm whitespace-pre-wrap">{detailError}</div>}
                        {detailStatus === 'success' && detailResult && (
                            detailResult.length > 0 ? (
                                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                                    <table className="min-w-full text-xs text-left">
                                        <thead className="bg-gray-100 text-gray-600 font-bold border-b">
                                            <tr>{Object.keys(detailResult[0]).filter(k => !isBarcodeColumn(k)).map(k => <th key={k} className={`px-3 py-2 ${isNumericColumn(k) ? 'text-right' : ''}`}>{k}</th>)}</tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {detailResult.map((row, i) => (
                                                <tr key={i} className="hover:bg-gray-50">
                                                    {Object.entries(row).filter(([k]) => !isBarcodeColumn(k)).map(([k, v], j) => <td key={j} className={`px-3 py-2 whitespace-nowrap ${isNumericColumn(k) ? 'text-right font-mono' : ''}`}>{isNumericColumn(k) ? formatNumericValue(v) : String(v)}</td>)}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : <div className="p-8 text-center text-gray-400">상세 내역이 없습니다.</div>
                        )}
                    </div>
                    <div className="p-3 bg-white border-t safe-area-pb">
                        <button onClick={() => setDetailOpen(false)} className="w-full py-3 bg-gray-100 text-gray-700 font-bold rounded-xl active:scale-95 transition-transform">닫기</button>
                    </div>
                </div>
            </ActionModal>
        </div>
    );
};

export default RealtimeReportPage;
