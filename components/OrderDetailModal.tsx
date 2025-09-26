
import React, { useState, useContext, useEffect, useMemo, useCallback, useRef } from 'react';
import { AppContext } from '../context/AppContext.tsx';
import { Order, OrderItem, Product } from '../types.ts';
import { RemoveIcon, PdfIcon } from './Icons.tsx';
import { exportToSMS, exportToXLS, exportToPDF } from '../services/dataService.ts';

interface SearchDropdownProps<T> {
    items: T[];
    renderItem: (item: T) => React.ReactNode;
    onSelect: (item: T) => void;
    show: boolean;
}

const SearchDropdown = <T,>({ items, renderItem, onSelect, show }: SearchDropdownProps<T>) => {
    if (!show || items.length === 0) return null;
    return (
        <div className="absolute z-20 w-full bg-white border border-slate-200 rounded-md mt-1 max-h-48 overflow-y-auto shadow-lg">
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

const OrderDetailModal: React.FC = () => {
    const { 
        orders, 
        editingOrderId, 
        closeDetailModal, 
        updateOrder,
        deleteOrder,
        products, 
        showAlert,
        openScanner,
        setOnScanSuccess,
        hasUnsavedChanges,
        setHasUnsavedChanges,
    } = useContext(AppContext);
    
    const order = useMemo(() => orders.find(o => o.id === editingOrderId), [orders, editingOrderId]);
    
    const [editedItems, setEditedItems] = useState<OrderItem[]>([]);
    const [productSearch, setProductSearch] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
    const [isBoxUnitDefault, setIsBoxUnitDefault] = useState(false);
    const [isPromotionMode, setIsPromotionMode] = useState(false);
    
    const [isQuantitySelectorOpen, setIsQuantitySelectorOpen] = useState(false);
    const [quantitySelectItem, setQuantitySelectItem] = useState<OrderItem | null>(null);
    const [highlightedItem, setHighlightedItem] = useState<string | null>(null);
    const quantityTimerRef = useRef<number | null>(null);

    const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
    const scrollableContainerRef = useRef<HTMLDivElement | null>(null);
    const lastItemCount = useRef(0);
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        if (order) {
            const initialItems = JSON.parse(JSON.stringify(order.items));
            setEditedItems(initialItems);
            lastItemCount.current = initialItems.length;
        }
    }, [order]);

    useEffect(() => {
        if (!order) {
            setHasUnsavedChanges(false);
            return;
        }

        const stringifyOrderItems = (items: OrderItem[]) => {
            if (!items) return '[]';
            const sortedItems = [...items].sort((a, b) => a.barcode.localeCompare(b.barcode));
            const relevantData = sortedItems.map(({ barcode, quantity, unit, isPromotion }) => ({ barcode, quantity, unit, isPromotion: isPromotion || false }));
            return JSON.stringify(relevantData);
        };

        const hasChanges = stringifyOrderItems(order.items) !== stringifyOrderItems(editedItems);
        setHasUnsavedChanges(hasChanges);

    }, [editedItems, order, setHasUnsavedChanges]);

    useEffect(() => {
        return () => {
            setHasUnsavedChanges(false);
        };
    }, [setHasUnsavedChanges]);
    
    const addProduct = useCallback((product: Product) => {
        const existingItem = editedItems.find(item => item.barcode === product.barcode);

        if (existingItem) {
            showAlert(
                '이미 추가된 상품입니다.',
                () => { 
                    setHighlightedItem(product.barcode);
                    setTimeout(() => {
                        const itemElement = itemRefs.current.get(product.barcode);
                        if (itemElement) {
                            itemElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    }, 100);
                },
                '확인'
            );
        } else {
            const newUnit = isBoxUnitDefault ? '박스' : '개';
            setEditedItems(prevItems => [...prevItems, { ...product, quantity: 1, unit: newUnit, isPromotion: isPromotionMode }]);
            setHighlightedItem(product.barcode);
        }
    }, [editedItems, showAlert, isBoxUnitDefault, isPromotionMode]);

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
        if (scrollableContainerRef.current && editedItems.length > lastItemCount.current) {
            scrollableContainerRef.current.scrollTo({ top: scrollableContainerRef.current.scrollHeight, behavior: 'smooth' });
        }
        lastItemCount.current = editedItems.length;
    }, [editedItems]);

    const filteredProducts = useMemo(() => {
        if (!productSearch) return [];
        return products.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.barcode.includes(productSearch));
    }, [products, productSearch]);

    const handleProductSelect = (product: Product) => {
        addProduct(product);
        setProductSearch('');
        setShowDropdown(false);
    };

    const updateItem = (barcode: string, newValues: Partial<OrderItem>) => {
        setEditedItems(prev => prev.map(item => item.barcode === barcode ? { ...item, ...newValues } : item));
    };

    const handleQuantityChange = (item: OrderItem, delta: number) => {
        const newQuantity = item.quantity + delta;
        if (newQuantity < 1) return;
        updateItem(item.barcode, { quantity: newQuantity });
        setHighlightedItem(item.barcode);
    };

    const handleQuantityPressStart = (item: OrderItem) => {
        quantityTimerRef.current = window.setTimeout(() => {
            setQuantitySelectItem(item);
            setIsQuantitySelectorOpen(true);
        }, 500);
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
        }, 500);
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
                setEditedItems(prev => prev.filter(item => item.barcode !== itemToRemove.barcode));
                setHighlightedItem(null);
            },
            '삭제',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    };

    const totalAmount = useMemo(() => {
        return Math.floor(editedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0));
    }, [editedItems]);

    const handleSaveChanges = () => {
        if (!order) return;
        const updated: Order = { ...order, items: editedItems, total: totalAmount };
        updateOrder(updated);
        showAlert("발주 내역이 수정되었습니다.");
        closeDetailModal();
    };

    const handleDeleteOrder = () => {
        if (!order) return;
        showAlert(
            `'${order.customer.name}'의 발주 내역을 정말 삭제하시겠습니까?`,
            () => {
                deleteOrder(order.id);
                showAlert("발주 내역이 삭제되었습니다.");
                closeDetailModal();
            },
            '삭제',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    };
    
    const handleClose = () => {
        if (hasUnsavedChanges) {
            showAlert(
                '수정된 내역이 있습니다. 저장하지 않고 닫으시겠습니까?',
                () => closeDetailModal(),
                '닫기',
                'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
            );
        } else {
            closeDetailModal();
        }
    };

    if (!order) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-40 flex items-end" role="dialog" aria-modal="true" aria-labelledby="order-detail-title">
            <div className={`flex flex-col h-[95vh] w-full bg-slate-50 rounded-t-2xl shadow-2xl ${isKeyboardVisible ? 'keyboard-padding' : ''}`}>
                <header className="flex-shrink-0 p-4 border-b border-slate-200 bg-white rounded-t-2xl flex justify-between items-center">
                    <div>
                        <h2 id="order-detail-title" className="text-xl font-bold text-slate-800">{order.customer.name}</h2>
                        <p className="text-sm text-slate-500">{new Date(order.date).toLocaleString('ko-KR')}</p>
                    </div>
                    <button onClick={handleClose} className="p-2 text-slate-500 hover:text-slate-800" aria-label="닫기">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </header>
                
                <div className="relative p-4 bg-white shadow-md z-10">
                    <div className="flex items-center space-x-2 mb-3">
                        <div className="relative flex-grow">
                            <input
                                type="text"
                                value={productSearch}
                                onChange={(e) => setProductSearch(e.target.value)}
                                onFocus={() => { setShowDropdown(true); setIsKeyboardVisible(true); setHighlightedItem(null); }}
                                onBlur={() => { setTimeout(() => setShowDropdown(false), 200); setIsKeyboardVisible(false); }}
                                placeholder="품목명 또는 바코드 검색"
                                className="w-full p-3 text-base border border-slate-300 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                            />
                            <SearchDropdown<Product>
                                items={filteredProducts}
                                renderItem={(p) => <>{p.name} <span className="text-sm text-slate-500">({p.barcode})</span></>}
                                onSelect={handleProductSelect}
                                show={showDropdown}
                            />
                        </div>
                        <button onClick={() => openScanner('modal')} className="p-3 bg-sky-500 text-white rounded-md flex-shrink-0 hover:bg-sky-600 shadow-sm" aria-label="바코드 스캔으로 품목 추가">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/><path d="M12 11v2"/></svg>
                        </button>
                    </div>
                    <div className="flex items-center justify-end space-x-4">
                        <div className="flex items-center">
                            <input id="modal-promotion-mode" type="checkbox" checked={isPromotionMode} onChange={(e) => setIsPromotionMode(e.target.checked)} className="h-5 w-5 rounded border-slate-400 text-red-600 focus:ring-red-500 bg-slate-100" />
                            <label htmlFor="modal-promotion-mode" className="ml-2 text-sm font-medium text-slate-700 select-none">행사</label>
                        </div>
                        <div className="flex items-center">
                            <input id="modal-box-unit" type="checkbox" checked={isBoxUnitDefault} onChange={(e) => setIsBoxUnitDefault(e.target.checked)} className="h-5 w-5 rounded border-slate-400 text-sky-600 focus:ring-sky-500 bg-slate-100" />
                            <label htmlFor="modal-box-unit" className="ml-2 text-sm font-medium text-slate-700 select-none">박스</label>
                        </div>
                    </div>
                </div>

                <div ref={scrollableContainerRef} className="flex-grow overflow-y-auto p-4">
                    <div className="space-y-2">
                        {editedItems.map((item) => (
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
                                        onMouseDown={() => handleUnitPressStart(item)} onMouseUp={handleUnitPressEnd} onMouseLeave={handleUnitPressEnd}
                                        onTouchStart={() => handleUnitPressStart(item)} onTouchEnd={handleUnitPressEnd}
                                        onClick={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()}
                                        className="w-11 h-8 border border-slate-300 rounded-md text-black font-semibold flex items-center justify-center focus:ring-2 focus:ring-sky-500 transition-colors hover:bg-slate-100 select-none text-sm"
                                        aria-label={`단위 변경: ${item.name}, 현재 단위: ${item.unit}. 길게 눌러 변경.`}
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
                </div>

                <footer className="flex-shrink-0 p-4 bg-white border-t border-slate-200 shadow-[0_-2px_5px_rgba(0,0,0,0.05)]">
                    <div className="flex justify-between items-center mb-3 font-bold">
                        <span className="text-lg text-slate-600">총 합계:</span>
                        <span className="text-xl text-slate-800">{totalAmount.toLocaleString()} 원</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <button onClick={handleDeleteOrder} className="w-full bg-rose-500 text-white p-3 rounded-md font-bold text-base hover:bg-rose-600 transition shadow-sm">내역삭제</button>
                        <button onClick={handleSaveChanges} disabled={!hasUnsavedChanges} className="w-full bg-emerald-500 text-white p-3 rounded-md font-bold text-base hover:bg-emerald-600 transition shadow-sm disabled:bg-slate-300 disabled:cursor-not-allowed">수정저장</button>
                    </div>
                    <div className="mt-3 flex justify-around items-center pt-3 border-t border-slate-200">
                        <button onClick={() => exportToSMS(order)} className="flex flex-col items-center text-slate-600 hover:text-sky-600 text-sm font-medium transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                            SMS
                        </button>
                        <button onClick={() => exportToXLS(order)} className="flex flex-col items-center text-slate-600 hover:text-sky-600 text-sm font-medium transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
                            XLS
                        </button>
                        <button onClick={() => exportToPDF(order)} className="flex flex-col items-center text-slate-600 hover:text-sky-600 text-sm font-medium transition-colors">
                            <PdfIcon />
                            PDF
                        </button>
                    </div>
                </footer>
            </div>
            
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

export default OrderDetailModal;