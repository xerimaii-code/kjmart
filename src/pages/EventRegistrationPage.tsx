
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDataState, useAlert, useModals, useScanner } from '../context/AppContext';
import { Product, EventRegistrationDraft } from '../types';
import { executeUserQuery } from '../services/sqlService';
import { SpinnerIcon, SaveIcon, PlayCircleIcon, CalendarIcon, TrashIcon } from '../components/Icons';
import AddEventProductModal from '../components/AddEventProductModal';
import EditEventProductModal from '../components/EditEventProductModal';
import { useDraft } from '../hooks/useDraft';
import { useAdjustForKeyboard } from '../hooks/useAdjustForKeyboard';

const DRAFT_KEY = 'event-registration-draft';

const CREATE_MASTER_SQL = `
-- [행사 마스터 신규 생성] sale_mast 테이블 사용
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @NewJunno VARCHAR(20)
DECLARE @Today VARCHAR(10)
SET @Today = CONVERT(VARCHAR(10), GETDATE(), 120)
-- 전표번호 형식: YYMMDD_HHMMSS
SET @NewJunno = CONVERT(VARCHAR(6), GETDATE(), 12) + '_' + REPLACE(CONVERT(VARCHAR(8), GETDATE(), 108), ':', '')

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO sale_mast (junno, salename, startday, endday, itemcount, isappl, appendid, appendday, avgmgrate)
    VALUES (
        @NewJunno, 
        LEFT(@SaleName, 30), 
        @StartDay, 
        @EndDay, 
        0, 
        '0', -- 초기 상태: 대기(0)
        '', 
        @Today, 
        0
    )

    COMMIT TRANSACTION;
    
    SELECT 'SUCCESS' AS RESULT, @NewJunno AS NEW_JUNNO
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    SELECT 'FAIL' AS RESULT, ERROR_MESSAGE() AS MSG
END CATCH
`;

const CANCEL_DELETE_SQL = `
-- [행사 등록 중 취소 및 완전 삭제]
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    -- 1. 중지 상태로 변경 (0)
    UPDATE sale_mast SET isappl = '0' WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno));
    UPDATE sale_ready SET isappl = '0' WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno));
    
    -- 2. 관련 데이터 삭제
    DELETE FROM sale_ready WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno));
    DELETE FROM sale_mast WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno));

    COMMIT TRANSACTION;
    SELECT 'SUCCESS' AS RESULT, '행사가 취소 및 삭제되었습니다.' AS MSG;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    SELECT 'FAIL' AS RESULT, ERROR_MESSAGE() AS MSG;
END CATCH
`;

