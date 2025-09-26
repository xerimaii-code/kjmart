
import React, { useState, useContext, useMemo, useEffect, useCallback, useRef } from 'react';
import { AppContext } from '../context/AppContext.tsx';
import { Customer, Product, OrderItem } from '../types.ts';
import { RemoveIcon } from '../components/Icons.tsx';

interface SearchDropdownProps<T> {
    items: T[];
    renderItem: (item: T) => React.ReactNode;
    onSelect: (item: T) => void;
    show: boolean;
}

const SearchDropdown = <T,>({ items, renderItem, onSelect, show }: SearchDropdownProps<T>) => {
    if (!show || items.length === 0) return null;
    return (
        <div className="absolute z-10 w-full bg-white border border-slate-200 rounded-md mt-1 max-h-48 overflow-y-auto shadow-lg">
            {items.map((item, index) => (
                <div key={index} onMouseDown={() => onSelect(item)} className="p-3 hover:bg-slate-100 cursor-pointer">
                    {renderItem(item)}
                </div>
            ))}
        </div>
    );
};

interface QuantitySelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (quantity: number) => void;
}

const QuantitySelectorModal: React.FC<QuantitySelectorModalProps> = ({ isOpen, onClose, onSelect }) => {
    if (!isOpen) return null;

    const quantities = Array.from({ length: 50 }, (_, i) => (i + 1) * 10); // Generates [10, 20, ..., 500]

    const handleSelect = (q: number) => {
        onSelect(q);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-xs flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="p-4 max-h-[70vh] overflow-y-auto">
                    <h3 className="text-lg font-bold text-center text-slate-800 mb-4 sticky top-0 bg-white py-2">수량 선택</h3>
                    <div className="grid grid-cols-4 gap-3">
                        {quantities.map(q => (
                            <button
                                key={q}
                                onClick={() => handleSelect(q)}
                                className="p-3 bg-slate-100 rounded-md font-semibold text-slate-700 hover:bg-sky-100 hover:text-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500 transition"
                            >
                                {q}
                            </button>
                        ))}
                    </div>
                </div>
                 <div className="bg-slate-50 p-3 text-center border-t border-slate-200">
                     <button
                        onClick={onClose}
                        className="w-full px-6 py-2 rounded-md font-semibold text-slate-600 bg-slate-200 hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-opacity-50 transition"
                    >
                        취소
                    </button>
                </div>
            </div>
        </div>
    );
};


