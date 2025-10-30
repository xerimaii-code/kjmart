import React, { useState, useMemo, useEffect, useCallback, useRef, memo } from 'react';
import { useDataState, useDataActions, useAlert, useScanner, useMiscUI, useModals } from '../context/AppContext';
import { Customer, Product, OrderItem, NewOrderDraft } from '../types';
import { RemoveIcon, DocumentTextIcon, SpinnerIcon, TrashIcon, ChatBubbleLeftIcon, PlusCircleIcon } from '../components/Icons';
import ToggleSwitch from '../components/ToggleSwitch';
import { useOrderManager, isSaleActive } from '../hooks/useOrderManager';
import { useDebounce } from '../hooks/useDebounce';
import { getDraft, saveDraft, deleteDraft } from '../services/draftDbService';
import SearchDropdown from '../components/SearchDropdown';
import ProductSearchResultItem from '../components/ProductSearchResultItem';

const DRAFT_KEY = 'new-order-draft';
const MAX_SEARCH_RESULTS = 50;

interface NewOrderPageProps {
    isActive: boolean;
}

const DraftLoadedToast: React.FC<{ show: boolean }> = ({ show }) => {
    if (!show) return null;
    return (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 mt-4 bg-gray-900/80 backdrop-blur-sm text-white text-sm font-semibold py-2 px-4 rounded-full shadow-lg z-50 animate-fade-in-down">
            임시저장된 내용을 불러왔습니다.
        </div>
    );
};

