import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useData, useUI } from '../context/AppContext';
import { Customer, Product, OrderItem } from '../types';
import { RemoveIcon, DocumentTextIcon, SpinnerIcon } from '../components/Icons';
import ToggleSwitch from '../components/ToggleSwitch';
import { useOrderManager } from '../hooks/useOrderManager';
import AddItemModal from '../components/AddItemModal';
import EditItemModal from '../components/EditItemModal';
import { useLocalStorage } from '../hooks/useLocalStorage';

type OrderDraft = {
  customer: Customer | null;
  items: OrderItem[];
  memo: string;
};

const MemoModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (memo: string) => void;
    initialMemo: string;
}> = ({ isOpen, onClose, onSave, initialMemo }) => {
    const [memo, setMemo] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const MAX_CHARS = 200;

    useEffect(() => {
        if (isOpen) {
            setMemo(initialMemo);
            setTimeout(() => {
                textareaRef.current?.focus();
            }, 100);
        }
    }, [isOpen, initialMemo]);

    if (!isOpen) return null;

    const handleSave = () => {
        onSave(memo);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                    <h3 className="text-xl font-bold text-gray-800 text-center mb-4">메모 추가/수정</h3>
                    <div className="relative">
                        <textarea
                            ref={textareaRef}
                            value={memo}
                            onChange={(e) => setMemo(e.target.value)}
                            placeholder="내용을 입력하세요..."
                            maxLength={MAX_CHARS}
                            className="w-full h-32 p-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition resize-none"
                        />
                        <div className="absolute bottom-2 right-2 text-xs text-gray-400">
                            {memo.length} / {MAX_CHARS}
                        </div>
                    </div>
                </div>
                <div className="bg-gray-50 p-3 grid grid-cols-2 gap-3">
                    <button
                        onClick={onClose}
                        className="px-6 py-3 rounded-lg font-semibold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleSave}
                        className="text-white px-6 py-3 rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                    >
                        저장
                    </button>
                </div>
            </div>
        </div>
    );
};

interface SearchDropdownProps<T> {
    items: T[];
    renderItem: (item: T) => React.ReactNode;
    show: boolean;
}

const SearchDropdown = <T,>({ items, renderItem, show }: SearchDropdownProps<T>) => {
    if (!show || items.length === 0) return null;
    return (
        <div className="absolute z-30 w-full bg-white border border-gray-200 rounded-lg mt-1 max-h-72 overflow-y-auto shadow-lg">
            {items.map((item, index) => (
                <React.Fragment key={index}>{renderItem(item)}</React.Fragment>
            ))}
        </div>
    );
};

