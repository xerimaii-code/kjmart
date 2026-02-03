import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ActionModal from '../components/ActionModal';
import { useAlert, useDataState, useScanner, useMiscUI } from '../context/AppContext';
import { executeUserQuery, searchProductsForEdit, extractParamsForQuery } from '../services/sqlService';
import { BarcodeScannerIcon, SearchIcon, SpinnerIcon, CheckCircleIcon, UndoIcon } from '../components/Icons';
import { Customer, Category } from '../types';
import { getCachedData } from '../services/cacheDbService';
import { useAdjustForKeyboard } from '../hooks/useAdjustForKeyboard';
import ProductSelectionModal from '../components/ProductSelectionModal';
import { useSortedCustomers } from '../hooks/useSortedCustomers';

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
    
    const [comcode, setComcode] = useState('');
    const [supplierList, setSupplierList] = useState<Customer[]>([]);
    
    const [stockQty, setStockQty] = useState<number>(0);
    const [isBundle, setIsBundle] = useState(false);

    // Flags
    const [isUse, setIsUse] = useState(true);
    const [isTaxable, setIsTaxable] = useState(true);
    const [isPoint, setIsPoint] = useState(true);
    const [isStockManaged, setIsStockManaged] = useState(true);
    
    // UI Logic (Default checked as requested)
    const [isCategoryFixed, setIsCategoryFixed] = useState(true);

    // Info Panels Data
    const [saleInfo, setSaleInfo] = useState<SaleInfo | null>(null);
    const [bomList, setBomList] = useState<any[]>([]);
    const [stopSaleOnSave, setStopSaleOnSave] = useState(false);

    const [isEditMode, setIsEditMode] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    
    const [searchInput, setSearchInput] = useState('');
    const searchInputRef = useRef<HTMLInputElement>(null);
    const productNameRef = useRef<HTMLInputElement>(null);
    
    // Selection Modal
    const [isSelectionModalOpen, setIsSelectionModalOpen] = useState(false);
    const [searchResults, setSearchResults] = useState<any[]>([]);

    // Keyboard Adjustment: Target the buttons container so info panels can be hidden
    const modalContainerRef = useRef<HTMLDivElement>(null);
    const buttonsContainerRef = useRef<HTMLDivElement>(null);
    useAdjustForKeyboard(modalContainerRef, isOpen, buttonsContainerRef);

    // Sorted Customers
    const { sortedCustomers, recordUsage } = useSortedCustomers(supplierList);

    // --- Format Helper ---
    const formatBarcodeDisplay = (code: string) => {
        if (!code) return '';
        if (code.length === 13) {
            return `${code.slice(0, 3)} ${code.slice(3, 7)} ${code.slice(7)}`;
        }
        return code;
    };

    // --- Data Fetching ---
    const loadSuppliers = useCallback(async () => {
        if (sqlStatus === 'connected') {
            try {
                const res = await executeUserQuery('getSuppliers');
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

    const loadMediumCats = useCallback(async (largeCode: string) => {
        if (!largeCode) {
            setMCats([]); return;
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

    const loadSmallCats = useCallback(async (largeCode: string, mediumCode: string) => {
        if (!largeCode || !mediumCode) {
            setSCats([]); return;
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

    useEffect(() => {
        if (isOpen) {
            loadSuppliers();
            loadLargeCats();
        }
    }, [isOpen, loadSuppliers, loadLargeCats]);

    const handleLargeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        setLCode(val); setMCode(''); setSCode(''); setSCats([]);
        loadMediumCats(val);
    };

    const handleMediumChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        setMCode(val); setSCode('');
        loadSmallCats(lCode, val);
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
            setComcode(''); setLCode(''); setMCode(''); setSCode('');
            setStockQty(0);
            setIsBundle(false);
            setIsUse(true); setIsTaxable(true); setIsPoint(true); setIsStockManaged(true);
            setSaleInfo(null);
            setStopSaleOnSave(false);
            setBomList([]);
            setIsEditMode(false);
            setMCats([]); setSCats([]);
        } else {
            setBarcode(''); setProductName(''); setSpec('');
            setCostPrice(0); setSellingPrice(0); setStockQty(0);
            setIsBundle(false);
            setSaleInfo(null);
            setStopSaleOnSave(false);
            setIsEditMode(false);
        }
    }, []);

    const populateProductData = useCallback(async (p: any) => {
        setBarcode(p.barcode || p.바코드);
        setProductName(p.descr || p.상품명);
        setSpec(p.spec || p.규격 || '');
        setComcode(p.comcode || p.거래처코드 || '');
        setStockQty(p.curjago || p.재고수량 || 0);
        
        setIsUse(String(p.isuse) === '1');
        setIsTaxable(String(p.isvat) === '1');
        setIsPoint(String(p.ispoint) === '1');
        setIsStockManaged(String(p.isjago) === '1');
        
        const lc = p.gubun1 || p.대분류코드 || '';
        const mc = p.gubun2 || p.중분류코드 || '';
        const sc = p.gubun3 || p.소분류코드 || '';
        
        setLCode(lc);
        if (lc) {
            await loadMediumCats(lc);
            setMCode(mc);
            if (mc) {
                await loadSmallCats(lc, mc);
                setSCode(sc);
            } else {
                setSCode(''); setSCats([]);
            }
        } else {
            setMCode(''); setSCode(''); setMCats([]); setSCats([]);
        }
        
        setStopSaleOnSave(false);
        // Sale Info Logic uses Korean keys, which is correct from the updated API query
        if (p.행사유무 === 'Y') {
            const newSaleInfo = {
                name: p.행사명,
                cost: p.행사매입가,
                price: p.행사판매가,
                start: p.행사시작일,
                end: p.행사종료일
            };
            setSaleInfo(newSaleInfo);
            // Populate inputs with event prices
            setCostPrice(newSaleInfo.cost);
            setSellingPrice(newSaleInfo.price);
        } else {
            setSaleInfo(null);
            // Populate with regular prices
            setCostPrice(p.money0vat || p.매입가);
            setSellingPrice(p.money1 || p.판매가);
        }

        // BOM Info Logic
        const isPack = String(p.ispack) === '1';
        setIsBundle(isPack);

        if (isPack) {
            // Fetch BOM components
            executeUserQuery('getBomComponents', { barcode: p.barcode || p.바코드 })
                .then(res => setBomList(res))
                .catch(err => {
                    console.error("Failed to fetch BOM", err);
                    setBomList([]);
                });
        } else {
            setBomList([]);
        }

        setIsEditMode(true);
        showToast('상품 정보를 불러왔습니다.', 'success');
    }, [loadMediumCats, loadSmallCats, showToast]);

    const performSearch = useCallback(async (code: string) => {
        if (!code) return;
        try {
            const results = await searchProductsForEdit(code);
            if (results && results.length > 0) {
                if (results.length === 1) {
                    populateProductData(results[0]);
                } else {
                    setSearchResults(results);
                    setIsSelectionModalOpen(true);
                }
            } else {
                if (/^\d+$/.test(code)) {
                    if (!isCategoryFixed) resetForm(true);
                    else resetForm(false);
                    
                    setBarcode(code);
                    setIsEditMode(false);
                    showToast('등록되지 않은 바코드입니다. 신규 등록합니다.', 'success');
                    
                    // Focus on Product Name for new item registration
                    setTimeout(() => {
                        productNameRef.current?.focus();
                    }, 150);
                } else {
                    showToast('검색 결과가 없습니다.', 'error');
                }
            }
        } catch (e) {
            console.error(e);
            showToast('상품 조회 중 오류가 발생했습니다.', 'error');
        }
    }, [populateProductData, resetForm, isCategoryFixed, showToast]);

    useEffect(() => {
        if (isOpen) {
            if (initialBarcode) {
                setSearchInput(initialBarcode);
                performSearch(initialBarcode);
            } else {
                setSearchInput('');
                resetForm(true);
            }
        }
    }, [isOpen, initialBarcode, performSearch, resetForm]);

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        performSearch(searchInput);
    };

    const handleScan = () => {
        openScanner('modal', (code) => {
            setSearchInput(code);
            performSearch(code);
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
            if (stopSaleOnSave) {
                await executeUserQuery('행사상품_개별중지', { barcode });
                showToast('상품이 행사에서 제외되었습니다.', 'success');
            }

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
            
            if (isCategoryFixed) resetForm(false);
            else resetForm(true);
            
            recordUsage(comcode);

        } catch (e: any) {
            showAlert(`저장 오류: ${e.message}`);
        } finally { setIsSaving(false); }
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

    const handleToggleWithConfirm = (label: string, currentValue: boolean, setter: (val: boolean) => void) => {
        showAlert(
            `'${label}' 설정을 ${currentValue ? '해제' : '설정'}하시겠습니까?`,
            () => setter(!currentValue),
            '확인',
            'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
        );
    };
    
    const CustomToggleButton = ({ label, checked, onChange }: { label: string, checked: boolean, onChange: (v: boolean) => void }) => (
        <button 
            onClick={() => handleToggleWithConfirm(label, checked, onChange)}
            className={`flex items-center justify-center gap-1 px-1 py-1.5 rounded border transition-all ${checked ? 'bg-white border-blue-500 text-blue-700' : 'bg-gray-50 border-gray-300 text-gray-500'}`}
        >
            <div className={`w-3.5 h-3.5 border rounded flex items-center justify-center ${checked ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-400'}`}>
                {checked && <CheckCircleIcon className="w-2.5 h-2.5 text-white" />}
            </div>
            <span className="text-[11px] font-bold whitespace-nowrap">{label}</span>
        </button>
    );

    return (
        <>
            <ActionModal
                isOpen={isOpen}
                onClose={onClose}
                title={isEditMode ? "상품 수정" : "상품 등록/수정"} 
                disableBodyScroll={false}
                containerRef={modalContainerRef}
                zIndexClass="z-[50]"
            >
                <div className="px-2 pt-2 pb-0 space-y-1 bg-white flex flex-col h-full overflow-y-auto">
                    {/* 1. Search Bar Row (Compact) */}
                    <form onSubmit={handleSearchSubmit} className="flex gap-1 items-stretch">
                        <input
                            ref={searchInputRef}
                            type="text"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="바코드/명칭 (길게 눌러 초기화)"
                            className="flex-1 h-9 pl-2 pr-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-sm" 
                        />
                        <button type="submit" className="w-14 h-9 flex items-center justify-center text-white bg-blue-600 rounded-md hover:bg-blue-700 active:scale-95 shadow-sm">
                            <SearchIcon className="w-5 h-5" />
                        </button>
                        <button type="button" onClick={handleScan} className="w-32 h-9 bg-gray-700 text-white rounded-md flex items-center justify-center gap-1 active:scale-95 shadow-sm hover:bg-gray-800">
                            <BarcodeScannerIcon className="w-6 h-6" />
                            <span className="text-xs font-bold">스캔</span>
                        </button>
                    </form>
                    
                    {/* 2. Product Name & Barcode Display & Spec */}
                    <div className="flex gap-1 pt-1 min-w-0">
                        <div className="flex-grow flex flex-col gap-0.5 min-w-0">
                            <div className="flex items-baseline gap-2">
                                <label className="text-xs font-bold text-gray-700 whitespace-nowrap">상품명</label>
                                {barcode && (
                                    <span className="text-sm font-bold text-gray-900 font-mono tracking-tight truncate">
                                        [{formatBarcodeDisplay(barcode)}]
                                    </span>
                                )}
                            </div>
                            <input
                                ref={productNameRef}
                                type="text"
                                value={productName}
                                onChange={(e) => setProductName(e.target.value)}
                                className="w-full h-9 px-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-sm"
                                placeholder="상품명 입력"
                            />
                        </div>
                        <div className="w-1/3 flex flex-col gap-0.5 flex-shrink-0">
                            <label className="text-xs font-bold text-gray-700">규격</label>
                            <input
                                type="text"
                                value={spec}
                                onChange={(e) => setSpec(e.target.value)}
                                className="w-full h-9 px-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-sm"
                                placeholder="규격"
                            />
                        </div>
                    </div>

                    {/* 3. Prices & Margin & Tax */}
                    <div className="flex gap-1 items-end pt-1">
                        <div className="flex-1 flex flex-col gap-0.5">
                            <label className="text-xs font-bold text-gray-700">매입가 {saleInfo && <span className="text-red-500 font-bold">(행사)</span>}</label>
                            <input
                                type="text" inputMode="numeric"
                                value={costPrice}
                                onChange={(e) => setCostPrice(e.target.value)}
                                className="w-full h-9 px-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-right text-sm font-semibold"
                            />
                        </div>
                        <div className="flex-1 flex flex-col gap-0.5">
                            <label className="text-xs font-bold text-gray-700">판매가 {saleInfo && <span className="text-red-500 font-bold">(행사)</span>}</label>
                            <input
                                type="text" inputMode="numeric"
                                value={sellingPrice}
                                onChange={(e) => setSellingPrice(e.target.value)}
                                className="w-full h-9 px-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-right text-sm font-bold text-blue-600"
                            />
                        </div>
                        <div className="w-12 flex flex-col items-center justify-center pb-1.5">
                            <label className="text-[10px] text-gray-500 leading-none mb-0.5">이익률</label>
                            <span className={`text-xs font-bold ${marginRate >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                                {marginRate.toFixed(1)}%
                            </span>
                        </div>
                        <div className="pb-0.5">
                            <button 
                                onClick={() => setIsTaxable(!isTaxable)}
                                className={`flex items-center gap-1 px-2 h-9 rounded border ${isTaxable ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-600'}`}
                            >
                                <div className={`w-3.5 h-3.5 border rounded flex items-center justify-center ${isTaxable ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-400'}`}>
                                    {isTaxable && <CheckCircleIcon className="w-2.5 h-2.5 text-white" />}
                                </div>
                                <span className="text-xs font-bold">과세</span>
                            </button>
                        </div>
                    </div>

                    {/* 4. Classification & Fixed Toggle */}
                    <div className="flex flex-col gap-0.5 pt-1">
                        <label className="text-xs font-bold text-gray-700">상품 분류</label>
                        <div className="flex gap-1 items-center">
                            <select value={lCode} onChange={handleLargeChange} className="flex-1 h-9 px-1 border border-gray-300 rounded text-sm bg-white focus:ring-1 focus:ring-blue-500 truncate min-w-0">
                                <option value="">대분류</option>
                                {lCats.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                            </select>
                            <select value={mCode} onChange={handleMediumChange} className="flex-1 h-9 px-1 border border-gray-300 rounded text-sm bg-white focus:ring-1 focus:ring-blue-500 truncate min-w-0">
                                <option value="">중분류</option>
                                {mCats.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                            </select>
                            <select value={sCode} onChange={(e) => setSCode(e.target.value)} className="flex-1 h-9 px-1 border border-gray-300 rounded text-sm bg-white focus:ring-1 focus:ring-blue-500 truncate min-w-0">
                                <option value="">소분류</option>
                                {sCats.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                            </select>
                            <label className="flex-shrink-0 flex items-center gap-1 cursor-pointer whitespace-nowrap px-1 ml-1 bg-gray-50 rounded border border-gray-200 h-9">
                                <input type="checkbox" checked={isCategoryFixed} onChange={(e) => setIsCategoryFixed(e.target.checked)} className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500" />
                                <span className="text-[11px] font-bold text-gray-700">고정</span>
                            </label>
                        </div>
                    </div>

                    {/* 5. Customer & Stock */}
                    <div className="flex gap-1 pt-1">
                        <div className="flex-grow flex flex-col gap-0.5">
                            <label className="text-xs font-bold text-gray-700">거래처</label>
                            <select
                                value={comcode}
                                onChange={(e) => setComcode(e.target.value)}
                                className="w-full h-9 px-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-sm bg-white"
                            >
                                <option value="">거래처를 선택하세요</option>
                                {sortedCustomers.map(c => (
                                    <option key={c.comcode} value={c.comcode}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="w-1/3 flex flex-col gap-0.5">
                            <div className="flex justify-between items-center">
                                <label className="text-xs font-bold text-gray-700">재고수량</label>
                                {isBundle && <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-1.5 rounded border border-purple-200 leading-none">묶음</span>}
                            </div>
                            <input
                                type="text"
                                value={stockQty.toLocaleString()}
                                readOnly
                                className="w-full h-9 px-2 border border-gray-300 rounded-md bg-gray-100 text-right text-sm font-bold text-gray-700"
                            />
                        </div>
                    </div>

                    {/* 6. Toggles */}
                    <div className="grid grid-cols-3 gap-1 py-1">
                        {saleInfo && (
                            <div className="col-span-3 mb-1">
                                <button 
                                    onClick={() => setStopSaleOnSave(!stopSaleOnSave)}
                                    className={`w-full flex items-center justify-center gap-2 px-2 py-2 rounded-lg border transition-all text-sm font-bold ${stopSaleOnSave ? 'bg-red-500 text-white border-red-500 shadow-md' : 'bg-white border-gray-300 text-gray-700'}`}
                                >
                                    <div className={`w-4 h-4 border rounded flex items-center justify-center ${stopSaleOnSave ? 'bg-white border-white' : 'bg-white border-gray-400'}`}>
                                        {stopSaleOnSave && <CheckCircleIcon className="w-3 h-3 text-red-500" />}
                                    </div>
                                    <span>이번 저장 시 행사 중지</span>
                                </button>
                            </div>
                        )}
                        <CustomToggleButton label="사용유무" checked={isUse} onChange={setIsUse} />
                        <CustomToggleButton label="포인트적립" checked={isPoint} onChange={setIsPoint} />
                        <CustomToggleButton label="재고관리" checked={isStockManaged} onChange={setIsStockManaged} />
                    </div>

                    {/* 7. Action Buttons (Ref attached here for keyboard avoidance) */}
                    <div ref={buttonsContainerRef} className="grid grid-cols-[1fr_4fr] gap-2 pt-1 pb-1">
                        <button 
                            onClick={handleReset} 
                            className="h-12 bg-orange-100 border border-orange-200 text-orange-600 rounded-md flex items-center justify-center hover:bg-orange-200 active:scale-95 transition-transform"
                        >
                            <UndoIcon className="w-6 h-6" />
                        </button>
                        <button 
                            onClick={handleSave} 
                            disabled={isSaving}
                            className="h-12 bg-blue-600 text-white rounded-md font-bold text-lg flex items-center justify-center gap-2 hover:bg-blue-700 shadow-md active:scale-95 disabled:bg-gray-400 transition-transform"
                        >
                            {isSaving ? <SpinnerIcon className="w-5 h-5" /> : <CheckCircleIcon className="w-5 h-5" />}
                            저장
                        </button>
                    </div>

                    {/* 8. Bottom Info Panels */}
                    <div className="grid grid-cols-2 gap-1 mt-1 mb-0">
                        {/* Discount Info Panel */}
                        <div className="bg-gray-50 border border-gray-200 rounded flex flex-col min-h-[5rem]">
                            <div className="bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600 border-b border-gray-200 text-center flex-shrink-0">할인정보</div>
                            <div className="p-1 flex-1 flex flex-col items-center justify-center">
                                {saleInfo ? (
                                    <>
                                        <div className="flex-1 flex items-center justify-center w-full">
                                            <p className="text-sm font-bold text-blue-700 text-center leading-tight line-clamp-2">{saleInfo.name}</p>
                                        </div>
                                        <div className="flex-shrink-0 text-center w-full">
                                            <p className="text-base font-bold text-red-600 leading-none my-0.5">
                                                {Number(saleInfo.cost).toLocaleString()} / {Number(saleInfo.price).toLocaleString()}
                                            </p>
                                            <p className="text-xs text-gray-500 leading-tight mt-1">
                                                {saleInfo.start} ~ {saleInfo.end}
                                            </p>
                                        </div>
                                    </>
                                ) : (
                                    <p className="text-sm text-gray-400">할인 정보 없음</p>
                                )}
                            </div>
                        </div>

                        {/* BOM Info Panel */}
                        <div className="bg-gray-50 border border-gray-200 rounded flex flex-col min-h-[5rem]">
                            <div className="bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600 border-b border-gray-200 text-center flex-shrink-0">BOM 정보</div>
                            <div className="p-1 flex-1">
                                {bomList.length > 0 ? (
                                    <div className="space-y-1">
                                        {bomList.map((item, idx) => (
                                            <div key={idx} className="bg-white border border-gray-100 rounded p-1.5 shadow-sm flex flex-col gap-0.5">
                                                <p className="text-[10px] font-mono text-gray-400 leading-none">{item.바코드}</p>
                                                <p className="text-xs font-bold text-gray-800 leading-tight">{item.상품명}</p>
                                                <p className="text-[10px] text-gray-500">{item.규격}</p>
                                                <div className="flex justify-between items-center mt-0.5 border-t border-gray-50 pt-0.5">
                                                    <p className="text-xs text-gray-600 font-medium">{Number(item.매입가).toLocaleString()}원</p>
                                                    <p className="text-xs font-bold text-blue-600">x{item.수량}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="h-full flex items-center justify-center">
                                        <p className="text-sm text-gray-400">일반 상품</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </ActionModal>

            <ProductSelectionModal
                isOpen={isSelectionModalOpen}
                onClose={() => setIsSelectionModalOpen(false)}
                products={searchResults}
                onSelect={handleProductSelect}
            />
        </>
    );
}