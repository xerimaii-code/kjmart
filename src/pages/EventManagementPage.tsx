
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { executeUserQuery } from '../services/sqlService';
import { useAlert, useDataState, useScanner } from '../context/AppContext';
import { SpinnerIcon, SearchIcon, PencilSquareIcon, TrashIcon, CalendarIcon, SaveIcon, ArchiveBoxIcon, ChartBarIcon, BarcodeScannerIcon } from '../components/Icons';
import ActionModal from '../components/ActionModal';
import AddEventProductModal from '../components/AddEventProductModal';
import EditEventProductModal from '../components/EditEventProductModal';
import EventActionSelectModal from '../components/EventActionSelectModal';
import StopEventModal from '../components/StopEventModal';
import { EventItem, Product } from '../types';
import { useProductSearch } from '../hooks/useProductSearch';
import ProductSearchBar from '../components/ProductSearchBar';
import EventContinuousAddModal from '../components/EventContinuousAddModal';

// ... (기존 SQL 상수들 유지 - 변경 없음)
const FIND_EVENT_BY_PRODUCT_SQL = `
-- [상품 바코드로 소속 행사 찾기]
SELECT TOP 1 
    M.junno, 
    M.salename, 
    M.startday, 
    M.endday, 
    M.isappl, 
    M.itemcount,
    M.avgmgrate
FROM sale_ready R WITH(NOLOCK)
JOIN sale_mast M WITH(NOLOCK) ON R.junno = M.junno
WHERE R.barcode = @Barcode
ORDER BY M.startday DESC, M.junno DESC
`;

const UPSERT_ITEM_SQL = `
-- 파라미터: @Junno(전표번호), @Barcode(상품바코드), @SaleCost(행사매입가), @SalePrice(행사판매가), @IsAppl(적용상태)

DECLARE @TargetStart VARCHAR(10)
DECLARE @TargetEnd VARCHAR(10)
DECLARE @SaleName VARCHAR(30)
DECLARE @ComCode VARCHAR(5)
DECLARE @MarginRate DECIMAL(18,2)
DECLARE @NextSerial VARCHAR(5)
DECLARE @JunnoSerial VARCHAR(25)
DECLARE @Today VARCHAR(10)
DECLARE @OrgPriceToUse DECIMAL(18,0)

-- [추가] edtday 포맷 생성을 위한 변수 선언
DECLARE @Now DATETIME
DECLARE @EdtTimeStr VARCHAR(30)
DECLARE @HH INT
DECLARE @AmPm VARCHAR(4)
DECLARE @HH12 INT

SET @Today = CONVERT(VARCHAR(10), GETDATE(), 120)

-- [추가] 'YYYY-MM-DD 오후 H:MM:SS' 포맷 생성 로직 (SQL 2005 호환)
SET @Now = GETDATE()
SET @HH = DATEPART(HOUR, @Now)
SET @AmPm = CASE WHEN @HH >= 12 THEN '오후' ELSE '오전' END
SET @HH12 = CASE WHEN @HH > 12 THEN @HH - 12
                 WHEN @HH = 0 THEN 12 
                 ELSE @HH END

-- 예: 2026-01-14 오후 7:06:21
SET @EdtTimeStr = @Today + ' ' + @AmPm + ' ' + 
                  CAST(@HH12 AS VARCHAR) + ':' + 
                  RIGHT('0' + CAST(DATEPART(MINUTE, @Now) AS VARCHAR), 2) + ':' + 
                  RIGHT('0' + CAST(DATEPART(SECOND, @Now) AS VARCHAR), 2)


SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

        -- [1] 행사 헤더 정보(기간, 행사명) 조회
        SELECT @SaleName = salename, 
               @TargetStart = startday, 
               @TargetEnd = endday
        FROM sale_mast WITH(UPDLOCK, ROWLOCK) 
        WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno))

        IF ISNULL(@SaleName, '') = ''
        BEGIN
            RAISERROR('존재하지 않는 행사 전표이거나 행사명이 없습니다.', 16, 1)
        END

        -- [2] 상품 기본 정보(거래처코드) 조회
        SELECT @ComCode = comcode
        FROM parts WITH(NOLOCK)
        WHERE barcode = @Barcode

        IF @ComCode IS NULL
        BEGIN
            RAISERROR('상품 마스터에 없는 바코드입니다.', 16, 1)
        END
        
        -- [3] 기준 정상가 조회 (이전 행사 가격이 있으면 그것을 우선, 없으면 현재 마스터 판매가)
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

        -- [5] 데이터 저장 (UPSERT: 있으면 수정, 없으면 추가)
        IF EXISTS (SELECT 1 FROM sale_ready WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno)) AND barcode = @Barcode)
        BEGIN
            -- 이미 등록된 경우: UPDATE
            UPDATE sale_ready
            SET salemoney0 = FLOOR(CAST(@SaleCost AS DECIMAL)), -- 소수점 제거
                salemoney1 = @SalePrice,
                salecount  = @MarginRate,
                isappl     = @IsAppl,
                
                -- [수정됨] 요청하신 날짜/시간 포맷 적용
                edtday     = @EdtTimeStr, 
                starttime  = @Today,      
                endtime    = '-'          
                
            WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno)) AND barcode = @Barcode
        END
        ELSE
        BEGIN
            -- 신규 등록인 경우: INSERT
            -- 일련번호 생성 (junno_serial)
            SELECT @NextSerial = RIGHT('00000' + CAST(ISNULL(COUNT(*), 0) + 1 AS VARCHAR), 5)
            FROM sale_ready 
            WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno))

            SET @JunnoSerial = @Junno + '_' + @NextSerial

            INSERT INTO sale_ready (
                junno_serial, junno, salename, barcode, comcode, 
                salemoney0, salemoney1, orgmoney1, salecount, 
                startday, endday, isappl, inpday, 
                islink, isautoappl, isautoback,
                
                -- [추가됨] 요청하신 컬럼 추가
                edtday, starttime, endtime
            )
            VALUES (
                @JunnoSerial, @Junno, @SaleName, @Barcode, @ComCode,
                FLOOR(CAST(@SaleCost AS DECIMAL)), @SalePrice, @OrgPriceToUse, @MarginRate, -- 소수점 제거
                @TargetStart, @TargetEnd, @IsAppl, @Today, 
                '1', '1', '1',
                
                -- [추가됨] 요청하신 값 매핑
                @EdtTimeStr, 
                @Today,      
                '-'          
            )
        END
        
        -- [6] 마스터 테이블 요약 정보(품목 수, 평균 마진율) 자동 업데이트
        UPDATE sale_mast 
        SET itemcount = (SELECT COUNT(*) FROM sale_ready WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno))),
            avgmgrate = (SELECT ISNULL(AVG(salecount), 0) FROM sale_ready WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno)))
        WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno))
        
        -- [7] [추가] 행사 마스터가 '진행중'이고, 현재 품목도 '적용'으로 저장될 때만 parts 즉시 업데이트
        IF @IsAppl = '1' AND EXISTS(SELECT 1 FROM sale_mast WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno)) AND isappl = '1')
        BEGIN
            UPDATE parts
            SET money1comp = @SalePrice,
                salemoney0 = FLOOR(CAST(@SaleCost AS DECIMAL)), -- 소수점 제거
                salestartday = @TargetStart,
                saleendday = @TargetEnd
            WHERE barcode = @Barcode
        END

    COMMIT TRANSACTION;
    SELECT 'SUCCESS' AS RESULT, '저장되었습니다.' AS MSG

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    SELECT 'FAIL' AS RESULT, ERROR_MESSAGE() AS MSG
END CATCH
`;

