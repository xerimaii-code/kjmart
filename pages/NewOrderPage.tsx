import React, { useState, useMemo, useEffect, useCallback, useRef, memo } from 'react';
import { useDataState, useDataActions, useUIActions } from '../context/AppContext';
import { Customer, Product, OrderItem, NewOrderDraft } from '../types';
import { RemoveIcon, DocumentTextIcon, SpinnerIcon, TrashIcon, ChatBubbleLeftIcon, PlusCircleIcon } from '../components/Icons';
import ToggleSwitch from '../components/ToggleSwitch';
import { useOrderManager, isSaleActive } from '../hooks/useOrderManager';
import { useDebounce } from '../hooks/useDebounce';
import { getDraft, saveDraft, deleteDraft } from '../services/draftDbService';
import SearchDropdown from '../components/SearchDropdown';

const DRAFT_KEY = 'new-order-draft';

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

const OrderItemRow = memo(({ item, onEdit, onRemove }: { item: OrderItem; onEdit: (item: OrderItem) => void; onRemove: (item: OrderItem) => void }) => {
    return (
        <div
            className="flex items-center p-3.5 space-x-3 cursor-pointer hover:bg-gray-50 transition-colors duration-200"
            onClick={() => onEdit(item)}
        >
            <div className="flex-grow min-w-0 pr-1">
                <p className="font-semibold text-gray-800 break-words whitespace-pre-wrap flex items-center gap-2">
                    <span>{item.name}</span>
                </p>
                {item.memo && (
                    <p className="text-xs text-blue-600 flex items-start gap-1.5 mt-1">
                        <ChatBubbleLeftIcon className="w-4 h-4 flex-shrink-0 mt-px" />
                        <span className="break-all">{item.memo}</span>
                    </p>
                )}
                <p className="text-sm text-gray-500 mt-1">{item.price.toLocaleString()}원</p>
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

const ProductSearchResultItem: React.FC<{ product: Product, onClick: (product: Product) => void }> = ({ product, onClick }) => {
    const saleIsActive = isSaleActive(product.saleEndDate);
    const hasSalePrice = !!product.salePrice;

    return (
        <div onClick={() => onClick(product)} className="p-3 hover:bg-gray-100 cursor-pointer text-gray-700 border-b border-gray-100 last:border-b-0">
            <p className="font-semibold">{product.name} <span className="text-sm text-gray-500">({product.barcode})</span></p>
            <div className="text-sm mt-1 flex flex-wrap gap-x-3 items-center">
                <span className="text-gray-500">
                    판가: <span className={`${(saleIsActive && hasSalePrice) ? 'line-through' : 'font-bold text-gray-800'}`}>{product.sellingPrice?.toLocaleString()}원</span>
                </span>
                {hasSalePrice && (
                    <span className="text-red-600 font-bold">
                        행사가: {product.salePrice}
                    </span>
                )}
            </div>
            {saleIsActive && hasSalePrice && product.saleEndDate && (
                 <p className="text-xs text-blue-600 font-semibold mt-1">행사 종료: ~{product.saleEndDate}</p>
            )}
        </div>
    );
};


const NewOrderPage: React.FC<NewOrderPageProps> = ({ isActive }) => {
    const { customers, products } = useDataState();
    const { addOrder } = useDataActions();
    const { 
        showAlert, 
        openScanner, 
        setLastModifiedOrderId, 
        openAddItemModal, 
        openEditItemModal, 
        openMemoModal,
        closeAddItemModal,
        closeEditItemModal,
        closeMemoModal 
    } = useUIActions();

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

    // This effect ensures that if the user swipes away from the New Order page,
    // any modals opened from this page are closed, preventing them from
    // "leaking" onto other pages.
    useEffect(() => {
        if (!isActive) {
            closeAddItemModal();
            closeEditItemModal();
            closeMemoModal();
        }
    }, [isActive, closeAddItemModal, closeEditItemModal, closeMemoModal]);

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
            saveDraft(DRAFT_KEY, debouncedDraftData as NewOrderDraft);
        } else {
            deleteDraft(DRAFT_KEY);
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
        return products.filter(p => p.name.toLowerCase().includes(searchTerm) || p.barcode.includes(searchTerm));
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
        setIsSaving(false);

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
            "작성 중인 모든 내용을 초기화하시겠습니까?\n임시 저장된 내용도 삭제됩니다.",
            () => {
                deleteDraft(DRAFT_KEY);
                resetOrder();
            },
            '초기화',
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
            await deleteDraft(DRAFT_KEY);
            resetOrder({ preventFocus: true });
        } catch (error) {
            console.error("Failed to save order:", error);
            showAlert("발주 저장에 실패했습니다.");
            setIsSaving(false);
        } finally {
            setIsSaving(false);
        }
    }, [selectedCustomer, items, totalAmount, memo, addOrder, setLastModifiedOrderId, resetOrder, showAlert]);

    const handleAddProductFromSearch = (product: Product) => {
        const existingItem = items.find(item => item.barcode === product.barcode);
        openAddItemModal({
            product: product,
            existingItem: existingItem || null,
            onAdd: (details) => addOrUpdateItem(product, details),
            trigger: 'search',
            initialSettings: { unit: isBoxUnitDefault ? '박스' : '개' },
        });
        setProductSearch('');
        setShowProductDropdown(false);
        productSearchInputRef.current?.blur();
    };

    const handleOpenScanner = useCallback(() => {
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
                    existingItem: existingItem || null,
                    onAdd: (details) => addOrUpdateItem(product, details),
                    onNextScan: handleOpenScanner,
                    trigger: 'scan',
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
            item,
            onSave: (updatedDetails) => {
                updateItem(item.barcode, updatedDetails);
            },
        });
    }, [openEditItemModal, updateItem]);

    if (isDraftLoading) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-transparent">
                <SpinnerIcon className="w-10 h-10 text-blue-500" />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col relative bg-transparent">
            <DraftLoadedToast show={showDraftLoadedToast} />
            <div className="p-3 bg-white/60 backdrop-blur-lg flex-shrink-0 z-20 border-b border-gray-200/80">
                <div className="flex gap-2">
                    <div className="flex flex-col gap-2 flex-grow">
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
                                className={`w-full p-3 h-12 border-2 ${isCustomerSelected ? 'border-blue-500 bg-blue-50 pr-28 font-semibold text-blue-800' : 'border-gray-300 bg-white'} rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-blue-500 transition-colors duration-200 text-base`}
                                autoComplete="off"
                            />
                             {isCustomerSelected && (
                                <button
                                    onClick={handleClearCustomer}
                                    className="absolute top-1/2 right-2.5 -translate-y-1/2 h-9 px-4 rounded-lg flex items-center justify-center gap-1.5 font-semibold transition bg-gray-200 text-gray-700 hover:bg-gray-300 active:scale-95"
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
                                    <div onClick={() => handleSelectCustomer(c)} className="p-3 hover:bg-gray-100 cursor-pointer text-gray-700">
                                        {c.name} <span className="text-sm text-gray-500">({c.comcode})</span>
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
                                placeholder={isCustomerSelected ? "품목명 또는 바코드 검색" : "거래처를 먼저 선택하세요"}
                                className="w-full p-3 h-12 border-2 border-gray-300 bg-white rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-blue-500 placeholder:text-gray-400 disabled:bg-gray-100 disabled:cursor-not-allowed transition-colors duration-200 text-base pr-28"
                                disabled={!isCustomerSelected}
                                autoComplete="off"
                            />
                            <div className="absolute top-1/2 right-3 -translate-y-1/2 flex items-center">
                                <ToggleSwitch
                                    id="new-order-box-unit"
                                    label="박스"
                                    checked={isBoxUnitDefault}
                                    onChange={setIsBoxUnitDefault}
                                    disabled={!isCustomerSelected}
                                    color="blue"
                                />
                            </div>
                            <SearchDropdown<Product>
                                items={filteredProducts}
                                renderItem={(p) => (
                                    <ProductSearchResultItem product={p} onClick={handleAddProductFromSearch} />
                                )}
                                show={showProductDropdown}
                            />
                        </div>
                    </div>
                    
                    <div className="flex-shrink-0 ml-2">
                        <button
                            onClick={handleOpenScanner}
                            className="h-full w-24 bg-blue-600 text-white rounded-xl p-2 flex flex-col items-center justify-center gap-1.5 font-bold hover:bg-blue-700 transition active:scale-95 disabled:bg-gray-400 disabled:cursor-not-allowed shadow-lg shadow-blue-500/30"
                            disabled={!isCustomerSelected}
                            aria-label="바코드 스캔"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-9 w-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg>
                            <span className="text-sm">스캔</span>
                        </button>
                    </div>
                </div>
            </div>

            <div ref={scrollableContainerRef} className="scrollable-content p-3 pb-40">
                 {items.length === 0 ? (
                    <div className="relative flex flex-col items-center justify-center h-full text-gray-400 mt-[-5rem]">
                        <PlusCircleIcon className="w-16 h-16 text-gray-300 mb-4"/>
                        <p className="text-center text-lg font-semibold">발주 품목이 없습니다</p>
                        <p className="text-sm">스캐너 또는 검색을 이용해 품목을 추가하세요.</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-xl shadow-lg border border-gray-200/60 overflow-hidden">
                        <div className="divide-y divide-gray-100">
                            {items.map((item) => (
                                <OrderItemRow 
                                    key={item.barcode} 
                                    item={item} 
                                    onEdit={handleEditItem} 
                                    onRemove={handleRemoveItem} 
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <footer className="absolute bottom-0 left-0 right-0 p-3 bg-white/80 backdrop-blur-xl border-t border-gray-200/60">
                <div className="flex justify-between items-center font-bold mb-3 px-2">
                    <span className="text-lg text-gray-600">총 합계:</span>
                    <span className="text-2xl text-gray-900 tracking-tighter">{totalAmount.toLocaleString()} 원</span>
                </div>
                 <div className="flex items-stretch gap-2">
                    <button 
                        onClick={handleResetOrder} 
                        className="px-4 py-3 bg-gray-200 text-gray-700 rounded-xl font-bold text-base hover:bg-gray-300 transition shadow-sm flex items-center justify-center gap-2 flex-shrink-0 active:scale-95"
                    >
                        <TrashIcon className="w-5 h-5" />
                    </button>
                    <button 
                        onClick={() => openMemoModal({
                            initialMemo: memo,
                            onSave: (newMemo) => { setMemo(newMemo); }
                        })}
                        disabled={items.length === 0}
                        className="px-4 py-3 bg-gray-200 text-gray-700 rounded-xl font-bold text-base hover:bg-gray-300 transition shadow-sm flex items-center justify-center gap-2 flex-shrink-0 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed active:scale-95"
                    >
                        <DocumentTextIcon className="w-5 h-5"/>
                        <span className="hidden sm:inline">{memo ? '메모 수정' : '메모 추가'}</span>
                    </button>
                    <button 
                        onClick={handleSaveOrder} 
                        disabled={isSaving || items.length === 0 || !isCustomerSelected}
                        className="flex-grow bg-blue-600 text-white p-3 rounded-xl font-bold text-base hover:bg-blue-700 transition shadow-lg shadow-blue-500/40 disabled:bg-gray-400 disabled:shadow-none disabled:cursor-not-allowed flex items-center justify-center active:scale-95"
                    >
                        {isSaving ? <SpinnerIcon className="w-6 h-6"/> : '신규 발주 저장'}
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default NewOrderPage;
