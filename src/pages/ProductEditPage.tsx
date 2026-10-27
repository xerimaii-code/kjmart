import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import ActionModal from '../components/ActionModal';
import { useAlert, useDataState, useScanner, useMiscUI } from '../context/AppContext';
import { executeUserQuery, searchProductsForEdit, extractParamsForQuery } from '../services/sqlService';
import { BarcodeScannerIcon, SearchIcon, SpinnerIcon, CheckCircleIcon, UndoIcon, XMarkIcon, ChevronDownIcon, WarningIcon } from '../components/Icons';
import { Customer, Category } from '../types';
import { getCachedData } from '../services/cacheDbService';
import { useAdjustForKeyboard } from '../hooks/useAdjustForKeyboard';
import ProductSelectionModal from '../components/ProductSelectionModal';
import { useSortedCustomers } from '../hooks/useSortedCustomers';
import SearchDropdown from '../components/SearchDropdown';

interface ProductEditPageProps {
    isOpen: boolean;
    onClose: () => void;
    initialBarcode?: string;
}

interface CategoryOption {
    code: string;
    name: string;
}

interface SaleInfo {
    name: string;
    cost: number;
    price: number;
    start: string;
    end: string;
}

interface BomItem {
    barcode: string;
    name: string;
    spec: string;
    cost: number;
    qty: number;
}

export interface BarcodeChecksumAnalysis {
    status: 'valid' | 'checksum_mismatch' | 'non_standard' | 'empty';
    original: string;
    corrected: string;
    standardType?: 'EAN-13' | 'EAN-8' | 'UPC-A';
    expectedDigit?: number;
    actualDigit?: number;
}

/**
 * 표준 바코드(EAN-13, EAN-8, UPC-A) 체크섬(Modulo 10) 검증 및 자동 교정 번호 산출 함수.
 * 8자리, 12자리, 13자리 숫자 코드는 표준 체크섬을 계산하며,
 * 그 외 길이(예: 4~6자리 자체 PLU 코드 등)나 영문 혼합 코드는 'non_standard'(체크섬 미적용 코드)로 분류합니다.
 */
export function analyzeBarcodeChecksum(rawCode: string): BarcodeChecksumAnalysis {
    const code = (rawCode || '').trim();
    if (!code) {
        return { status: 'empty', original: '', corrected: '' };
    }

    if (/^\d{13}$/.test(code)) {
        const digits = code.split('').map(Number);
        let sum = 0;
        for (let i = 0; i < 12; i++) {
            sum += digits[i] * (i % 2 === 0 ? 1 : 3);
        }
        const expected = (10 - (sum % 10)) % 10;
        const actual = digits[12];
        const corrected = code.slice(0, 12) + String(expected);
        return {
            status: expected === actual ? 'valid' : 'checksum_mismatch',
            original: code,
            corrected,
            standardType: 'EAN-13',
            expectedDigit: expected,
            actualDigit: actual,
        };
    }

    if (/^\d{8}$/.test(code)) {
        const digits = code.split('').map(Number);
        let sum = 0;
        for (let i = 0; i < 7; i++) {
            sum += digits[i] * (i % 2 === 0 ? 3 : 1);
        }
        const expected = (10 - (sum % 10)) % 10;
        const actual = digits[7];
        const corrected = code.slice(0, 7) + String(expected);
        return {
            status: expected === actual ? 'valid' : 'checksum_mismatch',
            original: code,
            corrected,
            standardType: 'EAN-8',
            expectedDigit: expected,
            actualDigit: actual,
        };
    }

    if (/^\d{12}$/.test(code)) {
        const digits = code.split('').map(Number);
        let sum = 0;
        for (let i = 0; i < 11; i++) {
            sum += digits[i] * (i % 2 === 0 ? 3 : 1);
        }
        const expected = (10 - (sum % 10)) % 10;
        const actual = digits[11];
        const corrected = code.slice(0, 11) + String(expected);
        return {
            status: expected === actual ? 'valid' : 'checksum_mismatch',
            original: code,
            corrected,
            standardType: 'UPC-A',
            expectedDigit: expected,
            actualDigit: actual,
        };
    }

    return {
        status: 'non_standard',
        original: code,
        corrected: code,
    };
}

// [BOM 기본 쿼리 - 묶음 상품용 유지]
const GET_BOM_COMPONENTS_SQL = `
SELECT 
    b.childbar AS [바코드],
    p.descr AS [상품명],
    p.spec  AS [규격],
    p.money0vat AS [매입가],
    b.childcount AS [수량]
FROM bom AS b WITH(NOLOCK)
JOIN parts AS p WITH(NOLOCK) ON b.childbar = p.barcode
WHERE b.parebar = @barcode
`;

const toBoolean = (val: any): boolean => {
    if (val === true || val === 'true') return true;
    if (val === 1 || val === '1') return true;
    if (String(val).trim().toUpperCase() === 'Y') return true;
    return false;
};

const toSqlBit = (val: boolean): string => val ? '1' : '0';

