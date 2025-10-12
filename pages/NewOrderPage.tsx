import React, { useState, useMemo, useEffect, useCallback, useRef, memo } from 'react';
import { useDataState, useDataActions, useUIActions } from '../context/AppContext';
import { Customer, Product, OrderItem, NewOrderDraft } from '../types';
import { RemoveIcon, DocumentTextIcon, SpinnerIcon, TrashIcon, ChatBubbleLeftIcon } from '../components/Icons';
import ToggleSwitch from '../components/ToggleSwitch';
import { useOrderManager } from '../hooks/useOrderManager';
import AddItemModal from '../components/AddItemModal';
import EditItemModal from '../components/EditItemModal';
import { useDebounce } from '../hooks/useDebounce';
import { getDraft, saveDraft, deleteDraft } from '../services/draftDbService';
import MemoModal from '../components/MemoModal';
import SearchDropdown from '../components/SearchDropdown';

const DRAFT_KEY = 'new-order-draft';

interface NewOrderPageProps {
    isActive: boolean;
}

const DraftLoadedToast: React.FC<{ show: boolean }> = ({ show }) => {
    if (!show) return null;
    return (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 mt-4 bg-gray-800 text-white text-sm font-semibold py-2 px-4 rounded-full shadow-lg z-50 animate-fade-in-down">
            임시저장된 내용을 불러왔습니다.
        </div>
    );
};

