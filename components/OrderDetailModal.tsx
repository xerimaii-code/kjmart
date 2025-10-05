import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useData, useUI } from '../context/AppContext';
import { Order, OrderItem, Product } from '../types';
import { PlusCircleIcon, RemoveIcon, CheckCircleIcon, SmsIcon, XlsIcon, ChatBubbleLeftIcon } from './Icons';
import ToggleSwitch from './ToggleSwitch';
import { useOrderManager } from '../hooks/useOrderManager';
import AddItemModal from './AddItemModal';
import EditItemModal from './EditItemModal';

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
        <div className="absolute z-40 w-full bg-white border border-gray-200 rounded-lg mt-1 max-h-72 overflow-y-auto shadow-lg">
            {items.map((item, index) => (
                <React.Fragment key={index}>
                    {renderItem(item)}
                </React.Fragment>
            ))}
        </div>
    );
};

type ItemChangeStatus = {
    status: 'new' | 'modified' | 'unchanged';
    changes: {
        quantity: boolean;
        unit: boolean;
        isPromotion: boolean;
    };
};


const OrderDetailModal: React.FC = () => {
    const { 
        orders, 
        products, 
        updateOrder,
    } = useData();
    
    const {
        editingOrderId, 
        closeDetailModal, 
        showAlert,
        openScanner,
        closeScanner,
    } = useUI();
    
    const [STABLE_EMPTY_ARRAY] = useState([]); // Create a stable empty array reference
    const order = useMemo(() => orders.find(o => o.id === editingOrderId), [orders, editingOrderId]);
    const isCompleted = useMemo(() => !!order?.completedAt || !!order?.completionDetails, [order]);
    
    const [productSearch, setProductSearch] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [isBoxUnitDefault, setIsBoxUnitDefault] = useState(false);
    const [isPromotionMode, setIsPromotionMode] = useState(false);
    const [productForModal, setProductForModal] = useState<Product | null>(null);
    const [existingItemForModal, setExistingItemForModal] = useState<OrderItem | null>(null);
    const [addItemTrigger, setAddItemTrigger] = useState<'scan' | 'search'>('search');
    const [scanSettings, setScanSettings] = useState<{ unit: '개' | '박스'; isPromotion: boolean }>({ unit: isBoxUnitDefault ? '박스' : '개', isPromotion: isPromotionMode });
    
    const [highlightedItem, setHighlightedItem] = useState<string | null>(null);
    const [quickAddedBarcode, setQuickAddedBarcode] = useState<string | null>(null);
    const [editingItem, setEditingItem] = useState<OrderItem | null>(null);
    const [hasChanges, setHasChanges] = useState(false);
    const [memo, setMemo] = useState('');
    const [isMemoModalOpen, setIsMemoModalOpen] = useState(false);
    const [isMemoSectionOpen, setIsMemoSectionOpen] = useState(false);
    const productSearchBlurTimeout = useRef<number | null>(null);
    const productSearchInputRef = useRef<HTMLInputElement | null>(null); // 품목 검색 입력을 위한 ref 추가

    const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
    const scrollableContainerRef = useRef<HTMLDivElement | null>(null);
    const lastItemCount = useRef(0);
    
    const {
        items: editedItems,
        addItem,
        updateItem,
        removeItem,
        resetItems,
        totalAmount,
    } = useOrderManager({
        initialItems: useMemo(() => order?.items.map(i => ({...i})) || STABLE_EMPTY_ARRAY, [order])
    });

    const itemStatuses = useMemo(() => {
        if (!order) return new Map<string, ItemChangeStatus>();
    
        const originalItemsMap = new Map<string, OrderItem>(order.items.map(item => [item.barcode, item]));
        const statuses = new Map<string, ItemChangeStatus>();
    
        editedItems.forEach(editedItem => {
            const originalItem = originalItemsMap.get(editedItem.barcode);
    
            if (!originalItem) {
                statuses.set(editedItem.barcode, {
                    status: 'new',
                    changes: { quantity: false, unit: false, isPromotion: false }
                });
            } else {
                const quantityChanged = originalItem.quantity !== editedItem.quantity;
                const unitChanged = originalItem.unit !== editedItem.unit;
                const promotionChanged = (originalItem.isPromotion || false) !== (editedItem.isPromotion || false);
    
                if (quantityChanged || unitChanged || promotionChanged) {
                    statuses.set(editedItem.barcode, {
                        status: 'modified',
                        changes: {
                            quantity: quantityChanged,
                            unit: unitChanged,
                            isPromotion: promotionChanged,
                        }
                    });
                } else {
                    statuses.set(editedItem.barcode, {
                        status: 'unchanged',
                        changes: { quantity: false, unit: false, isPromotion: false }
                    });
                }
            }
        });
        return statuses;
    }, [editedItems, order]);

    useEffect(() => {
        if (order) {
            setMemo(order.memo || '');
            setIsMemoSectionOpen(false); // Collapse memo when a new order is opened
        }
    }, [order]);

    useEffect(() => {
        if (!order) {
            setHasChanges(false);
            return;
        }

        const originalItemsString = JSON.stringify(order.items.slice().sort((a, b) => a.barcode.localeCompare(b.barcode)));
        const editedItemsString = JSON.stringify(editedItems.slice().sort((a, b) => a.barcode.localeCompare(b.barcode)));
        const memoChanged = (order.memo || '') !== memo;

        setHasChanges(originalItemsString !== editedItemsString || memoChanged);
    }, [editedItems, order, memo]);

    useEffect(() => {
        setScanSettings({ unit: isBoxUnitDefault ? '박스' : '개', isPromotion: isPromotionMode });
    }, [isBoxUnitDefault, isPromotionMode]);

    const handleAddProduct = useCallback((product: Product) => {
        const existingItem = editedItems.find(item => item.barcode === product.barcode);
        setExistingItemForModal(existingItem || null);
        setProductForModal(product);
    }, [editedItems]);

    const handleScanSuccess = useCallback((barcode: string) => {
        closeScanner();
        const product = products.find(p => p.barcode === barcode);
        if (product) {
            setAddItemTrigger('scan');
            const existingItem = editedItems.find(item => item.barcode === product.barcode);
            setExistingItemForModal(existingItem || null);
            setProductForModal(product);
        } else {
            showAlert("등록되지 않은 바코드입니다.");
        }
    }, [products, showAlert, editedItems, closeScanner]);
    
    const handleNextScan = () => {
        openScanner('modal', handleScanSuccess, true);
    };

    const filteredProducts = useMemo(() => {
        const searchTerm = productSearch.trim().toLowerCase();
        if (!searchTerm) return [];
        return products.filter(p => p.name.toLowerCase().includes(searchTerm) || p.barcode.includes(searchTerm));
    }, [products, productSearch]);

    const handleProductSelect = (product: Product) => {
        setAddItemTrigger('search');
        handleAddProduct(product);
        setProductSearch('');
        setShowDropdown(false);
        productSearchInputRef.current?.blur(); // 선택 후 키보드 숨김
    };

    const handleSave = () => {
        if (!order) return;
        if (editedItems.length === 0) {
            showAlert("품목이 없습니다. 발주를 저장할 수 없습니다.");
            return;
        }

        const itemsToSave = editedItems.map(item => {
            const sessionStatus = itemStatuses.get(item.barcode);
            const newItem = { ...item };

            let finalStatus: 'new' | 'modified' | undefined = undefined;

            if (sessionStatus?.status === 'new') {
                finalStatus = 'new';
            } else if (sessionStatus?.status === 'modified') {
                finalStatus = 'modified';
            } else if (item.status) {
                finalStatus = item.status;
            }

            if (finalStatus) {
                newItem.status = finalStatus;
            } else {
                delete newItem.status;
            }
            return newItem;
        });

        const updatedOrder: Order = { 
            ...order, 
            items: itemsToSave, 
            total: totalAmount,
            memo: memo.trim(),
            date: new Date().toISOString(), // Update modification date
            createdAt: order.createdAt || order.date, // Preserve original date as createdAt
        };
        updateOrder(updatedOrder);
        closeDetailModal();
        showAlert("발주 내역이 수정되었습니다.");
    };
    
    const handleClose = () => {
        if (hasChanges) {
             showAlert(
                "수정된 내용이 있습니다. 저장하지 않고 닫으시겠습니까?",
                closeDetailModal,
                "변경사항 폐기",
                "bg-red-500 hover:bg-red-600 focus:ring-red-500"
             );
        } else {
            closeDetailModal();
        }
    };

    useEffect(() => {
        if (scrollableContainerRef.current && quickAddedBarcode) {
            const itemElement = itemRefs.current.get(quickAddedBarcode);
            if (itemElement) {
                itemElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            setQuickAddedBarcode(null);
        } else if (scrollableContainerRef.current && editedItems.length > lastItemCount.current) {
            scrollableContainerRef.current.scrollTo({ top: scrollableContainerRef.current.scrollHeight, behavior: 'smooth' });
        }
        lastItemCount.current = editedItems.length;
    }, [editedItems, quickAddedBarcode]);
    
    const handleRemoveItem = (e: React.MouseEvent, itemToRemove: OrderItem) => {
        e.stopPropagation(); // Stop event from bubbling to the parent div's onClick
        showAlert(
            `'${itemToRemove.name}' 품목을 삭제하시겠습니까?`,
            () => removeItem(itemToRemove.barcode),
            '삭제',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    };

    if (!order) return null;

    const getCompletionDisplay = () => {
        const details = order.completionDetails;
        let icon: React.ReactNode = null;
        let textClass = '';
        let bgClass = '';
        let iconClass = '';

        if (details?.type === 'sms') {
            icon = <SmsIcon className="w-5 h-5 mr-2" />;
            textClass = 'text-green-800';
            bgClass = 'bg-green-50';
            iconClass = 'text-green-600';
        } else if (details?.type === 'xls') {
            icon = <XlsIcon className="w-5 h-5 mr-2" />;
            textClass = 'text-blue-800';
            bgClass = 'bg-blue-50';
            iconClass = 'text-blue-600';
        } else if (order.completedAt) { // Fallback for old data
            icon = <CheckCircleIcon className="w-5 h-5 mr-2" />;
            textClass = 'text-gray-800';
            bgClass = 'bg-gray-100';
            iconClass = 'text-gray-600';
        }

        if (!icon) return null;
        
        return (
            <div className={`mt-3 p-2 rounded-lg flex items-center justify-center text-sm font-semibold ${bgClass} ${textClass}`}>
                <span className={iconClass}>{icon}</span>
                <span>완료된 발주 (내보내기 완료)</span>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-30 flex items-end justify-center">
            <div className="bg-gray-50 h-[95%] w-full max-w-3xl rounded-t-2xl flex flex-col relative">
                <header className="p-4 bg-white border-b border-gray-200 flex-shrink-0 z-10">
                    <div className="flex justify-between items-center">
                        <div className="flex-1 min-w-0">
                             <div className="flex items-center">
                                <h2 className="text-xl font-bold text-gray-800 truncate" title={order.customer.name}>
                                    {order.customer.name}
                                </h2>
                                {memo.trim() ? (
                                    <button onClick={() => setIsMemoSectionOpen(prev => !prev)} className="ml-2 p-1 rounded-full hover:bg-gray-200 transition-colors flex-shrink-0" aria-expanded={isMemoSectionOpen} aria-controls="memo-section">
                                        <ChatBubbleLeftIcon className="w-5 h-5 text-blue-600" title="메모 보기/숨기기"/>
                                    </button>
                                ) : (
                                    !isCompleted && (
                                        <button onClick={() => setIsMemoModalOpen(true)} className="ml-2 text-sm font-semibold text-blue-600 hover:text-blue-800 flex-shrink-0 py-1 px-2 rounded hover:bg-blue-100 transition-colors">
                                            메모 추가
                                        </button>
                                    )
                                )}
                            </div>
                            <div className="text-xs text-gray-500 mt-1 leading-tight">
                                <p>
                                    <span className="font-semibold w-[60px] inline-block">최초 발주:</span>
                                    <span>{new Date(order.createdAt || order.date).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                                </p>
                                {order.createdAt && new Date(order.createdAt).getTime() !== new Date(order.date).getTime() && (
                                    <p>
                                        <span className="font-semibold w-[60px] inline-block">최종 수정:</span>
                                        <span className="text-blue-600 font-medium">{new Date(order.date).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                                    </p>
                                )}
                            </div>
                        </div>
                        <button onClick={handleClose} className="text-gray-500 hover:text-gray-800 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                    
                    {isMemoSectionOpen && memo.trim() && (
                        <div id="memo-section" className="mt-2 p-3 bg-gray-100 rounded-lg border border-gray-200 animate-fade-in-down">
                            <div className="flex justify-between items-center mb-2">
                                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">메모</h4>
                                {!isCompleted && (
                                    <button 
                                        onClick={() => setIsMemoModalOpen(true)}
                                        className="text-sm font-semibold text-blue-600 hover:text-blue-800"
                                    >
                                        수정
                                    </button>
                                )}
                            </div>
                            <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
                                {memo}
                            </p>
                        </div>
                    )}
                     {isCompleted && getCompletionDisplay()}
                </header>

                {!isCompleted && (
                    <div className="p-2 bg-white shadow-md flex-shrink-0 z-30">
                        <div className="flex items-stretch space-x-2">
                            <div className="flex-grow rounded-lg shadow-inner border border-gray-300 flex flex-col">
                                <div className="p-1.5 space-y-1.5 bg-gray-50/50">
                                    <div className="relative">
                                        <input
                                            ref={productSearchInputRef}
                                            type="text"
                                            value={productSearch}
                                            onChange={(e) => setProductSearch(e.target.value)}
                                            onFocus={() => {
                                                if (productSearchBlurTimeout.current) clearTimeout(productSearchBlurTimeout.current);
                                                setShowDropdown(true);
                                            }}
                                            onBlur={() => {
                                                productSearchBlurTimeout.current = window.setTimeout(() => setShowDropdown(false), 200);
                                            }}
                                            placeholder="품목명 또는 바코드 검색"
                                            className="w-full p-2 h-9 text-base border-0 bg-transparent rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-500 placeholder:text-gray-400"
                                            autoComplete="off"
                                        />
                                        <SearchDropdown<Product>
                                            items={filteredProducts}
                                            renderItem={(p) => (
                                                <div
                                                    onClick={() => handleProductSelect(p)}
                                                    className="p-3 hover:bg-gray-100 cursor-pointer text-gray-700"
                                                >
                                                    <div>{p.name} <span className="text-sm text-gray-500">({p.barcode})</span></div>
                                                </div>
                                            )}
                                            show={showDropdown}
                                        />
                                    </div>
                                    <div className="flex items-center justify-end space-x-3">
                                        <ToggleSwitch
                                            id="modal-promotion-mode"
                                            label="행사"
                                            checked={isPromotionMode}
                                            onChange={setIsPromotionMode}
                                            color="red"
                                            size="small"
                                        />
                                        <ToggleSwitch
                                            id="modal-box-unit"
                                            label="박스"
                                            checked={isBoxUnitDefault}
                                            onChange={setIsBoxUnitDefault}
                                            color="blue"
                                            size="small"
                                        />
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => openScanner('modal', handleScanSuccess, true)}
                                className="w-28 bg-blue-600 text-white rounded-lg flex-shrink-0 hover:bg-blue-700 shadow-md transition-all flex flex-col items-center justify-center gap-2 font-semibold"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/><path d="M12 11v2"/></svg>
                                <span className="text-lg">스캔</span>
                            </button>
                        </div>
                    </div>
                )}
                
                <div ref={scrollableContainerRef} className="scrollable-content p-2 pb-32">
                     {editedItems.length === 0 ? (
                        <div className="relative flex flex-col items-center justify-center h-full text-gray-400">
                            <p className="text-center text-lg font-semibold">품목이 없습니다</p>
                            {!isCompleted && <p className="text-sm">스캐너 또는 검색을 이용해 품목을 추가하세요.</p>}
                        </div>
                    ) : (
                        <div className="bg-white rounded-lg shadow-md border border-gray-200/80 overflow-hidden">
                            <div className="divide-y divide-gray-200">
                                {editedItems.map((item) => {
                                    const sessionStatus = itemStatuses.get(item.barcode);

                                    const isNew = item.status === 'new' || sessionStatus?.status === 'new';
                                    const isModified = !isNew && (item.status === 'modified' || sessionStatus?.status === 'modified');
                                
                                    const rowBgClass = isNew ? 'bg-green-50' : isModified ? 'bg-amber-50' : '';
                                    const quantityClass = (sessionStatus?.status === 'modified' && sessionStatus?.changes.quantity) ? 'text-blue-600 font-bold' : '';
                                    const unitClass = (sessionStatus?.status === 'modified' && sessionStatus?.changes.unit) ? 'text-blue-600 font-bold' : '';
                                    const promotionRingClass = (sessionStatus?.status === 'modified' && sessionStatus?.changes.isPromotion) ? 'ring-2 ring-amber-400' : '';

                                    return (
                                        <div
                                            key={item.barcode}
                                            ref={el => { itemRefs.current.set(item.barcode, el); }}
                                            className={`flex items-center p-3 space-x-2 transition-all duration-200 ${rowBgClass} ${highlightedItem === item.barcode ? 'bg-blue-50' : ''} ${!isCompleted ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                                            onClick={() => !isCompleted && setEditingItem(item)}
                                        >
                                            <div className="flex-grow min-w-0 pr-1">
                                                <p className="font-semibold text-sm text-gray-800 break-words whitespace-pre-wrap flex items-center gap-2">
                                                    {item.isPromotion && <span className={`text-xs font-bold text-white bg-red-500 rounded-full px-1.5 py-0.5 ${promotionRingClass}`}>행사</span>}
                                                    <span>{item.name}</span>
                                                    {isNew && <span className="text-xs font-bold text-white bg-green-600 rounded-full px-2 py-0.5">추가</span>}
                                                    {isModified && <span className="text-xs font-bold text-white bg-amber-500 rounded-full px-2 py-0.5">수정</span>}
                                                </p>
                                                <p className="text-xs text-gray-500">{item.price.toLocaleString()}원</p>
                                            </div>
                                            <div className="flex items-center space-x-1.5 flex-shrink-0">
                                                <span
                                                    className={`w-12 text-center text-gray-600 font-medium select-none text-sm transition-colors ${quantityClass}`}
                                                    aria-label={`수량: ${item.name}, 현재 수량: ${item.quantity}`}
                                                >
                                                    {item.quantity}
                                                </span>
                                                <span
                                                    className={`w-8 text-center text-gray-600 font-medium select-none text-sm transition-colors ${unitClass}`}
                                                    aria-label={`단위: ${item.name}, 현재 단위: ${item.unit}.`}
                                                >
                                                    {item.unit}
                                                </span>
                                                {!isCompleted && (
                                                    <button onClick={(e) => handleRemoveItem(e, item)} className="text-gray-400 hover:text-rose-500 p-0.5 z-10 relative">
                                                        <RemoveIcon className="w-5 h-5"/>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {!isCompleted && (
                 <footer className="absolute bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-lg border-t border-gray-200/60 shadow-[0_-5px_25px_rgba(0,0,0,0.1)]">
                    <div className="flex justify-between items-center mb-3 font-bold">
                        <span className="text-lg text-gray-600">총 합계:</span>
                        <span className="text-2xl text-gray-800">{totalAmount.toLocaleString()} 원</span>
                    </div>
                    <button 
                        onClick={handleSave} 
                        disabled={!hasChanges}
                        className="w-full bg-gradient-to-b from-blue-500 to-blue-600 text-white p-3 rounded-xl font-bold text-base hover:from-blue-600 hover:to-blue-700 transition shadow-lg shadow-blue-500/30 disabled:from-gray-400 disabled:to-gray-500 disabled:shadow-none disabled:cursor-not-allowed"
                    >
                        수정사항 저장
                    </button>
                </footer>
                )}
            </div>
            
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
                        const existingItem = editedItems.find(item => item.barcode === productForModal.barcode);
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
                onNextScan={handleNextScan}
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

export default OrderDetailModal;