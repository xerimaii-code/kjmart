
import React, { useState, useMemo, useEffect, useCallback, useRef, memo } from 'react';
import { useDataState, useDataActions, useAlert, useScanner, useMiscUI, useModals } from '../context/AppContext';
import { Customer, Product, OrderItem, NewOrderDraft } from '../types';
import { RemoveIcon, SpinnerIcon, ChatBubbleLeftIcon, ChevronDownIcon, DragHandleIcon } from '../components/Icons';
import { useOrderManager, isSaleActive } from '../hooks/useOrderManager';
import SearchDropdown from '../components/SearchDropdown';
import { useDraft } from '../hooks/useDraft';
import { useProductSearch } from '../hooks/useProductSearch';
import { useSortedCustomers } from '../hooks/useSortedCustomers';
import ProductSearchBar from '../components/ProductSearchBar';

const DRAFT_KEY = 'new-order-draft';

const OrderItemRow = memo(({ item, product, onEdit, onRemove, index, isDragging, onDragStart, onDragEnd, onDragOver, onDrop }: { 
    item: OrderItem; 
    product: Product | undefined; 
    onEdit: (item: OrderItem, product?: Product) => void; 
    onRemove: (item: OrderItem) => void; 
    index: number;
    isDragging: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
}) => {
    // [확정 전] 최신 상품 정보(Product)를 기준으로 행사 여부 판단
    const currentProduct = product;
    const saleIsActive = currentProduct ? isSaleActive(currentProduct.saleStartDate, currentProduct.saleEndDate) : false;
    const hasEventPrice = currentProduct && currentProduct.eventCostPrice && currentProduct.eventCostPrice > 0;

    return (
        <div
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
            className={`relative flex items-center p-3 space-x-3 bg-white border-b border-gray-100 last:border-0 transition-all duration-200 cursor-pointer ${isDragging ? 'opacity-40 bg-indigo-50 scale-95 z-50' : 'active:bg-gray-50 opacity-100'}`}
            onClick={() => onEdit(item, product)}
        >
            <div className="flex-shrink-0 text-gray-300">
                <DragHandleIcon className="w-5 h-5" />
            </div>

            <div className="flex-grow min-w-0 pr-1 space-y-1">
                <div className="flex justify-between items-start gap-2">
                    <div className="flex flex-wrap items-center gap-1 flex-grow">
                        {item.isModified && (
                            <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded border border-amber-200 whitespace-nowrap">
                                수정
                            </span>
                        )}
                        <p className="font-semibold text-gray-800 break-words whitespace-pre-wrap text-sm leading-snug">
                            {item.name}
                        </p>
                    </div>
                    {saleIsActive && hasEventPrice && (
                        <span className="text-rose-500 text-[10px] font-black px-1.5 py-0.5 rounded-md border border-rose-200 bg-rose-50 animate-pulse">행사중</span>
                    )}
                </div>

                <div className="flex flex-wrap items-center justify-between text-xs">
                    <div className="flex items-center gap-1">
                        <span className="font-bold text-gray-500">{item.price.toLocaleString()}</span>
                        <span className="text-gray-400">× {item.quantity} =</span>
                        <span className="font-extrabold text-gray-800">{(item.price * item.quantity).toLocaleString()}</span>
                    </div>
                </div>

                {saleIsActive && hasEventPrice && currentProduct && (
                    <div className="mt-1 px-2 py-1 bg-rose-50/50 border border-rose-100 border-dashed rounded-lg">
                        <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
                            <span className="font-black text-rose-500 uppercase">행사가</span>
                            <span className="font-bold text-rose-700">
                                {currentProduct.eventCostPrice!.toLocaleString()}
                                {currentProduct.salePrice && currentProduct.salePrice > 0 ? ` / ${currentProduct.salePrice.toLocaleString()}` : ''}
                            </span>
                            <span className="text-rose-300 mx-1">|</span>
                            <div className="flex flex-col leading-tight">
                                <span className="text-gray-500 font-bold truncate">{currentProduct.saleName}</span>
                                <span className="text-[9px] text-rose-400 font-mono">
                                    ({currentProduct.saleStartDate?.slice(5)}~{currentProduct.saleEndDate?.slice(5)})
                                </span>
                            </div>
                        </div>
                    </div>
                )}
                
                {item.memo && (
                    <p className="text-xs text-amber-600 flex items-start gap-1.5 pt-0.5 font-medium">
                        <ChatBubbleLeftIcon className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                        <span className="break-all">{item.memo}</span>
                    </p>
                )}
            </div>

            <div className="flex items-center space-x-2 flex-shrink-0">
                <div className="flex flex-col items-end">
                    <span className="font-bold text-lg leading-none text-gray-800">{item.quantity}</span>
                    <span className="text-gray-500 font-medium text-[10px]">{item.unit}</span>
                </div>
                <button onClick={(e) => { e.stopPropagation(); onRemove(item); }} className="text-gray-300 hover:text-rose-500 p-2.5 rounded-full transition-colors">
                    <RemoveIcon className="w-5 h-5"/>
                </button>
            </div>
        </div>
    );
});
OrderItemRow.displayName = 'OrderItemRow';