const UPDATE_PERIOD_AND_STATUS_SQL = `
-- [행사 기간 변경 및 상태 자동 조정]
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @JunnoToUpdate VARCHAR(20) = @Junno;
DECLARE @NewStartDay VARCHAR(10) = @StartDay;
DECLARE @NewEndDay VARCHAR(10) = @EndDay;
DECLARE @Today VARCHAR(10) = CONVERT(VARCHAR(10), GETDATE(), 120);

DECLARE @OldStatus VARCHAR(1);
DECLARE @NewStatus VARCHAR(1);

BEGIN TRY
    BEGIN TRANSACTION;

        -- 1. 현재 상태와 새로운 상태 결정
        SELECT @OldStatus = isappl FROM sale_mast WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@JunnoToUpdate));

        SET @NewStatus = CASE 
                            WHEN @NewStartDay > @Today THEN '0' -- 미래: 대기
                            WHEN @NewEndDay < @Today THEN '2'   -- 과거: 종료
                            ELSE '1'                           -- 현재: 진행
                         END;

        -- 2. 날짜 및 상태 업데이트
        UPDATE sale_mast SET startday = @NewStartDay, endday = @NewEndDay, isappl = @NewStatus WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@JunnoToUpdate));
        UPDATE sale_ready SET startday = @NewStartDay, endday = @NewEndDay WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@JunnoToUpdate));
        
        -- 3. 상태 변경에 따른 소속 상품(sale_ready) 상태 업데이트 ('D' 상태는 제외)
        IF @NewStatus = '0' -- 대기 상태로 변경 시
        BEGIN
            UPDATE sale_ready SET isappl = '0' WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@JunnoToUpdate)) AND isappl <> 'D';
        END
        ELSE IF @NewStatus = '1' -- 진행 상태로 변경 시
        BEGIN
            UPDATE sale_ready SET isappl = '1' WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@JunnoToUpdate)) AND isappl <> 'D';
        END
        ELSE IF @NewStatus = '2' -- 종료 상태로 변경 시
        BEGIN
            UPDATE sale_ready SET isappl = 'D' WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@JunnoToUpdate)) AND isappl <> 'D';
        END

        -- 4. 상태 변경에 따른 Parts 테이블 업데이트
        IF @OldStatus = '1' AND @NewStatus <> '1'
        BEGIN
            -- [행사 중지 로직]
            UPDATE p
            SET p.money1comp = ISNULL(ne.salemoney1, p.money1),
                p.salemoney0 = ISNULL(ne.salemoney0, p.money0vat),
                p.salestartday = ne.startday,
                p.saleendday = ne.endday
            FROM parts p JOIN sale_ready r ON p.barcode = r.barcode
            OUTER APPLY (
                SELECT TOP 1 r2.salemoney1, r2.salemoney0, m2.startday, m2.endday
                FROM sale_ready r2 JOIN sale_mast m2 ON r2.junno = m2.junno
                WHERE r2.barcode = p.barcode AND m2.isappl = '1' AND LTRIM(RTRIM(m2.junno)) <> LTRIM(RTRIM(@JunnoToUpdate))
                ORDER BY m2.startday DESC
            ) AS ne
            WHERE LTRIM(RTRIM(r.junno)) = LTRIM(RTRIM(@JunnoToUpdate));
        END
        else if @OldStatus <> '1' AND @NewStatus = '1'
        BEGIN
            -- [행사 적용 로직]
            UPDATE p
            SET p.money1comp = r.salemoney1,
                p.salemoney0 = r.salemoney0,
                p.salestartday = @NewStartDay,
                p.saleendday = @NewEndDay
            FROM parts p JOIN sale_ready r ON p.barcode = r.barcode
            WHERE LTRIM(RTRIM(r.junno)) = LTRIM(RTRIM(@JunnoToUpdate)) AND r.isappl = '1';
        END

    COMMIT TRANSACTION;
    SELECT 'SUCCESS' AS RESULT, '기간 및 상태가 업데이트되었습니다.' AS MSG;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    SELECT 'FAIL' AS RESULT, ERROR_MESSAGE() AS MSG;
END CATCH
`;

