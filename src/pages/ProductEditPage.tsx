
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ActionModal from '../components/ActionModal';
import { useAlert, useDataState, useScanner } from '../context/AppContext';
import { executeUserQuery, searchProductsForEdit } from '../services/sqlService';
import { extractParamsForQuery } from '../hooks/useProductSearch';
import { BarcodeScannerIcon, SearchIcon, SpinnerIcon, CheckCircleIcon, UndoIcon, CheckSquareIcon } from '../components/Icons';
import { Customer } from '../types';
import SearchDropdown from '../components/SearchDropdown';

interface ProductEditPageProps {
    isOpen: boolean;
    onClose: () => void;
    initialBarcode?: string;
}

export default function ProductEditPage({ isOpen, onClose, initialBarcode }: ProductEditPageProps) {
    const { userQueries, customers } = useDataState();
    const { showAlert, showToast } = useAlert();
    const { openScanner } = useScanner();

    // --- State Variables ---
    const [barcode, setBarcode] = useState('');
    const [productName, setProductName] = useState('');
    const [spec, setSpec] = useState('');
    const [costPrice, setCostPrice] = useState<number | string>(0);
    const [sellingPrice, setSellingPrice] = useState<number | string>(0);
    
    // 분류 (현재는 텍스트 입력, 추후 드롭다운으로 확장 가능)
    const [lCode, setLCode] = useState(''); // 대분류
    const [mCode, setMCode] = useState(''); // 중분류
    const [sCode, setSCode] = useState(''); // 소분류
    
    const [comcode, setComcode] = useState('');
    const [stockQty, setStockQty] = useState<number>(0); // 재고수량

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

    // Helpers for UI
    const [customerSearch, setCustomerSearch] = useState('');
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

    // Sync comcode with search input
    useEffect(() => {
        if (comcode && customers.length > 0) {
            const cust = customers.find(c => c.comcode === comcode);
            if (cust) setCustomerSearch(cust.name);
        } else if (!comcode) {
            setCustomerSearch('');
        }
    }, [comcode, customers]);

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
            setCustomerSearch('');
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
        } else {
            // 저장 후 부분 초기화 (바코드/상품명/가격만 리셋)
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
                setLCode(p.대분류코드 || '');
                setMCode(p.중분류코드 || '');
                setSCode(p.소분류코드 || '');
                setStockQty(p.재고수량 || 0);
                
                setIsUse(p.사용유무 === '1' || p.사용유무 === 'Y');
                setIsTaxable(p.과세여부 === '1' || p.과세여부 === 'Y');
                setIsPoint(p.고객점수가산 === '1' || p.고객점수가산 === 'Y');
                setIsStockManaged(p.재고관리여부 === '1' || p.재고관리여부 === 'Y');
                
                // 정보 패널 설정
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
    }, [resetForm, showToast]);

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

    const handleCustomerSelect = (customer: Customer) => {
        setComcode(customer.comcode);
        setCustomerSearch(customer.name);
        setShowCustomerDropdown(false);
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

            // Base values mapping
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
            resetForm(true); // 항상 초기화 (이미지 UI에는 초기화 옵션이 없으므로)
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

    const filteredCustomers = customers.filter(c => 
        c.name.toLowerCase().includes(customerSearch.toLowerCase()) || 
        c.comcode.includes(customerSearch)
    );

    // --- Custom UI Components for Image Matching ---

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
            title={isEditMode ? "상품 수정" : "상품 등록/수정"} // 이미지 헤더에 맞춤
            disableBodyScroll={false}
            // 이미지와 달리 Footer를 Body 내부에 통합하여 커스텀 레이아웃 구현
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
                            placeholder="바코드 또는 상품명 (길게 눌러 초기화)" // 이미지 플레이스홀더
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

                {/* 4. Row: Classification (Category) */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-bold text-gray-700">상품 분류</label>
                    <div className="flex gap-1">
                        <input type="text" value={lCode} onChange={(e) => setLCode(e.target.value)} className="flex-1 h-9 px-2 border border-gray-300 rounded text-sm text-center" placeholder="대분류" />
                        <input type="text" value={mCode} onChange={(e) => setMCode(e.target.value)} className="flex-1 h-9 px-2 border border-gray-300 rounded text-sm text-center" placeholder="중분류" />
                        <input type="text" value={sCode} onChange={(e) => setSCode(e.target.value)} className="flex-1 h-9 px-2 border border-gray-300 rounded text-sm text-center" placeholder="소분류" />
                        <button 
                            onClick={() => { setLCode(''); setMCode(''); setSCode(''); }}
                            className="w-16 h-9 bg-white border border-gray-300 rounded text-xs font-bold text-gray-600 flex items-center justify-center gap-1 hover:bg-gray-50"
                        >
                            <CheckSquareIcon className="w-3 h-3 text-blue-500" />
                            초기화
                        </button>
                    </div>
                </div>

                {/* 5. Row: Customer & Stock */}
                <div className="flex gap-2">
                    <div className="flex-grow relative flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-700">거래처</label>
                        <input
                            type="text"
                            value={customerSearch}
                            onChange={(e) => {
                                setCustomerSearch(e.target.value);
                                setShowCustomerDropdown(true);
                            }}
                            onFocus={() => setShowCustomerDropdown(true)}
                            onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                            className="w-full h-10 px-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-sm bg-white"
                            placeholder="거래처를 선택하세요"
                        />
                        <div className="absolute right-2 bottom-3 pointer-events-none text-gray-400">▼</div>
                        <SearchDropdown<Customer>
                            items={filteredCustomers}
                            renderItem={(c) => (
                                <div onClick={() => handleCustomerSelect(c)} className="p-3 hover:bg-gray-100 cursor-pointer border-b last:border-none">
                                    <div className="font-bold text-gray-800">{c.name}</div>
                                    <div className="text-xs text-gray-500">{c.comcode}</div>
                                </div>
                            )}
                            show={showCustomerDropdown && filteredCustomers.length > 0}
                        />
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