const NewOrderPage: React.FC = () => {
    const { customers, products, addOrder, showAlert, openScanner, setOnScanSuccess, setHasUnsavedChanges } = useContext(AppContext);

    const [currentOrderItems, setCurrentOrderItems] = useState<OrderItem[]>([]);
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

    const [customerSearch, setCustomerSearch] = useState('');
    const [productSearch, setProductSearch] = useState('');
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
    const [showProductDropdown, setShowProductDropdown] = useState(false);
    const [isCustomerLocked, setIsCustomerLocked] = useState(false);
    const [isBoxUnitDefault, setIsBoxUnitDefault] = useState(false);
    const [isPromotionMode, setIsPromotionMode] = useState(false);
    
    const [isQuantitySelectorOpen, setIsQuantitySelectorOpen] = useState(false);
    const [quantitySelectItem, setQuantitySelectItem] = useState<OrderItem | null>(null);
    const [highlightedItem, setHighlightedItem] = useState<string | null>(null);
    const quantityTimerRef = useRef<number | null>(null);

    const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
    const scrollableContainerRef = useRef<HTMLDivElement>(null);
    const lastItemCount = useRef(currentOrderItems.length);
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        const hasChanges = selectedCustomer !== null || currentOrderItems.length > 0;
        setHasUnsavedChanges(hasChanges);
    }, [selectedCustomer, currentOrderItems, setHasUnsavedChanges]);

    useEffect(() => {
        return () => {
            setHasUnsavedChanges(false);
        };
    }, [setHasUnsavedChanges]);

    const addProduct = useCallback((product: Product) => {
        const existingItem = currentOrderItems.find(item => item.barcode === product.barcode);

        if (existingItem) {
            showAlert(
                '이미 추가된 상품입니다. 수량을 추가하시겠습니까?',
                () => { // onConfirm
                    setHighlightedItem(product.barcode);
                    setTimeout(() => {
                        const itemElement = itemRefs.current.get(product.barcode);
                        if (itemElement) {
                            itemElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    }, 100);
                },
                '계속'
            );
        } else {
            const newUnit = isBoxUnitDefault ? '박스' : '개';
            setCurrentOrderItems(prevItems => [...prevItems, { ...product, quantity: 1, unit: newUnit, isPromotion: isPromotionMode }]);
            setHighlightedItem(product.barcode);
            if (selectedCustomer) {
                setIsCustomerLocked(true);
            }
        }
    }, [currentOrderItems, showAlert, selectedCustomer, isBoxUnitDefault, isPromotionMode]);

    useEffect(() => {
        setOnScanSuccess((barcode: string) => {
            const product = products.find(p => p.barcode === barcode);
            if (product) {
                addProduct(product);
            } else {
                showAlert("등록되지 않은 바코드입니다.");
            }
        });
    }, [products, setOnScanSuccess, showAlert, addProduct]);

    useEffect(() => {
        // Only scroll to bottom if a new item was added
        if (scrollableContainerRef.current && currentOrderItems.length > lastItemCount.current) {
            scrollableContainerRef.current.scrollTo({ top: scrollableContainerRef.current.scrollHeight, behavior: 'smooth' });
        }
        lastItemCount.current = currentOrderItems.length;
    }, [currentOrderItems]);


    const filteredCustomers = useMemo(() => {
        if (!customerSearch) return [];
        return customers.filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()));
    }, [customers, customerSearch]);

    const filteredProducts = useMemo(() => {
        if (!productSearch) return [];
        return products.filter(p =>
            p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
            p.barcode.includes(productSearch)
        );
    }, [products, productSearch]);
    
    const handleProductSelect = (product: Product) => {
        addProduct(product);
        setProductSearch('');
        setShowProductDropdown(false);
    };

    const updateItem = (barcode: string, newValues: Partial<OrderItem>) => {
        setCurrentOrderItems(prev => prev.map(item => item.barcode === barcode ? {...item, ...newValues} : item));
    }
    
    const handleQuantityChange = (item: OrderItem, delta: number) => {
        const newQuantity = item.quantity + delta;
        if (newQuantity < 1) return; // Min quantity is 1
        updateItem(item.barcode, { quantity: newQuantity });
        setHighlightedItem(item.barcode);
    };

    const handleQuantityPressStart = (item: OrderItem) => {
        quantityTimerRef.current = window.setTimeout(() => {
            setQuantitySelectItem(item);
            setIsQuantitySelectorOpen(true);
        }, 500); // 500ms for long press
    };

    const handleQuantityPressEnd = () => {
        if (quantityTimerRef.current) {
            clearTimeout(quantityTimerRef.current);
            quantityTimerRef.current = null;
        }
    };

    const handleUnitToggle = (item: OrderItem) => {
        showAlert(
            `'${item.name}'의 단위를 '${item.unit === '개' ? '박스' : '개'}'(으)로 변경하시겠습니까?`,
            () => {
                const newUnit = item.unit === '개' ? '박스' : '개';
                updateItem(item.barcode, { unit: newUnit });
                setHighlightedItem(null);
            },
            '변경'
        );
    };

    const handleUnitPressStart = (item: OrderItem) => {
        timerRef.current = window.setTimeout(() => {
            handleUnitToggle(item);
        }, 500); // 500ms for long press
    };

    const handleUnitPressEnd = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    const handleRemoveItem = (itemToRemove: OrderItem) => {
        showAlert(
            `'${itemToRemove.name}' 품목을 삭제하시겠습니까?`,
            () => {
                setCurrentOrderItems(prev => {
                    const newItems = prev.filter(item => item.barcode !== itemToRemove.barcode);
                    if (newItems.length === 0) {
                        setIsCustomerLocked(false);
                    }
                    return newItems;
                });
                setHighlightedItem(null);
            },
            '삭제',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    }

    const totalAmount = useMemo(() => {
        return Math.floor(currentOrderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0));
    }, [currentOrderItems]);
    
    const handleSaveOrder = () => {
        if (!selectedCustomer) {
            showAlert("거래처를 선택해주세요.");
            return;
        }
        if (currentOrderItems.length === 0) {
            showAlert("발주할 상품을 추가해주세요.");
            return;
        }
        addOrder({
            customer: selectedCustomer,
            items: currentOrderItems,
            total: totalAmount,
        });
        showAlert("발주가 저장되었습니다.");
        // Reset state
        setSelectedCustomer(null);
        setCurrentOrderItems([]);
        setCustomerSearch('');
        setIsCustomerLocked(false);
        setIsPromotionMode(false);
    };

    return (
        <div className="h-full flex flex-col bg-slate-50">
            <div className="fixed-filter p-4 bg-white border-b border-slate-200 space-y-4 flex-shrink-0 shadow-md">
                <div className="flex items-center space-x-2">
                    <div className="relative flex-grow">
                        <input
                            type="text"
                            value={customerSearch}
                            onChange={(e) => { setCustomerSearch(e.target.value); setSelectedCustomer(null); }}
                            onFocus={() => { setShowCustomerDropdown(true); setHighlightedItem(null); }}
                            onBlur={() => { setTimeout(() => setShowCustomerDropdown(false), 200); }}
                            placeholder="거래처명 검색 또는 선택"
                            disabled={isCustomerLocked}
                            className={`w-full p-3 text-base border border-slate-300 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-all ${isCustomerLocked ? 'bg-slate-100 cursor-not-allowed' : 'bg-white'}`}
                        />
                         {selectedCustomer && (
                            <button 
                                onClick={() => { 
                                    if (currentOrderItems.length === 0) {
                                        setSelectedCustomer(null); 
                                        setCustomerSearch(''); 
                                        setIsCustomerLocked(false);
                                    } else {
                                        showAlert("품목이 추가되어 거래처를 변경할 수 없습니다. 새 발주를 작성해주세요.");
                                    }
                                }}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-500"
                                aria-label="거래처 선택 취소"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        )}
                        <SearchDropdown<Customer>
                            items={filteredCustomers}
                            renderItem={(c) => <>{c.name} <span className="text-sm text-slate-500">({c.comcode})</span></>}
                            onSelect={(c) => {
                                setSelectedCustomer(c);
                                setCustomerSearch(c.name);
                                setShowCustomerDropdown(false);
                            }}
                            show={showCustomerDropdown && !selectedCustomer}
                        />
                    </div>
                     <button 
                        onClick={() => openScanner('new-order')} 
                        disabled={!selectedCustomer}
                        className="p-3 bg-sky-500 text-white rounded-md flex-shrink-0 hover:bg-sky-600 shadow-sm disabled:bg-slate-300 disabled:cursor-not-allowed" 
                        aria-label="바코드 스캔으로 품목 추가">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/><path d="M12 11v2"/></svg>
                    </button>
                </div>
                <div className="flex items-center space-x-2">
                    <div className="relative flex-grow">
                         <input
                            type="text"
                            value={productSearch}
                            onChange={(e) => setProductSearch(e.target.value)}
                            onFocus={() => { setShowProductDropdown(true); setHighlightedItem(null); }}
                            onBlur={() => setTimeout(() => setShowProductDropdown(false), 200)}
                            placeholder={!selectedCustomer ? "거래처를 먼저 선택해주세요." : "품목명 또는 바코드 검색"}
                            disabled={!selectedCustomer}
                            className="w-full p-3 text-base border border-slate-300 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-sky-500 disabled:bg-slate-100 disabled:cursor-not-allowed"
                        />
                        <SearchDropdown<Product>
                            items={filteredProducts}
                            renderItem={(p) => <>{p.name} <span className="text-sm text-slate-500">({p.barcode})</span></>}
                            onSelect={handleProductSelect}
                            show={showProductDropdown}
                        />
                    </div>
                    <div className="flex items-center space-x-3">
                        <div className="flex items-center">
                            <input
                                id="promotion-mode"
                                type="checkbox"
                                checked={isPromotionMode}
                                onChange={(e) => setIsPromotionMode(e.target.checked)}
                                disabled={!selectedCustomer}
                                className="h-5 w-5 rounded border-slate-400 text-red-600 focus:ring-red-500 bg-slate-100"
                            />
                            <label htmlFor="promotion-mode" className="ml-2 text-xs font-medium text-slate-700 select-none">행사</label>
                        </div>
                        <div className="flex items-center">
                            <input
                                id="box-unit"
                                type="checkbox"
                                checked={isBoxUnitDefault}
                                onChange={(e) => setIsBoxUnitDefault(e.target.checked)}
                                disabled={!selectedCustomer}
                                className="h-5 w-5 rounded border-slate-400 text-sky-600 focus:ring-sky-500 bg-slate-100"
                            />
                            <label htmlFor="box-unit" className="ml-2 text-xs font-medium text-slate-700 select-none">박스</label>
                        </div>
                    </div>
                </div>
            </div>

            <div ref={scrollableContainerRef} className="scrollable-content p-4">
                {currentOrderItems.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                        <p className="text-center text-slate-500 text-lg">상품을 추가해주세요.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {currentOrderItems.map((item) => (
                             <div 
                                key={item.barcode}
                                // FIX: The ref callback should not return a value. Encapsulating the expression in braces ensures it returns void.
                                ref={el => { itemRefs.current.set(item.barcode, el); }}
                                className="flex items-center p-2 bg-white rounded-lg space-x-2 transition-all shadow-sm"
                            >
                                <div className="flex-grow">
                                    <p className="font-semibold text-sm text-slate-800 break-words whitespace-pre-wrap">
                                        {item.isPromotion && <span className="text-red-500 font-bold">(행사) </span>}
                                        {item.name}
                                    </p>
                                    <p className="text-xs text-slate-500">{item.price.toLocaleString()}원</p>
                                </div>
                                <div className="flex items-center space-x-1 flex-shrink-0">
                                    <div className="flex items-center space-x-1">
                                        <button onClick={() => handleQuantityChange(item, -1)} className="bg-slate-200 w-7 h-8 rounded-full font-bold text-slate-600 flex items-center justify-center">-</button>
                                        <span
                                            onMouseDown={() => handleQuantityPressStart(item)}
                                            onMouseUp={handleQuantityPressEnd}
                                            onMouseLeave={handleQuantityPressEnd}
                                            onTouchStart={() => handleQuantityPressStart(item)}
                                            onTouchEnd={handleQuantityPressEnd}
                                            onContextMenu={(e) => e.preventDefault()}
                                            className={`w-10 h-8 text-center border rounded-md flex items-center justify-center text-black font-semibold cursor-pointer select-none text-sm transition-all ${quantitySelectItem?.barcode === item.barcode || highlightedItem === item.barcode ? 'border-rose-600 border-2' : 'border-slate-300'}`}
                                        >
                                            {item.quantity}
                                        </span>
                                        <button onClick={() => handleQuantityChange(item, 1)} className="bg-slate-200 w-7 h-8 rounded-full font-bold text-slate-600 flex items-center justify-center">+</button>
                                    </div>
                                    <button
                                        onMouseDown={() => handleUnitPressStart(item)}
                                        onMouseUp={handleUnitPressEnd}
                                        onMouseLeave={handleUnitPressEnd}
                                        onTouchStart={() => handleUnitPressStart(item)}
                                        onTouchEnd={handleUnitPressEnd}
                                        onClick={(e) => e.preventDefault()}
                                        onContextMenu={(e) => e.preventDefault()}
                                        className="w-11 h-8 border border-slate-300 rounded-md text-black font-semibold flex items-center justify-center focus:ring-2 focus:ring-sky-500 transition-colors hover:bg-slate-100 select-none text-sm"
                                        aria-label={`Change unit for ${item.name}, current is ${item.unit}. Long press to change.`}
                                    >
                                        {item.unit}
                                    </button>
                                    <button onClick={() => handleRemoveItem(item)} className="text-rose-500 hover:text-rose-600 p-1">
                                        <RemoveIcon />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {currentOrderItems.length > 0 && (
                <div className="p-4 bg-white border-t border-slate-200 flex-shrink-0">
                    <div className="flex justify-between items-center mb-3 font-bold">
                        <span className="text-lg text-slate-600">총 합계:</span>
                        <span className="text-xl text-slate-800">{totalAmount.toLocaleString()} 원</span>
                    </div>
                    <button 
                        onClick={handleSaveOrder} 
                        className="w-full bg-emerald-500 text-white p-4 rounded-md font-bold text-lg hover:bg-emerald-600 transition shadow-md"
                    >
                        발주 저장하기
                    </button>
                </div>
            )}
            
            {isQuantitySelectorOpen && quantitySelectItem && (
                <QuantitySelectorModal
                    isOpen={isQuantitySelectorOpen}
                    onClose={() => {
                        setIsQuantitySelectorOpen(false);
                        setQuantitySelectItem(null);
                    }}
                    onSelect={(quantity) => {
                        const barcode = quantitySelectItem.barcode;
                        updateItem(barcode, { quantity });
                        setHighlightedItem(barcode);
                    }}
                />
            )}
        </div>
    );
};

export default NewOrderPage;