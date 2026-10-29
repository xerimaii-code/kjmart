import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAlert, useScanner, useMiscUI } from '../context/AppContext';
import { Product, AuditedItem, InventoryAuditDraft } from '../types';
import { SpinnerIcon, TrashIcon, CheckCircleIcon, BarcodeScannerIcon, ChevronDownIcon, SearchIcon, WarningIcon } from '../components/Icons';
import { useProductSearch } from '../hooks/useProductSearch';
import { useDraft } from '../hooks/useDraft';
import { useDebounce } from '../hooks/useDebounce';
import StockAuditItemModal from '../components/StockAuditItemModal';
import { executeUserQuery } from '../services/sqlService';
import SearchDropdown from '../components/SearchDropdown';
import ProductSearchResultItem from '../components/ProductSearchResultItem';

const DRAFT_KEY = 'inventory-audit-draft';

const GET_REALTIME_STOCK_SQL = `SELECT ISNULL(curjago, 0) as curjago FROM parts WITH(NOLOCK) WHERE barcode = LEFT(@Barcode, 20)`;

const IMMEDIATE_AUDIT_SQL = `
-- [SQL 2005 호환] 재고 실사 반영 (이중 업데이트 방지 - 차이값 기록 방식, 단일 트랜잭션 원자성 보장)
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @CurQty DECIMAL(18,0)
DECLARE @DiffQty DECIMAL(18,0)
DECLARE @Cost DECIMAL(18,0)
DECLARE @Price DECIMAL(18,0)
DECLARE @ComCode NVARCHAR(MAX)
DECLARE @Today VARCHAR(10)
DECLARE @YYMM VARCHAR(4)
DECLARE @TableName NVARCHAR(100)
DECLARE @SQL NVARCHAR(MAX)
DECLARE @ErrMsg NVARCHAR(MAX)

SET @Today = CONVERT(VARCHAR(10), GETDATE(), 120)
SET @YYMM = LEFT(CONVERT(VARCHAR(6), GETDATE(), 12), 4)
SET @TableName = 'bojung_' + @YYMM

BEGIN TRY
    BEGIN TRANSACTION;

    -- 1. 현재 전산 재고 조회 (정확한 차이 계산을 위해 조회 직전 시점 데이터 사용)
    SELECT @CurQty = ISNULL(curjago, 0),
           @Cost = ISNULL(money0, 0),
           @Price = ISNULL(money1, 0),
           @ComCode = ISNULL(comcode, '')
    FROM parts WITH(UPDLOCK, HOLDLOCK)
    WHERE barcode = LEFT(@Barcode, 20)

    IF @CurQty IS NULL
    BEGIN
         RAISERROR('등록되지 않은 상품입니다.', 16, 1)
    END

    -- 2. 차이 수량 계산 (실사수량 - 전산재고)
    SET @DiffQty = @RealQty - @CurQty

    IF @DiffQty <> 0
    BEGIN
        -- [중요] 직접 UPDATE parts 대신 보정 테이블 INSERT만 수행
        SET @SQL = N'INSERT INTO ' + @TableName + N' (
                        comcode, day1, barcode, 
                        itemcount, money0vat, tmoney, money1, tmoney1, 
                        upgubun, mancode
                     )
                     SELECT 
                        LEFT(@P_ComCode, 5),
                        LEFT(@P_Day1, 10),
                        LEFT(@P_Barcode, 15),
                        @P_DiffQty,
                        @P_Cost,
                        @P_Cost * @P_DiffQty,
                        @P_Price,
                        @P_Price * @P_DiffQty,
                        ''0'',
                        '''' -- mancode'

        EXEC sp_executesql @SQL,
            N'@P_ComCode NVARCHAR(MAX), @P_Day1 VARCHAR(10), @P_Barcode NVARCHAR(MAX), 
              @P_DiffQty DECIMAL(18,0), @P_Cost DECIMAL(18,0), @P_Price DECIMAL(18,0)',
            @ComCode, @Today, @Barcode, 
            @DiffQty, @Cost, @Price
    END

    COMMIT TRANSACTION;

    -- 클라이언트에 결과 반환
    SELECT 'SUCCESS' AS RESULT,
           @CurQty AS OLD_QTY,
           @RealQty AS NEW_QTY,
           @DiffQty AS DIFF_QTY

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    SET @ErrMsg = ERROR_MESSAGE()
    SELECT 'FAIL' AS RESULT, @ErrMsg AS MSG
END CATCH
`;

