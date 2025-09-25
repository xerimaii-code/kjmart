
import React, { useState, useContext, useEffect, useMemo, useCallback, useRef } from 'react';
import { AppContext } from '../context/AppContext';
import { Order, OrderItem, Product } from '../types';
import { AddIcon, RemoveIcon } from './Icons';
import { exportToSMS, exportToXLS, exportToPDF } from '../services/dataService';

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
    } = useContext(AppContext);
    
    const order = useMemo(() => orders.find(o => o.id === editingOrderId), [orders, editingOrderId]);
    
    const [editedItems, setEditedItems] = useState<OrderItem[]>([]);
    const [productSearch, setProductSearch] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

    const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
    const scrollableContainerRef = useRef<HTMLDivElement>(null);
    const lastItemCount = useRef(0);

    useEffect(() => {
        if (order) {
            const initialItems = JSON.parse(JSON.stringify(order.items));
            setEditedItems(initialItems);
            lastItemCount.current = initialItems.length;
        }
    }, [order]);
    
    const addProduct = useCallback((product: Product) => {
        const existingItem = editedItems.find(item => item.barcode === product.barcode);

        if (existingItem) {
            showAlert(
                '이미 추가된 상품입니다. 수량을 추가하시겠습니까?',
                () => { // onConfirm
                    setTimeout(() => {
                        const itemElement = itemRefs.current.get(product.barcode);
                        if (itemElement) {
                            itemElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                        const inputElement = itemElement?.querySelector<HTMLInputElement>(`.modal-item-qty-input`);
                        if (inputElement) {
                            inputElement.focus();
                            inputElement.select();
                        }
                    }, 100);
                },
                '계속'
            );
        } else {
            setEditedItems(prevItems => [...prevItems, { ...product, quantity: 1, unit: '개' }]);
        }
    }, [editedItems, showAlert]);

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

    const updateItem = (barcode: string, newValues: Partial<OrderItem>) => {
        setEditedItems(prev => prev.map(item => item.barcode === barcode ? {...item, ...newValues} : item));
    }

    const removeItem = (barcode: string) => {
        setEditedItems(prev => prev.filter(item => item.barcode !== barcode));
    }

    const performDelete = () => {
        if (!order) return;
        deleteOrder(order.id);
        showAlert("발주 내역이 삭제되었습니다.");
        closeDetailModal();
    };

    const handleUpdateOrder = () => {
        if (!order) return;
        const finalItems = editedItems.filter(item => item.quantity > 0);
        
        if (finalItems.length === 0) {
            showAlert(
                '모든 품목이 삭제되어 발주 내역이 삭제됩니다. 계속하시겠습니까?',
                performDelete,
                '삭제',
                'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
            );
        } else {
            const newTotal = finalItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const updatedOrder: Order = { ...order, items: finalItems, total: newTotal };
            updateOrder(updatedOrder);
            showAlert("발주 내역이 수정되었습니다.");
            closeDetailModal();
        }
    };

    const getUpdatedOrderForExport = (): Order => {
        if (!order) throw new Error("Order not found for export");
        const finalItems = editedItems.filter(item => item.quantity > 0);
        const newTotal = finalItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        return { ...order, items: finalItems, total: newTotal };
    };

    const handleDeleteOrder = () => {
        if (!order) return;
        showAlert(
            '정말로 이 발주 내역을 삭제하시겠습니까?',
            performDelete,
            '삭제',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    }

    const filteredProducts = useMemo(() => {
        if (!productSearch) return [];
        return products.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.barcode.includes(productSearch));
    }, [products, productSearch]);
    
    const handleFocus = () => setIsKeyboardVisible(true);
    const handleBlur = () => setIsKeyboardVisible(false);

    if (!order) return null;

    const totalAmount = useMemo(() => {
        return editedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    }, [editedItems]);

    return (
        <div className={`fixed inset-0 bg-black bg-opacity-60 z-40 flex justify-center p-4 transition-all duration-300 ${isKeyboardVisible ? 'items-start pt-8' : 'items-center'}`}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg flex flex-col h-[90vh] overflow-hidden">
                <div className="flex justify-between items-center p-4 border-b border-slate-200 flex-shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800">{order.customer.name}</h2>
                        <p className="text-sm text-slate-500">{new Date(order.date).toLocaleString('ko-KR')}</p>
                    </div>
                    <button onClick={closeDetailModal} className="text-slate-400 hover:text-slate-600 text-3xl font-bold">&times;</button>
                </div>
                
                <div className="p-4 border-b border-slate-200 flex-shrink-0">
                    <div className="flex items-center space-x-2">
                        <div className="relative flex-grow">
                            <input
                                type="text"
                                value={productSearch}
                                onChange={(e) => setProductSearch(e.target.value)}
                                onFocus={() => { setShowDropdown(true); handleFocus(); }}
                                onBlur={() => { setTimeout(() => setShowDropdown(false), 200); handleBlur(); }}
                                placeholder="품목 추가 검색"
                                className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-sky-500"
                            />
                            {showDropdown && filteredProducts.length > 0 && (
                                <div className="absolute z-20 w-full bg-white border border-slate-200 rounded-md mt-1 max-h-48 overflow-y-auto shadow-lg">
                                    {filteredProducts.map(p => (
                                        <div key={p.barcode} onMouseDown={() => {
                                            addProduct(p);
                                            setProductSearch('');
                                            setShowDropdown(false);
                                        }} className="p-2 hover:bg-slate-100 cursor-pointer">
                                            <p className="font-semibold">{p.name}</p>
                                            <p className="text-sm text-slate-500">{p.barcode}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <button onClick={() => openScanner('modal')} className="p-2 bg-sky-500 text-white rounded-md flex-shrink-0 hover:bg-sky-600 shadow-sm">
                            <AddIcon />
                        </button>
                    </div>
                </div>

                <div ref={scrollableContainerRef} className="flex-grow p-4 overflow-y-auto bg-slate-50">
                    <div className="space-y-3">
                        {editedItems.map(item => (
                             <div key={item.barcode} ref={el => itemRefs.current.set(item.barcode, el)} className="flex items-center p-3 bg-white rounded-lg shadow-sm space-x-3">
                                <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-slate-800">{item.name}</p>
                                </div>
                                <div className="flex items-center space-x-2 flex-shrink-0">
                                    <button onClick={() => updateItem(item.barcode, { quantity: Math.max(0, item.quantity - 1) })} className="bg-slate-200 w-8 h-8 rounded-full font-bold text-slate-600">-</button>
                                    <input
                                        type="number"
                                        data-barcode={item.barcode}
                                        value={item.quantity}
                                        onChange={(e) => updateItem(item.barcode, { quantity: parseInt(e.target.value, 10) || 0 })}
                                        onFocus={handleFocus}
                                        onBlur={handleBlur}
                                        className="w-14 h-8 text-center border border-slate-300 rounded-md modal-item-qty-input"
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
                </div>

                <div className="p-4 border-t border-slate-200 bg-white flex-shrink-0">
                    <div className="flex justify-between items-center mb-3 font-bold">
                        <span className="text-lg text-slate-600">총 합계:</span>
                        <span className="text-xl text-slate-800">{totalAmount.toLocaleString()} 원</span>
                    </div>
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                             <button onClick={handleUpdateOrder} className="w-full bg-emerald-500 text-white p-3 rounded-md font-bold hover:bg-emerald-600 transition shadow-sm">
                                수정 완료
                            </button>
                            <button onClick={handleDeleteOrder} className="w-full bg-rose-500 text-white p-3 rounded-md font-bold hover:bg-rose-600 transition shadow-sm">
                                삭제
                            </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <button onClick={() => exportToSMS(getUpdatedOrderForExport())} className="bg-slate-600 text-white p-2 rounded-md text-sm font-semibold hover:bg-slate-700 transition">SMS</button>
                            <button onClick={() => exportToXLS(getUpdatedOrderForExport())} className="bg-slate-600 text-white p-2 rounded-md text-sm font-semibold hover:bg-slate-700 transition">XLS</button>
                            <button onClick={() => exportToPDF(getUpdatedOrderForExport())} className="bg-slate-600 text-white p-2 rounded-md text-sm font-semibold hover:bg-slate-700 transition">PDF</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OrderDetailModal;