const EventManagementPage: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    // ... (기존 상태 변수들 동일) ...
    const { showToast, showAlert } = useAlert();
    const { userQueries } = useDataState();
    const { openScanner } = useScanner();

    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        return d.toISOString().slice(0, 10);
    });
    const [endDate, setEndDate] = useState(() => {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        return d.toISOString().slice(0, 10);
    });
    
    const [statusFilter, setStatusFilter] = useState<'all' | '0' | '1' | '2'>('1');
    const [events, setEvents] = useState<EventItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false); 
    const [error, setError] = useState<string | null>(null);
    
    const [isActionSelectModalOpen, setIsActionSelectModalOpen] = useState(false);
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);
    const [isStopChoiceModalOpen, setIsStopChoiceModalOpen] = useState(false);
    
    const [editableStartDate, setEditableStartDate] = useState('');
    const [editableEndDate, setEditableEndDate] = useState('');
    
    const [draftItems, setDraftItems] = useState<any[]>([]);
    const [isDetailLoading, setIsDetailLoading] = useState(false);
    const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<any | null>(null);
    
    const [highlightedBarcode, setHighlightedBarcode] = useState<string | null>(null);
    
    const [continuousAddItem, setContinuousAddItem] = useState<Product | null>(null);
    const isProcessingScanRef = useRef(false);

    const { searchTerm, setSearchTerm, results, isSearching, search, searchByBarcode, clear: clearProductSearch } = useProductSearch('productInquiry', 50, '상품조회');

    // ... (기존 useEffect, handleSearch 등 함수들 동일) ...
    useEffect(() => {
        if (isActive && searchTerm.trim().length >= 2) {
            search();
        }
    }, [searchTerm, search, isActive]);

    useEffect(() => {
        if (selectedEvent) {
            setEditableStartDate(selectedEvent.startday);
            setEditableEndDate(selectedEvent.endday);
        }
    }, [selectedEvent]);

    const handleSearch = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        setError(null);

        const query = userQueries.find(q => q.name === '행사목록');
        if (!query) {
            const msg = "'행사목록' 쿼리가 없습니다. [설정 > SQL Runner]에서 쿼리를 추가해주세요.";
            setError(msg);
            if (!silent) showAlert(msg);
            setIsLoading(false);
            return;
        }

        try {
            const params = {
                startDate,
                endDate,
                status: statusFilter === 'all' ? '' : statusFilter
            };
            const result = await executeUserQuery(query.name, params, query.query);
            
            const mappedResult = (result || []).map((r: any): EventItem => ({
                ...r,
                salename: r.salename || r.행사명 || '이름 없음',
                junno: r.junno || r.전표번호 || 'N/A',
                startday: r.startday || r.시작일 || '',
                endday: r.endday || r.종료일 || '',
                itemcount: r.itemcount || r.행사품목수 || 0,
                isappl: String(r.isappl ?? r.상태 ?? '0'),
                avgmgrate: r.avgmgrate || r.평균마진율 || 0,
            }))
            setEvents(mappedResult);

        } catch (e: any) {
            const errorMessage = e.message || '행사 목록을 가져오는데 실패했습니다.';
            setError(errorMessage);
            if (!silent) showAlert(errorMessage);
        } finally {
            setIsLoading(false);
        }
    }, [startDate, endDate, statusFilter, showAlert, userQueries]);

    useEffect(() => {
        if (isActive) handleSearch(true);
    }, [isActive, handleSearch]);

    const fetchEventDetails = useCallback(async (junno: string) => {
        setIsDetailLoading(true);
        try {
            const query = userQueries.find(q => q.name === '행사상세');
            if (!query || !query.query) {
                throw new Error("'행사상세' 쿼리를 찾을 수 없거나 비어있습니다.");
            }
            const result = await executeUserQuery('행사상세', { junno: junno.trim() }, query.query);
            
            const mappedResult = (result || []).map((item: any) => {
                const rawStatus = item.isappl ?? item.상태;
                const normalizedStatus = String(rawStatus || '0').trim().toUpperCase();
                const finalStatus = (normalizedStatus === '1' || normalizedStatus === 'D') ? normalizedStatus : '0';

                return {
                    ...item,
                    barcode: item.barcode || item['바코드'],
                    descr: item.descr || item['상품명'],
                    spec: item.spec || item['규격'],
                    salemoney0: item.salemoney0 ?? item['행사매입가'],
                    salemoney1: item.salemoney1 ?? item['행사판매가'],
                    orgmoney1: item.orgmoney1 ?? item['이전판매가'],
                    isappl: finalStatus,
                    salecount: item.salecount ?? item.마진율 ?? 0,
                };
            });

            setDraftItems(mappedResult);
            return mappedResult;
        } catch (e: any) {
            showAlert('상세 내역 로드 실패: ' + e.message);
            return null;
        } finally {
            setIsDetailLoading(false);
        }
    }, [userQueries, showAlert]);

    // [이벤트 리스너 추가] 뒤로가기 시 연속 스캔 모달 닫기 처리
    useEffect(() => {
        const handlePop = (e: PopStateEvent) => {
            if (continuousAddItem && e.state?.modal !== 'continuousEventAdd') {
                setContinuousAddItem(null);
                isProcessingScanRef.current = false;
            }
        };
        window.addEventListener('popstate', handlePop);
        return () => window.removeEventListener('popstate', handlePop);
    }, [continuousAddItem]);

    const jumpToEventByBarcode = async (barcode: string) => {
        setIsLoading(true);
        try {
            const res = await executeUserQuery('행사찾기', { Barcode: barcode }, FIND_EVENT_BY_PRODUCT_SQL);
            if (res && res.length > 0) {
                const ev = res[0];
                const mappedEvent: EventItem = {
                    ...ev,
                    salename: ev.salename || '이름 없음',
                    junno: ev.junno || 'N/A',
                    startday: ev.startday || '',
                    endday: ev.endday || '',
                    itemcount: ev.itemcount || 0,
                    isappl: String(ev.isappl ?? '0'),
                    avgmgrate: ev.avgmgrate || 0,
                };
                setSelectedEvent(mappedEvent);
                setDetailModalOpen(true);
                
                const items = await fetchEventDetails(mappedEvent.junno);
                if (items && items.length > 0) {
                    const targetItem = items.find(i => String(i.barcode).trim() === barcode.trim());
                    if (targetItem) {
                        setHighlightedBarcode(barcode);
                        setTimeout(() => {
                            const el = document.getElementById(`event-item-${barcode}`);
                            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 500);
                    }
                }
            } else {
                showAlert('해당 상품이 포함된 행사를 찾을 수 없습니다.');
            }
        } catch (e: any) {
            showAlert('행사 조회 실패: ' + e.message);
        } finally {
            setIsLoading(false);
            clearProductSearch();
        }
    };

    const handleProductSelect = (product: Product) => {
        jumpToEventByBarcode(product.barcode);
    };

    const handleScan = () => {
        openScanner('modal', (barcode) => {
            jumpToEventByBarcode(barcode);
        }, false);
    };

    const handleManualSearch = () => {
        const term = searchTerm.trim();
        if (!term) {
            handleScan();
            return;
        }
        if (/^\d{7,}$/.test(term)) {
            jumpToEventByBarcode(term);
        } else {
            search();
        }
    };
    
    const handleAddProductSuccess = async (newItem: any) => {
        if (!selectedEvent) return;
        try {
            const params = {
                Junno: selectedEvent.junno.trim(),
                Barcode: newItem['바코드'],
                SaleCost: newItem['행사매입가'],
                SalePrice: newItem['행사판매가'],
                IsAppl: newItem['isappl'] || '0'
            };
            const result = await executeUserQuery('행사상품_추가저장', params, UPSERT_ITEM_SQL);
            if (result && result.length > 0 && result[0].RESULT === 'FAIL') {
                throw new Error(result[0].MSG || '상품 추가에 실패했습니다.');
            }
            
            setHighlightedBarcode(newItem['바코드']);
            showToast(result[0]?.MSG || '상품이 추가되었습니다.', 'success');
            
            await fetchEventDetails(selectedEvent.junno);
            await handleSearch(true);

            setTimeout(() => {
                document.getElementById(`event-item-${newItem['바코드']}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);

        } catch (e: any) {
            showAlert('저장 실패: ' + e.message);
            throw e; 
        }
    };

    const handleEventAction = (event: EventItem) => {
        if (!event || !event.junno) {
            showAlert('선택한 행사에 유효한 전표번호가 없어 작업을 계속할 수 없습니다.');
            return;
        }
        setSelectedEvent(event);
        setIsActionSelectModalOpen(true);
    };

    const handleApplyEvent = async (event: EventItem) => {
        showAlert(`'${event.salename}' 행사를 전체 적용하시겠습니까?\n즉시 매장의 판매가가 변경됩니다.`, async () => {
            setIsProcessing(true);
            try {
                const applySql = `
                    SET NOCOUNT ON; SET XACT_ABORT ON;
                    BEGIN TRY
                        BEGIN TRANSACTION;
                        UPDATE sale_mast SET isappl = '1' WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno));
                        UPDATE sale_ready SET isappl = '1' WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno)) AND isappl <> 'D';

                        UPDATE p SET p.money1comp = r.salemoney1, p.salemoney0 = r.salemoney0, p.salestartday = m.startday, p.saleendday = m.endday 
                        FROM parts p JOIN sale_ready r ON p.barcode = r.barcode JOIN sale_mast m ON r.junno = m.junno 
                        WHERE LTRIM(RTRIM(m.junno)) = LTRIM(RTRIM(@Junno)) AND r.isappl = '1';
                        COMMIT TRANSACTION;
                    END TRY
                    BEGIN CATCH
                        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
                        DECLARE @err_msg_apply NVARCHAR(MAX) = ERROR_MESSAGE();
                        RAISERROR(@err_msg_apply, 16, 1);
                    END CATCH`;
                await executeUserQuery('행사_적용_및_Parts업데이트', { Junno: event.junno.trim() }, applySql);
                showToast('행사가 전체 적용되었습니다.', 'success');
            } catch (e: any) {
                showAlert('적용 실패: ' + e.message);
            } finally {
                setIsProcessing(false);
                handleSearch(true);
            }
        });
    };

    const executeStopEvent = async (targetStatus: '0' | '2') => {
        if (!selectedEvent) return;
    
        const actionText = targetStatus === '0' ? '미적용' : '종료';
        const confirmText = targetStatus === '0' ? '미적용으로 변경' : '완전 종료';
        
        setIsStopChoiceModalOpen(false);
    
        showAlert(
            `'${selectedEvent.salename}' 행사를 '${actionText}' 상태로 변경하시겠습니까?\n${targetStatus === '0' ? '가격이 원복되고, 나중에 다시 적용할 수 있습니다.' : '행사가 영구적으로 종료됩니다.'}`, 
            async () => {
                setIsProcessing(true);
                try {
                    const finalSql = `
                        SET NOCOUNT ON; SET XACT_ABORT ON;
                        BEGIN TRY
                            BEGIN TRANSACTION;
                                ${targetStatus === '0' ? 
                                    `UPDATE sale_mast SET isappl = '0' WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno));
                                     UPDATE sale_ready SET isappl = '0' WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno)) AND isappl <> 'D';` 
                                    : 
                                    `UPDATE sale_mast SET isappl = '2' WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno));
                                     UPDATE sale_ready SET isappl = 'D' WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno)) AND isappl <> 'D';`
                                }
    
                                UPDATE p
                                SET 
                                    p.money1comp = ISNULL(next_event.salemoney1, p.money1),
                                    p.salemoney0 = ISNULL(next_event.salemoney0, p.money0vat),
                                    p.salestartday = next_event.startday,
                                    p.saleendday = next_event.endday
                                FROM parts p JOIN sale_ready r_stopped ON p.barcode = r_stopped.barcode
                                OUTER APPLY (
                                    SELECT TOP 1 r_other.salemoney1, r_other.salemoney0, m_other.startday, m_other.endday
                                    FROM sale_ready r_other WITH(NOLOCK) JOIN sale_mast m_other WITH(NOLOCK) ON r_other.junno = m_other.junno
                                    WHERE r_other.barcode = p.barcode AND m_other.isappl = '1' AND LTRIM(RTRIM(m_other.junno)) <> LTRIM(RTRIM(@Junno))
                                    ORDER BY m_other.startday DESC
                                ) AS next_event
                                WHERE LTRIM(RTRIM(r_stopped.junno)) = LTRIM(RTRIM(@Junno));
                            COMMIT TRANSACTION;
                        END TRY
                        BEGIN CATCH
                            IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
                            DECLARE @err_msg_stop NVARCHAR(MAX) = ERROR_MESSAGE();
                            RAISERROR(@err_msg_stop, 16, 1);
                        END CATCH
                    `;
                    
                    await executeUserQuery('행사_상태변경', { Junno: selectedEvent.junno.trim() }, finalSql);
                    showToast(`행사가 ${actionText} 처리되었습니다.`, 'success');
                    handleSearch(true);
                } catch (e: any) {
                    showAlert(`${actionText} 처리 실패: ${e.message}`);
                } finally {
                    setIsProcessing(false);
                }
            }, 
            confirmText, 
            targetStatus === '0' ? 'bg-orange-500' : 'bg-rose-500'
        );
    };

    const handleDeleteEvent = async (event: EventItem) => {
        // ... (동일) ...
        const isProgressing = event.isappl === '1';

        if (isProgressing) {
            showAlert("진행 중인 행사는 먼저 종료해야 삭제할 수 있습니다.\n[전체 종료] 기능을 이용해 행사를 종료해주세요.");
            return;
        }

        showAlert(`'${event.salename}' 행사를 완전히 삭제하시겠습니까?`, async () => {
            setIsProcessing(true);
            try {
                const deleteSql = `DELETE FROM sale_ready WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno)); DELETE FROM sale_mast WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno));`;
                await executeUserQuery('행사_삭제', { Junno: event.junno.trim() }, deleteSql);
                showToast('행사가 삭제되었습니다.', 'success');
                handleSearch(true);
            } catch (e: any) {
                showAlert('삭제 실패: ' + e.message);
            } finally {
                setIsProcessing(false);
            }
        }, '삭제', 'bg-rose-600');
    };

    const handleUpdateProduct = async () => {
        if (selectedEvent) {
            await fetchEventDetails(selectedEvent.junno);
            await handleSearch(true);
        }
    };

    const handleRemoveProduct = (barcode: string) => {
        // ... (동일) ...
        if (!selectedEvent) return;
        const itemToRemove = draftItems.find(i => String(i.barcode || i['바코드']) === barcode);
        if (!itemToRemove) return;

        const isItemApplied = String(itemToRemove.isappl) === '1';
        const msg = isItemApplied
            ? `'${itemToRemove.descr || itemToRemove['상품명']}' 상품이 행사 적용 중입니다.\n중지 후 행사에서 제외하시겠습니까? (가격 복구)`
            : `'${itemToRemove.descr || itemToRemove['상품명']}' 상품을 행사에서 제외하시겠습니까?`;

        showAlert(msg, async () => {
            if (!selectedEvent) return;
            setIsProcessing(true);
            try {
                if (isItemApplied) {
                    const stopSql = `
                        SET NOCOUNT ON; SET XACT_ABORT ON;
                        DECLARE @JunnoToStop VARCHAR(20) = @Junno; DECLARE @BarcodeToStop VARCHAR(20) = @Barcode;
                        BEGIN TRY
                            BEGIN TRANSACTION;
                                UPDATE sale_ready SET isappl = 'D' WHERE LTRIM(RTRIM(junno)) = @JunnoToStop AND barcode = @BarcodeToStop;
                                
                                DECLARE @NextBestSalePrice DECIMAL(18,0), @NextBestSaleCost DECIMAL(18,0), @NextBestStart VARCHAR(10), @NextBestEnd VARCHAR(10);
                                SELECT TOP 1 
                                    @NextBestSalePrice = r.salemoney1, @NextBestSaleCost = r.salemoney0, 
                                    @NextBestStart = m.startday, @NextBestEnd = m.endday 
                                FROM sale_ready r WITH(NOLOCK) 
                                JOIN sale_mast m WITH(NOLOCK) ON r.junno = m.junno 
                                WHERE r.barcode = @BarcodeToStop AND m.isappl = '1' AND LTRIM(RTRIM(m.junno)) <> LTRIM(RTRIM(@JunnoToStop)) 
                                ORDER BY m.startday DESC;
                                
                                IF @@ROWCOUNT > 0
                                    UPDATE p SET p.money1comp = @NextBestSalePrice, p.salemoney0 = @NextBestSaleCost, p.salestartday = @NextBestStart, p.saleendday = @NextBestEnd FROM parts p WHERE p.barcode = @BarcodeToStop;
                                ELSE
                                    UPDATE p SET p.money1comp = p.money1, p.salemoney0 = p.money0vat, p.salestartday = NULL, p.saleendday = NULL FROM parts p WHERE p.barcode = @BarcodeToStop;
                            COMMIT TRANSACTION;
                        END TRY
                        BEGIN CATCH
                            IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
                            DECLARE @err_msg_remove NVARCHAR(MAX) = ERROR_MESSAGE();
                            RAISERROR(@err_msg_remove, 16, 1);
                        END CATCH`;
                    await executeUserQuery('행사상품_개별중지_및_Parts업데이트', { Junno: selectedEvent.junno.trim(), Barcode: barcode }, stopSql);
                }
                
                const deleteSql = `DELETE FROM sale_ready WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno)) AND barcode = @Barcode; UPDATE sale_mast SET itemcount = (SELECT COUNT(*) FROM sale_ready WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno))), avgmgrate = (SELECT ISNULL(AVG(salecount), 0) FROM sale_ready WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno))) WHERE LTRIM(RTRIM(junno)) = LTRIM(RTRIM(@Junno));`;
                await executeUserQuery('행사상품_개별삭제', { Junno: selectedEvent.junno.trim(), Barcode: barcode }, deleteSql);
                
                showToast(isItemApplied ? '중지 및 삭제되었습니다.' : '상품을 삭제했습니다.', 'success');
                
                await fetchEventDetails(selectedEvent.junno);
                await handleSearch(true);
            } catch (e: any) {
                showAlert('삭제 실패: ' + e.message);
            } finally {
                setIsProcessing(false);
            }
        }, '삭제', 'bg-rose-500');
    };

    const handlePeriodChange = async () => {
        // ... (동일) ...
        if (!selectedEvent) return;
    
        const today = new Date().toISOString().slice(0, 10);
        const oldStatus = selectedEvent.isappl;
        const newStatus = (editableStartDate <= today && editableEndDate >= today) ? '1' : (editableStartDate > today ? '0' : '2');
    
        let alertMessage = "행사 기간을 변경하시겠습니까?";
        if (oldStatus === '1' && newStatus !== '1') {
            alertMessage += "\n\n기간 변경으로 행사가 '대기' 또는 '종료' 상태가 되어, 적용된 가격이 원래대로 복구됩니다.";
        } else if (oldStatus !== '1' && newStatus === '1') {
            alertMessage += "\n\n기간 변경으로 행사가 '진행중' 상태가 되어, 모든 품목의 가격이 즉시 적용됩니다.";
        }
    
        showAlert(alertMessage, async () => {
            setIsProcessing(true);
            try {
                const params = {
                    Junno: selectedEvent.junno.trim(),
                    StartDay: editableStartDate,
                    EndDay: editableEndDate,
                };
                const result = await executeUserQuery('행사기간_및_상태_수정', params, UPDATE_PERIOD_AND_STATUS_SQL);

                if (result && result[0]?.RESULT === 'FAIL') throw new Error(result[0].MSG);
                
                showToast('행사 기간이 변경되었습니다.', 'success');

                const refreshedEvent = { ...selectedEvent, startday: editableStartDate, endday: editableEndDate, isappl: newStatus };
                setSelectedEvent(refreshedEvent);
                await fetchEventDetails(selectedEvent.junno);
                await handleSearch(true);
            } catch (e: any) {
                showAlert('기간 변경 실패: ' + e.message);
            } finally {
                setIsProcessing(false);
            }
        }, "기간 변경", "bg-blue-600");
    };

    // [신규] 연속 스캔 핸들러
    const onContinuousScan = useCallback(async (barcode: string) => {
        if (isProcessingScanRef.current) return;
        isProcessingScanRef.current = true;
        
        try {
            const product = await searchByBarcode(barcode);
            if (product) {
                window.history.pushState({ modal: 'continuousEventAdd' }, '', '');
                setContinuousAddItem(product);
            } else {
                showToast("미등록 상품입니다.", "error");
                isProcessingScanRef.current = false;
            }
        } catch (e) {
            showToast("상품 조회 오류", 'error');
            isProcessingScanRef.current = false;
        }
    }, [searchByBarcode, showToast]);

    const handleStartContinuousScan = useCallback(() => {
        if (!selectedEvent) return;
        // setDetailModalOpen(false); // [수정됨] 상세 모달을 닫지 않음 (연속 스캔 모달은 위에 뜹니다)
        openScanner('modal', onContinuousScan, { continuous: true }); // 스캐너 열기
    }, [selectedEvent, openScanner, onContinuousScan]);

    const statusInfo: { [key: string]: { text: string; className: string } } = {
        '1': { text: '진행중', className: 'bg-green-100 text-green-700' },
        '0': { text: '대기', className: 'bg-yellow-100 text-yellow-700' },
        '2': { text: '종료', className: 'bg-slate-100 text-slate-500' },
        default: { text: '대기', className: 'bg-yellow-100 text-yellow-700' }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50">
            {/* Header Section (동일) */}
            <div className="p-3 bg-slate-100 border-b border-slate-200 space-y-2 flex-shrink-0 z-20 shadow-sm">
                <div className="flex gap-2">
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="flex-1 h-10 border border-gray-200 rounded-lg px-2 text-sm font-bold bg-white text-gray-700 focus:ring-1 focus:ring-indigo-500 outline-none" />
                    <span className="text-gray-400 font-bold self-center">~</span>
                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="flex-1 h-10 border border-gray-200 rounded-lg px-2 text-sm font-bold bg-white text-gray-700 focus:ring-1 focus:ring-indigo-500 outline-none" />
                </div>
                
                <div className="flex gap-2 items-stretch">
                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="w-1/4 h-11 border border-gray-200 rounded-xl px-2 text-xs font-bold bg-white text-gray-700 focus:ring-1 focus:ring-indigo-500 outline-none">
                        <option value="all">전체</option>
                        <option value="0">대기</option>
                        <option value="1">진행</option>
                        <option value="2">종료</option>
                    </select>

                    <div className="relative flex-grow">
                        <ProductSearchBar id="event-main-search" searchTerm={searchTerm} onSearchTermChange={setSearchTerm} isSearching={isSearching} results={results} onSelectProduct={handleProductSelect} onScan={handleManualSearch} isBoxUnit={false} onBoxUnitChange={() => {}} placeholder="상품명/바코드 검색" showBoxToggle={false} />
                    </div>
                </div>
            </div>

            {/* List Section (동일) */}
            <div className="flex-grow overflow-auto p-2 bg-slate-50">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-40"><SpinnerIcon className="w-8 h-8 text-indigo-500 animate-spin" /><p className="mt-2 text-sm text-gray-500">조회 중...</p></div>
                ) : error ? (
                    <div className="p-4 bg-red-50 text-red-600 rounded-xl text-center text-sm border border-red-100">{error}</div>
                ) : events.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-400"><p className="font-bold">조회된 행사가 없습니다.</p></div>
                ) : (
                    <div className="space-y-1">
                        {events.map((ev, idx) => {
                             const currentStatus = statusInfo[ev.isappl] || statusInfo.default;
                             return (
                                <div key={ev.junno || idx} onClick={() => handleEventAction(ev)} className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm cursor-pointer active:bg-gray-50 transition-all hover:shadow-md">
                                    <div className="flex justify-between items-start mb-1.5">
                                        <div className="min-w-0 pr-2">
                                            <h3 className="font-semibold text-gray-800 text-sm leading-tight break-words">
                                                {ev.salename}
                                                <span className="text-[10px] text-gray-400 font-mono ml-1.5">({(ev.junno || '').trim()})</span>
                                            </h3>
                                        </div>
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap flex-shrink-0 border ${currentStatus.className.replace('text-', 'border-').replace('100', '200')} ${currentStatus.className}`}>
                                            {currentStatus.text}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                                        <CalendarIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                                        <span className="font-medium tracking-tight">{ev.startday} ~ {ev.endday}</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        <div className="flex items-center justify-between bg-slate-50 px-2 py-1.5 rounded text-gray-600">
                                            <span className="text-[10px] text-gray-400 font-bold">품목수</span>
                                            <span className="font-bold text-indigo-600">{ev.itemcount}</span>
                                        </div>
                                        <div className="flex items-center justify-between bg-slate-50 px-2 py-1.5 rounded text-gray-600">
                                            <span className="text-[10px] text-gray-400 font-bold">마진율</span>
                                            <span className="font-bold text-indigo-600">{Number(ev.avgmgrate || 0).toFixed(1)}%</span>
                                        </div>
                                    </div>
                                </div>
                             );
                        })}
                    </div>
                )}
            </div>

            <EventActionSelectModal
                isOpen={isActionSelectModalOpen}
                onClose={() => setIsActionSelectModalOpen(false)}
                event={selectedEvent}
                onViewDetails={() => { setIsActionSelectModalOpen(false); setDetailModalOpen(true); if (selectedEvent) { fetchEventDetails(selectedEvent.junno); setHighlightedBarcode(null); } }}
                onApply={() => { setIsActionSelectModalOpen(false); selectedEvent && handleApplyEvent(selectedEvent); }}
                onStop={() => { setIsActionSelectModalOpen(false); setIsStopChoiceModalOpen(true); }}
                onDelete={() => { setIsActionSelectModalOpen(false); selectedEvent && handleDeleteEvent(selectedEvent); }}
            />

            <StopEventModal
                isOpen={isStopChoiceModalOpen}
                onClose={() => setIsStopChoiceModalOpen(false)}
                event={selectedEvent}
                onConfirm={executeStopEvent}
            />

            <ActionModal isOpen={detailModalOpen} onClose={() => setDetailModalOpen(false)} title={selectedEvent?.salename || '행사 상세'} zIndexClass="z-[80]" disableBodyScroll>
                <div className="flex flex-col h-full bg-slate-50">
                    {/* ... (상단 날짜 변경부 동일) ... */}
                    <div className="p-3 bg-slate-100 border-b border-slate-200 z-10 flex-shrink-0">
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1 flex-grow bg-white rounded-lg border border-slate-200 p-1 shadow-sm">
                                <input type="date" value={editableStartDate} onChange={e => setEditableStartDate(e.target.value)} className="w-0 flex-1 h-7 border-none text-[11px] font-bold text-slate-600 text-center focus:ring-0 outline-none bg-transparent"/>
                                <span className="text-slate-300 font-bold text-[10px] flex-shrink-0">~</span>
                                <input type="date" value={editableEndDate} onChange={e => setEditableEndDate(e.target.value)} className="w-0 flex-1 h-7 border-none text-[11px] font-bold text-slate-600 text-center focus:ring-0 outline-none bg-transparent"/>
                            </div>
                            <button onClick={handlePeriodChange} className="bg-indigo-600 text-white h-9 px-3 rounded-lg shadow-sm active:scale-95 flex items-center justify-center flex-shrink-0 hover:bg-indigo-700 transition-colors">
                                <span className="text-xs font-bold whitespace-nowrap">날짜변경</span>
                            </button>
                        </div>
                    </div>

                    <div className="flex-grow overflow-auto p-2 relative bg-slate-50">
                        {isProcessing && (
                            <div className="absolute inset-0 bg-white/60 z-50 flex items-center justify-center">
                                <div className="bg-white p-4 rounded-xl shadow-lg border border-gray-200 flex items-center gap-3">
                                    <SpinnerIcon className="w-6 h-6 text-indigo-600 animate-spin" />
                                    <span className="font-bold text-gray-700">처리 중...</span>
                                </div>
                            </div>
                        )}
                        {isDetailLoading ? (
                            <div className="flex items-center justify-center h-40"><SpinnerIcon className="w-8 h-8 text-blue-500 animate-spin" /></div>
                        ) : (
                            <div className="space-y-1.5">
                                {draftItems.map((item, idx) => {
                                    const isHighlighted = item.barcode === highlightedBarcode;
                                    const itemStatusMap = {
                                        '1': { text: '적용중', className: 'bg-green-50 text-green-700 border-green-200' },
                                        '0': { text: '대기', className: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
                                        'D': { text: '종료', className: 'bg-gray-100 text-gray-600 border-gray-200' },
                                    };
                                    const itemStatus = itemStatusMap[String(item.isappl) as keyof typeof itemStatusMap] || itemStatusMap['0'];
                                    const isEnded = String(item.isappl) === 'D';
                                    return (
                                        <div 
                                            key={item.junno_serial || idx}
                                            id={`event-item-${item.barcode}`}
                                            onClick={() => setEditingProduct(item)}
                                            className={`w-full text-left bg-white p-2.5 rounded-lg border shadow-sm transition-all cursor-pointer active:bg-slate-50 hover:shadow-md ${isEnded ? 'opacity-60' : ''} ${isHighlighted ? 'ring-1 ring-indigo-500 border-indigo-500 bg-indigo-50/10' : 'border-slate-200'}`}
                                        >
                                            <div className="flex justify-between items-start mb-1.5">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${itemStatus.className}`}>
                                                        {itemStatus.text}
                                                    </span>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="font-semibold text-slate-800 text-sm leading-tight truncate">{item.descr}</p>
                                                        <p className="text-[10px] text-slate-400 font-mono truncate mt-0.5">{item.barcode}</p>
                                                    </div>
                                                </div>
                                                <button 
                                                    disabled={isProcessing}
                                                    onClick={(e) => { e.stopPropagation(); handleRemoveProduct(item.barcode); }} 
                                                    className="p-1 text-slate-300 hover:text-rose-500 transition-colors -mr-1"
                                                >
                                                    <TrashIcon className="w-4 h-4" />
                                                </button>
                                            </div>

                                            <div className="bg-slate-50 rounded border border-slate-100 p-1.5 grid grid-cols-4 gap-px text-center">
                                                <div>
                                                    <p className="text-[9px] text-slate-400">행사매입</p>
                                                    <p className="text-[11px] font-bold text-slate-600">{Number(item.salemoney0).toLocaleString()}</p>
                                                </div>
                                                <div className="border-l border-slate-200">
                                                    <p className="text-[9px] text-slate-900 font-black">행사판가</p>
                                                    <p className="text-[12px] font-black text-slate-900">{Number(item.salemoney1).toLocaleString()}</p>
                                                </div>
                                                <div className="border-l border-slate-200">
                                                    <p className="text-[9px] text-slate-400">정상가</p>
                                                    <p className="text-[11px] font-medium text-slate-400 line-through">{Number(item.orgmoney1).toLocaleString()}</p>
                                                </div>
                                                <div className="border-l border-slate-200">
                                                    <p className="text-[9px] text-slate-400">마진율</p>
                                                    <p className="text-[11px] font-bold text-slate-600">{Number(item.salecount).toFixed(1)}%</p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    {/* [수정됨] 하단 버튼 영역: 연속 스캔 버튼 제거 및 + 상품 추가로 통합 */}
                    <div className="p-3 bg-white border-t flex flex-col gap-2 safe-area-pb">
                        <button onClick={() => setIsAddProductModalOpen(true)} className="w-full py-3 bg-indigo-600 text-white rounded-lg font-bold text-sm active:scale-95 transition-transform shadow-sm">
                            + 상품 추가
                        </button>
                        <button onClick={() => setDetailModalOpen(false)} className="w-full bg-gray-100 text-gray-700 py-2.5 rounded-lg font-bold text-sm active:scale-95 transition-transform">닫기</button>
                    </div>
                </div>
            </ActionModal>

            {isAddProductModalOpen && selectedEvent && (
                <AddEventProductModal
                    isOpen={isAddProductModalOpen}
                    onClose={() => setIsAddProductModalOpen(false)}
                    junno={selectedEvent.junno}
                    onSuccess={handleAddProductSuccess}
                    existingBarcodes={draftItems.map(i => i.barcode)}
                    parentStatus={selectedEvent.isappl as ('0' | '1' | '2')}
                    // [추가] 연속 스캔 핸들러 전달
                    onSwitchToContinuousScan={() => {
                        setIsAddProductModalOpen(false);
                        handleStartContinuousScan();
                    }}
                />
            )}

            {editingProduct && (
                <EditEventProductModal
                    isOpen={!!editingProduct}
                    onClose={() => setEditingProduct(null)}
                    product={{...editingProduct, '상품명': editingProduct.descr, '행사매입가': editingProduct.salemoney0, '행사판매가': editingProduct.salemoney1, '이전판매가': editingProduct.orgmoney1}}
                    editContext="management"
                    onSuccess={async (updated) => {
                        if (selectedEvent) {
                            try {
                                const params = {
                                    Junno: selectedEvent.junno.trim(),
                                    Barcode: updated.barcode,
                                    SaleCost: updated['행사매입가'],
                                    SalePrice: updated['행사판매가'],
                                    IsAppl: updated.isappl
                                };
                                const result = await executeUserQuery('행사상품_수정저장', params, UPSERT_ITEM_SQL);
                                if (result && result[0].RESULT === 'FAIL') throw new Error(result[0].MSG);
                                
                                setHighlightedBarcode(updated.barcode);
                                await handleUpdateProduct();
                                showToast(result[0]?.MSG || '수정되었습니다.', 'success');
                                
                                setTimeout(() => {
                                    document.getElementById(`event-item-${updated.barcode}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }, 300);

                            } catch (e: any) {
                                showAlert('수정 실패: ' + e.message);
                            }
                        }
                    }}
                    onDelete={() => {
                        handleRemoveProduct(editingProduct.barcode);
                        setEditingProduct(null);
                    }}
                />
            )}

            {selectedEvent && (
                <EventContinuousAddModal
                    isOpen={!!continuousAddItem}
                    product={continuousAddItem}
                    junno={selectedEvent.junno}
                    existingBarcodes={draftItems.map(i => i.barcode)}
                    parentStatus={selectedEvent.isappl as ('0' | '1' | '2')}
                    onClose={() => {
                        if(window.history.state?.modal === 'continuousEventAdd') window.history.back();
                        setContinuousAddItem(null);
                        isProcessingScanRef.current = false;
                    }}
                    onSave={async (details) => {
                        if (!continuousAddItem) return;
                        try {
                            const isappl = selectedEvent.isappl === '1' ? '1' : '0';
                            const newItemData = {
                                '바코드': continuousAddItem.barcode,
                                '행사매입가': details.saleCost,
                                '행사판매가': details.salePrice,
                                'isappl': isappl,
                            };
                            await handleAddProductSuccess(newItemData);
                        } catch (e) {
                            // Error is handled in handleAddProductSuccess
                        } finally {
                            if(window.history.state?.modal === 'continuousEventAdd') window.history.back();
                            setContinuousAddItem(null);
                            isProcessingScanRef.current = false;
                        }
                    }}
                />
            )}
        </div>
    );
};

export default EventManagementPage;