const buildAtomicBatchAuditSql = (count: number): string => {
    const itemBlocks: string[] = [];
    for (let i = 0; i < count; i++) {
        itemBlocks.push(`
    SET @CurQty = NULL;
    SELECT @CurQty = ISNULL(curjago, 0),
           @Cost = ISNULL(money0, 0),
           @Price = ISNULL(money1, 0),
           @ComCode = ISNULL(comcode, '')
    FROM parts WITH(UPDLOCK, HOLDLOCK)
    WHERE barcode = LEFT(@Barcode_${i}, 20);

    IF @CurQty IS NULL
    BEGIN
        RAISERROR('등록되지 않은 상품이 포함되어 전체 롤백되었습니다.', 16, 1);
    END

    SET @DiffQty = @RealQty_${i} - @CurQty;

    IF @DiffQty <> 0
    BEGIN
        EXEC sp_executesql @InsertSQL,
            N'@P_ComCode NVARCHAR(MAX), @P_Day1 VARCHAR(10), @P_Barcode NVARCHAR(MAX), 
              @P_DiffQty DECIMAL(18,0), @P_Cost DECIMAL(18,0), @P_Price DECIMAL(18,0)',
            @ComCode, @Today, @Barcode_${i},
            @DiffQty, @Cost, @Price;
    END`);
    }

    return `
-- [SQL 2005 호환] 재고 실사 일괄 반영 (단일 트랜잭션 원자성 보장 - 도중 오류 시 100% 전체 롤백)
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @CurQty DECIMAL(18,0);
DECLARE @DiffQty DECIMAL(18,0);
DECLARE @Cost DECIMAL(18,0);
DECLARE @Price DECIMAL(18,0);
DECLARE @ComCode NVARCHAR(MAX);
DECLARE @Today VARCHAR(10);
DECLARE @YYMM VARCHAR(4);
DECLARE @TableName NVARCHAR(100);
DECLARE @InsertSQL NVARCHAR(MAX);
DECLARE @ErrMsg NVARCHAR(MAX);

SET @Today = CONVERT(VARCHAR(10), GETDATE(), 120);
SET @YYMM = LEFT(CONVERT(VARCHAR(6), GETDATE(), 12), 4);
SET @TableName = 'bojung_' + @YYMM;

SET @InsertSQL = N'INSERT INTO ' + @TableName + N' (
                    comcode, day1, barcode, 
                    itemcount, money0vat, tmoney, money1, tmoney1, 
                    upgubun, mancode
                 )
                 SELECT 
                    LEFT(@P_ComCode, 5),
                    LEFT(@P_Day1, 10),
                    LEFT(@P_Barcode, 15),
                    @P_DiffQty,
                    @P_Cost,
                    @P_Cost * @P_DiffQty,
                    @P_Price,
                    @P_Price * @P_DiffQty,
                    ''0'',
                    ''''';

BEGIN TRY
    BEGIN TRANSACTION;
${itemBlocks.join('\n')}
    COMMIT TRANSACTION;
    SELECT 'SUCCESS' AS RESULT;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    SET @ErrMsg = ERROR_MESSAGE();
    SELECT 'FAIL' AS RESULT, @ErrMsg AS MSG;
END CATCH
`;
};