const UPSERT_ITEM_SQL = `
-- 쿼리 이름: 행사상품_저장_통합 (SQL 2005) - 이전 행사가격 자동 조회 기능 추가
-- 파라미터: @Junno, @Barcode, @SaleCost, @SalePrice, @IsAppl

DECLARE @TargetStart VARCHAR(10)
DECLARE @TargetEnd VARCHAR(10)
DECLARE @SaleName VARCHAR(30)
DECLARE @ComCode VARCHAR(5)
DECLARE @MarginRate DECIMAL(18,2)
DECLARE @NextSerial VARCHAR(5)
DECLARE @JunnoSerial VARCHAR(25)
DECLARE @Today VARCHAR(10)
DECLARE @OrgPriceToUse DECIMAL(18,0)

SET @Today = CONVERT(VARCHAR(10), GETDATE(), 120)

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

        -- [1] 행사 헤더 정보 조회
        SELECT @SaleName = salename, 
               @TargetStart = startday, 
               @TargetEnd = endday
        FROM sale_mast WITH(UPDLOCK, ROWLOCK) 
        WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno))

        IF ISNULL(@SaleName, '') = ''
        BEGIN
            RAISERROR('존재하지 않는 행사 전표이거나 행사명이 없습니다.', 16, 1)
        END

        -- [2] 상품 기본 정보 조회
        SELECT @ComCode = comcode
        FROM parts WITH(NOLOCK)
        WHERE barcode = @Barcode

        IF @ComCode IS NULL
        BEGIN
            RAISERROR('상품 마스터에 없는 바코드입니다.', 16, 1)
        END
        
        -- [3] 이전 행사가격 또는 정상가 조회 (orgmoney1 설정용)
        SET @OrgPriceToUse = ISNULL(
            (SELECT TOP 1 r.salemoney1 
             FROM sale_ready r JOIN sale_mast m ON r.junno = m.junno
             WHERE r.barcode = @Barcode AND LTRIM(RTRIM(m.junno)) <> LTRIM(RTRIM(@Junno))
             ORDER BY m.endday DESC, m.startday DESC),
            (SELECT money1 FROM parts WHERE barcode = @Barcode)
        );

        -- [4] 마진율 계산
        IF CAST(@SalePrice AS DECIMAL) = 0
            SET @MarginRate = 0
        ELSE
            SET @MarginRate = FLOOR(((CAST(@SalePrice AS DECIMAL) - CAST(@SaleCost AS DECIMAL)) / CAST(@SalePrice AS DECIMAL)) * 100)

        -- [5] 데이터 저장 (UPSERT)
        IF EXISTS (SELECT 1 FROM sale_ready WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno)) AND barcode = @Barcode)
        BEGIN
            UPDATE sale_ready
            SET salemoney0 = @SaleCost,
                salemoney1 = @SalePrice,
                salecount  = @MarginRate,
                isappl     = @IsAppl,
                edtday     = GETDATE()
            WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno)) AND barcode = @Barcode
        END
        ELSE
        BEGIN
            SELECT @NextSerial = RIGHT('00000' + CAST(ISNULL(COUNT(*), 0) + 1 AS VARCHAR), 5)
            FROM sale_ready 
            WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno))

            SET @JunnoSerial = @Junno + '_' + @NextSerial

            INSERT INTO sale_ready (
                junno_serial, junno, salename, barcode, comcode, 
                salemoney0, salemoney1, orgmoney1, salecount, 
                startday, endday, isappl, inpday, 
                islink, isautoappl, isautoback
            )
            VALUES (
                @JunnoSerial, @Junno, @SaleName, @Barcode, @ComCode,
                @SaleCost, @SalePrice, @OrgPriceToUse, @MarginRate,
                @TargetStart, @TargetEnd, @IsAppl, @Today,
                '1', '1', '1'
            )
        END
        
        -- [6] 마스터 요약 정보 업데이트
        UPDATE sale_mast 
        SET itemcount = (SELECT COUNT(*) FROM sale_ready WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno))),
            avgmgrate = (SELECT ISNULL(AVG(salecount), 0) FROM sale_ready WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno)))
        WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno))

    COMMIT TRANSACTION;
    SELECT 'SUCCESS' AS RESULT, '저장되었습니다.' AS MSG

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    SELECT 'FAIL' AS RESULT, ERROR_MESSAGE() AS MSG
END CATCH
`;

const FINAL_CONFIRM_SQL = `
-- [행사 최종 확정 및 상태 변경 + Parts 업데이트]
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Today VARCHAR(10)
DECLARE @TargetStatus VARCHAR(1)
SET @Today = CONVERT(VARCHAR(10), GETDATE(), 120)

-- 날짜 조건에 따른 최종 상태 결정 (시작일이 오늘이거나 지났으면 '1', 아니면 '0')
SET @TargetStatus = CASE 
                        WHEN @FinalStart <= @Today THEN '1'
                        ELSE '0'
                    END

BEGIN TRY
    BEGIN TRANSACTION;

        -- 1. 마스터 정보 업데이트
        UPDATE sale_mast
        SET salename = LEFT(@FinalName, 30),
            startday = @FinalStart,
            endday   = @FinalEnd,
            isappl   = @TargetStatus
        WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@TargetJunno))

        -- 2. 소속된 모든 품목 상태도 마스터와 동일하게 업데이트
        UPDATE sale_ready
        SET startday = @FinalStart,
            endday = @FinalEnd,
            isappl = @TargetStatus
        WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@TargetJunno))

        -- 3. [추가] 만약 적용 상태('1')가 되면 parts 테이블 업데이트
        IF @TargetStatus = '1'
        BEGIN
            UPDATE p
            SET p.money1comp = r.salemoney1,
                p.salemoney0 = r.salemoney0,
                p.salestartday = r.startday,
                p.saleendday = r.endday
            FROM parts p
            JOIN sale_ready r ON p.barcode = r.barcode
            WHERE LTRIM(RTRIM(r.junno)) = LTRIM(RTRIM(@TargetJunno));
        END

    COMMIT TRANSACTION;

    SELECT 'SUCCESS' AS RESULT, 
           CASE WHEN @TargetStatus = '1' THEN 'APPLIED' ELSE 'RESERVED' END AS STATUS
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    SELECT 'FAIL' AS RESULT, ERROR_MESSAGE() AS MSG
END CATCH
`;

