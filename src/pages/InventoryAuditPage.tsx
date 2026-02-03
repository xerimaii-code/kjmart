
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDataState, useAlert, useScanner, useMiscUI, useModals } from '../context/AppContext';
import { Product, AuditedItem, InventoryAuditDraft } from '../types';
import { SpinnerIcon, TrashIcon, CheckCircleIcon, BarcodeScannerIcon, ChevronDownIcon, SearchIcon } from '../components/Icons';
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
-- [SQL 2005 호환] 재고 실사 반영 (이중 업데이트 방지 - 차이값 기록 방식)
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
        -- 트리거가 있는 시스템에서는 보정 테이블 입력 시 자동으로 재고가 계산됩니다.
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

const InventoryAuditPage: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const { products: localProducts } = useDataState();
    const { showAlert, showToast } = useAlert();
    const { openScanner } = useScanner();
    const { sqlStatus, checkSql } = useMiscUI();

    const [auditedItems, setAuditedItems] = useState<AuditedItem[]>([]);
    const [applyMode, setApplyMode] = useState<'immediate' | 'batch'>('immediate');
    const [isSaving, setIsSaving] = useState(false);
    const [isFetchingStock, setIsFetchingStock] = useState(false);
    
    // Search UI Refs
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

    const { 
        searchTerm, setSearchTerm, results, isSearching, search, searchByBarcode 
    } = useProductSearch('productInquiry', 50, '상품조회', { forceOnline: true });

    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    useEffect(() => {
        if (isActive && debouncedSearchTerm.trim().length >= 2) {
            search(debouncedSearchTerm);
        } else if (debouncedSearchTerm.trim().length === 0) {
            search('');
        }
    }, [debouncedSearchTerm, search, isActive]);

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

    const fetchRealTimeStock = async (barcode: string): Promise<number | null> => {
        if (sqlStatus !== 'connected') return null;
        try {
            const res = await executeUserQuery('실시간재고확인', { Barcode: barcode }, GET_REALTIME_STOCK_SQL);
            if (res && res.length > 0) return Number(res[0].curjago);
            return null;
        } catch (e) { return null; }
    };

    const handleProductSelection = async (product: Product, trigger: 'scan' | 'search') => {
        setIsFetchingStock(true);
        try {
            const realTimeStock = await fetchRealTimeStock(product.barcode);
            const updatedProduct = {
                ...product,
                stockQuantity: realTimeStock !== null ? realTimeStock : product.stockQuantity
            };
            
            // [중요] 모달이 열릴 때 히스토리 상태를 추가하여 스캐너 배경이 98% 블랙으로 되도록 함
            if (window.history.state?.modal !== 'auditItem') {
                window.history.pushState({ modal: 'auditItem' }, '', '');
            }
            
            setAuditModalProps({ isOpen: true, product: updatedProduct, trigger, timestamp: Date.now() });
        } finally { setIsFetchingStock(false); }
    };

    const handleOpenScanner = useCallback(() => {
        const onScan = async (barcode: string) => {
            let product = await searchByBarcode(barcode);
            if (!product) product = localProducts.find(p => p.barcode === barcode) || null;

            if (product) handleProductSelection(product, 'scan');
            else showAlert(`'${barcode}'는 등록되지 않은 바코드입니다.`);
        };
        openScanner('inventory-audit', onScan, { continuous: true });
    }, [localProducts, searchByBarcode, openScanner, showAlert, sqlStatus]);

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
        if (!auditModalProps.product || isSaving) return;
        const p = auditModalProps.product;
        
        if (applyMode === 'immediate') {
            setIsSaving(true);
            try {
                const params = { Barcode: p.barcode, RealQty: auditQty };
                const res = await executeUserQuery('재고실사_즉시저장', params, IMMEDIATE_AUDIT_SQL);
                
                if (res && res[0]?.RESULT === 'SUCCESS') {
                    showToast(`'${p.name}' 실사가 서버에 즉시 반영되었습니다.`, 'success');
                    // [수정됨] 즉시 적용 시 목록에 추가하지 않음
                } else throw new Error(res?.[0]?.MSG || '서버 처리 오류');
            } catch (e: any) {
                showAlert(`즉시 반영 실패: ${e.message}`);
                setIsSaving(false); return;
            } finally { setIsSaving(false); }
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
        }
        
        setSearchTerm('');
        if (nextScan) setTimeout(() => handleOpenScanner(), 300);
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
        if (auditedItems.length === 0 || isSaving) return;
        if (sqlStatus !== 'connected') {
            const connected = await checkSql();
            if (!connected) { showAlert("SQL 서버에 연결되어 있지 않습니다."); return; }
        }

        showAlert(`총 ${auditedItems.length}건의 실사를 일괄 전송하시겠습니까?`, async () => {
            setIsSaving(true);
            let successCount = 0;
            try {
                for (const item of auditedItems) {
                    const params = { Barcode: item.barcode, RealQty: item.auditQty };
                    const res = await executeUserQuery('재고실사_즉시저장', params, IMMEDIATE_AUDIT_SQL);
                    if (res?.[0]?.RESULT === 'SUCCESS') successCount++;
                }
                showToast(`${successCount}건의 실사가 저장되었습니다.`, 'success');
                setAuditedItems([]); removeDraft();
            } catch (e: any) { showAlert(`저장 중 오류 발생: ${e.message}`); } finally { setIsSaving(false); }
        });
    };

    const handleSearchSelect = (p: Product) => {
        setSearchTerm('');
        setShowDropdown(false);
        handleProductSelection(p, 'search');
        inputRef.current?.blur();
    };

    return (
        <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
            <div className="p-3 bg-white border-b border-gray-200 flex-shrink-0 z-20 shadow-sm">
                <div className="flex gap-2">
                    <div className="flex-1 flex flex-col gap-2 min-w-0">
                        {/* Row 1: Search Input */}
                        <div className="relative h-11">
                            <input
                                ref={inputRef}
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onFocus={() => {
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
                                placeholder="상품명 또는 바코드 검색"
                                className="w-full h-full pl-3 pr-10 border border-gray-300 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none text-base font-bold text-gray-800"
                            />
                            <div className="absolute top-1/2 right-3 -translate-y-1/2 pointer-events-none">
                                {isSearching || isFetchingStock ? <SpinnerIcon className="w-5 h-5 animate-spin text-indigo-500" /> : <SearchIcon className="w-5 h-5 text-gray-400" />}
                            </div>
                            <SearchDropdown
                                items={results}
                                renderItem={(p) => <ProductSearchResultItem product={p} onClick={handleSearchSelect} />}
                                show={showDropdown && results.length > 0}
                            />
                        </div>

                        {/* Row 2: Mode Select */}
                        <div className="relative h-11">
                            <select
                                value={applyMode}
                                onChange={(e) => setApplyMode(e.target.value as 'immediate' | 'batch')}
                                className={`w-full h-full appearance-none pl-3 pr-8 rounded-lg text-xs font-bold border focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors cursor-pointer ${
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
                        className="w-20 bg-indigo-600 text-white rounded-lg flex flex-col items-center justify-center gap-1 font-bold shadow-md active:scale-95 transition-transform"
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
                        <p className="text-xs mt-1">스캔하여 재고를 입력하세요.</p>
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
                    {/* 즉시 적용 모드일 때는 버튼을 비활성화하거나 다른 텍스트 표시 */}
                    <button 
                        onClick={handleBatchSave} 
                        disabled={isSaving || auditedItems.length === 0 || applyMode === 'immediate'}
                        className={`col-span-2 h-12 rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-all ${
                            applyMode === 'immediate' 
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

            {auditModalProps.isOpen && (
                <StockAuditItemModal 
                    isOpen={true} 
                    product={auditModalProps.product} 
                    applyMode={applyMode} 
                    trigger={auditModalProps.trigger}
                    prevQty={auditedItems.find(i => i.barcode === auditModalProps.product?.barcode)?.auditQty || 0}
                    onClose={handleCloseAuditModal}
                    onConfirm={(qty, nextScan) => { handleAddAudit(qty, nextScan); handleCloseAuditModal(); }}
                    onSkip={() => { handleCloseAuditModal(); if(auditModalProps.trigger === 'scan') setTimeout(handleOpenScanner, 300); }}
                    timestamp={auditModalProps.timestamp}
                />
            )}
        </div>
    );
};

export default InventoryAuditPage;