const NewOrderPage: React.FC = () => {
    const { customers, products, addOrder } = useData();
    const { showAlert, openScanner, closeScanner } = useUI();

    const [draft, setDraft] = useLocalStorage<OrderDraft | null>('newOrderDraft', null);

    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(() => draft?.customer || null);
    const [customerSearch, setCustomerSearch] = useState(() => draft?.customer?.name || '');
    const [productSearch, setProductSearch] = useState('');
    const [memo, setMemo] = useState(() => draft?.memo || '');
    const [isMemoModalOpen, setIsMemoModalOpen] = useState(false);
    
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
    const [showProductDropdown, setShowProductDropdown] = useState(false);
    const [isCustomerLocked, setIsCustomerLocked] = useState(() => !!draft?.customer);
    const [isBoxUnitDefault, setIsBoxUnitDefault] = useState(false);
    const [isPromotionMode, setIsPromotionMode] = useState(false);
    
    const [productForModal, setProductForModal] = useState<Product | null>(null);
    const [existingItemForModal, setExistingItemForModal] = useState<OrderItem | null>(null);
    const [addItemTrigger, setAddItemTrigger] = useState<'scan' | 'search'>('search');
    const [scanSettings, setScanSettings] = useState<{ unit: '개' | '박스'; isPromotion: boolean }>({ unit: '개', isPromotion: false });
    const [editingItem, setEditingItem] = useState<OrderItem | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const customerSearchBlurTimeout = useRef<number | null>(null);
    const productSearchBlurTimeout = useRef<number | null>(null);
    const productSearchInputRef = useRef<HTMLInputElement>(null);
    const customerSearchInputRef = useRef<HTMLInputElement>(null);

    const itemsRef = useRef<Map<string, HTMLDivElement | null>>(new Map());
    const scrollableContainerRef = useRef<HTMLDivElement | null>(null);
    const lastItemCount = useRef(0);
    const [highlightedItem, setHighlightedItem] = useState<string | null>(null);
    const [quickAddedBarcode, setQuickAddedBarcode] = useState<string | null>(null);

    const [initialItems] = useState<OrderItem[]>(draft?.items || []); 

    const {
        items,
        addItem,
        updateItem,
        removeItem,
        resetItems,
        totalAmount,
    } = useOrderManager({
        initialItems,
    });
    
    // Sync state back to localStorage draft
    useEffect(() => {
        if (selectedCustomer || items.length > 0 || memo.trim() !== '') {
            setDraft({
                customer: selectedCustomer,
                items: items,
                memo: memo,
            });
        } else if (draft !== null) {
            // Clear draft if all fields are empty and draft exists
            setDraft(null);
        }
    }, [selectedCustomer, items, memo, draft, setDraft]);


    const filteredCustomers = useMemo(() => {
        const searchTerm = customerSearch.trim().toLowerCase();
        if (!searchTerm) return [];
        return customers.filter(c => c.name.toLowerCase().includes(searchTerm) || c.comcode.includes(searchTerm));
    }, [customers, customerSearch]);

    const filteredProducts = useMemo(() => {
        const searchTerm = productSearch.trim().toLowerCase();
        if (!searchTerm) return [];
        return products.filter(p => p.name.toLowerCase().includes(searchTerm) || p.barcode.includes(searchTerm));
    }, [products, productSearch]);

    const handleSelectCustomer = (customer: Customer) => {
        setSelectedCustomer(customer);
        setCustomerSearch(customer.name);
        setShowCustomerDropdown(false);
        setIsCustomerLocked(true);
        productSearchInputRef.current?.focus();
    };

    const handleUnlockCustomer = () => {
        setIsCustomerLocked(false);
        setSelectedCustomer(null);
        setCustomerSearch('');
        setShowCustomerDropdown(true);
        setTimeout(() => customerSearchInputRef.current?.focus(), 0);
    };

    const handleAddProduct = useCallback((product: Product) => {
        const existingItem = items.find(item => item.barcode === product.barcode);
        setExistingItemForModal(existingItem || null);
        setProductForModal(product);
    }, [items]);

    const handleScanSuccess = useCallback((barcode: string) => {
        closeScanner();
        const product = products.find(p => p.barcode === barcode);
        if (product) {
            setAddItemTrigger('scan');
            const existingItem = items.find(item => item.barcode === product.barcode);
            setExistingItemForModal(existingItem || null);
            setProductForModal(product);
        } else {
            showAlert("등록되지 않은 바코드입니다.");
        }
    }, [products, showAlert, items, closeScanner]);

    const handleProductSelect = (product: Product) => {
        setAddItemTrigger('search');
        handleAddProduct(product);
        setProductSearch('');
        setShowProductDropdown(false);
    };

    const handleCompleteOrder = async () => {
        if (!selectedCustomer) {
            showAlert("거래처를 선택해주세요.");
            return;
        }
        if (items.length === 0) {
            showAlert("발주할 품목이 없습니다.");
            return;
        }

        showAlert(
            `'${selectedCustomer.name}'으로 발주를 저장하시겠습니까?`,
            async () => {
                setIsSaving(true);
                try {
                    await addOrder({
                        customer: selectedCustomer,
                        items,
                        total: totalAmount,
                        memo: memo.trim(),
                    });
                    
                    // Clear draft before resetting UI state
                    setDraft(null);
                    
                    resetItems();
                    setSelectedCustomer(null);
                    setCustomerSearch('');
                    setIsCustomerLocked(false);
                    setMemo('');
                    showAlert("신규 발주가 추가되었습니다.");
                } catch (error) {
                    console.error("Order save failed:", error);
                    showAlert("발주 저장에 실패했습니다. 네트워크 연결을 확인하고 다시 시도하세요.");
                } finally {
                    setIsSaving(false);
                }
            },
            "발주 저장"
        );
    };

    const handleCancelOrder = useCallback(() => {
        if (items.length > 0 || selectedCustomer || memo.trim() !== '') {
            showAlert(
                '작성 중인 발주를 취소하시겠습니까? 모든 내용이 삭제됩니다.',
                () => {
                    setDraft(null); // Clear draft first
                    resetItems();
                    setSelectedCustomer(null);
                    setCustomerSearch('');
                    setIsCustomerLocked(false);
                    setMemo('');
                    setProductSearch('');
                },
                '모두 지우기',
                'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
            );
        }
    }, [items, selectedCustomer, memo, showAlert, resetItems, setDraft]);

    const handleRemoveItem = (e: React.MouseEvent, itemToRemove: OrderItem) => {
        e.stopPropagation();
        showAlert(
            `'${itemToRemove.name}' 품목을 삭제하시겠습니까?`,
            () => removeItem(itemToRemove.barcode),
            '삭제',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    };

    useEffect(() => {
        if (scrollableContainerRef.current && quickAddedBarcode) {
            const itemElement = itemsRef.current.get(quickAddedBarcode);
            if (itemElement) {
                itemElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            setQuickAddedBarcode(null);
        } else if (scrollableContainerRef.current && items.length > lastItemCount.current) {
            scrollableContainerRef.current.scrollTo({ top: scrollableContainerRef.current.scrollHeight, behavior: 'smooth' });
        }
        lastItemCount.current = items.length;
    }, [items, quickAddedBarcode]);

    useEffect(() => {
        setScanSettings({ unit: isBoxUnitDefault ? '박스' : '개', isPromotion: isPromotionMode });
    }, [isBoxUnitDefault, isPromotionMode]);

    return (
        <div className="h-full flex flex-col w-full max-w-3xl mx-auto">
            {/* Combined Search Section */}
            <div className="p-2 bg-white shadow-md z-10">
                <div className="flex items-stretch space-x-2">
                    {/* Left Column: Inputs */}
                    <div className="flex-grow rounded-lg shadow-inner border border-gray-300 divide-y divide-gray-300 flex flex-col">
                        {/* Customer Search Part */}
                        <div className="p-1.5">
                            <div className="relative">
                                <input
                                    ref={customerSearchInputRef}
                                    id="customer-search"
                                    type="text"
                                    value={customerSearch}
                                    onChange={e => setCustomerSearch(e.target.value)}
                                    onFocus={() => {
                                        if (customerSearchBlurTimeout.current) clearTimeout(customerSearchBlurTimeout.current);
                                        setShowCustomerDropdown(true);
                                    }}
                                    onBlur={() => {
                                        customerSearchBlurTimeout.current = window.setTimeout(() => setShowCustomerDropdown(false), 200);
                                    }}
                                    placeholder="거래처명 또는 코드 검색"
                                    className="w-full p-2 h-9 text-base border-0 bg-transparent rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-500 disabled:bg-gray-100 placeholder:text-gray-400"
                                    disabled={isCustomerLocked}
                                    autoComplete="off"
                                />
                                {isCustomerLocked && (
                                    <button onClick={handleUnlockCustomer} className="absolute top-1/2 right-3 -translate-y-1/2 text-sm font-semibold text-red-500 hover:text-red-700 z-10">변경</button>
                                )}
                                <SearchDropdown<Customer>
                                    items={filteredCustomers}
                                    renderItem={(c) => (
                                        <div key={c.comcode} onClick={() => handleSelectCustomer(c)} className="p-3 hover:bg-gray-100 cursor-pointer text-gray-700">
                                            <div>{c.name} <span className="text-sm text-gray-500">({c.comcode})</span></div>
                                        </div>
                                    )}
                                    show={showCustomerDropdown && !isCustomerLocked}
                                />
                            </div>
                        </div>

                        {/* Product Search Part */}
                        <div className={`relative z-20 transition-opacity duration-300 ${!selectedCustomer ? 'opacity-50 pointer-events-none' : ''}`}>
                            <div className="p-1.5 bg-gray-50/50">
                                <div className="relative">
                                    <input
                                        ref={productSearchInputRef}
                                        id="product-search"
                                        type="text"
                                        value={productSearch}
                                        onChange={e => setProductSearch(e.target.value)}
                                        onFocus={() => {
                                            if (productSearchBlurTimeout.current) clearTimeout(productSearchBlurTimeout.current);
                                            setShowProductDropdown(true);
                                        }}
                                        onBlur={() => {
                                            productSearchBlurTimeout.current = window.setTimeout(() => setShowProductDropdown(false), 200);
                                        }}
                                        placeholder="품목명 또는 바코드 검색"
                                        className="w-full p-2 h-9 text-base border-0 bg-transparent rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-500 pr-32"
                                        autoComplete="off"
                                    />
                                    <div className="absolute top-1/2 right-2 -translate-y-1/2 flex items-center space-x-2">
                                        <ToggleSwitch size="small" id="new-order-promotion" label="행사" checked={isPromotionMode} onChange={setIsPromotionMode} color="red" />
                                        <ToggleSwitch size="small" id="new-order-box-unit" label="박스" checked={isBoxUnitDefault} onChange={setIsBoxUnitDefault} color="blue" />
                                    </div>
                                    <SearchDropdown<Product>
                                        items={filteredProducts}
                                        renderItem={(p) => (
                                            <div key={p.barcode} onClick={() => handleProductSelect(p)} className="p-3 hover:bg-gray-100 cursor-pointer text-gray-700">
                                                <div>{p.name} <span className="text-sm text-gray-500">({p.barcode})</span></div>
                                            </div>
                                        )}
                                        show={showProductDropdown}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                    {/* Right Column: Scan Button */}
                    <button
                        onClick={() => openScanner('new-order', handleScanSuccess, true)}
                        disabled={!selectedCustomer}
                        className="w-16 bg-blue-600 text-white rounded-lg flex-shrink-0 hover:bg-blue-700 shadow-md transition-all flex flex-col items-center justify-center gap-1 font-semibold disabled:bg-gray-400 disabled:shadow-none disabled:cursor-not-allowed"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/><path d="M12 11v2"/></svg>
                        <span className="text-sm">스캔</span>
                    </button>
                </div>
            </div>


            {/* Items List */}
            <div ref={scrollableContainerRef} className="scrollable-content p-2 bg-gray-100 relative">
                {items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                        <p className="text-center text-lg font-semibold">품목이 없습니다</p>
                        <p className="text-sm">스캐너 또는 검색을 이용해 품목을 추가하세요.</p>
                    </div>
                ) : (
                    <div className="pb-32">
                        <div className="bg-white rounded-lg shadow-md border border-gray-200/80 overflow-hidden">
                            <div className="divide-y divide-gray-200">
                                {items.map((item) => (
                                    <div key={item.barcode} ref={el => { if (el) itemsRef.current.set(item.barcode, el); }} className={`flex items-center p-3 space-x-2 cursor-pointer hover:bg-gray-50 transition-all duration-200 ${highlightedItem === item.barcode ? 'bg-blue-50' : ''}`} onClick={() => setEditingItem(item)}>
                                        <div className="flex-grow min-w-0 pr-1">
                                            <p className="font-semibold text-sm text-gray-800 break-words whitespace-pre-wrap flex items-center gap-1.5">
                                                {item.isPromotion && <span className="text-xs font-bold text-white bg-red-500 rounded-full px-1.5 py-0.5">행사</span>}
                                                {item.name}
                                            </p>
                                            <p className="text-xs text-gray-500">{item.price.toLocaleString()}원</p>
                                        </div>
                                        <div className="flex items-center space-x-1.5 flex-shrink-0">
                                            <span className="w-12 text-center text-gray-600 font-medium select-none text-sm">{item.quantity}</span>
                                            <span className="w-8 text-center text-gray-600 font-medium select-none text-sm">{item.unit}</span>
                                            <button onClick={(e) => handleRemoveItem(e, item)} className="text-gray-400 hover:text-rose-500 p-0.5 z-10 relative"><RemoveIcon className="w-5 h-5"/></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
                {/* Memo FAB */}
                <button 
                    onClick={() => setIsMemoModalOpen(true)}
                    disabled={!selectedCustomer || items.length === 0}
                    className="absolute bottom-24 right-4 bg-white border-2 border-gray-300 text-gray-600 rounded-2xl p-3 shadow-lg hover:bg-gray-100 hover:border-gray-400 transition z-20 disabled:bg-gray-200 disabled:text-gray-400 disabled:border-gray-300 disabled:cursor-not-allowed"
                    aria-label="메모 추가/수정"
                >
                    <DocumentTextIcon className="w-6 h-6" />
                </button>
            </div>

            {/* Footer */}
            <footer className="absolute bottom-0 left-0 right-0 p-2 bg-white/80 backdrop-blur-lg border-t border-gray-200/60 shadow-[0_-5px_25px_rgba(0,0,0,0.1)]">
                <div className="flex justify-between items-center mb-2 font-bold">
                    <span className="text-base text-gray-600">총 합계:</span>
                    <span className="text-xl text-gray-800">{totalAmount.toLocaleString()} 원</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleCancelOrder}
                        className="w-[20%] bg-gray-200 text-gray-700 p-2 rounded-lg font-bold text-base hover:bg-gray-300 transition shadow-sm disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                        disabled={!selectedCustomer && items.length === 0 && memo.trim() === ''}
                    >
                        취소
                    </button>
                    <button 
                        onClick={handleCompleteOrder} 
                        className="w-[80%] bg-gradient-to-b from-blue-500 to-blue-600 text-white p-2 rounded-lg font-bold text-base hover:from-blue-600 hover:to-blue-700 transition shadow-lg shadow-blue-500/30 disabled:from-gray-400 disabled:to-gray-500 disabled:shadow-none disabled:cursor-not-allowed flex items-center justify-center" 
                        disabled={!selectedCustomer || items.length === 0 || isSaving}
                    >
                        {isSaving ? <SpinnerIcon className="w-6 h-6" /> : '발주 저장'}
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
                trigger={addItemTrigger}
                onClose={() => {
                    setProductForModal(null);
                    setExistingItemForModal(null);
                }}
                onAdd={(details) => {
                    if (productForModal) {
                        const existingItem = items.find(item => item.barcode === productForModal.barcode);
                        if (existingItem) {
                            updateItem(productForModal.barcode, { 
                                quantity: existingItem.quantity + details.quantity,
                                unit: details.unit,
                                isPromotion: details.isPromotion
                             });
                        } else {
                            addItem(productForModal, {
                                isBoxUnit: details.unit === '박스',
                                isPromotion: details.isPromotion,
                                quantity: details.quantity,
                            });
                        }
                        setQuickAddedBarcode(productForModal.barcode);
                        setHighlightedItem(productForModal.barcode);
                        setTimeout(() => setHighlightedItem(null), 1000);
                    }
                    setScanSettings({ unit: details.unit, isPromotion: details.isPromotion });
                    setProductForModal(null);
                    setExistingItemForModal(null);
                }}
                onNextScan={() => openScanner('new-order', handleScanSuccess, true)}
                initialSettings={scanSettings}
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