const OrderItemRow = memo(({ item, product, onEdit, onRemove }: { item: OrderItem; product: Product | undefined; onEdit: (item: OrderItem) => void; onRemove: (item: OrderItem) => void }) => {
    const saleIsActive = product ? isSaleActive(product.saleEndDate) : false;
    const hasSalePrice = product ? !!product.salePrice : false;

    return (
        <div
            className="relative overflow-hidden flex items-center p-3 space-x-3 cursor-pointer hover:bg-gray-50 transition-colors duration-200"
            onClick={() => onEdit(item)}
        >
            {saleIsActive && hasSalePrice && (
                <div className="sale-ribbon">SALE</div>
            )}
            <div className="flex-grow min-w-0 pr-1 space-y-1">
                <p className="font-semibold text-gray-800 break-words whitespace-pre-wrap">
                    <span>{item.name}</span>
                </p>

                <p className="text-sm font-semibold text-blue-600">발주가: {item.price.toLocaleString()}원</p>
                
                {product && (
                    <div className="text-xs flex items-baseline gap-x-1.5 flex-wrap text-gray-500">
                        <span>현재:</span>
                        <span className="font-semibold">{product.costPrice?.toLocaleString()}원</span>
                        <span className="text-gray-400">/</span>
                        <span className={`font-semibold ${saleIsActive && hasSalePrice ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                            {product.sellingPrice?.toLocaleString()}원
                        </span>
                        {hasSalePrice && (
                            <span
                                className={`${saleIsActive ? 'text-red-600 font-bold' : 'text-gray-500'}`}
                                style={!saleIsActive ? { fontSize: '80%' } : {}}
                            >
                                {product.salePrice}원
                            </span>
                        )}
                    </div>
                )}
                 {product && product.saleEndDate && (
                     <div className="text-xs text-gray-500">
                        <span className={saleIsActive ? 'font-semibold text-blue-600' : 'text-gray-400'}>
                            행사기간: ~{product.saleEndDate}
                        </span>
                     </div>
                )}
                {item.memo && (
                    <p className="text-xs text-blue-600 flex items-start gap-1.5 pt-0.5">
                        <ChatBubbleLeftIcon className="w-4 h-4 flex-shrink-0 mt-px" />
                        <span className="break-all">{item.memo}</span>
                    </p>
                )}
            </div>
            <div className="flex items-center space-x-2 flex-shrink-0">
                <span className="w-14 text-center text-gray-800 font-bold text-lg select-none">{item.quantity}</span>
                <span className="w-10 text-center text-gray-600 font-medium select-none text-sm">{item.unit}</span>
                <button onClick={(e) => { e.stopPropagation(); onRemove(item); }} className="text-gray-400 hover:text-rose-500 p-1.5 rounded-full hover:bg-rose-50 z-10 relative transition-colors">
                    <RemoveIcon className="w-5 h-5"/>
                </button>
            </div>
        </div>
    );
});
OrderItemRow.displayName = 'OrderItemRow';

const NewOrderPage: React.FC<NewOrderPageProps> = ({ isActive }) => {
    const { customers, products } = useDataState();
    const { addOrder } = useDataActions();
    const { showAlert } = useAlert();
    const { openScanner } = useScanner();
    const { setLastModifiedOrderId } = useMiscUI();
    const { openAddItemModal, openEditItemModal, openMemoModal } = useModals();

    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [customerSearch, setCustomerSearch] = useState('');
    const debouncedCustomerSearch = useDebounce(customerSearch, 200);
    const [productSearch, setProductSearch] = useState('');
    const debouncedProductSearch = useDebounce(productSearch, 200);
    const [memo, setMemo] = useState('');
    
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
    const [showProductDropdown, setShowProductDropdown] = useState(false);

    const isCustomerSelected = !!selectedCustomer; 

    const [isBoxUnitDefault, setIsBoxUnitDefault] = useState(false);
    
    const [isSaving, setIsSaving] = useState(false);
    
    const [isDraftLoading, setIsDraftLoading] = useState(true);
    const [showDraftLoadedToast, setShowDraftLoadedToast] = useState(false);

    const productSearchInputRef = useRef<HTMLInputElement>(null);
    const customerSearchInputRef = useRef<HTMLInputElement>(null);
    const scrollableContainerRef = useRef<HTMLDivElement | null>(null);
    const customerSearchBlurTimeout = useRef<number | null>(null);
    const productSearchBlurTimeout = useRef<number | null>(null);

    const initialOrderItems = useMemo(() => [], []);

    const {
        items,
        addOrUpdateItem,
        updateItem,
        removeItem,
        resetItems,
        totalAmount,
    } = useOrderManager({
        initialItems: initialOrderItems,
    });
    
    const itemsRef = useRef(items);
    useEffect(() => {
        itemsRef.current = items;
    }, [items]);

    // --- Draft Logic ---
    const draftDataToSave = useMemo(() => ({
        selectedCustomer,
        items,
        memo,
        isBoxUnitDefault,
    }), [selectedCustomer, items, memo, isBoxUnitDefault]);

    const debouncedDraftData = useDebounce(draftDataToSave, 500);

    useEffect(() => {
        getDraft<NewOrderDraft>(DRAFT_KEY).then(draft => {
            if (draft) {
                setSelectedCustomer(draft.selectedCustomer);
                if (draft.selectedCustomer) {
                    setCustomerSearch(draft.selectedCustomer.name);
                }
                resetItems(draft.items);
                setMemo(draft.memo);
                setIsBoxUnitDefault(draft.isBoxUnitDefault);
                setShowDraftLoadedToast(true);
                setTimeout(() => setShowDraftLoadedToast(false), 3000);
            }
            setIsDraftLoading(false);
        }).catch(err => {
            console.error("Failed to load draft:", err);
            setIsDraftLoading(false);
        });
    }, [resetItems]);

    useEffect(() => {
        if (isDraftLoading) return;

        if (debouncedDraftData.selectedCustomer || debouncedDraftData.items.length > 0 || debouncedDraftData.memo) {
            saveDraft(DRAFT_KEY, debouncedDraftData as NewOrderDraft)
                .catch(err => console.warn("Could not save new order draft:", err));
        } else {
            deleteDraft(DRAFT_KEY)
                .catch(err => console.warn("Could not delete new order draft:", err));
        }
    }, [debouncedDraftData, isDraftLoading]);

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
        if (!searchTerm || isCustomerSelected) return [];
        return customers.filter(c => c.name.toLowerCase().includes(searchTerm) || c.comcode.includes(searchTerm));
    }, [customers, debouncedCustomerSearch, isCustomerSelected]);

    const filteredProducts = useMemo(() => {
        const searchTerm = debouncedProductSearch.trim().toLowerCase();
        if (!searchTerm) return [];
        
        const results: Product[] = [];
        for (const p of products) {
            if (p.name.toLowerCase().includes(searchTerm) || p.barcode.includes(searchTerm)) {
                results.push(p);
                if (results.length >= MAX_SEARCH_RESULTS) {
                    break;
                }
            }
        }
        return results;
    }, [products, debouncedProductSearch]);

    const handleSelectCustomer = (customer: Customer) => {
        setSelectedCustomer(customer);
        setCustomerSearch(customer.name);
        setShowCustomerDropdown(false);
        productSearchInputRef.current?.focus();
    };

    const handleClearCustomer = () => {
        setSelectedCustomer(null);
        setCustomerSearch('');
        setTimeout(() => customerSearchInputRef.current?.focus(), 0);
    };

    const resetOrder = useCallback((options?: { preventFocus?: boolean }) => {
        setSelectedCustomer(null);
        setCustomerSearch('');
        setProductSearch('');
        resetItems();
        setMemo('');
        setIsBoxUnitDefault(false);

        if (options?.preventFocus) {
             if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }
        } else {
            customerSearchInputRef.current?.focus();
        }
    }, [resetItems]);

    const handleResetOrder = useCallback(() => {
        showAlert(
            "작성 중인 모든 내용을 삭제하시겠습니까?\n임시 저장된 내용도 삭제됩니다.",
            () => {
                deleteDraft(DRAFT_KEY)
                    .catch(err => console.warn("Could not delete draft on reset:", err));
                resetOrder();
            },
            '삭제',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    }, [showAlert, resetOrder]);
    
    const handleSaveOrder = useCallback(async () => {
        if (!selectedCustomer) {
            showAlert("거래처를 선택해주세요.");
            return;
        }
        if (items.length === 0) {
            showAlert("발주할 품목이 없습니다.");
            return;
        }

        setIsSaving(true);
        try {
            const newOrderId = await addOrder({
                customer: selectedCustomer,
                items,
                total: totalAmount,
                memo: memo.trim(),
            });
            setLastModifiedOrderId(newOrderId);
            
            deleteDraft(DRAFT_KEY).catch(err => {
                console.warn("Background draft deletion failed, but order was saved.", err);
            });
            
            resetOrder({ preventFocus: true });
        } catch (error) {
            console.error("Failed to save order:", error);
            showAlert("발주 저장에 실패했습니다. 작성 중인 내용은 임시 저장되어 다음에 다시 시도할 수 있습니다.");
        } finally {
            setIsSaving(false);
        }
    }, [selectedCustomer, items, totalAmount, memo, addOrder, setLastModifiedOrderId, resetOrder, showAlert]);

    const handleAddProductFromSearch = useCallback((product: Product) => {
        const existingItem = items.find(item => item.barcode === product.barcode);
        openAddItemModal({
            product,
            existingItem: existingItem || null,
            trigger: 'search',
            onAdd: (details) => addOrUpdateItem(product, details),
            initialSettings: { unit: isBoxUnitDefault ? '박스' : '개' }
        });
        setProductSearch('');
        setShowProductDropdown(false);
        productSearchInputRef.current?.blur();
    }, [items, openAddItemModal, addOrUpdateItem, isBoxUnitDefault]);

    const handleOpenScanner: () => void = useCallback(() => {
        if (!isCustomerSelected) {
            showAlert("먼저 거래처를 선택해주세요.");
            return;
        }
        const onScan = (barcode: string) => {
            const product = products.find(p => p.barcode === barcode);
            if (product) {
                const existingItem = itemsRef.current.find(item => item.barcode === product.barcode);
                openAddItemModal({
                    product,
                    existingItem,
                    trigger: 'scan',
                    onAdd: (details) => addOrUpdateItem(product, details),
                    onNextScan: handleOpenScanner,
                    initialSettings: { unit: isBoxUnitDefault ? '박스' : '개' }
                });
            } else {
                showAlert("등록되지 않은 바코드입니다.");
            }
        };
        openScanner('new-order', onScan, true);
    }, [isCustomerSelected, showAlert, openScanner, products, itemsRef, openAddItemModal, addOrUpdateItem, isBoxUnitDefault]);


    const handleRemoveItem = useCallback((item: OrderItem) => {
        showAlert(
            `'${item.name}' 품목을 삭제하시겠습니까?`,
            () => removeItem(item.barcode),
            '삭제',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    }, [showAlert, removeItem]);

    const handleEditItem = useCallback((item: OrderItem) => {
        openEditItemModal({
            item: item,
            onSave: (updatedDetails) => updateItem(item.barcode, updatedDetails)
        });
    }, [openEditItemModal, updateItem]);

    const handleOpenMemoModal = useCallback(() => {
        openMemoModal({
            initialMemo: memo,
            onSave: (newMemo) => setMemo(newMemo),
        });
    }, [memo, openMemoModal]);

    if (isDraftLoading) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-transparent">
                <SpinnerIcon className="w-10 h-10 text-blue-500" />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col relative bg-white">
            <DraftLoadedToast show={showDraftLoadedToast} />
            <div className="w-full py-2 px-3 bg-white flex-shrink-0 z-20 border-b border-gray-200">
                <div className="grid grid-cols-[1fr_auto] items-stretch gap-2 w-full max-w-2xl mx-auto">
                    <div className="flex flex-col gap-2">
                        <div className="relative">
                            <input
                                ref={customerSearchInputRef}
                                type="text"
                                value={customerSearch}
                                onChange={(e) => setCustomerSearch(e.target.value)}
                                onFocus={() => {
                                    if (customerSearchBlurTimeout.current) clearTimeout(customerSearchBlurTimeout.current);
                                    if (!isCustomerSelected) setShowCustomerDropdown(true);
                                }}
                                onBlur={() => {
                                    customerSearchBlurTimeout.current = window.setTimeout(() => setShowCustomerDropdown(false), 200);
                                }}
                                placeholder="거래처 검색"
                                readOnly={isCustomerSelected}
                                className={`w-full px-3 h-11 border ${isCustomerSelected ? 'border-blue-500 bg-blue-50 pr-28 font-semibold text-blue-800' : 'border-gray-300 bg-white'} rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 text-base`}
                                autoComplete="off"
                            />
                             {isCustomerSelected && (
                                <button
                                    onClick={handleClearCustomer}
                                    className="absolute top-1/2 right-1.5 -translate-y-1/2 h-8 px-3 rounded-md flex items-center justify-center gap-1.5 font-semibold transition bg-gray-200 text-gray-700 hover:bg-gray-300 active:scale-95 text-sm"
                                    aria-label="거래처 변경"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0114.13-6.36M20 15a9 9 0 01-14.13 6.36" />
                                    </svg>
                                    <span>변경</span>
                                </button>
                            )}
                            <SearchDropdown<Customer>
                                items={filteredCustomers}
                                renderItem={(c) => (
                                    <div onClick={() => handleSelectCustomer(c)} className="p-3 hover:bg-gray-100 cursor-pointer">
                                        <p className="font-semibold text-gray-800">{c.name}</p>
                                        <p className="text-sm text-gray-500">{c.comcode}</p>
                                    </div>
                                )}
                                show={showCustomerDropdown}
                            />
                        </div>
                        <div className="relative">
                            <input
                                ref={productSearchInputRef}
                                type="text"
                                value={productSearch}
                                onChange={(e) => setProductSearch(e.target.value)}
                                onFocus={() => {
                                    if (productSearchBlurTimeout.current) clearTimeout(productSearchBlurTimeout.current);
                                    setShowProductDropdown(true);
                                }}
                                onBlur={() => {
                                    productSearchBlurTimeout.current = window.setTimeout(() => setShowProductDropdown(false), 200);
                                }}
                                placeholder="품목명 또는 바코드 검색"
                                disabled={!isCustomerSelected}
                                className={`w-full px-3 h-11 border ${isCustomerSelected ? 'border-gray-300 bg-white' : 'border-gray-200 bg-gray-100'} rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder:text-gray-400 transition-colors duration-200 text-base pr-28`}
                                autoComplete="off"
                            />
                            <div className="absolute top-1/2 right-2 -translate-y-1/2 flex items-center">
                                <ToggleSwitch id="new-order-box-unit" label="박스" checked={isBoxUnitDefault} onChange={setIsBoxUnitDefault} color="blue" />
                            </div>
                            <SearchDropdown<Product>
                                items={filteredProducts}
                                renderItem={(p) => <ProductSearchResultItem product={p} onClick={handleAddProductFromSearch} />}
                                show={showProductDropdown}
                            />
                        </div>
                    </div>
                    <button onClick={handleOpenScanner} disabled={!isCustomerSelected} className="w-20 bg-blue-600 text-white rounded-lg flex flex-col items-center justify-center gap-1 font-bold hover:bg-blue-700 transition active:scale-95 shadow shadow-blue-500/30 disabled:bg-gray-400 disabled:shadow-none disabled:cursor-not-allowed">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg>
                        <span className="text-xs">스캔</span>
                    </button>
                </div>
            </div>

            <main ref={scrollableContainerRef} className="scrollable-content flex-grow">
                {items.length > 0 && (
                    <div className="max-w-2xl mx-auto divide-y divide-gray-200">
                        {items.map(item => (
                            <OrderItemRow 
                                key={item.barcode} 
                                item={item}
                                product={products.find(p => p.barcode === item.barcode)}
                                onEdit={handleEditItem} 
                                onRemove={handleRemoveItem}
                            />
                        ))}
                    </div>
                )}
            </main>

            <footer className="p-2 bg-white border-t border-gray-200 z-10 flex-shrink-0">
                <div className="max-w-2xl mx-auto">
                    <div className="flex justify-between items-center font-bold mb-2 px-2">
                        <span className="text-lg text-gray-600">총 합계:</span>
                        <span className="text-2xl text-gray-900 tracking-tighter">{totalAmount.toLocaleString()} 원</span>
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                         <button onClick={handleOpenMemoModal} className="h-11 bg-gray-200 text-gray-700 rounded-lg font-semibold text-base hover:bg-gray-300 transition shadow-sm flex items-center justify-center active:scale-95 col-span-1">
                            <span>메모</span>
                        </button>
                        <button onClick={handleResetOrder} className="h-11 bg-gray-200 text-gray-700 rounded-lg font-semibold text-base hover:bg-gray-300 transition shadow-sm flex items-center justify-center active:scale-95 col-span-1">
                            <span>삭제</span>
                        </button>
                        <button onClick={handleSaveOrder} disabled={isSaving || items.length === 0 || !selectedCustomer} className="relative h-11 bg-blue-600 text-white rounded-lg font-bold text-base hover:bg-blue-700 transition shadow-lg shadow-blue-500/40 disabled:bg-gray-400 disabled:shadow-none disabled:cursor-not-allowed flex items-center justify-center active:scale-95 col-span-3">
                            <span className={isSaving ? 'opacity-0' : 'opacity-100'}>발주 저장</span>
                            {isSaving && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <SpinnerIcon className="w-6 h-6"/>
                                </div>
                            )}
                        </button>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default NewOrderPage;