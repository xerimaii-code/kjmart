
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAlert, useScanner } from '../context/AppContext';
import { executeUserQuery } from '../services/sqlService';
import { Product } from '../types';
import { SpinnerIcon, XCircleIcon, WarningIcon, CheckCircleIcon, BarcodeScannerIcon } from './Icons';
import ProductSearchBar from './ProductSearchBar';
import { useProductSearch } from '../hooks/useProductSearch';
import { useDebounce } from '../hooks/useDebounce';

interface AddEventProductModalProps {
    isOpen: boolean;
    onClose: () => void;
    junno: string;
    onSuccess: (newItem: any) => Promise<void> | void;
    existingBarcodes: string[];
    parentStatus?: 'new' | '0' | '1' | '2';
    onSwitchToContinuousScan?: () => void;
}

const CHECK_PRODUCT_EVENT_SQL = `
-- [행사상품 상세조회 및 중복체크]
-- 파라미터: @Junno (현재 전표), @Barcode (상품)

DECLARE @MyStart VARCHAR(10)
DECLARE @MyEnd VARCHAR(10)
DECLARE @Today VARCHAR(10)
SET @Today = CONVERT(VARCHAR(10), GETDATE(), 120)

-- 1. 현재 내 행사의 시작/종료일 확보
SELECT @MyStart = startday, @MyEnd = endday
FROM sale_mast WITH(NOLOCK)
WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno))

-- 2. 상품 정보 + 내 행사 등록 여부 + 타 행사 중복 여부 조회
SELECT 
    P.descr      AS [GoodsName],
    P.spec       AS [Spec],
    P.money0vat  AS [Cost],        -- 부가세포함 매입가
    P.money1     AS [Price],       -- 정상 판매가
    @MyStart     AS [MyStart],     -- 내 행사의 시작일
    
    CASE 
        WHEN R.junno IS NOT NULL THEN 'UPDATE'
        ELSE 'INSERT'
    END AS [Mode],
    ISNULL(R.salemoney0, P.money0vat) AS [SaleCost],
    ISNULL(R.salemoney1, P.money1)    AS [SalePrice],
    ISNULL(R.salecount, 0)            AS [Margin],
    
    (
        SELECT TOP 1 
            '[' + M2.salename + '] ' + 
            CONVERT(VARCHAR, CAST(R2.salemoney1 AS INT)) + '원 (' + 
            M2.startday + '~' + M2.endday + ')'
        FROM sale_ready R2 WITH(NOLOCK)
        INNER JOIN sale_mast M2 WITH(NOLOCK) ON R2.junno = M2.junno
        WHERE R2.barcode = P.barcode
          AND LTRIM(RTRIM(R2.junno)) <> LTRIM(RTRIM(@Junno))
          AND M2.isappl = '1'
          AND (
              REPLACE(M2.startday, '-', '') <= REPLACE(@MyEnd, '-', '') 
              AND 
              REPLACE(M2.endday, '-', '') >= REPLACE(@MyStart, '-', '')
          )
        ORDER BY M2.startday DESC
    ) AS [WarningMsg],
    (
        SELECT TOP 1 R2.salemoney1
        FROM sale_ready R2 WITH(NOLOCK)
        INNER JOIN sale_mast M2 WITH(NOLOCK) ON R2.junno = M2.junno
        WHERE R2.barcode = P.barcode
          AND LTRIM(RTRIM(R2.junno)) <> LTRIM(RTRIM(@Junno))
          AND M2.isappl = '1'
          AND (
              REPLACE(M2.startday, '-', '') <= REPLACE(@MyEnd, '-', '') 
              AND 
              REPLACE(M2.endday, '-', '') >= REPLACE(@MyStart, '-', '')
          )
        ORDER BY M2.startday DESC
    ) AS [DuplicatePrice]

FROM parts P WITH(NOLOCK)
LEFT JOIN sale_ready R WITH(NOLOCK) 
    ON P.barcode = R.barcode AND LTRIM(RTRIM(R.junno)) = LTRIM(RTRIM(@Junno))
WHERE P.barcode = @Barcode
`;

