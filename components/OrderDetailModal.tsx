import React, { useState, useMemo, useCallback, useRef, useEffect, memo } from 'react';
import { useDataState, useDataActions, useUIActions, useUIState } from '../context/AppContext';
import { Order, OrderItem, Product, EditedOrderDraft } from '../types';
import { PlusCircleIcon, RemoveIcon, CheckCircleIcon, SmsIcon, XlsIcon, ChatBubbleLeftIcon, SpinnerIcon, DocumentIcon } from './Icons';
import ToggleSwitch from '../components/ToggleSwitch';
import { useOrderManager } from '../hooks/useOrderManager';
import AddItemModal from './AddItemModal';
import EditItemModal from './EditItemModal';
import { useDebounce } from '../hooks/useDebounce';
import { getDraft, saveDraft, deleteDraft } from '../services/draftDbService';
import MemoModal from './MemoModal';
import SearchDropdown from './SearchDropdown';

// Helper to ensure item properties are consistent for reliable comparison.
const normalizeItemsForComparison = (items: OrderItem[]): OrderItem[] => {
    if (!items) return [];
    return items.map(({ barcode, name, price, quantity, unit, memo }) => ({
        barcode,
        name,
        price,
        quantity,
        unit,
        memo: memo || '',
    }));
};

// FIX: Wrap EditedItemRow in React.forwardRef to allow it to receive a ref.
// This is necessary to scroll to the item when it's added.
const EditedItemRow = memo(React.forwardRef<HTMLDivElement, { item: OrderItem; isCompleted: boolean, isNew: boolean, onEdit: (item: OrderItem) => void; onRemove: (e: React.MouseEvent, item: OrderItem) => void; }>(({ item, isCompleted, isNew, onEdit, onRemove }, ref) => {
    return (
        <div
            ref={ref}
            className={`flex items-center p-3 space-x-2 transition-all duration-200 ${!isCompleted ? 'cursor-pointer hover:bg-gray-50' : ''} ${isNew ? 'animate-fade-in-down' : ''}`}
            onClick={() => !isCompleted && onEdit(item)}
        >
            <div className="flex-grow min-w-0 pr-1">
                <p className="font-semibold text-sm text-gray-800 break-words whitespace-pre-wrap flex items-center gap-2">
                    {isNew && <span className="text-xs font-bold text-white bg-green-500 rounded-full px-2 py-0.5">NEW</span>}
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
                {!isCompleted && (
                    <button onClick={(e) => onRemove(e, item)} className="text-gray-400 hover:text-rose-500 p-0.5 z-10 relative">
                        <RemoveIcon className="w-5 h-5"/>
                    </button>
                )}
            </div>
        </div>
    );
}));
EditedItemRow.displayName = 'EditedItemRow';