const InventoryAuditPage: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const { showAlert, showToast } = useAlert();
    const { openScanner, closeScanner, isScannerOpen } = useScanner();
    const { sqlStatus, checkSql } = useMiscUI();

    const [auditedItems, setAuditedItems] = useState<AuditedItem[]>([]);
    const [applyMode, setApplyMode] = useState<'immediate' | 'batch'>('immediate');
    const [isSaving, setIsSaving] = useState(false);
    const isSavingRef = useRef(false);
    const [isFetchingStock, setIsFetchingStock] = useState(false);
    
    const inputRef = useRef<HTMLInputElement>(null);
    const blurTimeoutRef = useRef<number | null>(null);
    const [showDropdown, setShowDropdown] = useState(false);
    
    const [auditModalProps, setAuditModalProps] = useState<{
        isOpen: boolean;
        product: Product | null;
        trigger: 'scan' | 'search';
        timestamp?: number;
    }>({ isOpen: false, product: null, trigger: 'search' });

    const { draft, save: saveDraft, remove: removeDraft, isLoading: isDraftLoading } = useDraft<InventoryAuditDraft>(DRAFT_KEY);

    // [중요] 재고실사는 윈포스(SQL 서버) 실시간 재고를 보면서 작업해야 하므로 strictOnline: true (로컬 캐시 조회 절대 금지)
    const { 
        searchTerm, setSearchTerm, results, isSearching, search, searchByBarcode, clear 
    } = useProductSearch('productInquiry', 50, '상품조회', { forceOnline: true, strictOnline: true });

    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const isOffline = sqlStatus !== 'connected';
    const sqlStatusRef = useRef(sqlStatus);
    sqlStatusRef.current = sqlStatus;

    // 작업 도중 윈포스(SQL 서버) 연결이 끊기면 즉시 검색 결과·수량창·스캐너를 닫아 오프라인 작업을 원천 차단
    useEffect(() => {
        if (!isActive) return;
        if (isOffline) {
            clear();
            setShowDropdown(false);
            if (auditModalProps.isOpen) {
                setAuditModalProps(p => ({ ...p, isOpen: false }));
            }
            if (isScannerOpen) {
                closeScanner();
            }
        }
    }, [isOffline, isActive, auditModalProps.isOpen, isScannerOpen, closeScanner, clear]);

    useEffect(() => {
        if (!isActive || isOffline) return;
        if (debouncedSearchTerm.trim().length >= 2) {
            search(debouncedSearchTerm);
        } else if (debouncedSearchTerm.trim().length === 0) {
            search('');
        }
    }, [debouncedSearchTerm, search, isActive, isOffline]);

    useEffect(() => {
        if (isActive && draft && auditedItems.length === 0) {
            setAuditedItems(draft.items || []);
            setApplyMode(draft.applyMode || 'immediate');
        }
    }, [isActive, draft, auditedItems.length]);

    useEffect(() => {
        if (isActive && !isDraftLoading) {
            saveDraft({ items: auditedItems, applyMode });
        }
    }, [auditedItems, applyMode, isActive, isDraftLoading, saveDraft]);

    const ensureOnlineConnection = useCallback(async (): Promise<boolean> => {
        if (sqlStatusRef.current === 'connected') return true;
        const connected = await checkSql();
        if (!connected) {
            showAlert('윈포스(SQL 서버)와 연결되어 있지 않습니다.\n재고실사는 기존 전산 재고를 실시간으로 확인해야 하므로 온라인 상태에서만 작업할 수 있습니다.');
            return false;
        }
        return true;
    }, [checkSql, showAlert]);

    const fetchRealTimeStock = async (barcode: string): Promise<number | null> => {
        if (sqlStatusRef.current !== 'connected') return null;
        try {
            const res = await executeUserQuery('실시간재고확인', { Barcode: barcode }, GET_REALTIME_STOCK_SQL);
            if (res && res.length > 0 && res[0].curjago !== undefined && res[0].curjago !== null) {
                return Number(res[0].curjago);
            }
            return null;
        } catch (e) {
            return null;
        }
    };

    const handleProductSelection = async (product: Product, trigger: 'scan' | 'search') => {
        if (!(await ensureOnlineConnection())) {
            if (trigger === 'scan') closeScanner();
            return;
        }
        setIsFetchingStock(true);
        try {
            const realTimeStock = await fetchRealTimeStock(product.barcode);
            // 실시간 전산 재고 조회 실패 시 로컬 캐시 재고로 대체하지 않고 즉시 작업을 차단
            if (realTimeStock === null) {
                if (trigger === 'scan') closeScanner();
                showAlert('윈포스(SQL 서버)에서 실시간 전산 재고를 불러오지 못했습니다.\n연결이 끊어졌거나 불안정하므로 재고실사를 진행할 수 없습니다.');
                return;
            }
            const updatedProduct = {
                ...product,
                stockQuantity: realTimeStock
            };
            
            if (trigger !== 'scan' && window.history.state?.modal !== 'auditItem') {
                window.history.pushState({ modal: 'auditItem' }, '', '');
            }
            
            setAuditModalProps({ isOpen: true, product: updatedProduct, trigger, timestamp: Date.now() });
        } finally {
            setIsFetchingStock(false);
        }
    };

    const handleOpenScanner = useCallback(async () => {
        if (!(await ensureOnlineConnection())) return;

        const onScan = async (barcode: string) => {
            if (sqlStatusRef.current !== 'connected') {
                closeScanner();
                showAlert('윈포스(SQL 서버)와 연결이 끊어져 스캔 작업을 중단합니다.');
                return;
            }
            try {
                const product = await searchByBarcode(barcode);
                if (product) {
                    handleProductSelection(product, 'scan');
                } else {
                    showAlert(`'${barcode}'는 윈포스(SQL 서버)에 등록되지 않은 바코드입니다.`);
                }
            } catch (e: any) {
                closeScanner();
                showAlert(`윈포스(SQL 서버) 조회 중 네트워크 오류가 발생하여 스캔을 중단합니다.\n(${e.message || '연결 오류'})`);
            }
        };
        openScanner('inventory-audit', onScan, { continuous: true });
        window.dispatchEvent(new CustomEvent('kjmart-scanner-resume'));
    }, [ ensureOnlineConnection, searchByBarcode, openScanner, closeScanner, showAlert ]);

    const handleCloseAuditModal = () => {
        if (window.history.state?.modal === 'auditItem') {
            window.history.back();
        }
        setAuditModalProps(p => ({ ...p, isOpen: false }));
    };

    useEffect(() => {
        const handlePop = (e: PopStateEvent) => {
            if (auditModalProps.isOpen && e.state?.modal !== 'auditItem') {
                setAuditModalProps(p => ({ ...p, isOpen: false }));
            }
        };
        window.addEventListener('popstate', handlePop);
        return () => window.removeEventListener('popstate', handlePop);
    }, [auditModalProps.isOpen]);

    const handleAddAudit = async (auditQty: number, nextScan: boolean = false) => {
        if (!auditModalProps.product || isSaving || isSavingRef.current) return;
        const p = auditModalProps.product;

        // 즉시 적용 모드뿐만 아니라 일괄 적용 모드에서도 오프라인이면 실사 등록 불가
        if (sqlStatusRef.current !== 'connected') {
            closeScanner();
            showAlert('윈포스(SQL 서버)와 연결이 끊어져 재고실사 작업을 진행할 수 없습니다.\n연결 복구 후 다시 시도해주세요.');
            return;
        }

        setSearchTerm('');
        
        if (applyMode === 'immediate') {
            isSavingRef.current = true;
            setIsSaving(true);
            try {
                const params = { Barcode: p.barcode, RealQty: auditQty };
                const res = await executeUserQuery('재고실사_즉시저장', params, IMMEDIATE_AUDIT_SQL);
                
                if (res && res[0]?.RESULT === 'SUCCESS') {
                    showToast(`'${p.name}' 실사가 서버에 즉시 반영되었습니다.`, 'success');
                    if (nextScan) {
                        handleOpenScanner();
                    } else {
                        closeScanner();
                    }
                } else {
                    throw new Error(res?.[0]?.MSG || '서버 처리 오류');
                }
            } catch (e: any) {
                closeScanner();
                showAlert(`저장 중 네트워크/서버 오류가 발생하여 변경 사항이 롤백되었습니다.\n(${e.message})`);
                return;
            } finally {
                isSavingRef.current = false;
                setIsSaving(false);
            }
        } else {
            setAuditedItems(prev => {
                const existing = prev.find(i => i.barcode === p.barcode);
                const prevCount = existing ? existing.auditQty : 0;
                const totalAudit = prevCount + auditQty;
                const computerStock = p.stockQuantity ?? 0;
                
                const newItem: AuditedItem = {
                    barcode: p.barcode, name: p.name, spec: p.spec,
                    computerStock, auditQty: totalAudit,
                    diff: totalAudit - computerStock, timestamp: Date.now()
                };
                return [newItem, ...prev.filter(i => i.barcode !== p.barcode)];
            });
            showToast(`전송 목록에 추가되었습니다.`, 'success');
            if (nextScan) {
                handleOpenScanner();
            } else {
                closeScanner();
            }
        }
    };

    const handleRemoveItem = (barcode: string) => {
        setAuditedItems(prev => prev.filter(i => i.barcode !== barcode));
    };

    const handleReset = () => {
        showAlert("실사 목록을 모두 삭제하시겠습니까?", () => {
            setAuditedItems([]); removeDraft(); showToast("초기화되었습니다.", 'success');
        }, '삭제', 'bg-rose-500');
    };

    const handleBatchSave = async () => {
        if (auditedItems.length === 0 || isSaving || isSavingRef.current) return;
        if (!(await ensureOnlineConnection())) return;

        showAlert(`총 ${auditedItems.length}건의 실사를 일괄 전송하시겠습니까?`, async () => {
            if (isSavingRef.current) return;
            if (!(await ensureOnlineConnection())) return;

            isSavingRef.current = true;
            setIsSaving(true);
            try {
                const batchParams: Record<string, any> = {};
                auditedItems.forEach((item, idx) => {
                    batchParams[`Barcode_${idx}`] = item.barcode;
                    batchParams[`RealQty_${idx}`] = item.auditQty;
                });

                const atomicSql = buildAtomicBatchAuditSql(auditedItems.length);
                const res = await executeUserQuery('재고실사_일괄저장', batchParams, atomicSql);

                if (res && res[0]?.RESULT === 'SUCCESS') {
                    showToast(`총 ${auditedItems.length}건의 실사가 모두 저장되었습니다.`, 'success');
                    setAuditedItems([]);
                    removeDraft();
                } else {
                    throw new Error(res?.[0]?.MSG || '일괄 저장 실패 (전체 롤백됨)');
                }
            } catch (e: any) {
                showAlert(`저장 도중 네트워크 또는 서버 오류가 발생하여 전체 내역이 롤백(취소)되었습니다.\n윈포스 연결 상태를 확인 후 다시 전송해주세요.\n(${e.message})`);
            } finally {
                isSavingRef.current = false;
                setIsSaving(false);
            }
        });
    };

    const handleSearchSelect = (p: Product) => {
        if (isOffline) {
            showAlert('윈포스(SQL 서버)와 연결되어 있지 않아 재고실사를 진행할 수 없습니다.');
            return;
        }
        setSearchTerm('');
        setShowDropdown(false);
        handleProductSelection(p, 'search');
        inputRef.current?.blur();
    };

    return (
        <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
            {isOffline && (
                <div className="bg-rose-50 border-b border-rose-200 px-3 py-2 flex items-center gap-2 text-rose-800 flex-shrink-0 z-30 animate-fade-in-down">
                    <WarningIcon className="w-5 h-5 text-rose-600 flex-shrink-0" />
                    <p className="text-xs font-bold leading-snug">
                        오프라인 작업 불가: 재고실사는 윈포스(SQL 서버)의 실시간 전산 재고를 기준으로 처리되므로 서버 연결 상태에서만 작업할 수 있습니다.
                    </p>
                </div>
            )}
            <div className="p-3 bg-white border-b border-gray-200 flex-shrink-0 z-20 shadow-sm">
                <div className="flex gap-2">
                    <div className="flex-1 flex flex-col gap-2 min-w-0">
                        {/* Row 1: Search Input */}
                        <div className="relative h-11">
                            <input
                                ref={inputRef}
                                type="text"
                                value={searchTerm}
                                disabled={isOffline}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onFocus={() => {
                                    if (isOffline) {
                                        inputRef.current?.blur();
                                        ensureOnlineConnection();
                                        return;
                                    }
                                    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
                                    setShowDropdown(true);
                                }}
                                onBlur={() => {
                                    blurTimeoutRef.current = window.setTimeout(() => setShowDropdown(false), 200);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleOpenScanner();
                                    }
                                }}
                                placeholder={isOffline ? "윈포스(SQL) 연결 후 검색 가능" : "상품명 또는 바코드 검색"}
                                className="w-full h-full pl-3 pr-10 border border-gray-300 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none text-base font-bold text-gray-800 disabled:bg-gray-100 disabled:text-gray-400"
                            />
                            <div className="absolute top-1/2 right-3 -translate-y-1/2 pointer-events-none">
                                {isSearching || isFetchingStock ? <SpinnerIcon className="w-5 h-5 animate-spin text-indigo-500" /> : <SearchIcon className="w-5 h-5 text-gray-400" />}
                            </div>
                            <SearchDropdown
                                items={results}
                                renderItem={(p) => <ProductSearchResultItem product={p} onClick={handleSearchSelect} />}
                                show={!isOffline && showDropdown && results.length > 0}
                            />
                        </div>

                        {/* Row 2: Mode Select */}
                        <div className="relative h-11">
                            <select
                                value={applyMode}
                                disabled={isOffline}
                                onChange={(e) => setApplyMode(e.target.value as 'immediate' | 'batch')}
                                className={`w-full h-full appearance-none pl-3 pr-8 rounded-lg text-xs font-bold border focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors cursor-pointer disabled:opacity-50 ${
                                    applyMode === 'immediate' 
                                        ? 'bg-rose-50 border-rose-200 text-rose-700' 
                                        : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                                }`}
                            >
                                <option value="batch">일괄 적용 (목록에 추가)</option>
                                <option value="immediate">즉시 적용 (재고에 실시간 반영)</option>
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2">
                                <ChevronDownIcon className={`w-4 h-4 ${applyMode === 'immediate' ? 'text-rose-500' : 'text-indigo-500'}`} />
                            </div>
                        </div>
                    </div>

                    {/* Column 2: Scan Button */}
                    <button
                        onClick={handleOpenScanner}
                        disabled={isOffline}
                        className="w-20 bg-indigo-600 text-white rounded-lg flex flex-col items-center justify-center gap-1 font-bold shadow-md active:scale-95 transition-transform disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                        <BarcodeScannerIcon className="w-8 h-8" />
                        <span className="text-sm">스캔</span>
                    </button>
                </div>
            </div>

            <div className="flex-grow overflow-y-auto p-2">
                {auditedItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 opacity-60">
                        <BarcodeScannerIcon className="w-16 h-16 mb-4" />
                        <p className="font-bold">실사 내역이 없습니다</p>
                        <p className="text-xs mt-1">{isOffline ? '윈포스(SQL 서버) 연결 후 작업할 수 있습니다.' : '스캔하여 재고를 입력하세요.'}</p>
                    </div>
                ) : (
                    <div className="space-y-2 pb-20">
                        {auditedItems.map((item, idx) => (
                            <div key={item.barcode} className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm animate-fade-in-up">
                                <div className="flex justify-between items-start mb-2">
                                    <div className="min-w-0 flex-grow">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-mono font-bold text-indigo-400">#{auditedItems.length - idx}</span>
                                            <h3 className="font-bold text-gray-800 text-sm truncate">{item.name}</h3>
                                        </div>
                                        <p className="text-[10px] text-gray-400 font-mono mt-0.5">{item.barcode} {item.spec ? `| ${item.spec}` : ''}</p>
                                    </div>
                                    <button onClick={() => handleRemoveItem(item.barcode)} className="p-1.5 text-gray-300 hover:text-rose-500 transition-colors"><TrashIcon className="w-4 h-4" /></button>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-center">
                                    <div className="bg-gray-50 p-1.5 rounded-lg border border-gray-100">
                                        <p className="text-[9px] text-gray-400 font-bold leading-none uppercase">전산</p>
                                        <p className="font-bold text-gray-600 mt-1 text-sm">{item.computerStock.toLocaleString()}</p>
                                    </div>
                                    <div className="bg-indigo-50 p-1.5 rounded-lg border border-indigo-100">
                                        <p className="text-[9px] text-indigo-400 font-bold leading-none uppercase">실사</p>
                                        <p className="font-bold text-indigo-700 mt-1 text-sm">{item.auditQty.toLocaleString()}</p>
                                    </div>
                                    <div className={`p-1.5 rounded-lg border ${item.diff === 0 ? 'bg-gray-50 border-gray-100' : (item.diff > 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100')}`}>
                                        <p className={`text-[9px] font-bold leading-none uppercase ${item.diff === 0 ? 'text-gray-400' : (item.diff > 0 ? 'text-emerald-500' : 'text-rose-500')}`}>차이</p>
                                        <p className={`font-bold mt-1 text-sm ${item.diff === 0 ? 'text-gray-500' : (item.diff > 0 ? 'text-emerald-600' : 'text-rose-600')}`}>
                                            {item.diff > 0 ? `+${item.diff}` : item.diff}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="p-3 bg-white border-t border-gray-200 safe-area-pb shadow-lg z-20">
                <div className="flex justify-between items-center mb-3 px-1">
                    <span className="text-sm font-bold text-gray-500">실사 품목 수</span>
                    <span className="text-lg font-black text-gray-800">{auditedItems.length} <span className="text-xs font-normal text-gray-400">건</span></span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <button onClick={handleReset} className="h-12 bg-gray-100 text-gray-600 rounded-xl font-bold active:scale-95">초기화</button>
                    <button 
                        onClick={handleBatchSave} 
                        disabled={isOffline || isSaving || auditedItems.length === 0 || applyMode === 'immediate'}
                        className={`col-span-2 h-12 rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-all ${
                            applyMode === 'immediate' || isOffline
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                                : `bg-indigo-600 text-white shadow-lg ${isSaving ? 'cursor-not-allowed' : ''} disabled:bg-gray-300`
                        }`}
                    >
                        {isSaving ? <SpinnerIcon className="w-6 h-6 animate-spin" /> : (
                            applyMode === 'batch' ? <><CheckCircleIcon className="w-5 h-5"/> 일괄 전송</> : '즉시 적용 모드'
                        )}
                    </button>
                </div>
            </div>

            {auditModalProps.isOpen && !isOffline && (
                <StockAuditItemModal 
                    isOpen={true} 
                    product={auditModalProps.product} 
                    applyMode={applyMode} 
                    trigger={auditModalProps.trigger}
                    prevQty={auditedItems.find(i => i.barcode === auditModalProps.product?.barcode)?.auditQty || 0}
                    onClose={handleCloseAuditModal}
                    onConfirm={(qty, nextScan) => { handleCloseAuditModal(); handleAddAudit(qty, nextScan); }}
                    onSkip={() => { handleCloseAuditModal(); if(auditModalProps.trigger === 'scan') handleOpenScanner(); }}
                    timestamp={auditModalProps.timestamp}
                />
            )}
        </div>
    );
};

export default InventoryAuditPage;
