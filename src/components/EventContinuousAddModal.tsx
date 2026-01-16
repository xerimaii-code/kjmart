
import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAlert } from '../context/AppContext';
import { executeUserQuery } from '../services/sqlService';
import { Product } from '../types';
import { SpinnerIcon, XCircleIcon, CheckCircleIcon, SaveIcon, SparklesIcon, PencilSquareIcon, WarningIcon } from './Icons';

interface EventContinuousAddModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (details: { saleCost: number; salePrice: number }) => void;
    product: Product | null;
    junno: string;
    existingBarcodes: string[];
    parentStatus?: 'new' | '0' | '1' | '2';
}

const CHECK_PRODUCT_EVENT_SQL = `
-- [행사상품 상세조회 및 중복체크]
DECLARE @MyStart VARCHAR(10)
DECLARE @MyEnd VARCHAR(10)

SELECT @MyStart = startday, @MyEnd = endday
FROM sale_mast WITH(NOLOCK)
WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno))

SELECT 
    P.descr      AS [GoodsName],
    P.spec       AS [Spec],
    P.money0vat  AS [Cost],
    P.money1     AS [Price],
    @MyStart     AS [MyStart],
    CASE WHEN R.junno IS NOT NULL THEN 'UPDATE' ELSE 'INSERT' END AS [Mode],
    ISNULL(R.salemoney0, P.money0vat) AS [SaleCost],
    ISNULL(R.salemoney1, P.money1)    AS [SalePrice],
    (
        SELECT TOP 1 '[' + M2.salename + '] ' + CONVERT(VARCHAR, CAST(R2.salemoney1 AS INT)) + '원'
        FROM sale_ready R2 WITH(NOLOCK)
        INNER JOIN sale_mast M2 WITH(NOLOCK) ON R2.junno = M2.junno
        WHERE R2.barcode = P.barcode
          AND LTRIM(RTRIM(R2.junno)) <> LTRIM(RTRIM(@Junno))
          AND M2.isappl = '1'
          AND (REPLACE(M2.startday, '-', '') <= REPLACE(@MyEnd, '-', '') AND REPLACE(M2.endday, '-', '') >= REPLACE(@MyStart, '-', ''))
        ORDER BY M2.startday DESC
    ) AS [WarningMsg],
    (
        SELECT TOP 1 R2.salemoney1
        FROM sale_ready R2 WITH(NOLOCK)
        INNER JOIN sale_mast M2 WITH(NOLOCK) ON R2.junno = M2.junno
        WHERE R2.barcode = P.barcode AND LTRIM(RTRIM(R2.junno)) <> LTRIM(RTRIM(@Junno))
        ORDER BY M2.endday DESC
    ) AS [PreviousSalePrice]
FROM parts P WITH(NOLOCK)
LEFT JOIN sale_ready R WITH(NOLOCK) 
    ON P.barcode = R.barcode AND LTRIM(RTRIM(R.junno)) = LTRIM(RTRIM(@Junno))
WHERE P.barcode = @Barcode
`;

