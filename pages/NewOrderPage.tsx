
import React, { useState, useContext, useMemo, useEffect, useCallback, useRef } from 'react';
import { AppContext } from '../context/AppContext';
import { Customer, Product, OrderItem } from '../types';
import { RemoveIcon, ScanIcon } from '../components/Icons';
import ScannerModal from '../components/ScannerModal';

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

const NewOrderPage: React.FC = () => {
    const { customers, products, addOrder, showAlert, setHasUnsavedChanges } = useContext(AppContext);

    const [currentOrderItems, setCurrentOrderItems] = useState<OrderItem[]>([]);
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

    const [customerSearch, setCustomerSearch] = useState('');
    const [productSearch, setProductSearch] = useState('');
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
    const [showProductDropdown, setShowProductDropdown] = useState(false);
    const [isCustomerLocked, setIsCustomerLocked] = useState(false);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    
    const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
    const scrollableContainerRef = useRef<HTMLDivElement>(null);
    const lastItemCount = useRef(currentOrderItems.length);

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
                    setTimeout(() => {
                        const itemElement = itemRefs.current.get(product.barcode);
                        if (itemElement) {
                            itemElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                        const inputElement = itemElement?.querySelector<HTMLInputElement>(`.new-order-item-qty-input`);
                        if (inputElement) {
                            inputElement.focus();
                            inputElement.select();
                        }
                    }, 100);
                },
                '계속'
            );
        } else {
            setCurrentOrderItems(prevItems => [...prevItems, { ...product, quantity: 1, unit: '개' }]);
            if (selectedCustomer) {
                setIsCustomerLocked(true);
            }
        }
    }, [currentOrderItems, showAlert, selectedCustomer]);
    
    const handleScanSuccess = useCallback((barcode: string) => {
        const product = products.find(p => p.barcode === barcode);
        if (product) {
            addProduct(product);
        } else {
            showAlert(`바코드 '${barcode}'에 해당하는 상품을 찾을 수 없습니다.`);
        }
    }, [products, addProduct, showAlert]);

    const closeScanner = useCallback(() => setIsScannerOpen(false), []);


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

    const removeItem = (barcode: string) => {
        setCurrentOrderItems(prev => {
            const newItems = prev.filter(item => item.barcode !== barcode);
            if (newItems.length === 0) {
                setIsCustomerLocked(false);
            }
            return newItems;
        });
    }

    const totalAmount = useMemo(() => {
        return currentOrderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
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
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
        // Use a timeout to allow the keyboard to appear and for the layout to adjust
        setTimeout(() => {
            e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
    };

    return (
        <div className="h-full flex flex-col bg-slate-50">
            <ScannerModal 
                isOpen={isScannerOpen}
                onClose={closeScanner}
                onScanSuccess={handleScanSuccess}
            />
            <div className="fixed-filter p-4 bg-white border-b border-slate-200 space-y-4 flex-shrink-0">
                <div className="flex items-center space-x-2">
                    <div className="relative flex-grow">
                        <input
                            type="text"
                            value={customerSearch}
                            onChange={(e) => { setCustomerSearch(e.target.value); setSelectedCustomer(null); }}
                            onFocus={(e) => { setShowCustomerDropdown(true); handleFocus(e); }}
                            onBlur={() => { setTimeout(() => setShowCustomerDropdown(false), 200); }}
                            placeholder="거래처명 검색 또는 선택"
                            disabled={isCustomerLocked}
                            className={`w-full p-3 text-base border border-slate-300 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition ${isCustomerLocked ? 'bg-slate-100 cursor-not-allowed' : ''}`}
                        />
                        <SearchDropdown
                            items={filteredCustomers}
                            renderItem={(c: Customer) => <span className="font-medium text-base">{c.name}</span>}
                            onSelect={(c) => {
                                setSelectedCustomer(c);
                                setCustomerSearch(c.name);
                                setShowCustomerDropdown(false);
                            }}
                            show={showCustomerDropdown && !selectedCustomer && !isCustomerLocked}
                        />
                    </div>
                    {isCustomerLocked && (
                        <button 
                            onClick={() => setIsCustomerLocked(false)}
                            className="px-4 py-3 bg-slate-200 text-slate-700 text-sm font-semibold rounded-md hover:bg-slate-300 flex-shrink-0"
                        >
                            변경
                        </button>
                    )}
                </div>
                <div className="flex items-center space-x-2">
                    <div className="relative flex-grow">
                        <input
                            type="text"
                            value={productSearch}
                            onChange={(e) => setProductSearch(e.target.value)}
                            onFocus={(e) => { setShowProductDropdown(true); handleFocus(e); }}
                            onBlur={() => { setTimeout(() => setShowProductDropdown(false), 200); }}
                            placeholder="품목 검색"
                            className="w-full p-3 text-base border border-slate-300 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition"
                        />
                        <SearchDropdown
                            items={filteredProducts}
                            renderItem={(p: Product) => (
                                <>
                                    <p className="font-semibold text-base">{p.name}</p>
                                    <p className="text-sm text-slate-500">{p.barcode} / {p.price.toLocaleString()}원</p>
                                </>
                            )}
                            onSelect={handleProductSelect}
                            show={showProductDropdown}
                        />
                    </div>
                    <button 
                        onClick={() => setIsScannerOpen(true)}
                        className="p-3 bg-slate-200 text-slate-700 rounded-md hover:bg-slate-300 flex-shrink-0"
                        aria-label="Scan product barcode"
                    >
                        <ScanIcon />
                    </button>
                </div>
            </div>
            <div ref={scrollableContainerRef} className="scrollable-content p-4 flex-grow">
                {currentOrderItems.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                        <p className="text-slate-500">검색 또는 스캔하여 상품을 추가하세요.</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {currentOrderItems.map(item => (
                            // Fix: The ref callback for a DOM element should not return a value. `Map.set` returns the map instance, so we wrap it in curly braces to ensure the callback has a void return.
                            <div key={item.barcode} ref={el => { itemRefs.current.set(item.barcode, el); }} className="flex items-center p-3 bg-white rounded-lg shadow-sm space-x-3">
                                <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-slate-800">{item.name}</p>
                                </div>
                                <div className="flex items-center space-x-2 flex-shrink-0">
                                    <button onClick={() => updateItem(item.barcode, { quantity: Math.max(1, item.quantity - 1) })} className="bg-slate-200 w-8 h-8 rounded-full font-bold text-slate-600">-</button>
                                    <input
                                        type="number"
                                        data-barcode={item.barcode}
                                        value={item.quantity}
                                        onChange={(e) => updateItem(item.barcode, { quantity: parseInt(e.target.value, 10) || 1 })}
                                        onFocus={handleFocus}
                                        className="w-14 h-8 text-center border border-slate-300 rounded-md new-order-item-qty-input"
                                    />
                                    <button onClick={() => updateItem(item.barcode, { quantity: item.quantity + 1 })} className="bg-slate-200 w-8 h-8 rounded-full font-bold text-slate-600">+</button>
                                    <select
                                        value={item.unit}
                                        onChange={(e) => updateItem(item.barcode, { unit: e.target.value as '개' | '박스' })}
                                        className="p-1 h-8 border border-slate-300 rounded-md"
                                    >
                                        <option value="개">개</option>
                                        <option value="박스">박스</option>
                                    </select>
                                    <button onClick={() => removeItem(item.barcode)} className="text-rose-500 hover:text-rose-600">
                                        <RemoveIcon />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <div className="p-4 bg-white border-t border-slate-200 mt-auto flex-shrink-0">
                <div className="flex justify-between items-center mb-3 font-bold">
                    <span className="text-lg text-slate-600">총 합계:</span>
                    <span className="text-xl text-slate-800">{totalAmount.toLocaleString()} 원</span>
                </div>
                <button 
                    onClick={handleSaveOrder} 
                    className="w-full bg-emerald-500 text-white p-3 rounded-md font-bold text-lg hover:bg-emerald-600 disabled:bg-slate-300 transition shadow-sm"
                    disabled={currentOrderItems.length === 0 || !selectedCustomer}
                >
                    발주 저장
                </button>
            </div>
        </div>
    );
};

export default NewOrderPage;