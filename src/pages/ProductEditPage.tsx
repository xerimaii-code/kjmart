
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useScanner, useAlert, useDataState } from '../context/AppContext';
import { SearchIcon, BarcodeScannerIcon, SpinnerIcon, CheckSquareIcon, UndoIcon } from '../components/Icons';
import { executeUserQuery, searchProductsForEdit } from '../services/sqlService';
import ProductSelectionModal from '../components/ProductSelectionModal';
import ActionModal from '../components/ActionModal';
import { useAdjustForKeyboard } from '../hooks/useAdjustForKeyboard';

interface ProductEditPageProps {
    isOpen: boolean;
    onClose: () => void;
    initialBarcode?: string;
}

// --- Helper: Extract parameters needed by the SQL query ---
const extractParamsForQuery = (queryText: string, sourceParams: Record<string, any>) => {
    // Find all variables in the query (e.g., @kw, @Barcode)
    // Matches @variable but excludes @@systemVariables
    const matches = Array.from(queryText.matchAll(/@([a-zA-Z0-9_가-힣]+)/g), m => m[1]);
    const uniqueVars = [...new Set(matches)];
    
    // Create a case-insensitive lookup map from sourceParams
    const lookup: Record<string, any> = {};
    Object.keys(sourceParams).forEach(k => {
        lookup[k.toLowerCase()] = sourceParams[k];
    });

    const finalParams: Record<string, any> = {};
    uniqueVars.forEach(v => {
        const lowerV = v.toLowerCase();
        if (lookup[lowerV] !== undefined) {
            // Use the exact variable name from the SQL query as the key
            finalParams[v] = lookup[lowerV];
        }
    });
    
    return finalParams;
};

// --- EAN-13 Checksum Utils ---
const calculateEan13Checksum = (barcode12: string): number => {
    if (barcode12.length !== 12 || !/^\d+$/.test(barcode12)) {
        throw new Error("Input must be 12 digits.");
    }
    let sumEven = 0;
    let sumOdd = 0;
    for (let i = 0; i < 12; i++) {
        const digit = parseInt(barcode12[i], 10);
        if ((i + 1) % 2 === 0) { // even position (2nd, 4th, etc.)
            sumEven += digit;
        } else { // odd position (1st, 3rd, etc.)
            sumOdd += digit;
        }
    }
    const totalSum = sumOdd + (sumEven * 3);
    const remainder = totalSum % 10;
    return remainder === 0 ? 0 : 10 - remainder;
};

// Helper for formatting integers (Selling Price)
const formatInteger = (value: number | string): string => {
    if (value === '' || value === undefined || value === null) return '';
    const num = String(value).replace(/[^0-9]/g, '');
    return num ? Number(num).toLocaleString() : '';
};

// Helper for formatting decimals (Cost Price) - Allows 2 decimal places
const formatDecimal = (value: number | string): string => {
    if (value === '' || value === undefined || value === null) return '';
    const str = String(value);
    const parts = str.split('.');
    
    // Format integer part
    const intPart = parts[0].replace(/[^0-9]/g, '');
    const formattedInt = intPart ? Number(intPart).toLocaleString() : '';
    
    // Handle decimal part
    if (parts.length > 1) {
        const decPart = parts[1].replace(/[^0-9]/g, '').slice(0, 2); // Limit to 2 decimals
        return `${formattedInt || '0'}.${decPart}`;
    }
    
    // Return only integer part if no dot, but handle empty string correctly
    return formattedInt;
};