const OrderItemRow = memo(({ item, onEdit, onRemove }: { item: OrderItem; onEdit: (item: OrderItem) => void; onRemove: (item: OrderItem) => void }) => {
    return (
        <div
            className="flex items-center p-3 space-x-2 cursor-pointer hover:bg-gray-50"
            onClick={() => onEdit(item)}
        >
            <div className="flex-grow min-w-0 pr-1">
                <p className="font-semibold text-sm text-gray-800 break-words whitespace-pre-wrap flex items-center gap-2">
                    <span>{item.name}</span>
                </p>
                {item.memo && (
                    <p className="text-xs text-blue-600 flex items-start gap-1 mt-0.5">
                        <ChatBubbleLeftIcon className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                        <span className="break-all">{item.memo}</span>
                    </p>
                )}
                <p className="text-xs text-gray-500 mt-0.5">{item.price.toLocaleString()}원</p>
            </div>
            <div className="flex items-center space-x-1.5 flex-shrink-0">
                <span className="w-12 text-center text-gray-600 font-medium select-none text-sm">{item.quantity}</span>
                <span className="w-8 text-center text-gray-600 font-medium select-none text-sm">{item.unit}</span>
                <button onClick={(e) => { e.stopPropagation(); onRemove(item); }} className="text-gray-400 hover:text-rose-500 p-0.5 z-10 relative">
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
    const { showAlert, openScanner, setLastModifiedOrderId } = useUIActions();

    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [customerSearch, setCustomerSearch] = useState('');
    const [productSearch, setProductSearch] = useState('');
    const [memo, setMemo] = useState('');
    const [isMemoModalOpen, setIsMemoModalOpen] = useState(false);
    
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
    const [showProductDropdown, setShowProductDropdown] = useState(false);

    const isCustomerSelected = !!selectedCustomer; 

    const [isBoxUnitDefault, setIsBoxUnitDefault] = useState(false);
    
    const [productForModal, setProductForModal] = useState<Product | null>(null);
    const [existingItemForModal, setExistingItemForModal] = useState<OrderItem | null>(null);
    const [editingItem, setEditingItem] = useState<OrderItem | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [addItemTrigger, setAddItemTrigger] = useState<'scan' | 'search'>('search');
    
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

    // Load draft on mount
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

    // Save draft on change
    useEffect(() => {
        if (isDraftLoading) return;

        if (debouncedDraftData.selectedCustomer || debouncedDraftData.items.length > 0 || debouncedDraftData.memo) {
            saveDraft(DRAFT_KEY, debouncedDraftData as NewOrderDraft);
        } else {
            deleteDraft(DRAFT_KEY);
        }
    }, [debouncedDraftData, isDraftLoading]);
    // --- End Draft Logic ---

    useEffect(() => {
        if (scrollableContainerRef.current) {
            scrollableContainerRef.current.scrollTo({
                top: scrollableContainerRef.current.scrollHeight,
                behavior: 'smooth',
            });
        }
    }, [items.length]);
    
    const filteredCustomers = useMemo(() => {
        const searchTerm = customerSearch.trim().toLowerCase();
        if (!searchTerm || isCustomerSelected) return [];
        return customers.filter(c => c.name.toLowerCase().includes(searchTerm) || c.comcode.includes(searchTerm));
    }, [customers, customerSearch, isCustomerSelected]);

    const filteredProducts = useMemo(() => {
        const searchTerm = productSearch.trim().toLowerCase();
        if (!searchTerm) return [];
        return products.filter(p => p.name.toLowerCase().includes(searchTerm) || p.barcode.includes(searchTerm));
    }, [products, productSearch]);

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
        }
    }, [selectedCustomer, items, totalAmount, memo, addOrder, setLastModifiedOrderId, resetOrder, showAlert]);

    const handleAddProductFromSearch = (product: Product) => {
        setAddItemTrigger('search');
        const existingItem = items.find(item => item.barcode === product.barcode);
        setProductForModal(product);
        setExistingItemForModal(existingItem || null);
        setProductSearch('');
        setShowProductDropdown(false);
        productSearchInputRef.current?.blur();
    };

    const handleScanSuccess = useCallback((barcode: string) => {
        const product = products.find(p => p.barcode === barcode);
        if (product) {
            setAddItemTrigger('scan');
            const existingItem = itemsRef.current.find(item => item.barcode === product.barcode);
            setProductForModal(product);
            setExistingItemForModal(existingItem || null);
        } else {
            showAlert("등록되지 않은 바코드입니다.");
        }
    }, [products, showAlert]);

    const handleOpenScanner = useCallback(() => {
        if (!isCustomerSelected) {
            showAlert("먼저 거래처를 선택해주세요.");
            return;
        }
        openScanner('new-order', handleScanSuccess, true);
    }, [isCustomerSelected, showAlert, openScanner, handleScanSuccess]);

    const handleRemoveItem = useCallback((item: OrderItem) => {
        showAlert(
            `'${item.name}' 품목을 삭제하시겠습니까?`,
            () => removeItem(item.barcode),
            '삭제',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    }, [showAlert, removeItem]);

    const handleAddItemFromModal = useCallback((product: Product, details: { quantity: number; unit: '개' | '박스'; memo?: string; }) => {
        addOrUpdateItem(product, details);
        setProductForModal(null);
        setExistingItemForModal(null);
    }, [addOrUpdateItem]);

    const handleEditItem = useCallback((item: OrderItem) => {
        setEditingItem(item);
    }, []);

    if (isDraftLoading) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-gray-50">
                <SpinnerIcon className="w-10 h-10 text-blue-500" />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col relative">
            <DraftLoadedToast show={showDraftLoadedToast} />
            <div className="p-2 bg-white shadow-md flex-shrink-0 z-20">
                <div className="flex gap-2">
                    {/* Left Column for inputs */}
                    <div className="flex flex-col gap-2 flex-grow">
                        {/* Customer Search */}
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
                                className={`w-full p-2 h-11 border ${isCustomerSelected ? 'border-blue-400 bg-blue-50 pr-24' : 'border-gray-300'} rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-500 transition-colors`}
                                autoComplete="off"
                            />
                             {isCustomerSelected && (
                                <button
                                    onClick={handleClearCustomer}
                                    className="absolute top-1/2 right-2 -translate-y-1/2 h-8 px-3 rounded-lg flex items-center justify-center gap-1.5 font-semibold transition bg-gray-200 text-gray-700 hover:bg-gray-300"
                                    aria-label="거래처 변경"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
                        
                        {/* Product Search */}
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
                                className="w-full p-2 h-11 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-500 placeholder:text-gray-400 pr-24"
                                disabled={!isCustomerSelected}
                                autoComplete="off"
                            />
                            <div className="absolute top-1/2 right-2 -translate-y-1/2 flex items-center">
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
                                    <div onClick={() => handleAddProductFromSearch(p)} className="p-3 hover:bg-gray-100 cursor-pointer text-gray-700">
                                        <div>{p.name} <span className="text-sm text-gray-500">({p.barcode})</span></div>
                                    </div>
                                )}
                                show={showProductDropdown}
                            />
                        </div>
                    </div>
                    
                    {/* Right Column for Scan Button */}
                    <div className="flex-shrink-0">
                        <button
                            onClick={handleOpenScanner}
                            className="h-full w-24 bg-blue-600 text-white rounded-lg p-2 flex flex-col items-center justify-center gap-1 font-bold hover:bg-blue-700 transition disabled:bg-gray-400"
                            disabled={!isCustomerSelected}
                            aria-label="바코드 스캔"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg>
                            <span className="text-sm">스캔</span>
                        </button>
                    </div>
                </div>
            </div>

            <div ref={scrollableContainerRef} className="scrollable-content p-2 pb-32">
                 {items.length === 0 ? (
                    <div className="relative flex flex-col items-center justify-center h-full text-gray-400">
                        <p className="text-center text-lg font-semibold">발주 품목이 없습니다</p>
                        <p className="text-sm">스캐너 또는 검색을 이용해 품목을 추가하세요.</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-lg shadow-md border border-gray-200/80 overflow-hidden">
                        <div className="divide-y divide-gray-200">
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

            <footer className="absolute bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-lg border-t border-gray-200/60 shadow-[0_-5px_25px_rgba(0,0,0,0.1)]">
                <div className="flex justify-between items-center font-bold mb-3">
                    <span className="text-lg text-gray-600">총 합계:</span>
                    <span className="text-2xl text-gray-800">{totalAmount.toLocaleString()} 원</span>
                </div>
                 <div className="flex items-stretch gap-2">
                    <button 
                        onClick={handleResetOrder} 
                        className="px-4 py-3 bg-gray-200 text-gray-800 rounded-xl font-bold text-base hover:bg-gray-300 transition shadow-sm flex items-center justify-center gap-2 flex-shrink-0"
                    >
                        <TrashIcon className="w-5 h-5" />
                    </button>
                    <button 
                        onClick={() => setIsMemoModalOpen(true)} 
                        disabled={items.length === 0}
                        className="px-4 py-3 bg-gray-200 text-gray-800 rounded-xl font-bold text-base hover:bg-gray-300 transition shadow-sm flex items-center justify-center gap-2 flex-shrink-0 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                    >
                        <DocumentTextIcon className="w-5 h-5"/>
                        <span className="hidden sm:inline">{memo ? '메모 수정' : '메모 추가'}</span>
                    </button>
                    <button 
                        onClick={handleSaveOrder} 
                        disabled={isSaving || items.length === 0 || !isCustomerSelected}
                        className="flex-grow bg-gradient-to-b from-blue-500 to-blue-600 text-white p-3 rounded-xl font-bold text-base hover:from-blue-600 hover:to-blue-700 transition shadow-lg shadow-blue-500/30 disabled:from-gray-400 disabled:to-gray-500 disabled:shadow-none disabled:cursor-not-allowed flex items-center justify-center"
                    >
                        {isSaving ? <SpinnerIcon className="w-6 h-6"/> : '신규 발주 저장'}
                    </button>
                </div>
            </footer>

            <MemoModal
                isOpen={isMemoModalOpen}
                onClose={() => setIsMemoModalOpen(false)}
                onSave={(newMemo) => { setMemo(newMemo); setIsMemoModalOpen(false); }}
                initialMemo={memo}
            />
            <AddItemModal
                isOpen={!!productForModal}
                product={productForModal}
                existingItem={existingItemForModal}
                onClose={() => {
                    setProductForModal(null);
                    setExistingItemForModal(null);
                }}
                onAdd={(details) => {
                    if (productForModal) {
                        handleAddItemFromModal(productForModal, details);
                    }
                }}
                onNextScan={handleOpenScanner}
                trigger={addItemTrigger}
                initialSettings={{ unit: isBoxUnitDefault ? '박스' : '개' }}
            />
            <EditItemModal
                isOpen={!!editingItem}
                item={editingItem}
                onClose={() => setEditingItem(null)}
                onSave={(updatedDetails) => {
                    if (editingItem) {
                        updateItem(editingItem.barcode, updatedDetails);
                    }
                    setEditingItem(null);
                }}
            />
        </div>
    );
};

export default NewOrderPage;