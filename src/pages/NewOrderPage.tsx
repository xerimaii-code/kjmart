
import React, { useState, useMemo, useEffect, useCallback, useRef, memo } from 'react';
import { useDataState, useDataActions, useAlert, useScanner, useMiscUI, useModals, useDeviceSettings } from '../context/AppContext';
import { Customer, Product, OrderItem, NewOrderDraft } from '../types';
import { RemoveIcon, SpinnerIcon, ChatBubbleLeftIcon, ChevronDownIcon } from '../components/Icons';
import { useOrderManager, isSaleActive } from '../hooks/useOrderManager';
import SearchDropdown from '../components/SearchDropdown';
import { useDraft } from '../hooks/useDraft';
import { useProductSearch } from '../hooks/useProductSearch';
import { useSortedCustomers } from '../hooks/useSortedCustomers';
import ProductSearchBar from '../components/ProductSearchBar';

const DRAFT_KEY = 'new-order-draft';

const OrderItemRow = memo(({ item, product, onEdit, onRemove, index }: { item: OrderItem; product: Product | undefined; onEdit: (item: OrderItem) => void; onRemove: (item: OrderItem) => void; index: number; }) => {
    const saleIsActive = product ? isSaleActive(product.saleStartDate, product.saleEndDate) : false;

    return (
        <div
            className="relative flex items-center p-3 space-x-3 bg-white border-b border-gray-100 last:border-0 transition-colors duration-200 active:bg-gray-50 cursor-pointer animate-fade-in-up"
            style={{ animationDelay: `${Math.min(index * 20, 300)}ms` }}
            onClick={() => onEdit(item)}
        >
            <div className="flex-grow min-w-0 pr-1 space-y-1">
                {/* Row 1: Name and Badge */}
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
                    {saleIsActive && (
                        <span className="bg-rose-100 text-rose-600 text-[10px] font-extrabold px-1.5 py-0.5 rounded flex-shrink-0 whitespace-nowrap border border-red-200">
                            행사중
                        </span>
                    )}
                </div>

                {/* Row 2: Order Price vs Current Price & Total */}
                <div className="flex flex-wrap items-center gap-x-2 text-xs">
                    <div className="flex items-center gap-1">
                        <span className="font-bold text-indigo-600">{item.price.toLocaleString()}</span>
                        <span className="text-gray-400">× {item.quantity}</span>
                        <span className="font-extrabold text-gray-800">{(item.price * item.quantity).toLocaleString()}</span>
                    </div>
                    {product && (
                        <>
                            <span className="text-gray-300">|</span>
                            <span className="text-gray-500">현재매입:</span>
                            {saleIsActive && product.eventCostPrice ? (
                                <div className="flex items-center gap-1">
                                    <span className="line-through text-gray-400">{product.costPrice.toLocaleString()}</span>
                                    <span className="text-rose-600 font-bold">{product.eventCostPrice.toLocaleString()}</span>
                                </div>
                            ) : (
                                <span className="text-gray-700 font-medium">{product.costPrice?.toLocaleString()}</span>
                            )}
                        </>
                    )}
                </div>
                
                {/* Row 3: Sale Date Information */}
                {product && saleIsActive && (product.saleStartDate || product.saleEndDate) && (
                     <div className="text-[11px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded inline-block">
                        <span className="font-bold">행사기간: </span>
                        <span>{product.saleStartDate ? `${product.saleStartDate}~` : `~`}{product.saleEndDate}</span>
                     </div>
                )}

                {/* Row 4: Memo */}
                {item.memo && (
                    <p className="text-xs text-amber-600 flex items-start gap-1.5 pt-0.5 font-medium">
                        <ChatBubbleLeftIcon className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                        <span className="break-all">{item.memo}</span>
                    </p>
                )}
            </div>

            {/* Quantity Controls */}
            <div className="flex items-center space-x-2 flex-shrink-0">
                <div className="flex flex-col items-end">
                    <span className="text-gray-800 font-bold text-lg select-none leading-none">{item.quantity}</span>
                    <span className="text-gray-500 font-medium select-none text-[10px]">{item.unit}</span>
                </div>
                <button onClick={(e) => { e.stopPropagation(); onRemove(item); }} className="text-gray-400 hover:text-rose-500 p-2 rounded-full hover:bg-rose-50 z-10 relative transition-colors">
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
    const { openAddItemModal, openEditItemModal } = useModals();
    const { dataSourceSettings } = useDeviceSettings();

    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [customerSearch, setCustomerSearch] = useState('');
    const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState('');
    
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

    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

    const isCustomerSelected = !!selectedCustomer; 

    const [isBoxUnitDefault, setIsBoxUnitDefault] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    
    const customerSearchInputRef = useRef<HTMLInputElement>(null);
    const scrollableContainerRef = useRef<HTMLDivElement | null>(null);
    const customerSearchBlurTimeout = useRef<number | null>(null);
    const isProcessingScanRef = useRef(false);

    const { sortedCustomers, recordUsage } = useSortedCustomers(customers);

    const initialOrderItems = useMemo(() => [], []);

    const {
        items,
        addOrUpdateItem,
        updateItem,
        removeItem,
        reorderItems,
        resetItems,
        totalAmount,
    } = useOrderManager({
        initialItems: initialOrderItems,
    });
    
    const itemsRef = useRef(items);
    useEffect(() => {
        itemsRef.current = items;
        selectedCustomerRef.current = selectedCustomer;
    }, [items, selectedCustomer]);

    useEffect(() => {
        if (debouncedProductSearch) search(debouncedProductSearch);
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

    useEffect(() => {
        if (scrollableContainerRef.current) {
            scrollableContainerRef.current.scrollTo({
                top: scrollableContainerRef.current.scrollHeight,
                behavior: 'smooth',
            });
        }
    }, [items.length]);
    
    const filteredCustomers = useMemo(() => {
        const searchTerm = debouncedCustomerSearch.trim().toLowerCase();
        if (isCustomerSelected) return [];
        if (!searchTerm) return sortedCustomers.slice(0, 50); 
        return sortedCustomers.filter(c => 
            c.name.toLowerCase().includes(searchTerm) || c.comcode.includes(searchTerm)
        ).slice(0, 50);
    }, [sortedCustomers, debouncedCustomerSearch, isCustomerSelected]);

    const dragIndex = useRef<number | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);

    const handleDragStart = (e: React.DragEvent, index: number) => {
        dragIndex.current = index;
        e.dataTransfer.effectAllowed = 'move';
        (e.currentTarget as HTMLElement).classList.add('dragging');
    };
    const handleDragEnter = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        if (dragIndex.current === index) return;
        setDropIndex(index);
    };
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };
    const handleDragEnd = (e: React.DragEvent) => {
        (e.currentTarget as HTMLElement).classList.remove('dragging');
        dragIndex.current = null;
        setDropIndex(null);
    };
    const handleDrop = () => {
        if (dragIndex.current !== null && dropIndex !== null) {
            const fromIndex = dragIndex.current;
            const toIndex = dropIndex > fromIndex ? dropIndex - 1 : dropIndex;
            if (fromIndex !== toIndex) reorderItems(fromIndex, toIndex);
        }
    };

    const handleSelectCustomer = (customer: Customer) => {
        setSelectedCustomer(customer);
        setCustomerSearch(customer.name);
        setShowCustomerDropdown(false);
        recordUsage(customer.comcode);
    };

    const handleCustomerInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (filteredCustomers.length > 0) handleSelectCustomer(filteredCustomers[0]);
        }
    };

    const handleClearCustomer = () => {
        setSelectedCustomer(null);
        setCustomerSearch('');
        setTimeout(() => customerSearchInputRef.current?.focus(), 50);
    };
    
    const handleToggleCustomerDropdown = (e: React.MouseEvent) => {
        e.preventDefault();
        setShowCustomerDropdown(prev => !prev);
        customerSearchInputRef.current?.focus();
    };

    const resetOrder = useCallback((options?: { preventFocus?: boolean }) => {
        setSelectedCustomer(null);
        setCustomerSearch('');
        setProductSearch('');
        resetItems([]);
        setIsBoxUnitDefault(false);
        if (options?.preventFocus) {
             if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        } else {
            customerSearchInputRef.current?.focus();
        }
    }, [resetItems, setProductSearch]);

    const handleResetOrder = useCallback(() => {
        showAlert(
            "작성 중인 모든 내용을 삭제하시겠습니까?",
            () => { removeDraftData(); resetOrder(); },
            '삭제', 'bg-rose-500 hover:bg-rose-600'
        );
    }, [showAlert, resetOrder, removeDraftData]);
    
    const handleSaveOrder = useCallback(async () => {
        const currentCustomer = selectedCustomerRef.current;
        const currentItemsList = itemsRef.current;
        if (!currentCustomer) { showAlert("거래처를 선택해주세요."); return; }
        if (currentItemsList.length === 0) { showAlert("발주할 품목이 없습니다."); return; }

        setIsSaving(true);
        try {
            const currentTotal = Math.floor(currentItemsList.reduce((sum, item) => sum + (item.price * item.quantity), 0));
            const newOrderId = await addOrder({ customer: currentCustomer, items: currentItemsList, total: currentTotal });
            setLastModifiedOrderId(newOrderId);
            removeDraftData();
            resetOrder({ preventFocus: true });
            showToast("발주가 저장되었습니다.", "success");
        } catch (error) {
            showAlert("발주 저장에 실패했습니다.");
        } finally {
            setIsSaving(false);
        }
    }, [addOrder, setLastModifiedOrderId, resetOrder, showAlert, removeDraftData, showToast]);

    const handleAddProductFromSearch = useCallback((product: Product) => {
        const existingItem = itemsRef.current.find(item => item.barcode === product.barcode);
        openAddItemModal({
            product, existingItem: existingItem || null, trigger: 'search',
            onAdd: (details) => addOrUpdateItem(product, details),
            initialSettings: { unit: existingItem ? existingItem.unit : (isBoxUnitDefault ? '박스' : '개') }
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
                product = products.find(p => p.barcode === barcode) || null;
                if (!product) {
                    showToast("온라인 상품 조회 중...", "success");
                    product = await searchByBarcode(barcode);
                }
            } catch (error) {
                console.error("Product search failed during scan:", error);
                showToast("상품 조회에 실패했습니다.", "error");
                isProcessingScanRef.current = false;
                return;
            }
    
            if (product) {
                const existingItem = itemsRef.current.find(item => item.barcode === product!.barcode);
                openAddItemModal({
                    product, existingItem, trigger: 'scan',
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
    }, [showAlert, openScanner, products, openAddItemModal, addOrUpdateItem, isBoxUnitDefault, searchByBarcode, showToast]);

    const handleRemoveItem = useCallback((item: OrderItem) => {
        showAlert(`'${item.name}' 삭제하시겠습니까?`, () => removeItem(item.barcode), '삭제', 'bg-rose-500');
    }, [showAlert, removeItem]);

    const handleEditItem = useCallback((item: OrderItem) => {
        openEditItemModal({
            item: item,
            onSave: (updatedDetails) => updateItem(item.barcode, { ...updatedDetails, isModified: true }),
            onScanNext: handleOpenScanner
        });
    }, [openEditItemModal, updateItem, handleOpenScanner]);

    if (isDraftLoading && items.length === 0) {
        return <div className="w-full h-full flex items-center justify-center"><SpinnerIcon className="w-10 h-10 text-indigo-500 animate-spin" /></div>;
    }

    return (
        <div className="h-full flex flex-col relative bg-white">
            {isSearchingProducts && <div className="fixed top-0 left-0 w-full h-1 bg-indigo-100 z-[100] overflow-hidden"><div className="h-full bg-indigo-600 animate-[indeterminate_1.5s_infinite_linear] origin-left"></div></div>}
            <div className="w-full py-2 px-3 bg-white flex-shrink-0 z-20 border-b border-gray-100">
                <div className="grid grid-cols-[1fr_auto] items-stretch gap-2 w-full max-w-2xl mx-auto">
                    <div className="flex flex-col gap-2">
                        <div className="relative">
                            <input ref={customerSearchInputRef} type="text" value={customerSearch} onChange={(e) => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); }} onKeyDown={handleCustomerInputKeyDown} onFocus={() => { if (customerSearchBlurTimeout.current) clearTimeout(customerSearchBlurTimeout.current); setShowCustomerDropdown(true); }} onBlur={() => { customerSearchBlurTimeout.current = window.setTimeout(() => setShowCustomerDropdown(false), 200); }} placeholder="거래처 검색" readOnly={isCustomerSelected} className={`w-full px-3 h-11 border ${isCustomerSelected ? 'border-indigo-500 bg-indigo-50 pr-28 font-bold text-indigo-800' : 'border-gray-300 bg-white pr-10'} rounded-xl focus:ring-1 focus:ring-indigo-500 transition-colors text-base`} autoComplete="off" />
                            {!isCustomerSelected && <button onMouseDown={handleToggleCustomerDropdown} className="absolute top-1/2 right-1 -translate-y-1/2 p-2 text-gray-400 hover:text-indigo-600" type="button"><ChevronDownIcon className="w-5 h-5" /></button>}
                            {isCustomerSelected && <button onClick={handleClearCustomer} className="absolute top-1/2 right-1.5 -translate-y-1/2 h-8 px-3 rounded-lg font-semibold bg-white border border-gray-200 text-gray-600 active:scale-95 text-sm">변경</button>}
                            <SearchDropdown<Customer> items={filteredCustomers} renderItem={(c) => <div onMouseDown={(e) => { e.preventDefault(); handleSelectCustomer(c); }} className="p-3 hover:bg-gray-50 cursor-pointer border-b last:border-b-0"><p className="font-semibold text-gray-800">{c.name}</p><p className="text-sm text-gray-500">{c.comcode}</p></div>} show={showCustomerDropdown && !isCustomerSelected} />
                        </div>
                        {isCustomerSelected && <ProductSearchBar id="new-order-search" searchTerm={productSearch} onSearchTermChange={setProductSearch} isSearching={isSearchingProducts} results={productSearchResults} onSelectProduct={handleAddProductFromSearch} onScan={handleOpenScanner} isBoxUnit={isBoxUnitDefault} onBoxUnitChange={setIsBoxUnitDefault} placeholder="품목 검색" showBoxToggle={true} />}
                    </div>
                </div>
            </div>
            <main ref={scrollableContainerRef} className="flex-grow overflow-y-auto bg-white p-0" onDragOver={handleDragOver} onDrop={handleDrop}>
                {items.length > 0 ? (
                    <div className="divide-y divide-gray-100">
                        {items.map((item, index) => {
                            const product = products.find(p => p.barcode === item.barcode);
                            return (
                                <React.Fragment key={item.barcode}>
                                    {dropIndex === index && <div className="h-1 bg-indigo-500" />}
                                    <div draggable onDragStart={(e) => handleDragStart(e, index)} onDragEnter={(e) => handleDragEnter(e, index)} onDragEnd={handleDragEnd} className="cursor-grab"><OrderItemRow item={item} product={product} onEdit={handleEditItem} onRemove={handleRemoveItem} index={index} /></div>
                                </React.Fragment>
                            );
                        })}
                        {dropIndex === items.length && <div className="h-1 bg-indigo-500" />}
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
                             <button onClick={handleResetOrder} className="h-12 bg-gray-100 text-gray-600 rounded-xl font-bold text-base active:scale-95 transition-transform">초기화</button>
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
