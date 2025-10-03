import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useData, useUI } from '../context/AppContext';
import { Customer, Product, OrderItem } from '../types';
import { RemoveIcon } from '../components/Icons';
import ToggleSwitch from '../components/ToggleSwitch';
import { useOrderManager } from '../hooks/useOrderManager';
import AddItemModal from '../components/AddItemModal';
import EditItemModal from '../components/EditItemModal';

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

    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [customerSearch, setCustomerSearch] = useState('');
    const [productSearch, setProductSearch] = useState('');
    
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
    const [showProductDropdown, setShowProductDropdown] = useState(false);
    const [isCustomerLocked, setIsCustomerLocked] = useState(false);
    const [isBoxUnitDefault, setIsBoxUnitDefault] = useState(false);
    const [isPromotionMode, setIsPromotionMode] = useState(false);
    
    const [productForModal, setProductForModal] = useState<Product | null>(null);
    const [existingItemForModal, setExistingItemForModal] = useState<OrderItem | null>(null);
    const [addItemTrigger, setAddItemTrigger] = useState<'scan' | 'search'>('search');
    const [scanSettings, setScanSettings] = useState<{ unit: '개' | '박스'; isPromotion: boolean }>({ unit: '개', isPromotion: false });
    const [editingItem, setEditingItem] = useState<OrderItem | null>(null);

    const customerSearchBlurTimeout = useRef<number | null>(null);
    const productSearchBlurTimeout = useRef<number | null>(null);
    const productSearchInputRef = useRef<HTMLInputElement>(null);
    const customerSearchInputRef = useRef<HTMLInputElement>(null);

    const itemsRef = useRef<Map<string, HTMLDivElement | null>>(new Map());
    const scrollableContainerRef = useRef<HTMLDivElement | null>(null);
    const lastItemCount = useRef(0);
    const [highlightedItem, setHighlightedItem] = useState<string | null>(null);
    const [quickAddedBarcode, setQuickAddedBarcode] = useState<string | null>(null);

    const [initialItems] = useState<OrderItem[]>([]); // FIX: Create a stable initial array

    const {
        items,
        addItem,
        updateItem,
        removeItem,
        resetItems,
        totalAmount,
    } = useOrderManager({
        initialItems, // FIX: Pass stable array to prevent resets
    });

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

    const handleCompleteOrder = () => {
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
            () => {
                addOrder({
                    customer: selectedCustomer,
                    items,
                    total: totalAmount,
                });
                resetItems();
                setSelectedCustomer(null);
                setCustomerSearch('');
                setIsCustomerLocked(false);
                showAlert("신규 발주가 추가되었습니다.");
            },
            "발주 저장"
        );
    };

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
                        <div className={`transition-opacity duration-300 ${!selectedCustomer ? 'opacity-50 pointer-events-none' : ''}`}>
                            <div className="p-1.5 bg-gray-50/50 flex items-center space-x-2">
                                <div className="relative flex-grow">
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
                                        className="w-full p-2 h-9 text-base border-0 bg-transparent rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-500"
                                        autoComplete="off"
                                    />
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
                                <div className="flex items-center justify-end space-x-3">
                                    <ToggleSwitch id="new-order-promotion" label="행사" checked={isPromotionMode} onChange={setIsPromotionMode} color="red" />
                                    <ToggleSwitch id="new-order-box-unit" label="박스" checked={isBoxUnitDefault} onChange={setIsBoxUnitDefault} color="blue" />
                                </div>
                            </div>
                        </div>
                    </div>
                    {/* Right Column: Scan Button */}
                    <button
                        onClick={() => openScanner('new-order', handleScanSuccess, true)}
                        disabled={!selectedCustomer}
                        className="w-16 bg-blue-600 text-white rounded-lg flex-shrink-0 hover:bg-blue-700 shadow-md transition-all flex flex-col items-center justify-center gap-2 font-semibold disabled:bg-gray-400 disabled:shadow-none disabled:cursor-not-allowed"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/><path d="M12 11v2"/></svg>
                        <span className="text-lg">스캔</span>
                    </button>
                </div>
            </div>


            {/* Items List */}
            <div ref={scrollableContainerRef} className="scrollable-content p-2 bg-gray-100">
                {items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                        <p className="text-center text-lg font-semibold">품목이 없습니다</p>
                        <p className="text-sm">스캐너 또는 검색을 이용해 품목을 추가하세요.</p>
                    </div>
                ) : (
                    <div className="space-y-1.5 pb-32">
                        {items.map((item) => (
                            <div key={item.barcode} ref={el => { if (el) itemsRef.current.set(item.barcode, el); }} className={`flex items-center p-1 rounded-lg space-x-1.5 shadow-md bg-white cursor-pointer hover:bg-gray-50 transition-all duration-300 ${highlightedItem === item.barcode ? 'ring-2 ring-blue-500' : 'shadow-gray-300/50'}`} onClick={() => setEditingItem(item)}>
                                <div className="flex-grow min-w-0 pr-1">
                                    <p className="font-semibold text-sm text-gray-800 break-words whitespace-pre-wrap flex items-center gap-1.5">
                                        {item.isPromotion && <span className="text-xs font-bold text-white bg-red-500 rounded-full px-1.5 py-0.5">행사</span>}
                                        {item.name}
                                    </p>
                                    <p className="text-xs text-gray-500">{item.price.toLocaleString()}원</p>
                                </div>
                                <div className="flex items-center space-x-1.5 flex-shrink-0">
                                    <span className="w-12 h-6 text-center border rounded-md flex items-center justify-center text-gray-800 font-bold select-none text-sm border-gray-200 bg-gray-50 shadow-inner">{item.quantity}</span>
                                    <span className="w-8 text-center text-gray-600 font-medium select-none text-sm">{item.unit}</span>
                                    <button onClick={(e) => handleRemoveItem(e, item)} className="text-gray-400 hover:text-rose-500 p-0.5 z-10 relative"><RemoveIcon className="w-5 h-5"/></button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer */}
            <footer className="absolute bottom-0 left-0 right-0 p-2 bg-white/80 backdrop-blur-lg border-t border-gray-200/60 shadow-[0_-5px_25px_rgba(0,0,0,0.1)]">
                <div className="flex justify-between items-center mb-2 font-bold">
                    <span className="text-base text-gray-600">총 합계:</span>
                    <span className="text-xl text-gray-800">{totalAmount.toLocaleString()} 원</span>
                </div>
                <button onClick={handleCompleteOrder} className="w-full bg-gradient-to-b from-blue-500 to-blue-600 text-white p-2 rounded-lg font-bold text-base hover:from-blue-600 hover:to-blue-700 transition shadow-lg shadow-blue-500/30 disabled:from-gray-400 disabled:to-gray-500 disabled:shadow-none disabled:cursor-not-allowed" disabled={!selectedCustomer || items.length === 0}>
                    발주 저장
                </button>
            </footer>

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