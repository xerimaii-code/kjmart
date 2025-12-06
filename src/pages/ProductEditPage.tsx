
import React, { useState, useEffect, useRef, useCallback } from 'react';
import ActionModal from '../components/ActionModal';
import { useAlert, useDataState, useScanner } from '../context/AppContext';
import { executeUserQuery, searchProductsForEdit } from '../services/sqlService';
import { extractParamsForQuery } from '../hooks/useProductSearch';
import ToggleSwitch from '../components/ToggleSwitch';
import { BarcodeScannerIcon, SearchIcon, SpinnerIcon, CheckCircleIcon } from '../components/Icons';
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
    const [comcode, setComcode] = useState('');
    const [lCode, setLCode] = useState('');
    const [mCode, setMCode] = useState('');
    const [sCode, setSCode] = useState('');
    
    // Flags
    const [isUse, setIsUse] = useState(true);
    const [isTaxable, setIsTaxable] = useState(true);
    const [isPoint, setIsPoint] = useState(true);
    const [isStockManaged, setIsStockManaged] = useState(true);

    const [isEditMode, setIsEditMode] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [resetAfterSave, setResetAfterSave] = useState(true);
    
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
            setIsUse(true);
            setIsTaxable(true);
            setIsPoint(true);
            setIsStockManaged(true);
            setIsEditMode(false);
        } else {
            // Partial reset: keep category/customer for faster entry
            setBarcode('');
            setProductName('');
            setCostPrice(0);
            setSellingPrice(0);
            setIsEditMode(false);
        }
    }, []);

    const loadProduct = useCallback(async (code: string) => {
        if (!code) return;
        try {
            const results = await searchProductsForEdit(code);
            if (results && results.length > 0) {
                // Assuming exact match or user selection logic could be added here.
                // For simplicity, take the first result.
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
                
                setIsUse(p.사용유무 === '1' || p.사용유무 === 'Y');
                setIsTaxable(p.과세여부 === '1' || p.과세여부 === 'Y');
                setIsPoint(p.고객점수가산 === '1' || p.고객점수가산 === 'Y');
                setIsStockManaged(p.재고관리여부 === '1' || p.재고관리여부 === 'Y');
                
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
        
        // [수정] 필수값 체크: 분류 및 거래처
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

            // Base values
            const pBarcode = barcode;
            const pProductName = productName;
            const pSpec = spec || '';
            const pMoney0vat = String(isNaN(safeCost) ? 0 : safeCost);
            const pMoney1 = String(isNaN(safeSelling) ? 0 : safeSelling);
            const pComcode = comcode || '';
            const pIsUse = isUse ? '1' : '0';
            const pIsVat = isTaxable ? '1' : '0';
            const pIsPoint = isPoint ? '1' : '0';
            const pIsStock = isStockManaged ? '1' : '0';
            const pGubun1 = lCode || '';
            const pGubun2 = mCode || '';
            const pGubun3 = sCode || '';
            
            // Generate current date strings for SQL params
            const now = new Date();
            const pCurrentDate = now.toISOString().slice(0, 10); // YYYY-MM-DD
            const pNow = now.toISOString();

            // Comprehensive Context Params mapping
            const contextParams = {
                // Section 1: Explicit inputs from Prompt & Specific SQL Requirements
                money0vat: pMoney0vat, // Required by SQL: @money0vat
                money1: pMoney1,       // Required by SQL: @money1
                Descr: pProductName,   // Required by SQL: @Descr (case sensitive)
                descr: pProductName,   // Fallback: @descr
                isvat: pIsVat,         // Required by SQL: @isvat
                gubun1: pGubun1,       // Required by SQL: @gubun1
                gubun2: pGubun2,       // Required by SQL: @gubun2
                gubun3: pGubun3,       // Required by SQL: @gubun3
                barcode: pBarcode,     // Required by SQL: @barcode
                spec: pSpec,           // Required by SQL: @spec
                comcode: pComcode,     // Required by SQL: @comcode
                isjago: pIsStock,      // Required by SQL: @isjago
                ispoint: pIsPoint,     // Required by SQL: @ispoint
                isuse: pIsUse,         // Required by SQL: @isuse
                remark: '모바일',       // Default remark
                
                // --- NEW: Automatically injected date variables ---
                CurrentDate: pCurrentDate, // Required by SQL: @CurrentDate
                Date: pCurrentDate,        // Alias
                Now: pNow,                 // Alias
                
                // Section 2: Helper/Internal variables provided for flexibility
                kw: searchInput, 
                
                // Lowercase aliases
                stock_yn: pIsStock,
                
                // Default flags (Available as variables in case user edits the query to use them)
                iscashback: '1', 
                pangacho: '0', 
                isinclude: '1', 
                islink: '0', 
                weightoff: '1', 
                autobalju: '0',
                isprt: '0',
                
                // Korean aliases
                바코드: pBarcode,
                상품명: pProductName,
                규격: pSpec,
                매입가: pMoney0vat,
                판매가: pMoney1,
                거래처코드: pComcode,
                사용유무: pIsUse,
                사용여부: pIsUse,
                과세유무: pIsVat,
                과세여부: pIsVat,
                고객점수가산: pIsPoint,
                포인트유무: pIsPoint,
                재고관리유무: pIsStock,
                재고관리여부: pIsStock,
                대분류: pGubun1,
                중분류: pGubun2,
                소분류: pGubun3,
                현재날짜: pCurrentDate
            };

            const userQueryName = isEditMode ? '상품수정' : '상품등록';
            const userDefinedQuery = userQueries.find(q => q.name === userQueryName);

            if (!userDefinedQuery) {
                setIsSaving(false);
                showAlert(`'${userQueryName}' 쿼리가 설정되지 않았습니다.\n[설정 > SQL Runner]에서 '${userQueryName}' 쿼리를 추가해주세요.`);
                return;
            }

            // Dynamically match params to what is actually used in the SQL query
            const dynamicParams = extractParamsForQuery(userDefinedQuery.query, contextParams);

            await executeUserQuery(userQueryName, dynamicParams, userDefinedQuery.query);
            showToast(isEditMode ? "상품 정보가 수정되었습니다." : "신규 상품이 등록되었습니다.", "success");
            
            setSearchInput('');

            if(resetAfterSave) { 
                resetForm(false); 
            } else { 
                resetForm(true); 
            }
            
            setTimeout(() => {
                searchInputRef.current?.focus();
            }, 100);

        } catch (e: any) {
            showAlert(`저장 오류: ${e.message}`);
        } finally { setIsSaving(false); }
    };

    if (!isOpen) return null;

    const filteredCustomers = customers.filter(c => 
        c.name.toLowerCase().includes(customerSearch.toLowerCase()) || 
        c.comcode.includes(customerSearch)
    );

    return (
        <ActionModal
            isOpen={isOpen}
            onClose={onClose}
            title={isEditMode ? "상품 수정" : "상품 등록"}
            disableBodyScroll={false}
            footer={
                <div className="grid grid-cols-2 gap-3">
                    <button onClick={onClose} className="h-12 rounded-xl bg-gray-200 text-gray-700 font-bold hover:bg-gray-300">취소</button>
                    <button 
                        onClick={handleSave} 
                        disabled={isSaving}
                        className="h-12 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 flex items-center justify-center gap-2 disabled:bg-gray-400"
                    >
                        {isSaving && <SpinnerIcon className="w-5 h-5"/>}
                        {isEditMode ? '수정 저장' : '신규 등록'}
                    </button>
                </div>
            }
        >
            <div className="p-4 space-y-4 bg-gray-50 min-h-full">
                {/* Search Bar */}
                <form onSubmit={handleSearch} className="flex gap-2">
                    <div className="relative flex-grow">
                        <input
                            ref={searchInputRef}
                            type="text"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="바코드 스캔 또는 입력"
                            className="w-full h-11 pl-4 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                        <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-600">
                            <SearchIcon className="w-5 h-5" />
                        </button>
                    </div>
                    <button type="button" onClick={handleScan} className="w-11 h-11 bg-blue-600 text-white rounded-lg flex items-center justify-center">
                        <BarcodeScannerIcon className="w-6 h-6" />
                    </button>
                </form>

                {/* Form Fields */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 space-y-3">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">바코드</label>
                        <input
                            type="text"
                            value={barcode}
                            onChange={(e) => setBarcode(e.target.value)}
                            className="w-full p-2.5 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-blue-500"
                            placeholder="상품 바코드"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">상품명</label>
                        <input
                            type="text"
                            value={productName}
                            onChange={(e) => setProductName(e.target.value)}
                            className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            placeholder="상품명 입력"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">규격</label>
                        <input
                            type="text"
                            value={spec}
                            onChange={(e) => setSpec(e.target.value)}
                            className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            placeholder="예: 1.5L"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">매입가</label>
                            <input
                                type="text" inputMode="numeric"
                                value={costPrice}
                                onChange={(e) => setCostPrice(e.target.value)}
                                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-right font-mono"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">판매가</label>
                            <input
                                type="text" inputMode="numeric"
                                value={sellingPrice}
                                onChange={(e) => setSellingPrice(e.target.value)}
                                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-right font-bold text-blue-600 font-mono"
                            />
                        </div>
                    </div>
                </div>

                {/* Additional Info */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 space-y-3">
                    <div className="relative">
                        <label className="block text-sm font-bold text-gray-700 mb-1">거래처</label>
                        <input
                            type="text"
                            value={customerSearch}
                            onChange={(e) => {
                                setCustomerSearch(e.target.value);
                                setShowCustomerDropdown(true);
                            }}
                            onFocus={() => setShowCustomerDropdown(true)}
                            onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                            className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            placeholder="거래처 검색"
                        />
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
                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1">대분류</label>
                            <input type="text" value={lCode} onChange={(e) => setLCode(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg" placeholder="코드"/>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1">중분류</label>
                            <input type="text" value={mCode} onChange={(e) => setMCode(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg" placeholder="코드"/>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1">소분류</label>
                            <input type="text" value={sCode} onChange={(e) => setSCode(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg" placeholder="코드"/>
                        </div>
                    </div>
                </div>

                {/* Flags */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                    <div className="grid grid-cols-2 gap-4">
                        <ToggleSwitch id="isUse" checked={isUse} onChange={setIsUse} label="사용 여부" color="blue" />
                        <ToggleSwitch id="isTaxable" checked={isTaxable} onChange={setIsTaxable} label="과세 상품" color="blue" />
                        <ToggleSwitch id="isPoint" checked={isPoint} onChange={setIsPoint} label="포인트 적립" color="blue" />
                        <ToggleSwitch id="isStockManaged" checked={isStockManaged} onChange={setIsStockManaged} label="재고 관리" color="blue" />
                    </div>
                </div>

                {/* Options */}
                <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-2" onClick={() => setResetAfterSave(!resetAfterSave)}>
                        <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${resetAfterSave ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-400'}`}>
                            {resetAfterSave && <CheckCircleIcon className="w-4 h-4 text-white" />}
                        </div>
                        <span className="text-sm font-medium text-gray-700">저장 후 입력 초기화</span>
                    </div>
                </div>
            </div>
        </ActionModal>
    );
}