const OrderDetailModal: React.FC = () => {
    const { products } = useDataState();
    const { updateOrder } = useDataActions();
    const { editingOrder: order } = useUIState();
    const { closeDetailModal, showAlert, openScanner, setLastModifiedOrderId } = useUIActions();
    
    const isCompleted = useMemo(() => !!order?.completedAt || !!order?.completionDetails, [order]);
    
    const [productSearch, setProductSearch] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [isBoxUnitDefault, setIsBoxUnitDefault] = useState(false);
    const [productForModal, setProductForModal] = useState<Product | null>(null);
    const [existingItemForModal, setExistingItemForModal] = useState<OrderItem | null>(null);
    const [addItemTrigger, setAddItemTrigger] = useState<'scan' | 'search'>('search');
    const [scanSettings, setScanSettings] = useState<{ unit: '개' | '박스' }>({ unit: isBoxUnitDefault ? '박스' : '개' });
    
    const [quickAddedBarcode, setQuickAddedBarcode] = useState<string | null>(null);
    const [editingItem, setEditingItem] = useState<OrderItem | null>(null);
    const [memo, setMemo] = useState('');
    const [isMemoModalOpen, setIsMemoModalOpen] = useState(false);
    const [isMemoSectionOpen, setIsMemoSectionOpen] = useState(false);
    const productSearchBlurTimeout = useRef<number | null>(null);
    const productSearchInputRef = useRef<HTMLInputElement | null>(null);

    const [isDraftLoading, setIsDraftLoading] = useState(true);
    const [draft, setDraft] = useState<EditedOrderDraft | null>(null);

    const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
    const scrollableContainerRef = useRef<HTMLDivElement | null>(null);
    const lastItemCount = useRef(0);
    
    const [isRendered, setIsRendered] = useState(false);

    useEffect(() => {
        // Animate in
        const timer = setTimeout(() => setIsRendered(true), 10);
        return () => clearTimeout(timer);
    }, []);

    // --- State and Draft Logic ---
    useEffect(() => {
        if (order) {
            setIsDraftLoading(true);
            getDraft<EditedOrderDraft>(order.id)
                .then(setDraft)
                .catch(err => {
                    console.error(`Failed to load draft for order ${order.id}:`, err);
                    setDraft(null);
                })
                .finally(() => {
                    setIsDraftLoading(false);
                });
        }
    }, [order]);

    const initialData = useMemo(() => {
        if (!order) return { items: [], memo: '' };
        if (isDraftLoading) return { items: [], memo: '' }; 
        if (draft) return { items: draft.items, memo: draft.memo };
        // Defensive fix: ensure order.items is treated as an empty array if it's missing.
        return { items: order.items || [], memo: order.memo || '' };
    }, [order, draft, isDraftLoading]);
    
    const {
        items: editedItems,
        addOrUpdateItem,
        updateItem,
        removeItem,
        totalAmount,
    } = useOrderManager({
        initialItems: initialData.items,
    });
    
    const editedItemsRef = useRef(editedItems);
    useEffect(() => {
        editedItemsRef.current = editedItems;
    }, [editedItems]);

    useEffect(() => {
        setMemo(initialData.memo);
    }, [initialData.memo]);

    const serverStateJSON = useMemo(() => {
        if (!order) return '';
        const normalizedOriginalItems = normalizeItemsForComparison(order.items);
        return JSON.stringify({ items: normalizedOriginalItems, memo: order.memo || '' });
    }, [order]);
    
    const hasChanges = useMemo(() => {
        if (isDraftLoading || !serverStateJSON) return false;
        return JSON.stringify({ items: normalizeItemsForComparison(editedItems), memo }) !== serverStateJSON;
    }, [editedItems, memo, serverStateJSON, isDraftLoading]);

    const debouncedDraftData = useDebounce({ items: editedItems, memo }, 500);

    useEffect(() => {
        if (isDraftLoading || !order) return;

        if (JSON.stringify({ items: normalizeItemsForComparison(debouncedDraftData.items), memo: debouncedDraftData.memo }) !== serverStateJSON) {
            saveDraft(order.id, debouncedDraftData as EditedOrderDraft);
        } else {
            deleteDraft(order.id);
        }
    }, [debouncedDraftData, serverStateJSON, order, isDraftLoading]);
    
    const handleAnimatedClose = useCallback(() => {
        setIsRendered(false);
        setTimeout(() => {
            closeDetailModal();
        }, 500); // Match animation duration
    }, [closeDetailModal]);
    
    const handleCancelAndDiscard = () => {
        if (hasChanges) {
             showAlert(
                "수정사항을 저장하지 않고 취소하시겠습니까?\n임시 저장된 내용도 삭제됩니다.",
                () => {
                    if (order) {
                        deleteDraft(order.id);
                    }
                    handleAnimatedClose();
                },
                '변경사항 폐기',
                'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
            );
        } else {
            handleAnimatedClose();
        }
    };

    useEffect(() => {
        if (order) {
            setIsMemoSectionOpen(false);
        }
    }, [order]);

    useEffect(() => {
        setScanSettings({ unit: isBoxUnitDefault ? '박스' : '개' });
    }, [isBoxUnitDefault]);
    

    useEffect(() => {
        const handlePopState = (event: PopStateEvent) => {
            if (order !== null) {
                event.preventDefault();
                handleAnimatedClose();
            }
        };

        window.history.pushState({ modal: 'open' }, '');
        window.addEventListener('popstate', handlePopState);

        return () => {
            window.removeEventListener('popstate', handlePopState);
            if (window.history.state && window.history.state.modal === 'open') {
                window.history.back();
            }
        };
    }, [order, handleAnimatedClose]);

    const handleAddProduct = useCallback((product: Product) => {
        const existingItem = editedItems.find(item => item.barcode === product.barcode);
        setExistingItemForModal(existingItem || null);
        setProductForModal(product);
    }, [editedItems]);

    const handleScanSuccess = useCallback((barcode: string) => {
        const product = products.find(p => p.barcode === barcode);
        if (product) {
            setAddItemTrigger('scan');
            const existingItem = editedItemsRef.current.find(item => item.barcode === product.barcode);
            setExistingItemForModal(existingItem || null);
            setProductForModal(product);
        } else {
            showAlert("등록되지 않은 바코드입니다.");
        }
    }, [products, showAlert]);
    
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
        productSearchInputRef.current?.blur();
    };

    const handleSave = () => {
        if (!order) return;
        if (editedItems.length === 0) {
            showAlert("품목이 없습니다. 발주를 저장할 수 없습니다.");
            return;
        }

        const orderToUpdate: Order = {
            ...order,
            items: editedItems,
            total: totalAmount,
            memo: memo.trim(),
            date: new Date().toISOString(),
        };

        updateOrder(orderToUpdate);
        setLastModifiedOrderId(order.id);
        deleteDraft(order.id);
        handleAnimatedClose();
        showAlert("발주 내역이 수정되었습니다.");
    };
    

    useEffect(() => {
        if (scrollableContainerRef.current && quickAddedBarcode) {
            const itemElement = itemRefs.current.get(quickAddedBarcode);
            if (itemElement) {
                itemElement.scrollIntoView({ behavior: 'auto', block: 'center' });
            }
            setQuickAddedBarcode(null);
        } else if (scrollableContainerRef.current && editedItems.length > lastItemCount.current) {
            const timer = setTimeout(() => {
                if (scrollableContainerRef.current) {
                    scrollableContainerRef.current.scrollTo({
                        top: scrollableContainerRef.current.scrollHeight,
                        behavior: 'auto',
                    });
                }
            }, 50);
            return () => clearTimeout(timer);
        }
        lastItemCount.current = editedItems.length;
    }, [editedItems, quickAddedBarcode]);
    
    const handleRemoveItem = useCallback((e: React.MouseEvent, itemToRemove: OrderItem) => {
        e.stopPropagation();
        showAlert(
            `'${itemToRemove.name}' 품목을 삭제하시겠습니까?`,
            () => removeItem(itemToRemove.barcode),
            '삭제',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    }, [showAlert, removeItem]);

    const handleEditItem = useCallback((item: OrderItem) => {
        setEditingItem(item);
    }, []);

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
        } else if (order.completedAt) {
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

    const originalItemBarcodes = useMemo(() => new Set((order?.items || []).map(item => item.barcode)), [order]);

    const showLoadingSpinner = isDraftLoading;

    return (
        <div className={`fixed inset-0 bg-black z-30 flex items-end justify-center transition-opacity duration-500 ${isRendered ? 'bg-opacity-50' : 'bg-opacity-0'}`}>
            <div
                className={`bg-gray-50 h-[95%] w-full max-w-3xl rounded-t-2xl flex flex-col relative ${isRendered ? 'translate-y-0' : 'translate-y-full'}`}
                style={{ transition: 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
            >
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
                        <button onClick={handleAnimatedClose} className="text-gray-500 hover:text-gray-800 transition-colors">
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
                        <div className="flex gap-2 items-center">
                            <div className="relative flex-grow">
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
                                    className="w-full p-2 h-11 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-500 placeholder:text-gray-400 pr-24"
                                    autoComplete="off"
                                />
                                <div className="absolute top-1/2 right-2 -translate-y-1/2 flex items-center">
                                    <ToggleSwitch
                                        id="modal-box-unit"
                                        label="박스"
                                        checked={isBoxUnitDefault}
                                        onChange={setIsBoxUnitDefault}
                                        color="blue"
                                    />
                                </div>
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
                            <button
                                onClick={() => openScanner('modal', handleScanSuccess, true)}
                                className="flex-shrink-0 h-11 bg-blue-600 text-white rounded-lg p-2 flex items-center justify-center gap-2 font-bold hover:bg-blue-700 transition"
                                aria-label="바코드 스캔"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg>
                                <span>스캔</span>
                            </button>
                        </div>
                    </div>
                )}
                
                <div ref={scrollableContainerRef} className="scrollable-content p-2 pb-32 relative">
                     {showLoadingSpinner ? (
                        <div className="absolute inset-0 bg-gray-50/80 flex items-center justify-center z-20">
                            <SpinnerIcon className="w-8 h-8 text-blue-500" />
                        </div>
                     ) : editedItems.length === 0 ? (
                        <div className="relative flex flex-col items-center justify-center h-full text-gray-400 p-8">
                             <DocumentIcon className="w-16 h-16 text-gray-300 mb-4" />
                             <p className="text-center text-lg font-semibold">품목이 없습니다</p>
                             {!isCompleted && <p className="text-sm mt-1">스캐너 또는 검색을 이용해 품목을 추가하세요.</p>}
                        </div>
                    ) : (
                        <div className="bg-white rounded-lg shadow-md border border-gray-200/80 overflow-hidden">
                            <div className="divide-y divide-gray-200">
                                {editedItems.map((item) => {
                                    const isNew = !originalItemBarcodes.has(item.barcode);
                                    return (
                                        <EditedItemRow 
                                            key={item.barcode}
                                            ref={el => { if (el) itemRefs.current.set(item.barcode, el); }}
                                            item={item}
                                            isCompleted={isCompleted}
                                            isNew={isNew}
                                            onEdit={handleEditItem}
                                            onRemove={handleRemoveItem}
                                        />
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
                    <div className="flex items-stretch gap-2">
                        <button
                            onClick={handleCancelAndDiscard}
                            className="px-6 py-3 bg-gray-200 text-gray-800 rounded-xl font-bold text-base hover:bg-gray-300 transition shadow-sm"
                        >
                            취소
                        </button>
                        <button 
                            onClick={handleSave} 
                            disabled={!hasChanges || editedItems.length === 0}
                            className="flex-grow bg-gradient-to-b from-blue-500 to-blue-600 text-white p-3 rounded-xl font-bold text-base hover:from-blue-600 hover:to-blue-700 transition shadow-lg shadow-blue-500/30 disabled:from-gray-400 disabled:to-gray-500 disabled:shadow-none disabled:cursor-not-allowed"
                        >
                            수정사항 저장
                        </button>
                    </div>
                </footer>
                )}
            </div>
            
             <AddItemModal
                isOpen={!!productForModal}
                product={productForModal}
                existingItem={existingItemForModal}
                onClose={() => {
                    setProductForModal(null);
                    setExistingItemForModal(null);
                }}
                onAdd={({ quantity, unit, memo }) => {
                    if (productForModal) {
                        addOrUpdateItem(productForModal, { quantity, unit, memo });
                        setQuickAddedBarcode(productForModal.barcode);
                        setProductForModal(null);
                        setExistingItemForModal(null);
                    }
                }}
                onNextScan={handleNextScan}
                trigger={addItemTrigger}
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
            <MemoModal
                isOpen={isMemoModalOpen}
                onClose={() => setIsMemoModalOpen(false)}
                onSave={(newMemo) => { setMemo(newMemo); setIsMemoModalOpen(false); }}
                initialMemo={memo}
            />
        </div>
    );
};

export default OrderDetailModal;