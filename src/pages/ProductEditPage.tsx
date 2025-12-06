
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ActionModal from '../components/ActionModal';
import { useAlert, useDataState, useScanner, useMiscUI } from '../context/AppContext';
import { executeUserQuery, searchProductsForEdit } from '../services/sqlService';
import { extractParamsForQuery } from '../hooks/useProductSearch';
import { BarcodeScannerIcon, SearchIcon, SpinnerIcon, CheckCircleIcon, UndoIcon } from '../components/Icons';
import { Customer, Category } from '../types';
import { getCachedData } from '../services/cacheDbService';

interface ProductEditPageProps {
    isOpen: boolean;
    onClose: () => void;
    initialBarcode?: string;
}

interface CategoryOption {
    code: string;
    name: string;
}

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
    
    // 분류 (드롭다운 바인딩용)
    const [lCode, setLCode] = useState(''); // 대분류
    const [mCode, setMCode] = useState(''); // 중분류
    const [sCode, setSCode] = useState(''); // 소분류
    
    // 분류 옵션 목록
    const [lCats, setLCats] = useState<CategoryOption[]>([]);
    const [mCats, setMCats] = useState<CategoryOption[]>([]);
    const [sCats, setSCats] = useState<CategoryOption[]>([]);
    
    const [comcode, setComcode] = useState('');
    const [supplierList, setSupplierList] = useState<Customer[]>([]);
    
    const [stockQty, setStockQty] = useState<number>(0);

    // Flags
    const [isUse, setIsUse] = useState(true);
    const [isTaxable, setIsTaxable] = useState(true);
    const [isPoint, setIsPoint] = useState(true);
    const [isStockManaged, setIsStockManaged] = useState(true);

    // Info Panels
    const [saleInfoText, setSaleInfoText] = useState('할인 정보 없음');
    const [bomInfoText, setBomInfoText] = useState('일반 상품');

    const [isEditMode, setIsEditMode] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    
    const [searchInput, setSearchInput] = useState('');
    const searchInputRef = useRef<HTMLInputElement>(null);

    // --- Data Fetching Logic ---

    // 거래처 목록 로드
    const loadSuppliers = useCallback(async () => {
        if (sqlStatus === 'connected') {
            try {
                const res = await executeUserQuery('getSuppliers');
                // SQL 결과 매핑 (comcode, comname -> comcode, name)
                const mapped = res.map((r: any) => ({
                    comcode: r.comcode,
                    name: r.comname
                }));
                setSupplierList(mapped);
            } catch (e) {
                console.error("Online supplier fetch failed", e);
                setSupplierList(offlineCustomers);
            }
        } else {
            setSupplierList(offlineCustomers);
        }
    }, [sqlStatus, offlineCustomers]);

    // 대분류 목록 로드
    const loadLargeCats = useCallback(async () => {
        if (sqlStatus === 'connected') {
            try {
                const res = await executeUserQuery('getLargeCategories');
                setLCats(res.map((r: any) => ({ code: r.code, name: r.name })));
            } catch (e) {
                console.error(e);
            }
        } else {
            const allCats = await getCachedData<Category>('categories');
            const filtered = allCats.filter(c => c.level === 1).map(c => ({ code: c.code1, name: c.name }));
            setLCats(filtered);
        }
    }, [sqlStatus]);

    // 중분류 목록 로드
    const loadMediumCats = useCallback(async (largeCode: string) => {
        if (!largeCode) {
            setMCats([]);
            return;
        }
        if (sqlStatus === 'connected') {
            try {
                const res = await executeUserQuery('getMediumCategories', { lCode: largeCode });
                setMCats(res.map((r: any) => ({ code: r.code, name: r.name })));
            } catch (e) { console.error(e); }
        } else {
            const allCats = await getCachedData<Category>('categories');
            const filtered = allCats.filter(c => c.level === 2 && c.code1 === largeCode)
                                    .map(c => ({ code: c.code2!, name: c.name }));
            setMCats(filtered);
        }
    }, [sqlStatus]);

    // 소분류 목록 로드
    const loadSmallCats = useCallback(async (largeCode: string, mediumCode: string) => {
        if (!largeCode || !mediumCode) {
            setSCats([]);
            return;
        }
        if (sqlStatus === 'connected') {
            try {
                const res = await executeUserQuery('getSmallCategories', { lCode: largeCode, mCode: mediumCode });
                setSCats(res.map((r: any) => ({ code: r.code, name: r.name })));
            } catch (e) { console.error(e); }
        } else {
            const allCats = await getCachedData<Category>('categories');
            const filtered = allCats.filter(c => c.level === 3 && c.code1 === largeCode && c.code2 === mediumCode)
                                    .map(c => ({ code: c.code3!, name: c.name }));
            setSCats(filtered);
        }
    }, [sqlStatus]);

    // 초기 데이터 로드 (모달 열릴 때)
    useEffect(() => {
        if (isOpen) {
            loadSuppliers();
            loadLargeCats();
        }
    }, [isOpen, loadSuppliers, loadLargeCats]);

    // 분류 변경 핸들러
    const handleLargeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        setLCode(val);
        setMCode('');
        setSCode('');
        setSCats([]); // Clear small cats
        loadMediumCats(val);
    };

    const handleMediumChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        setMCode(val);
        setSCode('');
        loadSmallCats(lCode, val);
    };

    // Calculate Margin Rate
    const marginRate = useMemo(() => {
        const cost = Number(String(costPrice).replace(/,/g, ''));
        const selling = Number(String(sellingPrice).replace(/,/g, ''));
        if (!selling || selling === 0) return 0;
        return ((selling - cost) / selling) * 100;
    }, [costPrice, sellingPrice]);

    const resetForm = useCallback((full: boolean = true) => {
        if (full) {
            setBarcode('');
            setProductName('');
            setSpec('');
            setCostPrice(0);
            setSellingPrice(0);
            setComcode('');
            setLCode('');
            setMCode('');
            setSCode('');
            setStockQty(0);
            setIsUse(true);
            setIsTaxable(true);
            setIsPoint(true);
            setIsStockManaged(true);
            setSaleInfoText('할인 정보 없음');
            setBomInfoText('일반 상품');
            setIsEditMode(false);
            
            // Reset category lists
            setMCats([]);
            setSCats([]);
        } else {
            setBarcode('');
            setProductName('');
            setCostPrice(0);
            setSellingPrice(0);
            setStockQty(0);
            setSaleInfoText('할인 정보 없음');
            setIsEditMode(false);
        }
    }, []);

    const loadProduct = useCallback(async (code: string) => {
        if (!code) return;
        try {
            const results = await searchProductsForEdit(code);
            if (results && results.length > 0) {
                const p = results[0];
                setBarcode(p.바코드);
                setProductName(p.상품명);
                setSpec(p.규격 || '');
                setCostPrice(p.매입가);
                setSellingPrice(p.판매가);
                setComcode(p.거래처코드 || '');
                setStockQty(p.재고수량 || 0);
                
                setIsUse(p.사용유무 === '1' || p.사용유무 === 'Y');
                setIsTaxable(p.과세여부 === '1' || p.과세여부 === 'Y');
                setIsPoint(p.고객점수가산 === '1' || p.고객점수가산 === 'Y');
                setIsStockManaged(p.재고관리여부 === '1' || p.재고관리여부 === 'Y');
                
                // 분류 설정 및 하위 목록 로드
                const lc = p.대분류코드 || '';
                const mc = p.중분류코드 || '';
                const sc = p.소분류코드 || '';
                
                setLCode(lc);
                if (lc) {
                    await loadMediumCats(lc);
                    setMCode(mc);
                    if (mc) {
                        await loadSmallCats(lc, mc);
                        setSCode(sc);
                    } else {
                        setSCode('');
                        setSCats([]);
                    }
                } else {
                    setMCode('');
                    setSCode('');
                    setMCats([]);
                    setSCats([]);
                }

                if (p.행사유무 === 'Y') {
                    setSaleInfoText(`[${p.행사명}] ${p.행사매입가?.toLocaleString()} / ${p.행사판매가?.toLocaleString()}\n(${p.행사시작일}~${p.행사종료일})`);
                } else {
                    setSaleInfoText('할인 정보 없음');
                }
                setBomInfoText(p.BOM여부 || '일반 상품');

                setIsEditMode(true);
                showToast('상품 정보를 불러왔습니다.', 'success');
            } else {
                if (/^\d+$/.test(code)) {
                    resetForm(false);
                    setBarcode(code);
                    setIsEditMode(false);
                    showToast('등록되지 않은 바코드입니다. 신규 등록합니다.', 'success');
                } else {
                    showToast('상품을 찾을 수 없습니다.', 'error');
                }
            }
        } catch (e) {
            console.error(e);
            showToast('상품 조회 중 오류가 발생했습니다.', 'error');
        }
    }, [resetForm, showToast, loadMediumCats, loadSmallCats]);

    useEffect(() => {
        if (isOpen) {
            if (initialBarcode) {
                setSearchInput(initialBarcode);
                loadProduct(initialBarcode);
            } else {
                setSearchInput('');
                resetForm(true);
                setTimeout(() => searchInputRef.current?.focus(), 150);
            }
        }
    }, [isOpen, initialBarcode, loadProduct, resetForm]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        loadProduct(searchInput);
    };

    const handleScan = () => {
        openScanner('modal', (code) => {
            setSearchInput(code);
            loadProduct(code);
        }, false);
    };

    const handleSave = async () => {
        if (!barcode || !productName) {
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

        setIsSaving(true);
        try {
            const safeCost = Number(String(costPrice).replace(/,/g, ''));
            const safeSelling = Number(String(sellingPrice).replace(/,/g, ''));

            const contextParams = {
                money0vat: String(isNaN(safeCost) ? 0 : safeCost),
                money1: String(isNaN(safeSelling) ? 0 : safeSelling),
                Descr: productName,
                descr: productName,
                isvat: isTaxable ? '1' : '0',
                gubun1: lCode || '',
                gubun2: mCode || '',
                gubun3: sCode || '',
                barcode: barcode,
                spec: spec || '',
                comcode: comcode || '',
                isjago: isStockManaged ? '1' : '0',
                ispoint: isPoint ? '1' : '0',
                isuse: isUse ? '1' : '0',
                CurrentDate: new Date().toISOString().slice(0, 10),
                kw: searchInput, 
                stock_yn: isStockManaged ? '1' : '0',
            };

            const userQueryName = isEditMode ? '상품수정' : '상품등록';
            const userDefinedQuery = userQueries.find(q => q.name === userQueryName);

            if (!userDefinedQuery) {
                setIsSaving(false);
                showAlert(`'${userQueryName}' 쿼리가 설정되지 않았습니다.`);
                return;
            }

            const dynamicParams = extractParamsForQuery(userDefinedQuery.query, contextParams);
            await executeUserQuery(userQueryName, dynamicParams, userDefinedQuery.query);
            
            showToast(isEditMode ? "상품 정보가 수정되었습니다." : "신규 상품이 등록되었습니다.", "success");
            setSearchInput('');
            resetForm(true); 
            setTimeout(() => searchInputRef.current?.focus(), 100);

        } catch (e: any) {
            showAlert(`저장 오류: ${e.message}`);
        } finally { setIsSaving(false); }
    };

    const handleReset = () => {
        setSearchInput('');
        resetForm(true);
        setTimeout(() => searchInputRef.current?.focus(), 100);
    };

    if (!isOpen) return null;

    const CustomToggleButton = ({ label, checked, onChange }: { label: string, checked: boolean, onChange: (v: boolean) => void }) => (
        <button 
            onClick={() => onChange(!checked)}
            className={`flex items-center justify-center gap-1.5 p-2 rounded border transition-all ${checked ? 'bg-white border-blue-500 text-blue-700' : 'bg-gray-50 border-gray-300 text-gray-500'}`}
        >
            <div className={`w-4 h-4 border rounded flex items-center justify-center ${checked ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-400'}`}>
                {checked && <CheckCircleIcon className="w-3.5 h-3.5 text-white" />}
            </div>
            <span className="text-xs font-bold whitespace-nowrap">{label}</span>
        </button>
    );

    return (
        <ActionModal
            isOpen={isOpen}
            onClose={onClose}
            title={isEditMode ? "상품 수정" : "상품 등록/수정"} 
            disableBodyScroll={false}
        >
            <div className="p-3 space-y-3 bg-white min-h-full">
                {/* 1. Search Bar */}
                <form onSubmit={handleSearch} className="flex gap-2">
                    <div className="relative flex-grow">
                        <input
                            ref={searchInputRef}
                            type="text"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="바코드 또는 상품명 (길게 눌러 초기화)"
                            className="w-full h-10 pl-3 pr-10 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-sm"
                        />
                        <button type="submit" className="absolute right-0 top-0 h-10 w-10 flex items-center justify-center text-white bg-blue-600 rounded-r-md hover:bg-blue-700">
                            <SearchIcon className="w-5 h-5" />
                        </button>
                    </div>
                    <button type="button" onClick={handleScan} className="w-10 h-10 bg-gray-700 text-white rounded-md flex items-center justify-center">
                        <BarcodeScannerIcon className="w-6 h-6" />
                    </button>
                </form>

                {/* 2. Row: Product Name & Spec */}
                <div className="flex gap-2">
                    <div className="flex-grow flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-700">상품명</label>
                        <input
                            type="text"
                            value={productName}
                            onChange={(e) => setProductName(e.target.value)}
                            className="w-full h-10 px-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-sm"
                            placeholder="상품명"
                        />
                    </div>
                    <div className="w-1/3 flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-700">규격</label>
                        <input
                            type="text"
                            value={spec}
                            onChange={(e) => setSpec(e.target.value)}
                            className="w-full h-10 px-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-sm"
                            placeholder="규격"
                        />
                    </div>
                </div>

                {/* 3. Row: Prices, Margin, Tax */}
                <div className="flex gap-2 items-end">
                    <div className="flex-1 flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-700">매입가</label>
                        <input
                            type="text" inputMode="numeric"
                            value={costPrice}
                            onChange={(e) => setCostPrice(e.target.value)}
                            className="w-full h-10 px-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-right text-sm font-semibold"
                        />
                    </div>
                    <div className="flex-1 flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-700">판매가</label>
                        <input
                            type="text" inputMode="numeric"
                            value={sellingPrice}
                            onChange={(e) => setSellingPrice(e.target.value)}
                            className="w-full h-10 px-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-right text-sm font-bold text-blue-600"
                        />
                    </div>
                    <div className="w-16 flex flex-col gap-1 items-center justify-center pb-2">
                        <label className="text-[10px] text-gray-500">이익률</label>
                        <span className={`text-xs font-bold ${marginRate >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                            {marginRate.toFixed(2)}%
                        </span>
                    </div>
                    <div className="pb-1">
                        <button 
                            onClick={() => setIsTaxable(!isTaxable)}
                            className={`flex items-center gap-1 px-2 py-2 rounded border ${isTaxable ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-600'}`}
                        >
                            <div className={`w-3.5 h-3.5 border rounded flex items-center justify-center ${isTaxable ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-400'}`}>
                                {isTaxable && <CheckCircleIcon className="w-3 h-3 text-white" />}
                            </div>
                            <span className="text-xs font-bold">과세</span>
                        </button>
                    </div>
                </div>

                {/* 4. Row: Classification (Category) Dropdowns */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-bold text-gray-700">상품 분류</label>
                    <div className="flex gap-1">
                        <select 
                            value={lCode} 
                            onChange={handleLargeChange} 
                            className="flex-1 h-9 px-1 border border-gray-300 rounded text-sm bg-white focus:ring-1 focus:ring-blue-500"
                        >
                            <option value="">대분류</option>
                            {lCats.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                        </select>
                        <select 
                            value={mCode} 
                            onChange={handleMediumChange} 
                            className="flex-1 h-9 px-1 border border-gray-300 rounded text-sm bg-white focus:ring-1 focus:ring-blue-500"
                        >
                            <option value="">중분류</option>
                            {mCats.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                        </select>
                        <select 
                            value={sCode} 
                            onChange={(e) => setSCode(e.target.value)} 
                            className="flex-1 h-9 px-1 border border-gray-300 rounded text-sm bg-white focus:ring-1 focus:ring-blue-500"
                        >
                            <option value="">소분류</option>
                            {sCats.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                        </select>
                    </div>
                </div>

                {/* 5. Row: Customer (Dropdown) & Stock */}
                <div className="flex gap-2">
                    <div className="flex-grow flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-700">거래처</label>
                        <select
                            value={comcode}
                            onChange={(e) => setComcode(e.target.value)}
                            className="w-full h-10 px-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-sm bg-white"
                        >
                            <option value="">거래처를 선택하세요</option>
                            {supplierList.map(c => (
                                <option key={c.comcode} value={c.comcode}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="w-1/3 flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-700">재고수량</label>
                        <input
                            type="text"
                            value={stockQty.toLocaleString()}
                            readOnly
                            className="w-full h-10 px-2 border border-gray-300 rounded-md bg-gray-100 text-right text-sm font-bold text-gray-700"
                        />
                    </div>
                </div>

                {/* 6. Row: Toggles */}
                <div className="grid grid-cols-3 gap-2 py-1">
                    <CustomToggleButton label="상품사용유무" checked={isUse} onChange={setIsUse} />
                    <CustomToggleButton label="고객점수가산" checked={isPoint} onChange={setIsPoint} />
                    <CustomToggleButton label="재고관리여부" checked={isStockManaged} onChange={setIsStockManaged} />
                </div>

                {/* 7. Action Buttons */}
                <div className="grid grid-cols-[1fr_4fr] gap-2 pt-2">
                    <button 
                        onClick={handleReset} 
                        className="h-12 bg-orange-100 border border-orange-200 text-orange-600 rounded-md flex items-center justify-center hover:bg-orange-200"
                    >
                        <UndoIcon className="w-6 h-6" />
                    </button>
                    <button 
                        onClick={handleSave} 
                        disabled={isSaving}
                        className="h-12 bg-blue-600 text-white rounded-md font-bold text-lg flex items-center justify-center gap-2 hover:bg-blue-700 shadow-md active:scale-95 disabled:bg-gray-400"
                    >
                        {isSaving ? <SpinnerIcon className="w-5 h-5" /> : <CheckCircleIcon className="w-5 h-5" />}
                        저장
                    </button>
                </div>

                {/* 8. Bottom Info Panels */}
                <div className="grid grid-cols-2 gap-2 h-40 mt-2">
                    <div className="bg-gray-50 border border-gray-200 rounded-lg flex flex-col">
                        <div className="bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-600 border-b border-gray-200 text-center">할인정보</div>
                        <div className="flex-grow p-2 flex items-center justify-center text-center">
                            <p className="text-xs text-gray-500 whitespace-pre-line leading-relaxed">{saleInfoText}</p>
                        </div>
                    </div>
                    <div className="bg-gray-50 border border-gray-200 rounded-lg flex flex-col">
                        <div className="bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-600 border-b border-gray-200 text-center">BOM 정보</div>
                        <div className="flex-grow p-2 flex items-center justify-center text-center">
                            <p className="text-xs text-gray-500">{bomInfoText}</p>
                        </div>
                    </div>
                </div>
            </div>
        </ActionModal>
    );
}
