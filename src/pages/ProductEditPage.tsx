
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ActionModal from '../components/ActionModal';
import { useAlert, useDataState, useScanner, useMiscUI } from '../context/AppContext';
import { executeUserQuery, searchProductsForEdit, extractParamsForQuery } from '../services/sqlService';
import { BarcodeScannerIcon, SearchIcon, SpinnerIcon, CheckCircleIcon, UndoIcon, XMarkIcon, ChevronDownIcon } from '../components/Icons';
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
    const { sqlStatus } = useMiscUI();

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

    // Keyboard Adjustment
    const modalContainerRef = useRef<HTMLDivElement>(null);
    const buttonsContainerRef = useRef<HTMLDivElement>(null);
    useAdjustForKeyboard(modalContainerRef, isOpen, buttonsContainerRef);

    // Sorted Customers
    const { sortedCustomers, recordUsage } = useSortedCustomers(supplierList);

    const formatBarcodeDisplay = (code: string) => {
        if (!code) return '';
        if (code.length === 13) return `${code.slice(0, 3)} ${code.slice(3, 7)} ${code.slice(7)}`;
        return code;
    };

    const loadSuppliers = useCallback(async () => {
        if (sqlStatus === 'connected') {
            try {
                const res = await executeUserQuery('getSuppliers');
                const mapped = res.map((r: any) => ({ comcode: r.comcode, name: r.comname }));
                setSupplierList(mapped);
            } catch (e) { setSupplierList(offlineCustomers); }
        } else { setSupplierList(offlineCustomers); }
    }, [sqlStatus, offlineCustomers]);

    // [수정] 동적 컬럼 매핑 (분류)
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

    // [핵심] 분류 조회 함수: SQL Runner의 사용자 쿼리만 사용 + 클라이언트 필터링 강화
    const fetchCategories = useCallback(async (level: 1 | 2 | 3, parent1?: string, parent2?: string) => {
        if (sqlStatus === 'connected') {
            try {
                const queryName = level === 1 ? '대분류' : level === 2 ? '중분류' : '소분류';
                const userQuery = userQueries.find(q => q.name === queryName);

                if (userQuery) {
                    // 다양한 파라미터 이름 지원
                    const params = { 
                        lCode: parent1 || '', mCode: parent2 || '', 
                        gubun1: parent1, gubun2: parent2,
                        code1: parent1, code2: parent2,
                        parent: parent1
                    };
                    const res = await executeUserQuery(queryName, params, userQuery.query);
                    
                    // [안전장치] 사용자가 SQL에 WHERE 절을 넣지 않았을 경우를 대비하여 클라이언트 필터링 시도
                    // 결과 데이터에 gubun1, gubun2 등의 상위 키 컬럼이 존재할 경우에만 작동함.
                    let filteredRes = res;
                    
                    if (level === 2 && parent1) {
                        filteredRes = res.filter(item => {
                            // 다양한 상위 키 컬럼명 감지 (대소문자 무시)
                            const p1Key = Object.keys(item).find(k => /^(gubun1|l_code|code1|large|대분류.*|상위.*)$/i.test(k));
                            // 키가 없으면 필터링하지 않음 (SQL에서 처리했다고 가정하거나 데이터 누락)
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
            // 오프라인 캐시 사용
            const allCats = await getCachedData<Category>('categories');
            if (level === 1) return allCats.filter(c => c.level === 1).map(c => ({ code: c.code1, name: c.name }));
            if (level === 2) return allCats.filter(c => c.level === 2 && c.code1 === parent1).map(c => ({ code: c.code2!, name: c.name }));
            if (level === 3) return allCats.filter(c => c.level === 3 && c.code1 === parent1 && c.code2 === parent2).map(c => ({ code: c.code3!, name: c.name }));
        }
        return [];
    }, [sqlStatus, userQueries]);

    useEffect(() => {
        if (isOpen) {
            loadSuppliers();
            fetchCategories(1).then(setLCats);
        }
    }, [isOpen, loadSuppliers, fetchCategories]);

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
        
        // 분류 설정
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
        if (!code) return;
        try {
            const results = await searchProductsForEdit(code);
            if (results && results.length > 0) {
                if (results.length === 1) populateProductData(results[0]);
                else { setSearchResults(results); setIsSelectionModalOpen(true); }
            } else {
                if (/^\d+$/.test(code)) {
                    if (!isCategoryFixed) resetForm(true);
                    else resetForm(false);
                    setBarcode(code); setIsEditMode(false);
                    showToast('등록되지 않은 바코드입니다. 신규 등록합니다.', 'success');
                    setTimeout(() => productNameRef.current?.focus(), 150);
                } else { showToast('검색 결과가 없습니다.', 'error'); }
            }
        } catch (e) { showToast('상품 조회 중 오류가 발생했습니다.', 'error'); }
    }, [populateProductData, resetForm, isCategoryFixed, showToast]);

    const handleScan = () => {
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
            if (initialBarcode) { setSearchInput(initialBarcode); performSearch(initialBarcode); }
            else { setSearchInput(''); resetForm(true); }
        }
    }, [isOpen, initialBarcode, performSearch, resetForm]);

    const handleSave = async () => {
        if (!barcode || !productName) { showAlert("바코드와 상품명은 필수 항목입니다."); return; }
        if (!lCode) { showAlert("대분류를 선택해주세요."); return; }
        if (!comcode) { showAlert("거래처를 선택해주세요."); return; }

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
                barcode: barcode, spec: spec || '', comcode: comcode || '',
                isjago: toSqlBit(isStockManaged), ispoint: toSqlBit(isPoint), isuse: toSqlBit(isUse),
                CurrentDate: new Date().toISOString().slice(0, 10),
                kw: searchInput, stock_yn: toSqlBit(isStockManaged),
            };

            const userQueryName = isEditMode ? '상품수정' : '상품등록';
            const userDefinedQuery = userQueries.find(q => q.name === userQueryName);

            if (!userDefinedQuery) { showAlert(`'${userQueryName}' 쿼리가 설정되지 않았습니다.`); return; }

            const dynamicParams = extractParamsForQuery(userDefinedQuery.query, contextParams);
            await executeUserQuery(userQueryName, dynamicParams, userDefinedQuery.query);
            
            showToast(isEditMode ? "수정되었습니다." : "등록되었습니다.", "success");
            setSearchInput('');
            if (isCategoryFixed) resetForm(false); else resetForm(true);
            recordUsage(comcode);

        } catch (e: any) { showAlert(`저장 오류: ${e.message}`); } finally { setIsSaving(false); }
    };

    const handleToggleWithConfirm = (label: string, currentValue: boolean, setter: (val: boolean) => void) => {
        showAlert(`'${label}' 설정을 ${currentValue ? '해제' : '설정'}하시겠습니까?`, () => setter(!currentValue), '확인', 'bg-blue-600');
    };
    
    const CustomToggleButton = ({ label, checked, onChange }: { label: string, checked: boolean, onChange: (v: boolean) => void }) => (
        <button onClick={() => handleToggleWithConfirm(label, checked, onChange)} className={`flex items-center justify-center gap-1 px-1 py-1.5 rounded border ${checked ? 'bg-white border-blue-500 text-blue-700' : 'bg-gray-50 border-gray-300 text-gray-500'}`}>
            <div className={`w-3.5 h-3.5 border rounded flex items-center justify-center ${checked ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-400'}`}>{checked && <CheckCircleIcon className="w-2.5 h-2.5 text-white" />}</div>
            <span className="text-[11px] font-bold whitespace-nowrap">{label}</span>
        </button>
    );

    return (
        <>
            <ActionModal isOpen={isOpen} onClose={onClose} title={isEditMode ? "상품 수정" : "상품 등록/수정"} disableBodyScroll={false} containerRef={modalContainerRef} zIndexClass="z-[50]">
                <div className="px-2 pt-2 pb-0 space-y-1 bg-white flex flex-col h-full overflow-y-auto">
                    <form onSubmit={(e) => { e.preventDefault(); performSearch(searchInput); }} className="flex gap-1 items-stretch">
                        <input ref={searchInputRef} type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="바코드/명칭 (길게 눌러 초기화)" className="flex-1 h-9 pl-2 pr-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-sm" />
                        <button type="submit" className="w-14 h-9 flex items-center justify-center text-white bg-blue-600 rounded-md hover:bg-blue-700 active:scale-95 shadow-sm"><SearchIcon className="w-5 h-5" /></button>
                        <button type="button" onClick={handleScan} className="w-32 h-9 bg-gray-700 text-white rounded-md flex items-center justify-center gap-1 active:scale-95 shadow-sm hover:bg-gray-800"><BarcodeScannerIcon className="w-6 h-6" /><span className="text-xs font-bold">스캔</span></button>
                    </form>
                    
                    <div className="flex gap-1 pt-1 min-w-0">
                        <div className="flex-grow flex flex-col gap-0.5 min-w-0">
                            <div className="flex items-baseline gap-2"><label className="text-xs font-bold text-gray-700 whitespace-nowrap">상품명</label>{barcode && <span className="text-sm font-bold text-gray-900 font-mono tracking-tight truncate">[{formatBarcodeDisplay(barcode)}]</span>}</div>
                            <input ref={productNameRef} type="text" value={productName} onChange={(e) => setProductName(e.target.value)} className="w-full h-9 px-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-sm" placeholder="상품명 입력" />
                        </div>
                        <div className="w-1/3 flex flex-col gap-0.5 flex-shrink-0">
                            <label className="text-xs font-bold text-gray-700">규격</label>
                            <input type="text" value={spec} onChange={(e) => setSpec(e.target.value)} className="w-full h-9 px-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-sm" placeholder="규격" />
                        </div>
                    </div>

                    <div className="flex gap-1 items-end pt-1">
                        <div className="flex-1 flex flex-col gap-0.5"><label className="text-xs font-bold text-gray-700">매입가</label><input type="text" inputMode="numeric" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} className="w-full h-9 px-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-right text-sm font-semibold" /></div>
                        <div className="flex-1 flex flex-col gap-0.5"><label className="text-xs font-bold text-gray-700">판매가</label><input type="text" inputMode="numeric" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} className="w-full h-9 px-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-right text-sm font-bold text-blue-600" /></div>
                        <div className="w-12 flex flex-col items-center justify-center pb-1.5"><label className="text-[10px] text-gray-500 leading-none mb-0.5">이익률</label><span className={`text-xs font-bold ${marginRate >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{marginRate.toFixed(1)}%</span></div>
                        <div className="pb-0.5"><button onClick={() => setIsTaxable(!isTaxable)} className={`flex items-center gap-1 px-2 h-9 rounded border ${isTaxable ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-600'}`}><div className={`w-3.5 h-3.5 border rounded flex items-center justify-center ${isTaxable ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-400'}`}>{isTaxable && <CheckCircleIcon className="w-2.5 h-2.5 text-white" />}</div><span className="text-xs font-bold">과세</span></button></div>
                    </div>

                    <div className="flex flex-col gap-0.5 pt-1">
                        <label className="text-xs font-bold text-gray-700">상품 분류</label>
                        <div className="flex gap-1 items-center">
                            <select value={lCode} onChange={handleLargeChange} className="flex-1 h-9 px-1 border border-gray-300 rounded text-sm bg-white focus:ring-1 focus:ring-blue-500 truncate min-w-0"><option value="">대분류</option>{lCats.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
                            <select value={mCode} onChange={handleMediumChange} className="flex-1 h-9 px-1 border border-gray-300 rounded text-sm bg-white focus:ring-1 focus:ring-blue-500 truncate min-w-0"><option value="">중분류</option>{mCats.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
                            <select value={sCode} onChange={(e) => setSCode(e.target.value)} className="flex-1 h-9 px-1 border border-gray-300 rounded text-sm bg-white focus:ring-1 focus:ring-blue-500 truncate min-w-0"><option value="">소분류</option>{sCats.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
                            <label className="flex-shrink-0 flex items-center gap-1 cursor-pointer whitespace-nowrap px-1 ml-1 bg-gray-50 rounded border border-gray-200 h-9"><input type="checkbox" checked={isCategoryFixed} onChange={(e) => setIsCategoryFixed(e.target.checked)} className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500" /><span className="text-[11px] font-bold text-gray-700">고정</span></label>
                        </div>
                    </div>

                    <div className="flex gap-1 pt-1">
                         <div className="relative flex-grow flex flex-col gap-0.5">
                            <label className="text-xs font-bold text-gray-700">거래처</label>
                            <div className="relative">
                                <input ref={supplierInputRef} type="text" value={supplierSearch} onChange={(e) => { setSupplierSearch(e.target.value); setComcode(''); setShowSupplierDropdown(true); }} onFocus={() => { if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current); setShowSupplierDropdown(true); }} onBlur={() => { blurTimeoutRef.current = window.setTimeout(() => setShowSupplierDropdown(false), 200); }} placeholder="거래처 검색 (선택)" className={`w-full h-9 px-2 pr-8 border rounded-md focus:ring-1 focus:ring-blue-500 text-sm ${comcode ? 'bg-blue-50 border-blue-500 text-blue-800 font-bold' : 'bg-white border-gray-300'}`} />
                                {comcode && <button onClick={handleClearSupplier} className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600" type="button"><XMarkIcon className="w-4 h-4" /></button>}
                                {!comcode && <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400"><ChevronDownIcon className="w-4 h-4" /></div>}
                            </div>
                            <SearchDropdown<Customer> items={filteredSuppliers} show={showSupplierDropdown && !comcode} renderItem={(c) => (<div onMouseDown={(e) => { e.preventDefault(); handleSelectSupplier(c); }} className="p-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0"><p className="font-semibold text-sm">{c.name}</p><p className="text-xs text-gray-500">{c.comcode}</p></div>)} />
                        </div>
                        <div className="w-1/3 flex flex-col gap-0.5">
                            <div className="flex justify-between items-center"><label className="text-xs font-bold text-gray-700">재고수량</label>{isBundle && <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-1.5 rounded border border-purple-200 leading-none">묶음</span>}</div>
                            <input type="text" value={stockQty.toLocaleString()} readOnly className="w-full h-9 px-2 border border-gray-300 rounded-md bg-gray-100 text-right text-sm font-bold text-gray-700" />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1 py-1">
                        <CustomToggleButton label="사용유무" checked={isUse} onChange={setIsUse} />
                        <CustomToggleButton label="포인트적립" checked={isPoint} onChange={setIsPoint} />
                        <CustomToggleButton label="재고관리" checked={isStockManaged} onChange={setIsStockManaged} />
                    </div>

                    <div ref={buttonsContainerRef} className="grid grid-cols-[1fr_4fr] gap-2 pt-1 pb-1">
                        <button onClick={handleReset} className="h-12 bg-orange-100 border border-orange-200 text-orange-600 rounded-md flex items-center justify-center hover:bg-orange-200 active:scale-95 transition-transform"><UndoIcon className="w-6 h-6" /></button>
                        <button onClick={handleSave} disabled={isSaving} className="h-12 bg-blue-600 text-white rounded-md font-bold text-lg flex items-center justify-center gap-2 hover:bg-blue-700 shadow-md active:scale-95 disabled:bg-gray-400 transition-transform">{isSaving ? <SpinnerIcon className="w-5 h-5" /> : <CheckCircleIcon className="w-5 h-5" />}저장</button>
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
        </>
    );
}