interface EventRegistrationPageProps {
    isActive: boolean;
    onSuccess: (newJunno: string) => void;
}

const EventRegistrationPage: React.FC<EventRegistrationPageProps> = ({ isActive, onSuccess }) => {
    const { showAlert, showToast } = useAlert();
    const { userQueries } = useDataState();
    const { draft, save: saveDraft, remove: removeDraft } = useDraft<EventRegistrationDraft>(DRAFT_KEY);
    const draftRestored = useRef(false);
    const popupRef = useRef<HTMLDivElement>(null);

    const [step, setStep] = useState<1 | 2>(1);
    const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [endDate, setEndDate] = useState(() => {
        const date = new Date();
        date.setFullYear(date.getFullYear() + 1); 
        return date.toISOString().slice(0, 10);
    });
    const [eventName, setEventName] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [junno, setJunno] = useState('');
    const [addedItems, setAddedItems] = useState<any[]>([]);
    const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<any | null>(null);

    // Step 1 팝업 키보드 가림 방지
    useAdjustForKeyboard(popupRef, step === 1 && isActive);

    const fetchAddedItems = useCallback(async (currentJunno: string) => {
        if (!currentJunno) { setAddedItems([]); return; }
        try {
            const query = userQueries.find(q => q.name === '행사상세');
            if (!query || !query.query) {
                showAlert("'행사상세' 쿼리가 없거나 비어있습니다.");
                return;
            }
            const result = await executeUserQuery('행사상세', { junno: currentJunno.trim() }, query.query);
            
            const mappedResult = (result || []).map((item: any) => ({
                ...item,
                barcode: item.barcode || item['바코드'],
                descr: item.descr || item['상품명'],
                salemoney0: item.salemoney0 ?? item['행사매입가'],
                salemoney1: item.salemoney1 ?? item['행사판매가'],
                orgmoney1: item.orgmoney1 ?? item['이전판매가'],
                isappl: String(item.isappl ?? item.상태 ?? '0'),
            }));

            setAddedItems(mappedResult);
        } catch (e: any) {
            showAlert('행사 품목을 불러오는데 실패했습니다: ' + e.message);
        }
    }, [showAlert, userQueries]);

    useEffect(() => {
        if (isActive && draft && !draftRestored.current) {
            draftRestored.current = true;
            showAlert(
                "작성 중이던 행사 정보가 있습니다.\n이어서 등록하시겠습니까?",
                () => {
                    setStep(draft.step); setJunno(draft.junno); setEventName(draft.eventName);
                    setStartDate(draft.startDate); setEndDate(draft.endDate);
                    if (draft.junno) fetchAddedItems(draft.junno);
                    else setAddedItems(draft.items || []);
                }, "이어서 작성", "bg-blue-600",
                () => removeDraft(), "새로 시작"
            );
        }
    }, [isActive, draft, removeDraft, showAlert, fetchAddedItems]);
    
    useEffect(() => {
        if (isActive && (eventName || addedItems.length > 0)) {
            saveDraft({ step, junno, eventName, startDate, endDate, items: addedItems });
        }
    }, [addedItems, eventName, startDate, endDate, step, junno, isActive, saveDraft]);

    const handleCreateMaster = async () => {
        if (!eventName.trim()) { showAlert('행사명을 입력해주세요.'); return; }
        setIsSaving(true);
        try {
            const params = { SaleName: eventName, StartDay: startDate, EndDay: endDate };
            const result = await executeUserQuery('행사마스터_신규등록', params, CREATE_MASTER_SQL);
            
            if (result && result.length > 0 && result[0].RESULT === 'SUCCESS') {
                const newJunno = String(result[0].NEW_JUNNO).trim();
                setJunno(newJunno);
                setStep(2);
                showToast("행사 전표가 생성되었습니다.", "success");
            } else { 
                throw new Error(result?.[0]?.MSG || '행사 마스터 생성 실패'); 
            }
        } catch (error: any) { 
            showAlert(`오류: ${error.message}`); 
        } finally { setIsSaving(false); }
    };

    const handleSaveItem = async (itemData: any) => {
        try {
            const params = {
                Junno: junno.trim(),
                Barcode: itemData['바코드'],
                SaleCost: itemData['행사매입가'],
                SalePrice: itemData['행사판매가'],
                IsAppl: '0' // 신규 등록 시에는 항상 '0'(대기)
            };
            const result = await executeUserQuery('행사상품_추가저장', params, UPSERT_ITEM_SQL);
            if (result && result.length > 0 && result[0].RESULT === 'FAIL') throw new Error(result[0].MSG);
            
            showToast('상품이 저장되었습니다.', 'success');
            await fetchAddedItems(junno);
        } catch (e: any) {
            showAlert('상품 저장 실패: ' + e.message);
            throw e;
        }
    };

    const handleDeleteItem = (barcode: string) => {
        showAlert(`목록에서 삭제하시겠습니까?`, async () => {
            try {
                const deleteSql = `DELETE FROM sale_ready WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno)) AND barcode = @Barcode; UPDATE sale_mast SET itemcount = (SELECT COUNT(*) FROM sale_ready WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno))), avgmgrate = (SELECT ISNULL(AVG(salecount), 0) FROM sale_ready WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno))) WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno));`;
                await executeUserQuery('행사상품_개별삭제', { Junno: junno.trim(), Barcode: barcode }, deleteSql);
                showToast('삭제되었습니다.', 'success');
                await fetchAddedItems(junno);
            } catch (e: any) { showAlert('삭제 실패: ' + e.message); }
        });
    };
    
    const handleSaveAndApply = async () => {
        if (addedItems.length === 0) { showAlert('등록된 상품이 없습니다.'); return; }
        
        const today = new Date().toISOString().slice(0, 10);
        const isImmediate = startDate <= today;
        const msg = isImmediate 
            ? `행사 시작일이 오늘이거나 이전입니다.\n최종 확정 시 모든 품목이 '즉시 적용'됩니다. 진행하시겠습니까?`
            : `행사 시작일이 미래(${startDate})입니다.\n최종 확정 시 '예약' 처리됩니다. 진행하시겠습니까?`;

        showAlert(msg, async () => {
            setIsSaving(true);
            try {
                const res = await executeUserQuery('행사등록_최종확정', { 
                    TargetJunno: junno.trim(), FinalName: eventName, FinalStart: startDate, FinalEnd: endDate 
                }, FINAL_CONFIRM_SQL);
                
                if (res && res[0].RESULT === 'SUCCESS') {
                    if (res[0].STATUS === 'APPLIED') showToast('행사가 즉시 적용되었습니다.', 'success');
                    else showToast('행사가 성공적으로 예약되었습니다.', 'success');
                    removeDraft(); 
                    onSuccess(junno);
                } else {
                    throw new Error(res?.[0]?.MSG || '확정 실패');
                }
            } catch (e: any) { 
                showAlert(`저장 오류: ${e.message}`); 
            } finally { 
                setIsSaving(false); 
            }
        }, '최종 확정', 'bg-indigo-600');
    };

    const handleCancelAll = () => {
        showAlert(
            "작성 중인 행사를 취소하고 모든 내용을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.",
            async () => {
                try {
                    if (junno) await executeUserQuery('행사등록_취소삭제', { Junno: junno.trim() }, CANCEL_DELETE_SQL);
                    removeDraft();
                    onSuccess('');
                    showToast('행사 등록이 취소되었습니다.', 'success');
                } catch (e: any) {
                    showAlert('취소 처리 중 오류가 발생했습니다: ' + e.message);
                }
            },
            '삭제 및 취소',
            'bg-rose-600'
        );
    };

    const sortedItems = useMemo(() => {
        return [...addedItems].sort((a, b) => (a.descr || a['상품명'] || '').localeCompare(b.descr || b['상품명'] || ''));
    }, [addedItems]);

    if (step === 1) return (
        <div className="flex items-center justify-center min-h-full p-4 bg-gray-900/10 backdrop-blur-[1px]">
            <div ref={popupRef} className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-4 w-full max-w-[320px] space-y-4 animate-card-enter flex flex-col">
                <div className="space-y-3">
                    <div className="space-y-1">
                        <label className="text-[11px] font-black text-gray-400 uppercase tracking-tighter ml-1">행사 기간</label>
                        <div className="flex flex-col gap-2">
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 pointer-events-none">시작</span>
                                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="h-11 border border-gray-200 rounded-xl pl-10 pr-3 text-sm font-bold focus:ring-1 focus:ring-indigo-500 outline-none bg-white w-full shadow-sm text-gray-800" required />
                            </div>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 pointer-events-none">종료</span>
                                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="h-11 border border-gray-200 rounded-xl pl-10 pr-3 text-sm font-bold focus:ring-1 focus:ring-indigo-500 outline-none bg-white w-full shadow-sm text-gray-800" required />
                            </div>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <label className="text-[11px] font-black text-gray-400 uppercase tracking-tighter ml-1">행사명</label>
                        <input type="text" value={eventName} onChange={e => setEventName(e.target.value)} placeholder="행사명 입력" maxLength={30} className="w-full h-11 px-4 border border-gray-200 rounded-xl text-base font-bold focus:ring-1 focus:ring-indigo-500 outline-none bg-white shadow-sm"/>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-1">
                    <button onClick={() => onSuccess('')} className="h-12 bg-gray-50 text-gray-500 rounded-xl font-bold active:scale-95 transition-transform text-sm border border-gray-100">취소</button>
                    <button onClick={handleCreateMaster} disabled={isSaving} className="h-12 bg-indigo-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-transform text-sm">
                        {isSaving ? <SpinnerIcon className="w-4 h-4 animate-spin"/> : <SaveIcon className="w-4 h-4"/>}
                        전표 생성
                    </button>
                </div>
            </div>
        </div>
    );

    return (
        <div className="flex flex-col h-full bg-gray-50">
            <div className="p-3 bg-white border-b z-10 flex-shrink-0 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded font-mono font-bold">전표: {junno}</span>
                    <button onClick={handleCancelAll} className="text-xs text-rose-500 font-black px-2 py-1 bg-rose-50 rounded-lg border border-rose-100 active:scale-95">모두 취소</button>
                </div>
                <input type="text" value={eventName} onChange={e => setEventName(e.target.value)} className="w-full font-black text-gray-800 text-xl border-b border-transparent focus:border-indigo-500 outline-none py-1 bg-transparent transition-colors" placeholder="행사명"/>
                <div className="flex gap-2 text-xs font-bold text-gray-500 items-center mt-2">
                    <div className="flex items-center gap-1 bg-indigo-50/50 px-2 py-1.5 rounded-xl border border-indigo-100/50">
                        <CalendarIcon className="w-3.5 h-3.5 text-indigo-400" />
                        <span className="text-indigo-700">{startDate} ~ {endDate}</span>
                    </div>
                </div>
            </div>
            
            <div className="flex-grow overflow-auto p-2">
                {addedItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 pb-20 text-center opacity-60">
                        <div className="w-20 h-20 bg-gray-200 rounded-full flex items-center justify-center mb-4">
                            <PlayCircleIcon className="w-10 h-10 text-gray-400" />
                        </div>
                        <p className="font-black text-lg text-gray-500">행사 품목을 추가하세요</p>
                    </div>
                ) : (
                    <div className="space-y-2 pb-24">
                        {sortedItems.map((item, idx) => (
                            <div key={item.barcode} onClick={() => setEditingProduct(item)} className="bg-white p-3 rounded-2xl border border-gray-200 flex justify-between items-center shadow-sm animate-fade-in-up cursor-pointer active:bg-gray-50 transition-all hover:shadow-md">
                                <div className="min-w-0 flex-grow pr-2">
                                    <p className="font-black text-gray-800 text-sm mb-1 truncate">
                                        <span className={`font-mono mr-2 ${String(item.isappl) === '1' ? 'text-green-500' : 'text-slate-300'}`}>#{idx + 1}</span>
                                        {item.descr || item['상품명']}
                                    </p>
                                    <div className="flex gap-3 text-[11px] items-center">
                                        <span className="text-gray-400 font-bold">매입: {Number(item.salemoney0 || item['행사매입가']).toLocaleString()}</span>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-indigo-600 font-black text-sm">판매: {Number(item.salemoney1 || item['행사판매가']).toLocaleString()}</span>
                                            <span className="text-gray-300 line-through font-medium">({Number(item.orgmoney1 || item['이전판매가']).toLocaleString()})</span>
                                        </div>
                                    </div>
                                </div>
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteItem(item.barcode || item['바코드']); }} className="p-2.5 text-gray-300 hover:text-rose-500 active:bg-rose-50 rounded-full transition-colors"><TrashIcon className="w-5 h-5" /></button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="fixed bottom-24 right-6 z-[120]">
                <button onClick={() => setIsAddProductModalOpen(true)} className="w-16 h-16 bg-indigo-600 text-white rounded-full shadow-2xl flex items-center justify-center hover:bg-indigo-700 active:scale-95 transition-transform border-[6px] border-white">
                    <span className="text-4xl font-light mb-1">+</span>
                </button>
            </div>

            <div className="p-3 bg-white border-t border-gray-100 z-10 safe-area-pb shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
                <button onClick={handleSaveAndApply} disabled={isSaving || addedItems.length === 0} className="w-full h-14 bg-indigo-600 text-white rounded-2xl font-black text-lg flex items-center justify-center gap-3 disabled:bg-gray-400 active:scale-95 transition-transform shadow-xl shadow-indigo-100">
                    {isSaving ? <SpinnerIcon className="w-7 h-7 animate-spin"/> : <><PlayCircleIcon className="w-7 h-7"/> 최종 확정 (작성 완료)</>}
                </button>
            </div>

            {isAddProductModalOpen && (
                <AddEventProductModal isOpen={isAddProductModalOpen} onClose={() => setIsAddProductModalOpen(false)} junno={junno} onSuccess={handleSaveItem} existingBarcodes={addedItems.map(i => i.barcode || i['바코드'])} parentStatus="new" />
            )}
            {editingProduct && (
                <EditEventProductModal 
                    isOpen={!!editingProduct} 
                    onClose={() => setEditingProduct(null)} 
                    product={{ ...editingProduct, '상품명': editingProduct.descr || editingProduct['상품명'], '행사매입가': editingProduct.salemoney0 || editingProduct['행사매입가'], '행사판매가': editingProduct.salemoney1 || editingProduct['행사판매가'], '이전판매가': editingProduct.orgmoney1 || editingProduct['이전판매가'], '바코드': editingProduct.barcode || editingProduct['바코드'], 'isappl': '0' }} 
                    onSuccess={(updated) => { handleSaveItem(updated); setEditingProduct(null); }} 
                    editContext="new"
                />
            )}
        </div>
    );
};

export default EventRegistrationPage;