export default function ProductEditPage({ isOpen, onClose, initialBarcode }: ProductEditPageProps) {
    const { userQueries, customers: offlineCustomers } = useDataState();
    const { showAlert, showToast } = useAlert();
    const { openScanner } = useScanner();
    const { sqlStatus, checkSql } = useMiscUI();

    // --- State Variables ---
    const [barcode, setBarcode] = useState('');
    const [productName, setProductName] = useState('');
    const [spec, setSpec] = useState('');
    const [costPrice, setCostPrice] = useState<number | string>(0);
    const [sellingPrice, setSellingPrice] = useState<number | string>(0);
    
    // 분류
    const [lCode, setLCode] = useState('');
    const [mCode, setMCode] = useState('');
    const [sCode, setSCode] = useState('');
    
    const [lCats, setLCats] = useState<CategoryOption[]>([]);
    const [mCats, setMCats] = useState<CategoryOption[]>([]);
    const [sCats, setSCats] = useState<CategoryOption[]>([]);
    
    // Supplier
    const [comcode, setComcode] = useState('');
    const [supplierList, setSupplierList] = useState<Customer[]>([]);
    const [supplierSearch, setSupplierSearch] = useState('');
    const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
    const supplierInputRef = useRef<HTMLInputElement>(null);
    const blurTimeoutRef = useRef<number | null>(null);
    
    const [stockQty, setStockQty] = useState<number>(0);
    const [isBundle, setIsBundle] = useState(false);

    // Flags
    const [isUse, setIsUse] = useState(true);
    const [isTaxable, setIsTaxable] = useState(true);
    const [isPoint, setIsPoint] = useState(true);
    const [isStockManaged, setIsStockManaged] = useState(true);
    
    // UI Logic
    const [isCategoryFixed, setIsCategoryFixed] = useState(true);

    // Info Panels Data
    const [saleInfo, setSaleInfo] = useState<SaleInfo | null>(null);
    const [bomList, setBomList] = useState<BomItem[]>([]);

    const [isEditMode, setIsEditMode] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    
    const [searchInput, setSearchInput] = useState('');
    const searchInputRef = useRef<HTMLInputElement>(null);
    const productNameRef = useRef<HTMLInputElement>(null);
    
    // Selection Modal
    const [isSelectionModalOpen, setIsSelectionModalOpen] = useState(false);
    const [searchResults, setSearchResults] = useState<any[]>([]);

    // Save & Checksum Confirmation Modal State
    const [saveConfirmModal, setSaveConfirmModal] = useState<{
        isOpen: boolean;
        analysis: BarcodeChecksumAnalysis;
    }>({ isOpen: false, analysis: { status: 'empty', original: '', corrected: '' } });

    // Keyboard Adjustment
    const modalContainerRef = useRef<HTMLDivElement>(null);
    const buttonsContainerRef = useRef<HTMLDivElement>(null);
    useAdjustForKeyboard(modalContainerRef, isOpen, buttonsContainerRef);

    // Sorted Customers
    const { sortedCustomers, recordUsage } = useSortedCustomers(supplierList);

    const isOffline = sqlStatus !== 'connected';

    const formatBarcodeDisplay = (code: string) => {
        if (!code) return '';
        if (code.length === 13) return `${code.slice(0, 3)} ${code.slice(3, 7)} ${code.slice(7)}`;
        return code;
    };

    const barcodeAnalysis = useMemo(() => analyzeBarcodeChecksum(barcode), [barcode]);

    const loadSuppliers = useCallback(async () => {
        if (sqlStatus === 'connected') {
            try {
                const res = await executeUserQuery('getSuppliers');
                const mapped = res.map((r: any) => ({ comcode: r.comcode, name: r.comname }));
                setSupplierList(mapped);
            } catch (e) { setSupplierList(offlineCustomers); }
        } else { setSupplierList(offlineCustomers); }
    }, [sqlStatus, offlineCustomers]);

    const mapCategoryData = (data: any[], level: number): CategoryOption[] => {
        if (!data || !Array.isArray(data)) return [];
        return data.map(item => {
            const keys = Object.keys(item);
            const lowerKeys = keys.map(k => k.toLowerCase());
            
            let codeKey = keys.find((_, i) => lowerKeys[i] === 'code' || lowerKeys[i] === `gubun${level}` || lowerKeys[i].includes('코드'));
            if (!codeKey && keys.length > 0) codeKey = keys[0];

            let nameKey = keys.find((_, i) => lowerKeys[i] === 'name' || lowerKeys[i] === `gubun${level}x` || lowerKeys[i].includes('명'));
            if (!nameKey) nameKey = codeKey;

            return {
                code: String(item[codeKey!] || '').trim(),
                name: String(item[nameKey!] || '').trim()
            };
        }).filter(item => item.code);
    };

    const fetchCategories = useCallback(async (level: 1 | 2 | 3, parent1?: string, parent2?: string) => {
        if (sqlStatus === 'connected') {
            try {
                const queryName = level === 1 ? '대분류' : level === 2 ? '중분류' : '소분류';
                const userQuery = userQueries.find(q => q.name === queryName);

                if (userQuery) {
                    const params = { 
                        lCode: parent1 || '', mCode: parent2 || '', 
                        gubun1: parent1, gubun2: parent2,
                        code1: parent1, code2: parent2,
                        parent: parent1
                    };
                    const res = await executeUserQuery(queryName, params, userQuery.query);
                    
                    let filteredRes = res;
                    
                    if (level === 2 && parent1) {
                        filteredRes = res.filter(item => {
                            const p1Key = Object.keys(item).find(k => /^(gubun1|l_code|code1|large|대분류.*|상위.*)$/i.test(k));
                            if (!p1Key) return true;
                            
                            const itemVal = String(item[p1Key]).trim();
                            const parentVal = String(parent1).trim();
                            return itemVal === parentVal;
                        });
                    } else if (level === 3 && parent1 && parent2) {
                        filteredRes = res.filter(item => {
                            const p1Key = Object.keys(item).find(k => /^(gubun1|l_code|code1|large|대분류.*)$/i.test(k));
                            const p2Key = Object.keys(item).find(k => /^(gubun2|m_code|code2|medium|중분류.*)$/i.test(k));
                            
                            const match1 = p1Key ? String(item[p1Key]).trim() === String(parent1).trim() : true;
                            const match2 = p2Key ? String(item[p2Key]).trim() === String(parent2).trim() : true;
                            
                            return match1 && match2;
                        });
                    }

                    return mapCategoryData(filteredRes, level);
                } else {
                    return [];
                }
            } catch (e) { console.error(`Cat Lv${level} error:`, e); }
        } else {
            const allCats = await getCachedData<Category>('categories');
            if (level === 1) return allCats.filter(c => c.level === 1).map(c => ({ code: c.code1, name: c.name }));
            if (level === 2) return allCats.filter(c => c.level === 2 && c.code1 === parent1).map(c => ({ code: c.code2!, name: c.name }));
            if (level === 3) return allCats.filter(c => c.level === 3 && c.code1 === parent1 && c.code2 === parent2).map(c => ({ code: c.code3!, name: c.name }));
        }
        return [];
    }, [sqlStatus, userQueries]);

    useEffect(() => {
        if (isOpen && sqlStatus === 'connected') {
            loadSuppliers();
            fetchCategories(1).then(setLCats);
        }
    }, [isOpen, sqlStatus, loadSuppliers, fetchCategories]);

    useEffect(() => {
        if (comcode && supplierList.length > 0) {
            const found = supplierList.find(c => c.comcode === comcode);
            if (found && supplierSearch !== found.name) setSupplierSearch(found.name);
        }
    }, [comcode, supplierList]);

    const filteredSuppliers = useMemo(() => {
        const term = supplierSearch.trim().toLowerCase();
        if (!term) return sortedCustomers.slice(0, 50);
        return sortedCustomers.filter(c => c.name.toLowerCase().includes(term) || c.comcode.includes(term)).slice(0, 50);
    }, [sortedCustomers, supplierSearch]);

    const handleSelectSupplier = (c: Customer) => {
        setComcode(c.comcode);
        setSupplierSearch(c.name);
        setShowSupplierDropdown(false);
        recordUsage(c.comcode);
    };

    const handleClearSupplier = () => {
        setComcode('');
        setSupplierSearch('');
        setTimeout(() => supplierInputRef.current?.focus(), 50);
    };

    const handleLargeChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        setLCode(val); setMCode(''); setSCode(''); setSCats([]);
        const mids = await fetchCategories(2, val);
        setMCats(mids);
    };

    const handleMediumChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        setMCode(val); setSCode('');
        const smalls = await fetchCategories(3, lCode, val);
        setSCats(smalls);
    };

    const marginRate = useMemo(() => {
        const cost = Number(String(costPrice).replace(/,/g, ''));
        const selling = Number(String(sellingPrice).replace(/,/g, ''));
        if (!selling || selling === 0) return 0;
        return ((selling - cost) / selling) * 100;
    }, [costPrice, sellingPrice]);

    const resetForm = useCallback((full: boolean = true) => {
        if (full) {
            setBarcode(''); setProductName(''); setSpec('');
            setCostPrice(0); setSellingPrice(0);
            setComcode(''); setSupplierSearch(''); setLCode(''); setMCode(''); setSCode('');
            setStockQty(0); setIsBundle(false);
            setIsUse(true); setIsTaxable(true); setIsPoint(true); setIsStockManaged(true);
            setSaleInfo(null); setBomList([]);
            setIsEditMode(false); setMCats([]); setSCats([]);
        } else {
            setBarcode(''); setProductName(''); setSpec('');
            setCostPrice(0); setSellingPrice(0); setStockQty(0);
            setIsBundle(false); setSaleInfo(null); setIsEditMode(false);
        }
    }, []);

    const mapBomData = (rows: any[]): BomItem[] => {
        return rows.map(r => ({
            barcode: r.barcode || r.childbar || r.바코드 || '',
            name: r.name || r.descr || r.상품명 || '',
            spec: r.spec || r.규격 || '',
            cost: Number(r.cost || r.money0vat || r.매입가 || 0),
            qty: Number(r.qty || r.childcount || r.수량 || 0)
        }));
    };

    const populateProductData = useCallback(async (p: any) => {
        const safeBarcode = String(p.barcode || p.바코드 || '').trim();
        setBarcode(safeBarcode);
        setProductName(p.descr || p.상품명);
        setSpec(p.spec || p.규격 || '');
        setComcode(p.comcode || p.거래처코드 || '');
        setStockQty(p.curjago || p.재고수량 || 0);
        
        setIsUse(toBoolean(p.isuse || p.사용유무));
        setIsTaxable(toBoolean(p.isvat || p.과세여부));
        setIsPoint(toBoolean(p.ispoint || p.포인트적립));
        setIsStockManaged(toBoolean(p.isjago || p.재고관리));
        
        const lc = String(p.gubun1 || p.대분류코드 || '').trim();
        const mc = String(p.gubun2 || p.중분류코드 || '').trim();
        const sc = String(p.gubun3 || p.소분류코드 || '').trim();
        
        setLCode(lc);
        if (lc) {
            const mids = await fetchCategories(2, lc);
            setMCats(mids);
            if (mids.some(m => m.code === mc)) {
                setMCode(mc);
                const smalls = await fetchCategories(3, lc, mc);
                setSCats(smalls);
                if (smalls.some(s => s.code === sc)) setSCode(sc);
                else setSCode('');
            } else { setMCode(''); setSCats([]); setSCode(''); }
        } else { setMCode(''); setSCats([]); setSCode(''); setMCats([]); }
        
        setCostPrice(p.money0vat || p.매입가 || 0);
        setSellingPrice(p.money1 || p.판매가 || 0);

        if (p.행사유무 === 'Y' || p.행사유무 === '1' || p.행사유무 === true) {
            setSaleInfo({
                name: p.행사명,
                cost: p.행사매입가,
                price: p.행사판매가,
                start: p.행사시작일,
                end: p.행사종료일
            });
        } else { setSaleInfo(null); }

        const isPack = toBoolean(p.ispack) || toBoolean(p.BOM여부) || p.BOM여부 === '묶음' || p.bomStatus === '묶음';
        setIsBundle(isPack);

        if (isPack) {
            try {
                const userQuery = userQueries.find(q => q.name === 'BOM');
                const sqlToRun = userQuery ? userQuery.query : GET_BOM_COMPONENTS_SQL;
                const bomRes = await executeUserQuery('BOM', { barcode: safeBarcode }, sqlToRun);
                setBomList(mapBomData(bomRes));
            } catch (err) { setBomList([]); }
        } else { setBomList([]); }

        setIsEditMode(true);
        showToast('상품 정보를 불러왔습니다.', 'success');
    }, [fetchCategories, showToast, userQueries]);

    const performSearch = useCallback(async (code: string) => {
        if (sqlStatus !== 'connected') {
            showAlert('오프라인 상태에서는 상품 등록 및 수정을 사용할 수 없습니다.');
            return;
        }
        const trimmed = code.trim();
        if (!trimmed) return;
        try {
            const results = await searchProductsForEdit(trimmed);
            if (results && results.length > 0) {
                if (results.length === 1) populateProductData(results[0]);
                else { setSearchResults(results); setIsSelectionModalOpen(true); }
            } else {
                // 숫자로만 이루어졌거나 바코드 형식인 경우 신규 등록 모드로 전환
                if (/^[0-9A-Za-z-]+$/.test(trimmed)) {
                    if (!isCategoryFixed) resetForm(true);
                    else resetForm(false);
                    setBarcode(trimmed);
                    setIsEditMode(false);
                    showToast('등록되지 않은 바코드입니다. 신규 등록합니다.', 'success');
                    setTimeout(() => productNameRef.current?.focus(), 150);
                } else {
                    showToast('검색 결과가 없습니다.', 'error');
                }
            }
        } catch (e) { showToast('상품 조회 중 오류가 발생했습니다.', 'error'); }
    }, [sqlStatus, showAlert, populateProductData, resetForm, isCategoryFixed, showToast]);

    const handleScan = () => {
        if (isOffline) {
            showAlert('오프라인 상태에서는 상품 등록 및 수정을 사용할 수 없습니다.');
            return;
        }
        openScanner('modal', (code) => {
            setSearchInput(code);
            performSearch(code);
        }, false);
    };

    const handleReset = () => {
        setSearchInput('');
        resetForm(true);
    };

    const handleProductSelect = (product: any) => {
        setIsSelectionModalOpen(false);
        setSearchInput(product.barcode || product.바코드);
        populateProductData(product);
    };

    useEffect(() => {
        if (isOpen) {
            if (initialBarcode && sqlStatus === 'connected') {
                setSearchInput(initialBarcode);
                performSearch(initialBarcode);
            } else if (!initialBarcode) {
                setSearchInput('');
                resetForm(true);
            }
        }
    }, [isOpen, initialBarcode, sqlStatus, performSearch, resetForm]);

    // 실제 SQL 저장 실행 함수 (확정된 targetBarcode를 인자로 받음)
    const executeSaveWithBarcode = async (targetBarcode: string) => {
        setSaveConfirmModal(prev => ({ ...prev, isOpen: false }));
        setBarcode(targetBarcode);
        setIsSaving(true);
        try {
            const safeCost = Number(String(costPrice).replace(/,/g, ''));
            const safeSelling = Number(String(sellingPrice).replace(/,/g, ''));

            const contextParams = {
                money0vat: String(isNaN(safeCost) ? 0 : safeCost),
                money1: String(isNaN(safeSelling) ? 0 : safeSelling),
                Descr: productName, descr: productName,
                isvat: toSqlBit(isTaxable),
                gubun1: lCode || '', gubun2: mCode || '', gubun3: sCode || '',
                barcode: targetBarcode, spec: spec || '', comcode: comcode || '',
                isjago: toSqlBit(isStockManaged), ispoint: toSqlBit(isPoint), isuse: toSqlBit(isUse),
                CurrentDate: new Date().toISOString().slice(0, 10),
                kw: searchInput, stock_yn: toSqlBit(isStockManaged),
            };

            const userQueryName = isEditMode ? '상품수정' : '상품등록';
            const userDefinedQuery = userQueries.find(q => q.name === userQueryName);

            if (!userDefinedQuery) { showAlert(`'${userQueryName}' 쿼리가 설정되지 않았습니다.`); return; }

            const dynamicParams = extractParamsForQuery(userDefinedQuery.query, contextParams);
            await executeUserQuery(userQueryName, dynamicParams, userDefinedQuery.query);
            
            showToast(isEditMode ? "수정되었습니다." : `등록되었습니다. [${targetBarcode}]`, "success");
            setSearchInput('');
            if (isCategoryFixed) resetForm(false); else resetForm(true);
            recordUsage(comcode);

        } catch (e: any) { showAlert(`저장 오류: ${e.message}`); } finally { setIsSaving(false); }
    };

    // 저장 버튼 클릭 시 검증 및 체크섬 확인 창 표시
    const handleSave = () => {
        if (isOffline) {
            showAlert("오프라인 상태에서는 상품을 저장할 수 없습니다.");
            return;
        }
        const candidateBarcode = (barcode || searchInput).trim();
        if (!candidateBarcode || !productName.trim()) {
            showAlert("바코드와 상품명은 필수 항목입니다.");
            return;
        }
        if (!lCode) {
            showAlert("대분류를 선택해주세요.");
            return;
        }
        if (!comcode) {
            showAlert("거래처를 선택해주세요.");
            return;
        }

        if (!barcode && candidateBarcode) {
            setBarcode(candidateBarcode);
        }

        const analysis = analyzeBarcodeChecksum(candidateBarcode);

        // 상품 수정 모드이면서 바코드가 표준 체크섬 정상인 경우에는 기존처럼 바로 저장하되,
        // 신규 등록이거나 체크섬 불일치 / 비표준(체크섬 미적용) 코드인 경우 앱 디자인에 맞춘 확인 모달을 거칩니다.
        if (isEditMode && analysis.status === 'valid') {
            executeSaveWithBarcode(candidateBarcode);
            return;
        }

        setSaveConfirmModal({
            isOpen: true,
            analysis,
        });
    };

    const handleToggleWithConfirm = (label: string, currentValue: boolean, setter: (val: boolean) => void) => {
        showAlert(`'${label}' 설정을 ${currentValue ? '해제' : '설정'}하시겠습니까?`, () => setter(!currentValue), '확인', 'bg-blue-600');
    };
    
    const CustomToggleButton = ({ label, checked, onChange, disabled }: { label: string, checked: boolean, onChange: (v: boolean) => void, disabled?: boolean }) => (
        <button disabled={disabled} onClick={() => handleToggleWithConfirm(label, checked, onChange)} className={`flex items-center justify-center gap-1 px-1 py-1.5 rounded border ${checked ? 'bg-white border-blue-500 text-blue-700' : 'bg-gray-50 border-gray-300 text-gray-500'} disabled:opacity-50`}>
            <div className={`w-3.5 h-3.5 border rounded flex items-center justify-center ${checked ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-400'}`}>{checked && <CheckCircleIcon className="w-2.5 h-2.5 text-white" />}</div>
            <span className="text-[11px] font-bold whitespace-nowrap">{label}</span>
        </button>
    );

    return (
        <>
            <ActionModal isOpen={isOpen} onClose={onClose} title={isEditMode ? "상품 수정" : "상품 등록/수정"} disableBodyScroll={false} containerRef={modalContainerRef} zIndexClass="z-[50]">
                <div className="px-2 pt-2 pb-0 space-y-1 bg-white flex flex-col h-full overflow-y-auto relative">
                    {isOffline && (
                        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 mb-1 flex flex-col gap-2 text-rose-800 shadow-sm animate-fade-in-down">
                            <div className="flex items-start gap-2">
                                <WarningIcon className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
                                <div className="text-xs font-bold leading-relaxed">
                                    <p className="text-sm font-extrabold text-rose-700">오프라인 모드 사용 불가</p>
                                    <p className="mt-0.5 text-rose-600">상품 등록 및 수정은 SQL 서버와 온라인으로 연결된 상태에서만 작동합니다.</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => checkSql()}
                                disabled={sqlStatus === 'checking'}
                                className="w-full py-2 bg-rose-600 text-white rounded-lg text-xs font-bold active:scale-95 transition-transform flex items-center justify-center gap-1.5 shadow-sm disabled:bg-rose-400"
                            >
                                {sqlStatus === 'checking' ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : null}
                                <span>{sqlStatus === 'checking' ? '연결 확인 중...' : '서버 연결 다시 확인'}</span>
                            </button>
                        </div>
                    )}

                    <form onSubmit={(e) => { e.preventDefault(); performSearch(searchInput); }} className="flex gap-1 items-stretch">
                        <input ref={searchInputRef} type="text" disabled={isOffline} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="바코드/명칭 (길게 눌러 초기화)" className="flex-1 h-9 pl-2 pr-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-sm disabled:bg-gray-100" />
                        <button type="submit" disabled={isOffline} className="w-14 h-9 flex items-center justify-center text-white bg-blue-600 rounded-md hover:bg-blue-700 active:scale-95 shadow-sm disabled:bg-gray-400"><SearchIcon className="w-5 h-5" /></button>
                        <button type="button" disabled={isOffline} onClick={handleScan} className="w-32 h-9 bg-gray-700 text-white rounded-md flex items-center justify-center gap-1 active:scale-95 shadow-sm hover:bg-gray-800 disabled:bg-gray-400"><BarcodeScannerIcon className="w-6 h-6" /><span className="text-xs font-bold">스캔</span></button>
                    </form>
                    
                    <div className="flex gap-1 pt-1 min-w-0">
                        <div className="flex-grow flex flex-col gap-0.5 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <label className="text-xs font-bold text-gray-700 whitespace-nowrap">상품명</label>
                                {barcode && (
                                    <span className="text-sm font-bold text-gray-900 font-mono tracking-tight truncate">
                                        [{formatBarcodeDisplay(barcode)}]
                                    </span>
                                )}
                                {barcode && barcodeAnalysis.status === 'valid' && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
                                        {barcodeAnalysis.standardType} 정상
                                    </span>
                                )}
                                {barcode && barcodeAnalysis.status === 'checksum_mismatch' && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setBarcode(barcodeAnalysis.corrected);
                                            setSearchInput(barcodeAnalysis.corrected);
                                            showToast(`체크섬이 교정되었습니다: ${barcodeAnalysis.corrected}`, 'success');
                                        }}
                                        className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-300 whitespace-nowrap active:scale-95"
                                        title="터치하면 정상 체크섬 번호로 즉시 수정합니다"
                                    >
                                        체크섬오류 (교정:{barcodeAnalysis.expectedDigit})
                                    </button>
                                )}
                                {barcode && barcodeAnalysis.status === 'non_standard' && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">
                                        자체/비표준 코드
                                    </span>
                                )}
                            </div>
                            <input ref={productNameRef} type="text" disabled={isOffline} value={productName} onChange={(e) => setProductName(e.target.value)} className="w-full h-9 px-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-sm disabled:bg-gray-100" placeholder="상품명 입력" />
                        </div>
                        <div className="w-1/3 flex flex-col gap-0.5 flex-shrink-0">
                            <label className="text-xs font-bold text-gray-700">규격</label>
                            <input type="text" disabled={isOffline} value={spec} onChange={(e) => setSpec(e.target.value)} className="w-full h-9 px-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-sm disabled:bg-gray-100" placeholder="규격" />
                        </div>
                    </div>

                    <div className="flex gap-1 items-end pt-1">
                        <div className="flex-1 flex flex-col gap-0.5"><label className="text-xs font-bold text-gray-700">매입가</label><input type="text" disabled={isOffline} inputMode="numeric" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} className="w-full h-9 px-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-right text-sm font-semibold disabled:bg-gray-100" /></div>
                        <div className="flex-1 flex flex-col gap-0.5"><label className="text-xs font-bold text-gray-700">판매가</label><input type="text" disabled={isOffline} inputMode="numeric" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} className="w-full h-9 px-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-right text-sm font-bold text-blue-600 disabled:bg-gray-100" /></div>
                        <div className="w-12 flex flex-col items-center justify-center pb-1.5"><label className="text-[10px] text-gray-500 leading-none mb-0.5">이익률</label><span className={`text-xs font-bold ${marginRate >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{marginRate.toFixed(1)}%</span></div>
                        <div className="pb-0.5"><button disabled={isOffline} onClick={() => setIsTaxable(!isTaxable)} className={`flex items-center gap-1 px-2 h-9 rounded border ${isTaxable ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-600'} disabled:opacity-50`}><div className={`w-3.5 h-3.5 border rounded flex items-center justify-center ${isTaxable ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-400'}`}>{isTaxable && <CheckCircleIcon className="w-2.5 h-2.5 text-white" />}</div><span className="text-xs font-bold">과세</span></button></div>
                    </div>

                    <div className="flex flex-col gap-0.5 pt-1">
                        <label className="text-xs font-bold text-gray-700">상품 분류</label>
                        <div className="flex gap-1 items-center">
                            <select disabled={isOffline} value={lCode} onChange={handleLargeChange} className="flex-1 h-9 px-1 border border-gray-300 rounded text-sm bg-white focus:ring-1 focus:ring-blue-500 truncate min-w-0 disabled:bg-gray-100"><option value="">대분류</option>{lCats.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
                            <select disabled={isOffline} value={mCode} onChange={handleMediumChange} className="flex-1 h-9 px-1 border border-gray-300 rounded text-sm bg-white focus:ring-1 focus:ring-blue-500 truncate min-w-0 disabled:bg-gray-100"><option value="">중분류</option>{mCats.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
                            <select disabled={isOffline} value={sCode} onChange={(e) => setSCode(e.target.value)} className="flex-1 h-9 px-1 border border-gray-300 rounded text-sm bg-white focus:ring-1 focus:ring-blue-500 truncate min-w-0 disabled:bg-gray-100"><option value="">소분류</option>{sCats.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
                            <label className="flex-shrink-0 flex items-center gap-1 cursor-pointer whitespace-nowrap px-1 ml-1 bg-gray-50 rounded border border-gray-200 h-9"><input type="checkbox" disabled={isOffline} checked={isCategoryFixed} onChange={(e) => setIsCategoryFixed(e.target.checked)} className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500" /><span className="text-[11px] font-bold text-gray-700">고정</span></label>
                        </div>
                    </div>

                    <div className="flex gap-1 pt-1">
                         <div className="relative flex-grow flex flex-col gap-0.5">
                            <label className="text-xs font-bold text-gray-700">거래처</label>
                            <div className="relative">
                                <input ref={supplierInputRef} type="text" disabled={isOffline} value={supplierSearch} onChange={(e) => { setSupplierSearch(e.target.value); setComcode(''); setShowSupplierDropdown(true); }} onFocus={() => { if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current); setShowSupplierDropdown(true); }} onBlur={() => { blurTimeoutRef.current = window.setTimeout(() => setShowSupplierDropdown(false), 200); }} placeholder="거래처 검색 (선택)" className={`w-full h-9 px-2 pr-8 border rounded-md focus:ring-1 focus:ring-blue-500 text-sm disabled:bg-gray-100 ${comcode ? 'bg-blue-50 border-blue-500 text-blue-800 font-bold' : 'bg-white border-gray-300'}`} />
                                {comcode && !isOffline && <button onClick={handleClearSupplier} className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600" type="button"><XMarkIcon className="w-4 h-4" /></button>}
                                {!comcode && <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400"><ChevronDownIcon className="w-4 h-4" /></div>}
                            </div>
                            <SearchDropdown<Customer> items={filteredSuppliers} show={showSupplierDropdown && !comcode && !isOffline} renderItem={(c) => (<div onMouseDown={(e) => { e.preventDefault(); handleSelectSupplier(c); }} className="p-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0"><p className="font-semibold text-sm">{c.name}</p><p className="text-xs text-gray-500">{c.comcode}</p></div>)} />
                        </div>
                        <div className="w-1/3 flex flex-col gap-0.5">
                            <div className="flex justify-between items-center"><label className="text-xs font-bold text-gray-700">재고수량</label>{isBundle && <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-1.5 rounded border border-purple-200 leading-none">묶음</span>}</div>
                            <input type="text" value={stockQty.toLocaleString()} readOnly className="w-full h-9 px-2 border border-gray-300 rounded-md bg-gray-100 text-right text-sm font-bold text-gray-700" />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1 py-1">
                        <CustomToggleButton label="사용유무" checked={isUse} onChange={setIsUse} disabled={isOffline} />
                        <CustomToggleButton label="포인트적립" checked={isPoint} onChange={setIsPoint} disabled={isOffline} />
                        <CustomToggleButton label="재고관리" checked={isStockManaged} onChange={setIsStockManaged} disabled={isOffline} />
                    </div>

                    <div ref={buttonsContainerRef} className="grid grid-cols-[1fr_4fr] gap-2 pt-1 pb-1">
                        <button onClick={handleReset} disabled={isOffline} className="h-12 bg-orange-100 border border-orange-200 text-orange-600 rounded-md flex items-center justify-center hover:bg-orange-200 active:scale-95 transition-transform disabled:opacity-50"><UndoIcon className="w-6 h-6" /></button>
                        <button onClick={handleSave} disabled={isSaving || isOffline} className="h-12 bg-blue-600 text-white rounded-md font-bold text-lg flex items-center justify-center gap-2 hover:bg-blue-700 shadow-md active:scale-95 disabled:bg-gray-400 transition-transform">{isSaving ? <SpinnerIcon className="w-5 h-5" /> : <CheckCircleIcon className="w-5 h-5" />}저장</button>
                    </div>

                    <div className="grid grid-cols-2 gap-1 mt-1 mb-0">
                        <div className="bg-gray-50 border border-gray-200 rounded flex flex-col min-h-[5rem]">
                            <div className="bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600 border-b border-gray-200 text-center flex-shrink-0">할인정보</div>
                            <div className="p-1 flex-1 flex flex-col items-center justify-center">
                                {saleInfo ? (<><div className="flex-1 flex items-center justify-center w-full"><p className="text-sm font-bold text-blue-700 text-center leading-tight line-clamp-2">{saleInfo.name}</p></div><div className="flex-shrink-0 text-center w-full"><p className="text-base font-bold text-red-600 leading-none my-0.5">{Number(saleInfo.cost).toLocaleString()} / {Number(saleInfo.price).toLocaleString()}</p><p className="text-xs text-gray-500 leading-tight mt-1">{saleInfo.start} ~ {saleInfo.end}</p></div></>) : (<p className="text-sm text-gray-400">할인 정보 없음</p>)}
                            </div>
                        </div>
                        <div className="bg-gray-50 border border-gray-200 rounded flex flex-col min-h-[5rem]">
                            <div className="bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600 border-b border-gray-200 text-center flex-shrink-0">BOM 정보</div>
                            <div className="p-1 flex-1">
                                {bomList.length > 0 ? (<div className="space-y-1">{bomList.map((item, idx) => (<div key={idx} className="bg-white border border-gray-100 rounded p-1.5 shadow-sm flex flex-col gap-0.5"><p className="text-[10px] font-mono text-gray-400 leading-none">{item.barcode}</p><p className="text-xs font-bold text-gray-800 leading-tight">{item.name}</p><p className="text-[10px] text-gray-500">{item.spec}</p><div className="flex justify-between items-center mt-0.5 border-t border-gray-50 pt-0.5"><p className="text-xs text-gray-600 font-medium">{item.cost.toLocaleString()}원</p><p className="text-xs font-bold text-blue-600">x{item.qty}</p></div></div>))}</div>) : (<div className="h-full flex items-center justify-center"><p className="text-sm text-gray-400">일반 상품</p></div>)}
                            </div>
                        </div>
                    </div>
                </div>
            </ActionModal>

            <ProductSelectionModal isOpen={isSelectionModalOpen} onClose={() => setIsSelectionModalOpen(false)} products={searchResults} onSelect={handleProductSelect} />

            {/* 바코드 체크섬 검증 및 저장 확인 모달 (앱 디자인 일관성 적용) */}
            {saveConfirmModal.isOpen && createPortal(
                <div
                    className="fixed inset-0 bg-black/50 z-[220] flex items-center justify-center p-4 animate-fade-in-down"
                    role="dialog"
                    aria-modal="true"
                    onClick={() => setSaveConfirmModal(prev => ({ ...prev, isOpen: false }))}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-100"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="p-5 space-y-3">
                            {saveConfirmModal.analysis.status === 'checksum_mismatch' ? (
                                <>
                                    <div className="flex items-center justify-center gap-2 text-amber-600">
                                        <WarningIcon className="w-6 h-6 flex-shrink-0" />
                                        <h3 className="text-lg font-extrabold text-slate-800">바코드 체크섬 확인</h3>
                                    </div>
                                    <p className="text-xs text-slate-600 text-center leading-relaxed">
                                        입력한 바코드의 끝자리 체크섬이 표준({saveConfirmModal.analysis.standardType}) 규칙과 다릅니다. 체크섬에 맞게 수정하여 저장하시겠습니까?
                                    </p>
                                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-2 text-xs">
                                        <div className="flex justify-between items-center">
                                            <span className="font-bold text-slate-500">입력 번호 (체크섬 불일치)</span>
                                            <span className="font-mono font-bold text-rose-600 text-sm">
                                                {saveConfirmModal.analysis.original.slice(0, -1)}
                                                <span className="underline decoration-2">{saveConfirmModal.analysis.original.slice(-1)}</span>
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center pt-1.5 border-t border-slate-200">
                                            <span className="font-bold text-blue-600">교정 번호 (정상 체크섬)</span>
                                            <span className="font-mono font-extrabold text-blue-700 text-sm bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                                                {saveConfirmModal.analysis.corrected.slice(0, -1)}
                                                <span className="text-rose-600 underline decoration-2">{saveConfirmModal.analysis.corrected.slice(-1)}</span>
                                            </span>
                                        </div>
                                    </div>
                                    <p className="text-[11px] text-slate-400 text-center">
                                        * 체크섬을 사용하지 않는 자체/예외 코드인 경우 아래 [입력값 그대로 저장]을 선택하세요.
                                    </p>
                                </>
                            ) : saveConfirmModal.analysis.status === 'non_standard' ? (
                                <>
                                    <div className="flex items-center justify-center gap-2 text-indigo-600">
                                        <WarningIcon className="w-6 h-6 flex-shrink-0" />
                                        <h3 className="text-lg font-extrabold text-slate-800">비표준(자체) 바코드 확인</h3>
                                    </div>
                                    <p className="text-xs text-slate-600 text-center leading-relaxed">
                                        표준(8/12/13자리) 체크섬 대상이 아닌 <strong>체크섬 미적용 코드</strong>입니다. 아래 정보로 저장하시겠습니까?
                                    </p>
                                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-1.5 text-xs">
                                        <div className="flex justify-between items-center">
                                            <span className="font-bold text-slate-500">바코드 ({saveConfirmModal.analysis.original.length}자리)</span>
                                            <span className="font-mono font-extrabold text-slate-800 text-sm">{saveConfirmModal.analysis.original}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="font-bold text-slate-500">상품명</span>
                                            <span className="font-bold text-slate-800 truncate max-w-[180px]">{productName}</span>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="flex items-center justify-center gap-2 text-blue-600">
                                        <CheckCircleIcon className="w-6 h-6 flex-shrink-0" />
                                        <h3 className="text-lg font-extrabold text-slate-800">신규 상품 등록 확인</h3>
                                    </div>
                                    <p className="text-xs text-slate-600 text-center leading-relaxed">
                                        바코드 체크섬({saveConfirmModal.analysis.standardType})이 정상입니다. 아래 정보로 등록하시겠습니까?
                                    </p>
                                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-1.5 text-xs">
                                        <div className="flex justify-between items-center">
                                            <span className="font-bold text-slate-500">바코드</span>
                                            <span className="font-mono font-extrabold text-emerald-700 text-sm">{saveConfirmModal.analysis.original}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="font-bold text-slate-500">상품명</span>
                                            <span className="font-bold text-slate-800 truncate max-w-[180px]">{productName}</span>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="bg-slate-50 p-3 border-t border-slate-100 flex flex-col gap-2">
                            {saveConfirmModal.analysis.status === 'checksum_mismatch' ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => executeSaveWithBarcode(saveConfirmModal.analysis.corrected)}
                                        className="w-full py-2.5 px-4 rounded-xl font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 shadow-sm active:scale-95 transition-transform"
                                    >
                                        체크섬 수정 후 저장 ({saveConfirmModal.analysis.corrected})
                                    </button>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setSaveConfirmModal(prev => ({ ...prev, isOpen: false }))}
                                            className="py-2.5 px-3 rounded-xl font-bold text-xs text-slate-700 bg-gray-200 hover:bg-gray-300 active:scale-95 transition-transform"
                                        >
                                            취소
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => executeSaveWithBarcode(saveConfirmModal.analysis.original)}
                                            className="py-2.5 px-3 rounded-xl font-bold text-xs text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 active:scale-95 transition-transform"
                                        >
                                            입력값 그대로 저장
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div className="grid grid-cols-2 gap-2.5">
                                    <button
                                        type="button"
                                        onClick={() => setSaveConfirmModal(prev => ({ ...prev, isOpen: false }))}
                                        className="py-2.5 px-4 rounded-xl font-bold text-sm text-slate-700 bg-gray-200 hover:bg-gray-300 active:scale-95 transition-transform"
                                    >
                                        취소
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => executeSaveWithBarcode(saveConfirmModal.analysis.original)}
                                        className="py-2.5 px-4 rounded-xl font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 shadow-sm active:scale-95 transition-transform"
                                    >
                                        확인 및 저장
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