const NewOrderPage: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const { customers, products } = useDataState();
    const { addOrder } = useDataActions();
    const { showAlert, showToast } = useAlert();
    const { openScanner } = useScanner();
    const { setLastModifiedOrderId } = useMiscUI();
    const { openAddItemModal, openEditItemModal, closeEditItemModal } = useModals();

    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [customerSearch, setCustomerSearch] = useState('');
    const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState('');
    
    // 수정 모달에 최신 정보를 넘기기 위한 임시 세션 상품 캐시
    const sessionProductsRef = useRef<Map<string, Product>>(new Map());

    const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
    const [dropIdx, setDropIdx] = useState<number | null>(null);
    
    const selectedCustomerRef = useRef(selectedCustomer);
    
    useEffect(() => {
        const handler = setTimeout(() => setDebouncedCustomerSearch(customerSearch), 200);
        return () => clearTimeout(handler);
    }, [customerSearch]);
    
    const { 
        searchTerm: productSearch, 
        setSearchTerm: setProductSearch, 
        results: productSearchResults, 
        isSearching: isSearchingProducts, 
        search,
        searchByBarcode
    } = useProductSearch('newOrder', 50, '상품조회_발주');
    
    const [debouncedProductSearch, setDebouncedProductSearch] = useState('');
    
    useEffect(() => {
        const handler = setTimeout(() => setDebouncedProductSearch(productSearch), 300);
        return () => clearTimeout(handler);
    }, [productSearch]);

    useEffect(() => {
        if (productSearchResults.length > 0) {
            productSearchResults.forEach(p => sessionProductsRef.current.set(p.barcode, p));
        }
    }, [productSearchResults]);

    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
    const isCustomerSelected = !!selectedCustomer; 
    const [isBoxUnitDefault, setIsBoxUnitDefault] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    
    const customerSearchInputRef = useRef<HTMLInputElement>(null);
    const scrollableContainerRef = useRef<HTMLDivElement | null>(null);
    const customerSearchBlurTimeout = useRef<number | null>(null);
    const isProcessingScanRef = useRef(false);

    const { sortedCustomers, recordUsage } = useSortedCustomers(customers);

    const filteredCustomers = useMemo(() => {
        const term = customerSearch.trim().toLowerCase();
        if (!term) return sortedCustomers.slice(0, 50);
        return sortedCustomers.filter(c => 
            c.name.toLowerCase().includes(term) || c.comcode.includes(term)
        ).slice(0, 50);
    }, [sortedCustomers, customerSearch]);

    const {
        items,
        addOrUpdateItem,
        updateItem,
        removeItem,
        reorderItems,
        resetItems,
        totalAmount,
    } = useOrderManager({
        initialItems: [],
    });
    
    const itemsRef = useRef(items);
    useEffect(() => {
        itemsRef.current = items;
        selectedCustomerRef.current = selectedCustomer;
    }, [items, selectedCustomer]);

    useEffect(() => {
        const term = debouncedProductSearch.trim();
        if (term.length >= 2) {
            search(term);
        } else if (term.length === 0) {
            search(''); 
        }
    }, [debouncedProductSearch, search]);

    const { draft, isLoading: isDraftLoading, status: draftStatus, save: saveDraftData, remove: removeDraftData } = useDraft<NewOrderDraft>(DRAFT_KEY);

    const draftRestored = useRef(false);
    useEffect(() => {
        if (isActive && draft && !isSaving && !draftRestored.current) {
            draftRestored.current = true;
            setSelectedCustomer(draft.selectedCustomer);
            if (draft.selectedCustomer) {
                setCustomerSearch(draft.selectedCustomer.name);
            }
            if (draft.items && draft.items.length > 0) {
                resetItems(draft.items);
            }
            setIsBoxUnitDefault(!!draft.isBoxUnitDefault);
        }
    }, [isActive, draft, resetItems, isSaving]);

    useEffect(() => {
        if (!isActive || isDraftLoading || isSaving) return;
        
        const hasContent = !!selectedCustomer || (items && items.length > 0);
        if (hasContent) {
            saveDraftData({
                selectedCustomer,
                items,
                isBoxUnitDefault,
            });
        }
    }, [selectedCustomer, items, isBoxUnitDefault, isDraftLoading, saveDraftData, isSaving, isActive]);

    const handleSelectCustomer = (customer: Customer) => {
        setSelectedCustomer(customer);
        setCustomerSearch(customer.name);
        setShowCustomerDropdown(false);
        recordUsage(customer.comcode);
    };

    const handleClearCustomer = () => {
        setSelectedCustomer(null);
        setCustomerSearch('');
        setTimeout(() => customerSearchInputRef.current?.focus(), 50);
    };
    
    const handleSaveOrder = useCallback(async () => {
        const currentCustomer = selectedCustomerRef.current;
        const currentItemsList = itemsRef.current;
        if (!currentCustomer) { showAlert("거래처를 선택해주세요."); return; }
        if (currentItemsList.length === 0) { showAlert("발주할 품목이 없습니다."); return; }

        setIsSaving(true);
        try {
            // [중요] 저장 시점의 상품 정보를 스냅샷으로 박제하여 저장
            const itemsWithSnapshot: OrderItem[] = await Promise.all(currentItemsList.map(async (item) => {
                // 1. 세션(검색 결과)에서 최신 상품 정보 조회
                let prod = sessionProductsRef.current.get(item.barcode) || products.find(p => p.barcode === item.barcode);
                
                // 2. 만약 없다면 온라인 조회 시도
                if (!prod && navigator.onLine) {
                    try {
                        prod = await searchByBarcode(item.barcode) || undefined;
                    } catch (e) {}
                }

                if (prod) {
                    const saleActive = isSaleActive(prod.saleStartDate, prod.saleEndDate);
                    return {
                        ...item,
                        // [Snapshot] 검색된 시점의 마스터/행사 정보를 그대로 박제
                        masterPrice: prod.costPrice,
                        eventPrice: saleActive ? prod.eventCostPrice : undefined,
                        salePrice: saleActive ? prod.salePrice : undefined,
                        saleName: saleActive ? prod.saleName : undefined,
                        saleStartDate: saleActive ? prod.saleStartDate : undefined, // [수정] 기간 저장
                        saleEndDate: saleActive ? prod.saleEndDate : undefined,     // [수정] 기간 저장
                        // 가격은 행사 중이면 행사 매입가, 아니면 마스터 매입가 사용
                        price: (saleActive && prod.eventCostPrice && prod.eventCostPrice > 0) ? prod.eventCostPrice : prod.costPrice
                    };
                }
                // 상품 정보를 못 찾으면 기존 item 정보 유지
                return item;
            }));

            const finalTotal = Math.floor(itemsWithSnapshot.reduce((sum, item) => sum + (item.price * item.quantity), 0));
            
            const newOrderId = await addOrder({ 
                customer: currentCustomer, 
                items: itemsWithSnapshot, 
                total: finalTotal 
            });
            
            setLastModifiedOrderId(newOrderId);
            removeDraftData();
            
            setSelectedCustomer(null);
            setCustomerSearch('');
            setProductSearch('');
            resetItems([]);
            setIsBoxUnitDefault(false);
            
            showToast("발주가 저장되었습니다.", "success");
        } catch (error) {
            showAlert("발주 저장에 실패했습니다.");
        } finally {
            setIsSaving(false);
        }
    }, [addOrder, setLastModifiedOrderId, showAlert, removeDraftData, showToast, resetItems, setProductSearch, products, searchByBarcode]);

    const handleAddProductFromSearch = useCallback((product: Product) => {
        sessionProductsRef.current.set(product.barcode, product);
        const existingItem = itemsRef.current.find(item => item.barcode === product.barcode);
        openAddItemModal({
            product, existingItem: existingItem || null, trigger: 'search',
            onAdd: (details) => addOrUpdateItem(product, details),
            initialSettings: { unit: existingItem ? existingItem.unit : (isBoxUnitDefault ? '박스' : '개') },
            timestamp: Date.now()
        });
        setProductSearch('');
    }, [openAddItemModal, addOrUpdateItem, isBoxUnitDefault, setProductSearch]);

    const handleOpenScanner = useCallback(() => {
        if (!selectedCustomerRef.current) { showAlert("먼저 거래처를 선택해주세요."); return; }
    
        const onScan = async (barcode: string) => {
            if (isProcessingScanRef.current) return;
            isProcessingScanRef.current = true;
    
            let product: Product | null = null;
            try {
                // [수정] searchByBarcode를 사용하여 온라인(행사정보 포함) 우선 검색
                product = await searchByBarcode(barcode);
                if (product) sessionProductsRef.current.set(product.barcode, product);
            } catch (error) {
                isProcessingScanRef.current = false;
                return;
            }
    
            if (product) {
                const existingItem = itemsRef.current.find(item => item.barcode === product!.barcode);
                openAddItemModal({
                    product, existingItem: existingItem || null, trigger: 'scan',
                    onAdd: (details) => { addOrUpdateItem(product!, details); isProcessingScanRef.current = false; },
                    onClose: () => { isProcessingScanRef.current = false; },
                    onNextScan: handleOpenScanner,
                    initialSettings: { unit: existingItem ? existingItem.unit : (isBoxUnitDefault ? '박스' : '개') },
                    timestamp: Date.now()
                });
            } else {
                showAlert("등록되지 않은 바코드입니다.");
                isProcessingScanRef.current = false;
            }
        };
    
        openScanner('new-order', onScan, { continuous: true });
    }, [showAlert, openScanner, openAddItemModal, addOrUpdateItem, isBoxUnitDefault, searchByBarcode]);

    const handleDragStart = (idx: number) => setDraggedIdx(idx);
    const handleDragEnd = () => { setDraggedIdx(null); setDropIdx(null); };
    const handleDragOver = (e: React.DragEvent, idx: number) => {
        e.preventDefault();
        if (draggedIdx === idx) return;
        setDropIdx(idx);
    };
    const handleDrop = (e: React.DragEvent, targetIdx: number) => {
        e.preventDefault();
        if (draggedIdx === null || draggedIdx === targetIdx) return;
        reorderItems(draggedIdx, targetIdx);
        handleDragEnd();
    };

    const displayItems = useMemo(() => {
        return [...items].reverse();
    }, [items]);

    return (
        <div className="h-full flex flex-col relative bg-white">
            {isSearchingProducts && <div className="fixed top-0 left-0 w-full h-1 bg-indigo-100 z-[100] overflow-hidden"><div className="h-full bg-indigo-600 animate-[indeterminate_1.5s_infinite_linear] origin-left"></div></div>}
            <div className="w-full py-2 px-3 bg-white flex-shrink-0 z-20 border-b border-gray-100">
                <div className="grid grid-cols-[1fr_auto] items-stretch gap-2 w-full max-w-2xl mx-auto">
                    <div className="flex flex-col gap-2">
                        <div className="relative">
                            <input ref={customerSearchInputRef} type="text" value={customerSearch} onChange={(e) => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); }} onFocus={() => { if (customerSearchBlurTimeout.current) clearTimeout(customerSearchBlurTimeout.current); setShowCustomerDropdown(true); }} onBlur={() => { customerSearchBlurTimeout.current = window.setTimeout(() => setShowCustomerDropdown(false), 200); }} placeholder="거래처 검색" readOnly={isCustomerSelected} className={`w-full px-3 h-11 border ${isCustomerSelected ? 'border-indigo-500 bg-indigo-50 pr-28 font-bold text-indigo-800' : 'border-gray-300 bg-white pr-10'} rounded-xl focus:ring-1 focus:ring-indigo-500 transition-colors text-base`} autoComplete="off" />
                            {!isCustomerSelected && <button onClick={() => setShowCustomerDropdown(prev => !prev)} className="absolute top-1/2 right-1 -translate-y-1/2 p-2 text-gray-400 hover:text-indigo-600" type="button"><ChevronDownIcon className="w-5 h-5" /></button>}
                            {isCustomerSelected && <button onClick={handleClearCustomer} className="absolute top-1/2 right-1.5 -translate-y-1/2 h-8 px-3 rounded-lg font-semibold bg-white border border-gray-200 text-gray-600 active:scale-95 text-sm">변경</button>}
                            <SearchDropdown<Customer> items={filteredCustomers} renderItem={(c) => <div onMouseDown={(e) => { e.preventDefault(); handleSelectCustomer(c); }} className="p-3 hover:bg-gray-50 cursor-pointer border-b last:border-b-0"><p className="font-semibold text-gray-800">{c.name}</p><p className="text-sm text-gray-500">{c.comcode}</p></div>} show={showCustomerDropdown && !isCustomerSelected} />
                        </div>
                        {isCustomerSelected && <ProductSearchBar id="new-order-search" searchTerm={productSearch} onSearchTermChange={setProductSearch} isSearching={isSearchingProducts} results={productSearchResults} onSelectProduct={handleAddProductFromSearch} onScan={handleOpenScanner} isBoxUnit={isBoxUnitDefault} onBoxUnitChange={setIsBoxUnitDefault} placeholder="품목 검색" showBoxToggle={true} />}
                    </div>
                </div>
            </div>
            <main ref={scrollableContainerRef} className="flex-grow overflow-y-auto bg-white p-0">
                {items.length > 0 ? (
                    <div className="divide-y divide-gray-100 pb-20">
                        {displayItems.map((item, dIdx) => {
                            const index = items.length - 1 - dIdx;
                            const product = sessionProductsRef.current.get(item.barcode) || products.find(p => p.barcode === item.barcode);
                            return (
                                <React.Fragment key={item.barcode}>
                                    {dropIdx === index && draggedIdx !== null && index < draggedIdx && <div className="h-1 bg-indigo-500 animate-pulse" />}
                                    <OrderItemRow 
                                        item={item} 
                                        product={product}
                                        onEdit={(it, pr) => {
                                            openEditItemModal({ 
                                                item: it, 
                                                product: pr,
                                                onSave: (det) => {
                                                    updateItem(it.barcode, { ...det, isModified: true });
                                                    closeEditItemModal();
                                                }, 
                                                onScanNext: handleOpenScanner 
                                            });
                                        }} 
                                        onRemove={(it) => showAlert(`'${it.name}' 삭제하시겠습니까?`, () => removeItem(it.barcode), '삭제', 'bg-rose-500')} 
                                        index={index}
                                        isDragging={draggedIdx === index}
                                        onDragStart={() => handleDragStart(index)}
                                        onDragEnd={handleDragEnd}
                                        onDragOver={(e) => handleDragOver(e, index)}
                                        onDrop={(e) => handleDrop(e, index)}
                                    />
                                    {dropIdx === index && draggedIdx !== null && index > draggedIdx && <div className="h-1 bg-indigo-500 animate-pulse" />}
                                </React.Fragment>
                            );
                        })}
                    </div>
                ) : !isCustomerSelected ? (
                    <div className="text-center p-12 text-gray-400 font-medium animate-fade-in-up">거래처를 선택하여 발주를 시작하세요.</div>
                ) : (
                     <div className="text-center p-12 text-gray-400 font-medium animate-fade-in-up"><p>품목이 없습니다.</p><p className="text-sm mt-2">스캔 또는 검색으로 품목을 추가하세요.</p></div>
                )}
            </main>
            {(items.length > 0 || selectedCustomer) && (
                 <footer className="p-3 bg-white border-t border-gray-100 z-10 safe-area-pb shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                    <div className="max-w-2xl mx-auto">
                        <div className="flex justify-between items-center mb-3 px-2">
                             <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-gray-500">총 합계:</span>
                                {draftStatus === 'saving' && !isSaving && <span className="text-[10px] font-bold text-indigo-400 animate-pulse flex items-center gap-1"><SpinnerIcon className="w-3 h-3"/> 저장 중...</span>}
                            </div>
                            <span className="text-xl font-bold text-gray-900 tracking-tighter">{totalAmount.toLocaleString()} 원</span>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                             <button onClick={() => showAlert("작성 중인 모든 내용을 삭제하시겠습니까?", () => { removeDraftData(); setSelectedCustomer(null); setCustomerSearch(''); setProductSearch(''); resetItems([]); setIsBoxUnitDefault(false); }, '삭제', 'bg-rose-500')} className="h-12 bg-gray-100 text-gray-600 rounded-xl font-bold text-base active:scale-95 transition-transform">초기화</button>
                            <button onClick={handleSaveOrder} disabled={isSaving || !isCustomerSelected || items.length === 0} className="relative col-span-2 h-12 bg-indigo-600 text-white rounded-xl font-bold text-base shadow-lg shadow-indigo-200 disabled:bg-gray-400 active:scale-95 transition-transform">
                                <span className={isSaving ? 'opacity-0' : 'opacity-100'}>발주 저장</span>
                                {isSaving && <div className="absolute inset-0 flex items-center justify-center"><SpinnerIcon className="w-6 h-6 animate-spin"/></div>}
                            </button>
                        </div>
                    </div>
                </footer>
            )}
        </div>
    );
};

export default NewOrderPage;