const EventContinuousAddModal: React.FC<EventContinuousAddModalProps> = ({ 
    isOpen, onClose, onSave, product, junno, existingBarcodes
}) => {
    const { showAlert, showToast } = useAlert();
    const [isRendered, setIsRendered] = useState(false);
    
    const [saleCost, setSaleCost] = useState<number | string>('');
    const [salePrice, setSalePrice] = useState<number | string>('');
    const [isSaving, setIsSaving] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    
    const [orgPrice, setOrgPrice] = useState(0);
    const [otherEventInfo, setOtherEventInfo] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const isDuplicateLocal = useMemo(() => product ? existingBarcodes.includes(product.barcode) : false, [product, existingBarcodes]);
    
    useEffect(() => {
        if (isOpen) {
            setIsSaving(false);
            setIsRendered(true);
            setIsLoading(true);
            setOtherEventInfo(null);
            setSaleCost(''); setSalePrice('');
            
            if (product) {
                executeUserQuery('행사상품체크', { Junno: junno, Barcode: product.barcode }, CHECK_PRODUCT_EVENT_SQL)
                    .then(res => {
                        if (res && res.length > 0) {
                            const info = res[0];
                            setSaleCost(info.SaleCost);
                            setSalePrice(info.SalePrice);
                            setIsEditMode(info.Mode === 'UPDATE');
                            setOrgPrice(info.PreviousSalePrice || info.Price);
                            if (info.WarningMsg) setOtherEventInfo(info.WarningMsg);
                        }
                    }).catch(e => showAlert('상품 정보 조회 실패: ' + e.message))
                    .finally(() => setIsLoading(false));
            }
        } else {
            setIsRendered(false);
        }
    }, [isOpen, product, junno, existingBarcodes, showAlert]);

    const handleSave = () => {
        setIsSaving(true);
        onSave({ saleCost: Number(saleCost), salePrice: Number(salePrice) });
    };

    const marginRate = useMemo(() => {
        const cost = Number(saleCost); const price = Number(salePrice);
        if (!price || price === 0) return 0;
        return ((price - cost) / price) * 100;
    }, [saleCost, salePrice]);

    if (!isOpen || !product) return null;

    return createPortal(
        <div className={`fixed inset-0 z-[150] flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black/40' : 'bg-transparent'}`} onClick={onClose}>
            <div className={`bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col transition-all duration-300 ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`} onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh' }}>
                
                {/* Header: 수정 모드일 경우 색상 강조 */}
                <div className={`p-4 border-b flex justify-between items-center rounded-t-2xl ${isDuplicateLocal ? 'bg-gray-100' : 'bg-gray-50'}`}>
                    <div className="flex items-center gap-2">
                        <h3 className={`text-xs font-black uppercase tracking-widest ${isDuplicateLocal ? 'text-gray-700' : 'text-gray-500'}`}>
                            {isDuplicateLocal ? '등록된 상품 수정' : (isEditMode ? '행사 상품 수정' : '행사 상품 추가')}
                        </h3>
                        {isDuplicateLocal && (
                            <span className="bg-white text-gray-800 text-[10px] font-bold px-2 py-0.5 rounded border border-gray-300 shadow-sm">
                                목록에 있음
                            </span>
                        )}
                    </div>
                    <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><XCircleIcon className="w-6 h-6" /></button>
                </div>
                
                {isLoading ? <div className="h-40 flex items-center justify-center"><SpinnerIcon className="w-8 h-8 text-indigo-500" /></div> : (
                    <>
                        <div className="p-4 space-y-3">
                            {/* 상품 정보 카드 */}
                            <div className={`rounded-xl p-3 border ${isDuplicateLocal ? 'bg-gray-50 border-gray-300' : 'bg-indigo-50 border-indigo-100'}`}>
                                <p className="font-black text-gray-800 text-sm leading-tight mb-1">{product.name}</p>
                                <div className="flex justify-between items-center">
                                    <span className="text-[10px] text-gray-400 font-bold uppercase">정상가</span>
                                    <span className="text-sm font-black text-gray-600">{orgPrice.toLocaleString()}원</span>
                                </div>
                            </div>

                            {/* [수정됨] 목록 중복 안내 메시지 - 연한 회색 & 검정 텍스트 */}
                            {isDuplicateLocal && (
                                <div className="flex items-start gap-2 bg-gray-50 p-2.5 rounded-xl border border-gray-300 shadow-sm">
                                    <PencilSquareIcon className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
                                    <div className="flex-1">
                                        <p className="text-[11px] font-black text-gray-900 leading-tight">작성 중인 목록에 이미 있는 상품입니다.</p>
                                        <p className="text-[10px] text-gray-600 mt-1 font-medium">저장 시 입력한 내용으로 <span className="underline font-bold text-gray-900">덮어씁니다(수정).</span></p>
                                    </div>
                                </div>
                            )}

                            {/* [수정됨] 타 행사 정보 - 연한 회색 & 검정 텍스트 */}
                            {otherEventInfo && (
                                <div className="bg-gray-50 border border-gray-300 rounded-xl p-3 flex gap-2.5 items-start shadow-sm">
                                    <WarningIcon className="w-5 h-5 text-gray-500 flex-shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-start">
                                            <span className="text-[11px] font-black text-gray-900 leading-none mb-1">타 행사 중복 진행 중</span>
                                        </div>
                                        <div className="text-xs font-bold text-gray-900 leading-snug break-words bg-white p-2 rounded-lg border border-gray-200 shadow-sm mb-1.5">
                                            {otherEventInfo}
                                        </div>
                                        <p className="text-[10px] text-gray-600 font-medium leading-tight">
                                            * 기간이 겹칩니다. 저장 시 <span className="font-bold underline text-gray-900">현재 가격이 우선 적용</span>됩니다.
                                        </p>
                                    </div>
                                </div>
                            )}
                            
                            <div className="space-y-3 pt-1">
                                <div className="flex items-center justify-between gap-4">
                                    <label className="text-[11px] font-black text-gray-400 uppercase whitespace-nowrap">행사 매입가</label>
                                    <input type="number" value={saleCost} onChange={(e) => setSaleCost(e.target.value)} className="w-full h-11 px-4 border border-gray-200 rounded-xl text-right font-black text-lg focus:ring-2 focus:ring-indigo-500 bg-gray-50" onFocus={e => e.target.select()}/>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                    <label className="text-[11px] font-black text-indigo-400 uppercase whitespace-nowrap">행사 판매가</label>
                                    <input type="number" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} className="w-full h-11 px-4 border-2 border-indigo-200 rounded-xl text-right font-black text-2xl text-indigo-600 focus:ring-2 focus:ring-indigo-500 bg-white" onFocus={e => e.target.select()}/>
                                </div>
                            </div>
                            <div className="text-right px-1">
                                <span className="text-[10px] font-bold text-gray-400 uppercase mr-2">이익률</span>
                                <span className={`font-black text-base ${marginRate < 5 ? 'text-rose-500' : 'text-emerald-500'}`}>{marginRate.toFixed(1)}%</span>
                            </div>
                        </div>

                        <div className="p-4 bg-gray-50 grid grid-cols-2 gap-3 border-t rounded-b-2xl">
                            <button onClick={onClose} disabled={isSaving} className="h-12 bg-white border border-gray-300 text-gray-600 rounded-xl font-bold active:scale-95 transition-all text-sm">취소</button>
                            {/* 버튼 스타일도 중복 시 너무 튀지 않게 조정 */}
                            <button onClick={handleSave} disabled={isSaving} className={`h-12 text-white rounded-xl font-bold shadow-lg active:scale-95 disabled:bg-gray-300 transition-all flex items-center justify-center gap-2 text-sm ${isDuplicateLocal ? 'bg-slate-600 hover:bg-slate-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                                {isSaving ? <SpinnerIcon className="w-5 h-5 animate-spin" /> : <><SaveIcon className="w-5 h-5"/>{isDuplicateLocal ? '수정 저장' : (isEditMode ? '수정' : '저장')}</>}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>,
        document.body
    );
};

export default EventContinuousAddModal;