const ProductEditPage: React.FC<ProductEditPageProps> = ({ isOpen, onClose, initialBarcode }) => {
    const { openScanner } = useScanner();
    const { showAlert, showToast } = useAlert();
    const { userQueries } = useDataState();

    const [searchInput, setSearchInput] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    
    // Default to true (checked) as requested: "초기화체크박스 기본값 1"
    const [resetAfterSave, setResetAfterSave] = useState(true);
    
    const [selectionModalOpen, setSelectionModalOpen] = useState(false);
    const [productsToSelect, setProductsToSelect] = useState<any[]>([]);

    // Product Fields
    const [barcode, setBarcode] = useState('');
    const [productName, setProductName] = useState('');
    const [spec, setSpec] = useState('');
    const [costPrice, setCostPrice] = useState<number | string>('');
    const [sellingPrice, setSellingPrice] = useState<number | string>('');
    const [comcode, setComcode] = useState('');
    
    // Checkbox States
    const [isTaxable, setIsTaxable] = useState(true);
    const [isUse, setIsUse] = useState(true);
    const [isPoint, setIsPoint] = useState(true);
    const [isStockManaged, setIsStockManaged] = useState(true);

    const [stockQty, setStockQty] = useState<number | string>('');
    const [bomStatus, setBomStatus] = useState<string>('');
    
    // Category Codes
    const [lCode, setLCode] = useState('');
    const [mCode, setMCode] = useState('');
    const [sCode, setSCode] = useState('');

    const [supplierOptions, setSupplierOptions] = useState<any[]>([]);
    const [lCodeOptions, setLCodeOptions] = useState<any[]>([]);
    const [mCodeOptions, setMCodeOptions] = useState<any[]>([]);
    const [sCodeOptions, setSCodeOptions] = useState<any[]>([]);

    const [saleInfo, setSaleInfo] = useState<any | null>(null);
    const [bomComponents, setBomComponents] = useState<any[]>([]);
    
    // Ref to prevent useEffect conflicts during programmatic population
    const isPopulating = useRef(false);
    const productNameRef = useRef<HTMLInputElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const modalContainerRef = useRef<HTMLDivElement>(null);
    
    // Ref for long press timer (now used for search input)
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useAdjustForKeyboard(modalContainerRef, isOpen);

    const margin = useMemo(() => {
        const cost = Number(String(costPrice).replace(/,/g, '')) || 0;
        const price = Number(String(sellingPrice).replace(/,/g, '')) || 0;
        if (price === 0) return '0.00';
        return ((price - cost) / price * 100).toFixed(2);
    }, [costPrice, sellingPrice]);
    
    const resetForm = (partial: boolean = false) => {
        isPopulating.current = true;
        setBarcode(''); setProductName(''); setSpec('');
        setCostPrice(''); setSellingPrice(''); 
        setIsTaxable(true); setIsUse(true); setIsPoint(true); setIsStockManaged(true);
        setSaleInfo(null); setStockQty(''); setBomStatus('');
        setBomComponents([]); setIsEditMode(false);
        if (!partial) {
            setComcode(''); setLCode(''); setMCode(''); setSCode('');
            setMCodeOptions([]); setSCodeOptions([]);
        }
        setTimeout(() => { isPopulating.current = false; }, 50);
    };
    
    // Reset form when modal is closed
    useEffect(() => {
        if (!isOpen) {
            // Delay reset to allow closing animation to complete smoothly.
            const timer = setTimeout(() => {
                resetForm(false); // Full reset
                setSearchInput(''); // Also reset the search input
            }, 300); // Animation duration is around 300ms

            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    // Fetch Suppliers and Categories when modal opens
    useEffect(() => {
        if (isOpen) {
            executeUserQuery('getSuppliers')
                .then(setSupplierOptions)
                .catch(e => console.error("Failed to fetch suppliers:", e));
            
            executeUserQuery('getLargeCategories')
                .then(data => {
                    const trimmedData = data.map((item: any) => ({ ...item, code: String(item.code).trim() }));
                    setLCodeOptions(trimmedData);
                })
                .catch(e => console.error("Failed to fetch large categories:", e));
        }
    }, [isOpen]);

    // Handle initial barcode when modal opens
    useEffect(() => {
        if (isOpen && initialBarcode) {
            setSearchInput(initialBarcode);
            // We use a small timeout to ensure the query cache/context is ready and the modal is rendered
            const timer = setTimeout(() => {
                handleSearch(initialBarcode);
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [isOpen, initialBarcode]);


    // Fetch Medium Categories when Large Code changes
    useEffect(() => {
        if (isPopulating.current) return;
        if (lCode) {
            executeUserQuery('getMediumCategories', { lCode })
                .then(data => {
                    const trimmedData = data.map((item: any) => ({ ...item, code: String(item.code).trim() }));
                    setMCodeOptions(trimmedData);
                })
                .catch(e => console.error("Failed to fetch medium categories:", e));
        } else { setMCodeOptions([]); setMCode(''); }
    }, [lCode]);

    // Fetch Small Categories when Medium Code changes
    useEffect(() => {
        if (isPopulating.current) return;
        if (lCode && mCode) {
            executeUserQuery('getSmallCategories', { lCode, mCode })
                .then(data => {
                    const trimmedData = data.map((item: any) => ({ ...item, code: String(item.code).trim() }));
                    setSCodeOptions(trimmedData);
                })
                .catch(e => console.error("Failed to fetch small categories:", e));
        } else { setSCodeOptions([]); setSCode(''); }
    }, [lCode, mCode]);

    const populateForm = async (rawProduct: any) => {
        isPopulating.current = true;
        try {
            const pBarcode = rawProduct['바코드'] || rawProduct.barcode;
            setBarcode(pBarcode);
            setSearchInput(pBarcode);

            setProductName(rawProduct['상품명'] || rawProduct.descr);
            // Check all common casing variants for Spec
            setSpec(rawProduct['규격'] || rawProduct.spec || rawProduct.Spec || rawProduct.SPEC || '');
            
            const pVat = rawProduct['과세여부'] !== undefined ? rawProduct['과세여부'] : rawProduct.isvat;
            setIsTaxable(![0, '0', false, 'N', 'n', '2'].includes(pVat));
            setCostPrice(rawProduct['매입가'] !== undefined ? rawProduct['매입가'] : rawProduct.money0vat || '');
            setSellingPrice(rawProduct['판매가'] !== undefined ? rawProduct['판매가'] : rawProduct.money1 || '');
            setComcode((rawProduct['거래처코드'] || rawProduct.comcode || '').trim());
            
            const stockVal = rawProduct['재고수량'] !== undefined ? rawProduct['재고수량'] : rawProduct.curjago;
            setStockQty(stockVal !== null && stockVal !== undefined ? Number(stockVal).toLocaleString() : '');
            
            let pBomStatus = rawProduct['BOM여부'] || rawProduct.bomStatus;
            if (rawProduct['ispack'] === '1' || rawProduct['ispack'] === 1) pBomStatus = '묶음';
            else if (rawProduct['ispack'] === '0' || rawProduct['ispack'] === 0) pBomStatus = '일반';
            setBomStatus(pBomStatus || '');
            
            const pIsUse = rawProduct['사용유무'] !== undefined ? rawProduct['사용유무'] : rawProduct.isuse;
            setIsUse(String(pIsUse) === '1' || pIsUse === true || pIsUse === '사용' || pIsUse === 'Y');

            // Default to true if fields are missing in rawProduct (best effort)
            const pIsPoint = rawProduct['고객점수가산'] !== undefined ? rawProduct['고객점수가산'] : (rawProduct.ispoint !== undefined ? rawProduct.ispoint : '1');
            setIsPoint(String(pIsPoint) === '1' || pIsPoint === true);

            // Logic for Stock Management: Priority: 재고관리여부 -> 재고관리유무 -> isjago -> stock_yn -> Default '1'
            const pIsStock = rawProduct['재고관리여부'] !== undefined 
                ? rawProduct['재고관리여부'] 
                : (rawProduct['재고관리유무'] !== undefined 
                    ? rawProduct['재고관리유무'] 
                    : (rawProduct.isjago !== undefined 
                        ? rawProduct.isjago 
                        : (rawProduct.stock_yn !== undefined ? rawProduct.stock_yn : '1')
                      )
                  );
            setIsStockManaged(String(pIsStock) === '1' || pIsStock === true || pIsStock === 'Y');

            const pLCode = String(rawProduct['대분류코드'] || rawProduct.gubun1 || '').trim();
            const pMCode = String(rawProduct['중분류코드'] || rawProduct.gubun2 || '').trim();
            const pSCode = String(rawProduct['소분류코드'] || rawProduct.gubun3 || '').trim();
            const pClcode = rawProduct['분류코드'] || rawProduct.clcode;
            
            let targetL = '', targetM = '', targetS = '';
            if (pLCode) {
                targetL = pLCode; targetM = pMCode; targetS = pSCode;
            } else if (pClcode && typeof pClcode === 'string') {
                const parts = pClcode.split('-');
                if (parts.length >= 1) targetL = parts[0].trim();
                if (parts.length >= 2) targetM = parts[1].trim();
                if (parts.length >= 3) targetS = parts[2].trim();
            }
            setLCode(targetL);

            if (targetL) {
                const mResult = await executeUserQuery('getMediumCategories', { lCode: targetL });
                const mOptions = mResult.map((item: any) => ({ ...item, code: String(item.code).trim() }));
                setMCodeOptions(mOptions);
                setMCode(targetM);
                if (targetM) {
                    const sResult = await executeUserQuery('getSmallCategories', { lCode: targetL, mCode: targetM });
                    const sOptions = sResult.map((item: any) => ({ ...item, code: String(item.code).trim() }));
                    setSCodeOptions(sOptions);
                    setSCode(targetS);
                } else { setSCodeOptions([]); setSCode(''); }
            } else { setMCodeOptions([]); setMCode(''); setSCodeOptions([]); setSCode(''); }
            
            setSaleInfo(rawProduct['행사유무'] === 'Y' ? rawProduct : null);

            if (pBomStatus === '묶음') {
                const components = await executeUserQuery('getBomComponents', { barcode: pBarcode });
                setBomComponents(components);
            } else { setBomComponents([]); }
            setIsEditMode(true);
            setSelectionModalOpen(false);

            // Note: Auto-focus removed as requested for better UX on mobile when viewing details
            // The input will not be focused automatically after loading an existing product.

        } finally {
            setTimeout(() => { isPopulating.current = false; }, 100);
        }
    };

    const handleSearch = async (term?: string) => {
        const query = (term || searchInput).trim();
        if (!query) return;
        setIsSearching(true);
        try {
            // 사용자 정의 쿼리 '상품조회' 확인
            const userSearchQuery = userQueries.find(q => q.name === '상품조회');
            let results;

            if (userSearchQuery) {
                // Dynamically match params to what is actually used in the SQL query
                const contextParams = {
                    // Standard aliases
                    kw: query, keyword: query, search: query, 
                    barcode: query, name: query, spec: query,
                    
                    상품명: query, 바코드: query, 검색어: query, 규격: query,

                    // Provide current form state as potential filter params
                    comcode: comcode, 거래처코드: comcode,
                    gubun1: lCode, 대분류: lCode,
                    gubun2: mCode, 중분류: mCode,
                    gubun3: sCode, 소분류: sCode,
                    
                    isuse: isUse ? '1' : '0', 사용유무: isUse ? '1' : '0',
                    isvat: isTaxable ? '1' : '0', 과세여부: isTaxable ? '1' : '0',
                    isjago: isStockManaged ? '1' : '0', 재고관리여부: isStockManaged ? '1' : '0',
                    ispoint: isPoint ? '1' : '0', 포인트유무: isPoint ? '1' : '0',
                    
                    // Extra prompt variables
                    Descr: query,
                    descr: query,
                    money0vat: String(costPrice).replace(/,/g, ''),
                    money1: String(sellingPrice).replace(/,/g, ''),
                    remark: '모바일수정'
                };

                const dynamicParams = extractParamsForQuery(userSearchQuery.query, contextParams);
                results = await executeUserQuery('상품조회', dynamicParams, userSearchQuery.query);
            } else {
                // Fallback to default system query if user query not found
                results = await searchProductsForEdit(query);
            }

            if (results.length === 0) {
                 if (/^\d{7,}$/.test(query)) { // Check for 7+ digit number
                    resetForm(!resetAfterSave); // Partial reset if 'resetAfterSave' is unchecked
                    setBarcode(query);
                    setIsEditMode(false); // Set to new product mode
                    showToast('신규 상품 등록 모드입니다.', 'success');
                    
                    // 신규 등록 모드 진입 시 상품명 입력 필드로 포커스 (Keep focus for new items)
                    setTimeout(() => {
                        productNameRef.current?.focus();
                    }, 150);
                } else {
                    showAlert(`'${query}' 상품을 찾을 수 없습니다.`);
                }
            } else if (results.length === 1) {
                await populateForm(results[0]);
            } else {
                const exactMatch = /^\d+$/.test(query) ? results.find(p => (p['바코드'] || p.barcode) === query) : null;
                if (exactMatch) await populateForm(exactMatch);
                else { setProductsToSelect(results); setSelectionModalOpen(true); }
            }
        } catch (e: any) {
            showAlert(`상품 조회 오류: ${e.message || String(e)}`);
        } finally { setIsSearching(false); }
    };
    
    const handleSearchInputBlur = () => {
        const value = searchInput.trim();
        if (!value) return;

        // Condition: The string contains at least one digit, and NO Korean/English letters.
        const isPotentialBarcode = /\d/.test(value) && !/[a-zA-Z가-힣]/.test(value);

        if (isPotentialBarcode) {
            const numericChars = value.replace(/[^0-9]/g, '');
            
            let finalBarcode = numericChars;
            let message = '';

            if (numericChars.length === 12) {
                const checkDigit = calculateEan13Checksum(numericChars);
                finalBarcode = numericChars + checkDigit;
                message = `체크섬(${checkDigit})이 추가되었습니다.`;
            } else if (numericChars.length === 13) {
                const base = numericChars.substring(0, 12);
                const originalCheck = numericChars.substring(12);
                const correctCheck = calculateEan13Checksum(base);
                if (String(correctCheck) !== originalCheck) {
                    finalBarcode = base + correctCheck;
                    message = `체크섬이 '${originalCheck}'에서 '${correctCheck}'(으)로 수정되었습니다.`;
                }
            }

            if (finalBarcode !== searchInput) {
                setSearchInput(finalBarcode);
                if (message) {
                    showToast(message, 'success');
                } else if (value !== numericChars) {
                    showToast('숫자 이외의 문자는 제거되었습니다.', 'error');
                }
            }
            
            if (isEditMode && finalBarcode === barcode) {
                return;
            }

            if (finalBarcode) {
                handleSearch(finalBarcode);
            }
        }
    };

    const handleScan = () => openScanner('modal', (scanned) => { setSearchInput(scanned); handleSearch(scanned); }, false);

    const handleSave = async () => {
        if (!barcode || !productName) {
            showAlert("바코드와 상품명은 필수 항목입니다.");
            return;
        }
        
        // [New] Validation: Check for required fields to prevent clcode/search errors in PC app
        if (!lCode) {
            showAlert("대분류를 선택해주세요.\n(PC 앱 검색을 위해 필수입니다)");
            return;
        }
        if (!comcode) {
            showAlert("거래처를 선택해주세요.\n(PC 앱 검색을 위해 필수입니다)");
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
            // Ensure these keys align EXACTLY with what's expected in the user's SQL query.
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
                
                // --- NEW: Automatically injected date variables ---
                CurrentDate: pCurrentDate, // Required by SQL: @CurrentDate (Must remove DECLARE from SQL)
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
            // This allows user queries to use @Barcode, @BARCODE, or @barcode freely without conflicts
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
    
    const handleSearchInputStart = () => {
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = setTimeout(() => {
            if (navigator.vibrate) navigator.vibrate(50);
            setSearchInput('');
            showToast("검색어가 초기화되었습니다.", "success");
        }, 700);
    };

    const handleSearchInputEnd = () => {
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };

    const handleReset = () => {
        showAlert(
            "입력된 모든 내용을 초기화하시겠습니까?",
            () => {
                resetForm(false);
                setSearchInput('');
                showToast('입력창이 초기화되었습니다.', 'success');
            },
            '초기화',
            'bg-orange-500 hover:bg-orange-600 focus:ring-orange-500'
        );
    };

    return (
        <ActionModal 
            isOpen={isOpen} 
            onClose={onClose} 
            title="상품 등록/수정" 
            disableBodyScroll 
            zIndexClass="z-40"
            containerRef={modalContainerRef}
        >
            <div className="flex flex-col h-full bg-white">
                <div className="flex-shrink-0 bg-white p-1.5 border-b shadow-sm z-10">
                    <div className="flex items-center gap-2">
                        <div className="relative flex-grow">
                            <input 
                                id="product-edit-search-input"
                                ref={searchInputRef} 
                                type="text" 
                                value={searchInput} 
                                onChange={(e) => setSearchInput(e.target.value)} 
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()} 
                                onBlur={handleSearchInputBlur} 
                                onMouseDown={handleSearchInputStart} 
                                onTouchStart={handleSearchInputStart} 
                                onMouseUp={handleSearchInputEnd} 
                                onTouchEnd={handleSearchInputEnd} 
                                onMouseLeave={handleSearchInputEnd}
                                placeholder="바코드 또는 상품명 (길게 눌러 초기화)" 
                                className="w-full h-9 px-3 border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 text-sm" 
                            />
                        </div>
                        <button onClick={() => handleSearch()} disabled={isSearching} className="w-10 h-9 bg-blue-600 text-white font-bold rounded-lg transition hover:bg-blue-700 active:scale-95 shadow-md flex items-center justify-center">
                            {isSearching ? <SpinnerIcon className="w-5 h-5" /> : <SearchIcon className="w-5 h-5" />}
                        </button>
                        <button onClick={handleScan} className="w-12 h-9 bg-gray-700 text-white font-bold rounded-lg transition hover:bg-gray-800 active:scale-95 shadow-md flex items-center justify-center">
                            <BarcodeScannerIcon className="w-6 h-6" />
                        </button>
                    </div>
                </div>

                <div className="flex-grow overflow-y-auto px-1.5 py-1 flex flex-col">
                    <div className="max-w-2xl mx-auto w-full flex-grow flex flex-col gap-1.5">
                        {barcode && (
                            <div>
                                <label className="block text-xs font-bold text-gray-600">바코드</label>
                                <div className="w-full h-9 px-2.5 text-sm rounded-md bg-gray-100 font-mono text-gray-800 border border-gray-300 flex items-center">{barcode}</div>
                            </div>
                        )}
                        
                        {/* Name and Spec in one row */}
                        <div className="flex gap-1.5">
                            <div className="flex-[2] min-w-0">
                                <label htmlFor="productName" className="block text-xs font-bold text-gray-600">상품명</label>
                                <input 
                                    id="productName" 
                                    ref={productNameRef}
                                    type="text" 
                                    value={productName} 
                                    placeholder="상품명" 
                                    onChange={(e) => setProductName(e.target.value)} 
                                    className="w-full h-9 px-2.5 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500" 
                                />
                            </div>
                            <div className="flex-[1] min-w-0">
                                <label className="block text-xs font-bold text-gray-600">규격</label>
                                <input id="spec" type="text" value={spec} placeholder="규격" onChange={(e) => setSpec(e.target.value)} className="w-full h-9 px-2.5 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500" />
                            </div>
                        </div>

                        {/* Prices and Tax Checkbox Row */}
                        <div className="flex gap-1.5 items-end">
                            <div className="flex-1 min-w-0">
                                <label htmlFor="costPrice" className="block text-xs font-bold text-gray-600">매입가</label>
                                <input id="costPrice" type="text" inputMode="decimal" value={formatDecimal(costPrice)} onChange={(e) => setCostPrice(e.target.value)} className="w-full h-9 px-2.5 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-right font-mono" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <label htmlFor="sellingPrice" className="block text-xs font-bold text-gray-600">판매가</label>
                                <input id="sellingPrice" type="text" inputMode="numeric" value={formatInteger(sellingPrice)} onChange={(e) => setSellingPrice(e.target.value)} className="w-full h-9 px-2.5 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 text-right font-mono" />
                            </div>
                            <div className="h-9 flex items-center justify-end px-1 min-w-[3rem]">
                                <div className="text-right">
                                    <span className="block text-[10px] text-gray-500 leading-none">이익률</span>
                                    <span className="font-bold text-blue-600 text-sm leading-tight">{margin}%</span>
                                </div>
                            </div>
                            <label className="flex-shrink-0 flex items-center space-x-1.5 cursor-pointer select-none bg-white border border-gray-300 rounded-md px-3 h-9">
                                <input type="checkbox" checked={isTaxable} onChange={(e) => setIsTaxable(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                <span className="font-medium text-gray-700 text-xs whitespace-nowrap">과세</span>
                            </label>
                        </div>

                        {/* Categories and Save Reset Checkbox */}
                         <div>
                            <label className="block text-xs font-bold text-gray-600">상품 분류</label>
                            <div className="flex gap-1.5 items-center">
                                <div className="flex-1 grid grid-cols-3 gap-1.5">
                                    <select id="lCode" value={lCode} onChange={(e) => { isPopulating.current=false; setLCode(e.target.value); setMCode(''); setSCode(''); }} className="w-full h-9 px-1 border border-gray-300 rounded-md text-xs focus:ring-1 focus:ring-blue-500">
                                        <option value="">대분류</option>{lCodeOptions.map((c: any) => <option key={c.code} value={c.code}>{c.name}</option>)}
                                    </select>
                                    <select id="mCode" value={mCode} onChange={(e) => { isPopulating.current=false; setMCode(e.target.value); setSCode(''); }} disabled={!lCode || mCodeOptions.length === 0} className="w-full h-9 px-1 border border-gray-300 rounded-md text-xs focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100">
                                        <option value="">중분류</option>{mCodeOptions.map((c: any) => <option key={c.code} value={c.code}>{c.name}</option>)}
                                    </select>
                                    <select id="sCode" value={sCode} onChange={(e) => setSCode(e.target.value)} disabled={!mCode || sCodeOptions.length === 0} className="w-full h-9 px-1 border border-gray-300 rounded-md text-xs focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100">
                                        <option value="">소분류</option>{sCodeOptions.map((c: any) => <option key={c.code} value={c.code}>{c.name}</option>)}
                                    </select>
                                </div>
                                <label className="flex-shrink-0 flex items-center space-x-1.5 cursor-pointer select-none bg-white border border-gray-300 rounded-md px-3 h-9 justify-center">
                                    <input type="checkbox" checked={resetAfterSave} onChange={(e) => setResetAfterSave(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                    <span className="font-medium text-gray-700 text-xs whitespace-nowrap">초기화</span>
                                </label>
                            </div>
                        </div>

                        {/* Supplier and Stock Row */}
                        <div className="flex gap-1.5">
                            <div className="flex-[2] min-w-0">
                                <label className="block text-xs font-bold text-gray-600">거래처</label>
                                <select id="comcode" value={comcode} onChange={(e) => setComcode(e.target.value)} className="w-full h-9 px-2.5 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500">
                                    <option value="">거래처를 선택하세요</option>
                                    {supplierOptions.map((s: any) => <option key={s.comcode} value={s.comcode}>{s.comname}</option>)}
                                </select>
                            </div>
                            <div className="flex-[1] min-w-0">
                                <label className="block text-xs font-bold text-gray-600">재고수량</label>
                                <input type="text" value={stockQty || ''} readOnly className="w-full h-9 px-2.5 text-sm border border-gray-300 rounded-md bg-gray-50 text-gray-600 font-mono text-right" />
                            </div>
                        </div>

                        {/* Checkboxes Row */}
                        <div className="flex gap-1.5 my-0.5">
                            <label className="flex-1 flex items-center justify-center bg-white border border-gray-300 rounded-md h-9 cursor-pointer select-none">
                                <input type="checkbox" checked={isUse} onChange={(e) => setIsUse(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                <span className="ml-1.5 text-xs font-medium text-gray-700">상품사용유무</span>
                            </label>
                            <label className="flex-1 flex items-center justify-center bg-white border border-gray-300 rounded-md h-9 cursor-pointer select-none">
                                <input type="checkbox" checked={isPoint} onChange={(e) => setIsPoint(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                <span className="ml-1.5 text-xs font-medium text-gray-700">고객점수가산</span>
                            </label>
                            <label className="flex-1 flex items-center justify-center bg-white border border-gray-300 rounded-md h-9 cursor-pointer select-none">
                                <input type="checkbox" checked={isStockManaged} onChange={(e) => setIsStockManaged(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                <span className="ml-1.5 text-xs font-medium text-gray-700">재고관리여부</span>
                            </label>
                        </div>

                        {/* Save and Reset Button Group */}
                        <div className="flex w-full items-stretch gap-2 mt-1">
                            <button
                                onClick={handleReset}
                                className="flex-[2] py-3 bg-orange-100 text-orange-600 rounded-lg font-bold shadow-md active:scale-95 transition-all hover:bg-orange-200 flex items-center justify-center border border-orange-200"
                                title="초기화"
                            >
                                <UndoIcon className="w-5 h-5" />
                            </button>
                            <button 
                                onClick={handleSave} 
                                disabled={isSaving} 
                                className="flex-[5] py-3 bg-blue-600 text-white rounded-lg font-bold shadow-md active:scale-95 disabled:bg-gray-400 disabled:shadow-none transition-all hover:bg-blue-700 flex items-center justify-center gap-2 text-base"
                            >
                                {isSaving ? <SpinnerIcon className="w-5 h-5" /> : <CheckSquareIcon className="w-5 h-5" />}
                                <span>저장</span>
                            </button>
                        </div>

                        {/* Info Boxes with flex grow and min height */}
                        <div className="grid grid-cols-2 gap-1.5 text-center flex-grow min-h-[120px]">
                            <div className="bg-gray-100 p-1.5 rounded-lg border h-full overflow-y-auto flex flex-col">
                                <p className="text-xs font-bold text-gray-500 sticky top-0 bg-gray-100 pb-1 border-b mb-1">할인정보</p>
                                {saleInfo ? (
                                    <div className="bg-white rounded border border-gray-200 p-2 text-left shadow-sm h-full flex flex-col justify-center">
                                        <div className="font-bold text-red-600 text-sm mb-1 truncate" title={saleInfo['행사명']}>{saleInfo['행사명']}</div>
                                        <div className="text-xs text-gray-500 mb-2">
                                            {saleInfo['행사시작일']} ~ {saleInfo['행사종료일']}
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-xs border-t border-gray-100 pt-2">
                                            <div>
                                                <div className="text-gray-400 text-[10px]">행사매입</div>
                                                <div className="font-bold">{Number(saleInfo['행사매입가']).toLocaleString()}</div>
                                            </div>
                                            <div>
                                                <div className="text-gray-400 text-[10px]">행사판매</div>
                                                <div className="font-bold text-red-600">{Number(saleInfo['행사판매가']).toLocaleString()}</div>
                                            </div>
                                        </div>
                                    </div>
                                ) : <div className="flex items-center justify-center h-full text-gray-400 text-xs">할인 정보 없음</div>}
                            </div>
                            <div className="bg-gray-100 p-1.5 rounded-lg border h-full overflow-y-auto flex flex-col">
                                <p className="text-xs font-bold text-gray-500 sticky top-0 bg-gray-100 pb-1 border-b mb-1">BOM 정보</p>
                                {bomComponents.length > 0 ? (
                                    <div className="flex flex-col gap-2 p-1">
                                      {bomComponents.map((c, i) => (
                                        <div key={i} className="bg-white rounded border border-gray-200 p-2 text-left shadow-sm">
                                            <div className="font-bold text-gray-800 text-sm mb-0.5 truncate" title={c['상품명']}>{c['상품명']}</div>
                                            <div className="flex justify-between items-center text-xs mt-1">
                                                <span className="text-gray-500">{c['규격'] || '규격없음'}</span>
                                                <span className="font-bold text-blue-600 bg-blue-50 px-1.5 rounded">{c['수량']}개</span>
                                            </div>
                                            <div className="flex justify-between items-center text-xs mt-1.5 pt-1.5 border-t border-gray-100">
                                                 <div>
                                                    <span className="text-gray-400 mr-1">매입</span>
                                                    <span className="font-medium">{Number(c['매입가']).toLocaleString()}</span>
                                                 </div>
                                                 <div>
                                                    <span className="text-gray-400 mr-1">판매</span>
                                                    <span className="font-bold">{Number(c['판매가']).toLocaleString()}</span>
                                                 </div>
                                            </div>
                                        </div>
                                      ))}
                                    </div>
                                ) : <div className="flex items-center justify-center h-full text-gray-400 text-xs">{bomStatus === '묶음' ? '구성품 정보 없음' : '일반 상품'}</div>}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
             <ProductSelectionModal 
                isOpen={selectionModalOpen}
                onClose={() => setSelectionModalOpen(false)}
                products={productsToSelect}
                onSelect={populateForm}
            />
        </ActionModal>
    );
};

export default ProductEditPage;
