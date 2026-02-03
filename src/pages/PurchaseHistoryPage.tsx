
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { executeUserQuery, extractParamsForQuery } from '../services/sqlService';
import { useAlert, useDataState } from '../context/AppContext';
import { SpinnerIcon, SearchIcon, XMarkIcon } from '../components/Icons';
import SearchDropdown from '../components/SearchDropdown';
import { Customer } from '../types';
import { useSortedCustomers } from '../hooks/useSortedCustomers';
import ActionModal from '../components/ActionModal';

interface PurchaseHistoryItem {
    매입일자: string;
    전표번호: string;
    거래처명: string;
    매입금액: number;
    반품액: number;
    합계금액: number;
    비고?: string;
    거래처코드?: string;
    [key: string]: any;
}

interface PurchaseDetailItem {
    rowType: 'purchase' | 'return';
    바코드: string;
    상품명: string;
    규격: string;
    수량: number;
    매입단가: number;
    금액: number;
    [key: string]: any;
}

const PurchaseHistoryPage: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const { showToast, showAlert } = useAlert();
    const { customers, userQueries } = useDataState();
    const { sortedCustomers, recordUsage } = useSortedCustomers(customers);

    // Dates
    const [startDate, setStartDate] = useState(() => {
        const now = new Date();
        now.setDate(now.getDate() - 7); // 기본: 최근 7일
        return now.toISOString().slice(0, 10);
    });
    const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

    // Supplier Search
    const [supplierSearch, setSupplierSearch] = useState('');
    const [selectedSupplier, setSelectedSupplier] = useState<Customer | null>(null);
    const [showDropdown, setShowDropdown] = useState(false);
    const supplierInputRef = useRef<HTMLInputElement>(null);
    const blurTimeoutRef = useRef<number | null>(null);

    // Results
    const [results, setResults] = useState<PurchaseHistoryItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);

    // Detail Modal State
    const [isDetailOpen, setDetailOpen] = useState(false);
    const [detailData, setDetailData] = useState<PurchaseDetailItem[]>([]);
    const [isDetailLoading, setIsDetailLoading] = useState(false);
    const [selectedSummary, setSelectedSummary] = useState<PurchaseHistoryItem | null>(null);

    // Calculate Grand Total
    const grandTotal = useMemo(() => {
        return Math.floor(results.reduce((sum, item) => sum + (Number(item.합계금액) || 0), 0));
    }, [results]);

    // --- Search Logic ---
    const handleSearch = async () => {
        setIsLoading(true);
        setResults([]);
        setHasSearched(true);

        try {
            const userProvidedQuery = `
-- [매입 목록 조회] 전체/개별 거래처 통합 조회 (SQL 2005 호환)
SET NOCOUNT ON;

DECLARE @p_StartDate  VARCHAR(10);
DECLARE @p_EndDate    VARCHAR(10);
DECLARE @p_ComCode    VARCHAR(5);

-- ★ 앱에서 "전체" 선택 시 빈 값('')을 보내주세요.
SET @p_StartDate = @startDate;
SET @p_EndDate   = @endDate;
SET @p_ComCode   = @comcode;   -- 값이 있으면 개별, 없으면('') 전체

DECLARE @FinalSQL     NVARCHAR(MAX);
DECLARE @UnionStr     NVARCHAR(10);
DECLARE @CurrDate     DATETIME;
DECLARE @EndTarget    DATETIME;
DECLARE @YYMM         VARCHAR(4);
DECLARE @TableName    VARCHAR(20);

SET @FinalSQL    = N'';
SET @UnionStr    = N'';
SET @CurrDate    = CONVERT(DATETIME, @p_StartDate);
SET @EndTarget   = CONVERT(DATETIME, @p_EndDate);
SET @CurrDate    = DATEADD(MONTH, DATEDIFF(MONTH, 0, @CurrDate), 0); -- 매월 1일로 셋팅

WHILE @CurrDate <= @EndTarget
BEGIN
    SET @YYMM = CONVERT(VARCHAR(4), @CurrDate, 12); 
    SET @TableName = 'ipgom_' + @YYMM;

    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @TableName)
    BEGIN
        SET @FinalSQL = @FinalSQL + @UnionStr + N'
            SELECT 
                  A.day1             AS day1
                , A.junno            AS junno
                , ISNULL(B.comname, ''미등록거래처'') AS comname
                , ISNULL(A.ipgo, 0)   AS ipgo
                , ISNULL(A.banpum, 0) AS banpum
                , (ISNULL(A.ipgo, 0) - ISNULL(A.banpum, 0)) AS tmoney1
                , A.remark           AS remark
                , A.comcode          AS comcode
            FROM ' + @TableName + ' A WITH(NOLOCK)
            LEFT OUTER JOIN comp B WITH(NOLOCK) ON A.comcode = B.comcode
            WHERE A.day1 BETWEEN ''' + @p_StartDate + ''' AND ''' + @p_EndDate + '''
        ';

        -- [핵심] 코드가 있을 때만 AND 조건을 붙입니다. (빈 값이면 전체 조회됨)
        IF @p_ComCode IS NOT NULL AND @p_ComCode <> ''
        BEGIN
            SET @FinalSQL = @FinalSQL + N' AND A.comcode = ''' + @p_ComCode + '''';
        END

        SET @UnionStr = N' UNION ALL ';
    END
    SET @CurrDate = DATEADD(MONTH, 1, @CurrDate);
END

IF @FinalSQL <> N''
BEGIN
    SET @FinalSQL = @FinalSQL + N' ORDER BY day1 DESC, junno DESC';
    EXEC sp_executesql @FinalSQL;
END
ELSE
BEGIN
    SELECT 'NO_DATA' AS [RESULT], '조회된 기간에 매입 내역이 없습니다.' AS [MSG];
END`;

            const params = {
                startDate: startDate,
                endDate: endDate,
                comcode: selectedSupplier ? selectedSupplier.comcode : '' // Use empty string for 'all'
            };
            
            const data = await executeUserQuery('매입내역', params, userProvidedQuery);

            if (!Array.isArray(data)) {
                throw new Error('서버로부터 올바른 형식의 데이터를 받지 못했습니다.');
            }
            
            if (data.length > 0 && data[0] && (data[0].RESULT === 'NO_DATA' || data[0].메시지)) {
                setResults([]);
                showToast(data[0].MSG || data[0].메시지 || '조회된 내역이 없습니다.', 'error');
            } else {
                const mappedResults = data.map((item: any) => {
                    const purchaseAmount = Number(item.매입금액 || item.매입공급가 || item.ipgo || 0);
                    const returnAmount = Number(item.반품액 || item.banpum || 0);
                    const totalAmount = purchaseAmount - returnAmount;
                    
                    return {
                        ...item,
                        거래처명: item.거래처명 || item.comname || '거래처 불명',
                        매입금액: purchaseAmount,
                        반품액: returnAmount,
                        합계금액: totalAmount,
                        매입일자: item.매입일자 || item.day1 || '',
                        전표번호: item.전표번호 || item.junno || ''
                    };
                });
                setResults(mappedResults);
                if (mappedResults.length > 0) {
                    showToast(`${mappedResults.length}건이 조회되었습니다.`, 'success');
                }
            }
        } catch (error: any) {
            console.error("Purchase history search error:", error);
            showAlert(`조회 중 오류 발생: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    // --- Detail View Logic ---
    const handleItemClick = async (item: PurchaseHistoryItem) => {
        setSelectedSummary(item);
        // FIX: Replaced incorrect 'setIsDetailOpen(true)' with correct state setter 'setDetailOpen(true)'
        setDetailOpen(true);
        setIsDetailLoading(true);
        setDetailData([]);

        try {
            const query = userQueries.find(q => q.name === '매입내역_상세');
            if (!query) {
                showAlert("'매입내역_상세' 쿼리를 찾을 수 없습니다. [설정]에서 쿼리가 존재하는지 확인해주세요.");
                return;
            }

            const dateStr = String(item.매입일자).substring(0, 10);
            
            const params = {
                ClickDate: dateStr,
                ClickJunno: item.전표번호
            };
            
            const dynamicParams = extractParamsForQuery(query.query, params);
            const data = await executeUserQuery(query.name, dynamicParams, query.query);
            
            if (data.length > 0 && data[0].RESULT === 'NO_DATA') {
                setDetailData([]);
            } else {
                const mappedDetails: PurchaseDetailItem[] = [];
                data.forEach((d: any) => {
                    const common = {
                        상품명: d.상품명 || d.descr || '',
                        규격: d.규격 || d.spec || '',
                        바코드: d.바코드 || d.barcode || '',
                        매입단가: Number(d.money0vat_d || d.매입단가 || d.money0vat || 0),
                    };
                    const purchaseQty = Number(d.iitemcount || d.매입수량 || 0);
                    if (purchaseQty > 0) {
                        mappedDetails.push({
                            ...common,
                            rowType: 'purchase',
                            수량: purchaseQty,
                            금액: Number(d.매입액 || d.ipgo || 0),
                        });
                    }
                    const returnQty = Number(d.bitemcount || d.반품수량 || 0);
                    if (returnQty > 0) {
                        mappedDetails.push({
                            ...common,
                            rowType: 'return',
                            수량: -returnQty,
                            금액: -Number(d.반품액 || d.banpum || 0),
                        });
                    }
                });
                setDetailData(mappedDetails);
            }
        } catch (e: any) {
            console.error("Detail fetch error:", e);
            showAlert(`상세 내역 로드 실패: ${e.message}`);
        } finally {
            setIsDetailLoading(false);
        }
    };

    // --- Supplier Selection Logic ---
    const filteredSuppliers = useMemo(() => {
        const term = supplierSearch.toLowerCase();
        const allOption: Customer = { comcode: '', name: '전체 거래처 (전체선택)' };
        let list = sortedCustomers;

        if (term) {
            list = sortedCustomers.filter(c => 
                c.name.toLowerCase().includes(term) || c.comcode.includes(term)
            );
        }
        return [allOption, ...list.slice(0, 50)];
    }, [sortedCustomers, supplierSearch]);

    const handleSelectSupplier = (c: Customer) => {
        if (c.comcode === '') {
            setSelectedSupplier(null);
            setSupplierSearch('전체 거래처');
        } else {
            setSelectedSupplier(c);
            setSupplierSearch(c.name);
            recordUsage(c.comcode);
        }
        setShowDropdown(false);
    };

    const handleClearSupplier = () => {
        setSelectedSupplier(null);
        setSupplierSearch('');
        setTimeout(() => supplierInputRef.current?.focus(), 50);
    };

    const formatCurrency = (val: any) => {
        const num = Number(val);
        return isNaN(num) ? val : num.toLocaleString();
    };

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '';
        return dateStr.length >= 10 ? dateStr.substring(0, 10) : dateStr;
    }

    return (
        <div className="flex flex-col h-full bg-gray-50">
            <div className="p-3 bg-white border-b border-gray-200 shadow-sm z-20 flex-shrink-0 space-y-3">
                <div className="flex items-center gap-2">
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="flex-1 h-10 border border-gray-300 rounded-lg px-2 text-sm font-bold text-gray-700 bg-white shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"/>
                    <span className="text-gray-400 font-bold">~</span>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="flex-1 h-10 border border-gray-300 rounded-lg px-2 text-sm font-bold text-gray-700 bg-white shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"/>
                </div>

                <div className="flex gap-2 items-stretch">
                    <div className="relative flex-grow">
                        <input ref={supplierInputRef} type="text" value={supplierSearch} onChange={(e) => { setSupplierSearch(e.target.value); setShowDropdown(true); }} onFocus={() => { if(blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current); setShowDropdown(true); }} onBlur={() => { blurTimeoutRef.current = window.setTimeout(() => setShowDropdown(false), 200); }} placeholder="거래처 검색 (전체선택)" className={`w-full h-10 pl-3 pr-8 border border-gray-300 rounded-lg text-sm font-bold transition-all focus:ring-2 focus:ring-blue-500 outline-none ${selectedSupplier || supplierSearch === '전체 거래처' ? 'bg-blue-50 text-blue-800 border-blue-300' : 'bg-white text-gray-700'}`}/>
                        {(selectedSupplier || supplierSearch) && <button onClick={handleClearSupplier} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"><XMarkIcon className="w-4 h-4" /></button>}
                        <SearchDropdown<Customer> items={filteredSuppliers} show={showDropdown} renderItem={(c) => (
                            <div onMouseDown={(e) => { e.preventDefault(); handleSelectSupplier(c); }} className={`p-3 hover:bg-gray-50 cursor-pointer border-b last:border-b-0 ${c.comcode === '' ? 'text-blue-600 font-bold bg-blue-50/30' : ''}`}>
                                <p className="font-bold text-sm">{c.name}</p>
                                {c.comcode && <p className="text-xs text-gray-500 mt-0.5">{c.comcode}</p>}
                            </div>
                        )} />
                    </div>
                    <button 
                        onClick={handleSearch} 
                        disabled={isLoading}
                        className="w-12 h-10 bg-blue-600 text-white rounded-lg flex items-center justify-center font-bold hover:bg-blue-700 transition active:scale-95 shadow-md flex-shrink-0 disabled:bg-gray-400"
                        aria-label="조회"
                    >
                        {isLoading ? <SpinnerIcon className="w-5 h-5 animate-spin" /> : <SearchIcon className="w-5 h-5" />}
                    </button>
                </div>
            </div>

            <div className="flex-grow overflow-auto relative p-2">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-40 mt-10"><SpinnerIcon className="w-10 h-10 text-blue-500 animate-spin" /><p className="mt-4 text-gray-500 font-medium">데이터 로딩 중...</p></div>
                ) : results.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-400"><SearchIcon className="w-16 h-16 text-gray-200 mb-4" /><p className="text-lg font-semibold">{hasSearched ? '조회된 내역이 없습니다.' : '조건을 선택하고 검색 버튼을 눌러주세요.'}</p></div>
                ) : (
                    <div className="space-y-1 pb-16">
                        {results.map((item, idx) => (
                            <div key={idx} onClick={() => handleItemClick(item)} className="bg-white px-3 py-1.5 rounded-lg border border-gray-200 shadow-sm flex flex-col gap-1 cursor-pointer active:bg-blue-50 active:border-blue-300 transition-all hover:shadow-md animate-card-enter" style={{ animationDelay: `${Math.min(idx * 20, 300)}ms` }}>
                                <div className="flex justify-between items-start border-b border-gray-50 pb-1">
                                    <div className="flex flex-col min-w-0">
                                        <h3 className="font-bold text-gray-800 text-[15px] truncate">{item.거래처명}</h3>
                                        <span className="text-[10px] text-gray-400 font-mono leading-none">{item.거래처코드}</span>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-md">{formatDate(item.매입일자)}</span>
                                            <span className="text-[10px] text-gray-300 font-mono">#{item.전표번호}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-1 py-0.5">
                                    <div className="flex flex-col"><span className="text-[10px] text-gray-400 leading-tight">매입</span><span className="font-semibold text-gray-700 text-xs">{formatCurrency(item.매입금액)}</span></div>
                                    <div className="flex flex-col text-center"><span className="text-[10px] text-gray-400 leading-tight">반품</span><span className={`font-semibold text-xs ${Number(item.반품액) > 0 ? 'text-rose-600' : 'text-gray-300'}`}>{formatCurrency(item.반품액)}</span></div>
                                    <div className="flex flex-col text-right"><span className="text-[10px] text-gray-400 leading-tight">합계</span><span className="font-bold text-blue-600 text-[13px]">{formatCurrency(item.합계금액)}</span></div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {results.length > 0 && (
                <div className="bg-white border-t border-gray-200 px-4 py-2 flex justify-between items-center shadow-[0_-2px_10px_rgba(0,0,0,0.05)] z-20 safe-area-pb flex-shrink-0">
                    <span className="text-sm font-bold text-gray-500">총 {results.length}건 합계</span>
                    <span className="text-xl font-black text-indigo-600 tabular-nums">{grandTotal.toLocaleString()} <span className="text-xs font-normal text-gray-400 ml-0.5">원</span></span>
                </div>
            )}

            <ActionModal isOpen={isDetailOpen} onClose={() => setDetailOpen(false)} title={`${selectedSummary?.거래처명 || '상세 내역'}`} zIndexClass="z-[80]" disableBodyScroll>
                <div className="flex flex-col h-full bg-gray-50">
                    <div className="flex-grow overflow-auto">
                        {isDetailLoading ? (
                            <div className="flex flex-col items-center justify-center h-40"><SpinnerIcon className="w-8 h-8 text-blue-500 animate-spin" /><p className="mt-4 text-gray-500 font-medium">상세 정보 수신 중...</p></div>
                        ) : detailData.length === 0 ? (
                            <div className="p-10 text-center text-gray-400 font-bold">상세 내역이 없습니다.</div>
                        ) : (
                            <div className="divide-y divide-gray-100 bg-white">
                                {detailData.map((item, idx) => (
                                    <div key={idx} className="p-3 flex justify-between items-start gap-3">
                                        <div className="min-w-0 flex-grow">
                                            <p className="font-bold text-gray-800 text-sm break-words leading-tight">{item.상품명}</p>
                                            <p className="text-[10px] text-gray-400 font-mono mt-1">{item.바코드} | {item.규격}</p>
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                            <div className="flex items-center justify-end gap-1.5 mb-1">
                                                <span className={`text-[11px] font-bold px-1.5 rounded ${item.rowType === 'return' ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'}`}>
                                                    {item.수량.toLocaleString()}개
                                                </span>
                                                <span className="text-[10px] text-gray-400">@{item.매입단가.toLocaleString()}</span>
                                            </div>
                                            <p className={`font-bold text-sm ${item.rowType === 'return' ? 'text-rose-600' : 'text-gray-800'}`}>{item.금액.toLocaleString()}원</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
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

export default PurchaseHistoryPage;