const AddEventProductModal: React.FC<AddEventProductModalProps> = ({ 
    isOpen, onClose, junno, onSuccess, existingBarcodes, parentStatus = 'new', onSwitchToContinuousScan
}) => {
    const { showAlert, showToast } = useAlert();
    const { openScanner } = useScanner();

    const [isRendered, setIsRendered] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState<any>(null);
    const [saleCost, setSaleCost] = useState<number | string>('');
    const [salePrice, setSalePrice] = useState<number | string>('');
    const [isSaving, setIsSaving] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    
    const [applyOnSave, setApplyOnSave] = useState(parentStatus === '1');
    
    const [orgPrice, setOrgPrice] = useState(0);
    const [warning, setWarning] = useState<string | null>(null);
    
    const { searchTerm, setSearchTerm, results, isSearching, search, searchByBarcode } = useProductSearch('newOrder', 50, '상품조회_행사용');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    useEffect(() => {
        if (debouncedSearchTerm.length >= 2) search(debouncedSearchTerm);
        else search('');
    }, [debouncedSearchTerm, search]);

    const isNewEventContext = parentStatus === 'new';

    const resetForm = useCallback(() => {
        setSearchTerm('');
        setSelectedProduct(null);
        setSaleCost('');
        setSalePrice('');
        setApplyOnSave(parentStatus === '1'); 
        setOrgPrice(0);
        setWarning(null);
        setIsEditMode(false);
    }, [setSearchTerm, parentStatus]);

    useEffect(() => {
        if (isOpen) setIsRendered(true); else setIsRendered(false);
    }, [isOpen]);
    
    useEffect(() => {
        if (isOpen) resetForm();
    }, [isOpen, resetForm]);

    const handleProductSelect = async (product: Product) => {
        const isDuplicate = existingBarcodes.includes(product.barcode);

        const proceedSelection = async () => {
            setSearchTerm(product.barcode);
            setWarning(null);
            
            try {
                const res = await executeUserQuery('행사상품체크', { Junno: junno, Barcode: product.barcode }, CHECK_PRODUCT_EVENT_SQL);
                
                if (res && res.length > 0) {
                    const info = res[0];
                    setSelectedProduct({ ...product, barcode: product.barcode, name: info.GoodsName });
                    setSaleCost(info.SaleCost);
                    setSalePrice(info.SalePrice);
                    setIsEditMode(info.Mode === 'UPDATE');

                    if (info.WarningMsg) {
                        setWarning(info.WarningMsg);
                        setOrgPrice(info.DuplicatePrice || info.Price);

                        showAlert(
                            `중복 행사 주의!\n\n${info.WarningMsg}\n\n위 행사와 기간이 겹칩니다. 등록 시 현재 입력한 행사가격으로 최종 적용됩니다. 계속 진행하시겠습니까?`,
                            () => showToast("중복 행사 가격이 기준가로 설정되었습니다.", "success"),
                            "계속 진행", "bg-orange-600",
                            () => resetForm(), "취소"
                        );
                    } else {
                        setOrgPrice(info.Price);
                    }
                } else {
                    showToast("상품 정보를 가져올 수 없습니다.", "error");
                }
            } catch (e: any) {
                showAlert("조회 오류: " + e.message);
            }
        };

        if (isDuplicate) {
            showAlert(
                "이미 이 행사에 등록된 상품입니다.\n내용을 수정하시겠습니까?",
                () => proceedSelection(),
                "수정하기", "bg-indigo-600",
                () => resetForm(), "취소"
            );
        } else {
            proceedSelection();
        }
    };

    const handleScan = () => {
        if (onSwitchToContinuousScan) {
            onSwitchToContinuousScan();
        } else {
            openScanner('modal', async (barcode) => {
                setSearchTerm(barcode);
                const product = await searchByBarcode(barcode);
                if (product) handleProductSelect(product);
                else showToast("미등록 상품입니다.", 'error');
            }, false);
        }
    };

    const handleSave = async (shouldClose = true) => {
        if (!selectedProduct) { showAlert("상품을 선택해주세요."); return false; }
        
        setIsSaving(true);
        try {
            const isappl = isNewEventContext ? '0' : (applyOnSave ? '1' : '0');
            const savedItemData = {
                '바코드': selectedProduct.barcode,
                '상품명': selectedProduct.name,
                '규격': selectedProduct.spec,
                '행사매입가': Number(saleCost),
                '이전판가': orgPrice,
                '행사판매가': Number(salePrice),
                'isappl': isappl
            };
            await onSuccess(savedItemData);
            
            if (shouldClose) onClose();
            return true;
        } catch (e: any) {
            showAlert(`저장 오류: ${e.message}`);
            return false;
        } finally {
            setIsSaving(false);
        }
    };

    // 연속 스캔 핸들러
    const handleSaveAndScan = async () => {
        const success = await handleSave(false); 
        if (success) {
            if (onSwitchToContinuousScan) {
                // 저장 후 스캔 버튼 누르면 바로 연속 스캔 모드로 전환
                onClose();
                onSwitchToContinuousScan();
            } else {
                resetForm();
                setTimeout(() => handleScan(), 300);
            }
        }
    };

    const marginRate = useMemo(() => {
        const cost = Number(saleCost); const price = Number(salePrice);
        if (!price || price === 0) return 0;
        return ((price - cost) / price) * 100;
    }, [saleCost, salePrice]);

    if (!isOpen) return null;

    return createPortal(
        <div className={`fixed inset-0 z-[110] flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-50' : 'bg-transparent'}`} onClick={onClose}>
            <div className={`bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col transition-all duration-300 ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`} onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh' }}>
                <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-2xl">
                    <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest">{isEditMode ? '행사 상품 수정' : '행사 상품 추가'}</h3>
                    <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><XCircleIcon className="w-6 h-6" /></button>
                </div>
                <div className="p-4 space-y-4 overflow-y-auto">
                    <ProductSearchBar id="add-event-product-search" searchTerm={searchTerm} onSearchTermChange={setSearchTerm} isSearching={isSearching} results={results} onSelectProduct={handleProductSelect} onScan={handleScan} isBoxUnit={false} onBoxUnitChange={() => {}} placeholder="바코드 또는 상품명" showBoxToggle={false} autoFocus={true}/>
                    
                    {selectedProduct && (
                        <div className="space-y-2">
                            <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100 shadow-inner">
                                <p className="font-black text-indigo-900 text-sm leading-tight mb-1">{selectedProduct.name}</p>
                                <div className="flex justify-between items-center">
                                    <span className="text-[10px] text-indigo-400 font-bold uppercase">기준 이전가격</span>
                                    <span className="text-sm font-black text-indigo-600">{orgPrice.toLocaleString()}원</span>
                                </div>
                                {warning && <p className="text-[9px] text-orange-600 font-bold mt-1">* 중복 행사 가격이 기준가로 자동 설정됨</p>}
                            </div>

                            {/* [수정됨] 타 행사 중복 경고 메시지 - 연한 회색 & 검정 텍스트 */}
                            {warning && (
                                <div className="bg-gray-50 border border-gray-300 rounded-xl p-3 flex gap-2.5 items-start shadow-sm">
                                    <WarningIcon className="w-5 h-5 text-gray-500 flex-shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-start">
                                            <span className="text-[11px] font-black text-gray-900 leading-none mb-1">타 행사 중복 진행 중</span>
                                        </div>
                                        <div className="text-xs font-bold text-gray-900 leading-snug break-words bg-white p-2 rounded-lg border border-gray-200 shadow-sm mb-1.5">
                                            {warning}
                                        </div>
                                        <p className="text-[10px] text-gray-600 font-medium leading-tight">
                                            * 기간이 겹칩니다. 저장 시 <span className="font-bold underline text-gray-900">현재 가격이 우선 적용</span>됩니다.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    
                    <div className="space-y-3 pt-1">
                        <div className="flex items-center justify-between gap-4">
                            <label className="text-[11px] font-black text-gray-400 uppercase whitespace-nowrap">행사 매입가</label>
                            <input type="number" value={saleCost} onChange={(e) => setSaleCost(e.target.value)} className="w-full h-11 px-4 border border-gray-200 rounded-xl text-right font-black text-lg focus:ring-2 focus:ring-indigo-500 bg-gray-50" disabled={!selectedProduct} onFocus={e => e.target.select()}/>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                            <label className="text-[11px] font-black text-indigo-400 uppercase whitespace-nowrap">행사 판매가</label>
                            <input type="number" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} className="w-full h-11 px-4 border-2 border-indigo-200 rounded-xl text-right font-black text-2xl text-indigo-600 focus:ring-2 focus:ring-indigo-500 bg-white" disabled={!selectedProduct} onFocus={e => e.target.select()}/>
                        </div>
                    </div>

                    <div className="flex justify-between items-center px-1">
                         <div className="flex items-center gap-2">
                            <span className="text-[11px] font-black text-gray-400 uppercase">이익률</span>
                            <span className={`font-black text-base ${marginRate < 5 ? 'text-rose-500' : 'text-emerald-500'}`}>{marginRate.toFixed(1)}%</span>
                         </div>
                         <div className="flex flex-col items-end">
                             {!isNewEventContext && (
                                <button onClick={() => setApplyOnSave(p => !p)} className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${applyOnSave ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'}`}>
                                    {applyOnSave ? "저장 시 즉시 적용 (1)" : "저장 시 대기 (0)"}
                                </button>
                             )}
                         </div>
                    </div>
                </div>
                <div className="p-4 bg-gray-50 grid grid-cols-2 gap-3 border-t rounded-b-2xl">
                    <button onClick={() => handleSave(true)} disabled={isSaving || !selectedProduct} className="h-12 bg-white border border-gray-300 text-gray-600 rounded-xl font-bold active:scale-95 transition-all text-sm">
                        {isEditMode ? "수정 완료" : "저장"}
                    </button>
                    <button onClick={handleSaveAndScan} disabled={isSaving || !selectedProduct} className="h-12 bg-indigo-600 text-white rounded-xl font-bold shadow-lg active:scale-95 disabled:bg-gray-300 transition-all flex items-center justify-center gap-2 text-sm">
                        {isSaving ? <SpinnerIcon className="w-5 h-5 animate-spin" /> : <><BarcodeScannerIcon className="w-5 h-5"/>저장 & 스캔</>}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default AddEventProductModal;
