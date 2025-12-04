


import React, { useState, useMemo, useCallback, useRef, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { useDataState, useDataActions, useAlert, useModals, useScanner, useMiscUI } from '../context/AppContext';
import { OrderItem, Product, EditedOrderDraft } from '../types';
import { RemoveIcon, ChatBubbleLeftIcon, SpinnerIcon, BarcodeScannerIcon } from './Icons';
import ToggleSwitch from './ToggleSwitch';
import { isSaleActive, useOrderManager } from '../hooks/useOrderManager';
import { useDebounce } from '../hooks/useDebounce';
import { getDraft, saveDraft, deleteDraft } from '../services/draftDbService';
import SearchDropdown from './SearchDropdown';
import ProductSearchResultItem from '../context/ProductSearchResultItem';

const MAX_SEARCH_RESULTS = 50;

// Helper to create a consistent, comparable representation of an item list for content changes.
const normalizeItemsForComparison = (items: OrderItem[]): Omit<OrderItem, 'price'>[] => {
    if (!items) return [];
    return items.map(({ barcode, name, quantity, unit, memo }) => ({
        barcode, name, quantity, unit, memo: memo || '',
    })).sort((a, b) => a.barcode.localeCompare(b.barcode));
};


// --- Sub-components for the Modal ---

const EditedItemRow = memo(React.forwardRef<HTMLDivElement, { item: OrderItem; isCompleted: boolean; onEdit: (item: OrderItem) => void; onRemove: (e: React.MouseEvent, item: OrderItem) => void; }>(({ item, isCompleted, onEdit, onRemove }, ref) => {
    return (
        <div
            ref={ref}
            className={`relative flex items-center p-3 space-x-3 transition-colors duration-200 ${!isCompleted ? 'hover:bg-gray-50' : 'opacity-70'}`}
            onClick={() => !isCompleted && onEdit(item)}
        >
            <div className="flex-grow min-w-0 pr-1 space-y-1">
                <p className="font-semibold text-gray-800 break-words whitespace-pre-wrap text-sm">
                    {item.name}
                </p>
                <p className="text-xs font-semibold text-blue-600">
                    발주가: {item.price.toLocaleString()}원
                </p>
                {item.memo && (
                    <p className="text-xs text-blue-600 flex items-start gap-1.5 pt-0.5">
                        <ChatBubbleLeftIcon className="w-4 h-4 flex-shrink-0 mt-px" />
                        <span className="break-all">{item.memo}</span>
                    </p>
                )}
            </div>
            <div className="flex items-center space-x-2 flex-shrink-0">
                <span className="w-14 text-center text-gray-800 font-bold text-base select-none">{item.quantity}</span>
                <span className="w-10 text-center text-gray-600 font-medium select-none text-xs">{item.unit}</span>
                 {!isCompleted && (
                    <button onClick={(e) => onRemove(e, item)} className="text-gray-400 hover:text-red-500 p-1.5 rounded-full hover:bg-red-50 z-10 relative transition-colors">
                        <RemoveIcon className="w-5 h-5"/>
                    </button>
                )}
            </div>
        </div>
    );
}));
EditedItemRow.displayName = 'EditedItemRow';

// --- Main Modal Component ---

const OrderDetailModal: React.FC = () => {
    const { products } = useDataState();
    const { updateOrder } = useDataActions();
    const { showAlert, showToast } = useAlert();
    const { editingOrder: originalOrder, closeDetailModal, openAddItemModal, openEditItemModal } = useModals();
    const { openScanner } = useScanner();
    const { setLastModifiedOrderId } = useMiscUI();
    
    const isOpen = !!originalOrder;

    const [isMounted, setIsMounted] = useState(isOpen);
    const [isRendered, setIsRendered] = useState(isOpen);
    
    // Animation Constants
    const animationDuration = 400;

    const [isSaving, setIsSaving] = useState(false);
    const [draftLoaded, setDraftLoaded] = useState(false);

    const [productSearch, setProductSearch] = useState('');
    const debouncedProductSearch = useDebounce(productSearch, 200);
    const [showProductDropdown, setShowProductDropdown] = useState(false);
    const [isBoxUnitDefault, setIsBoxUnitDefault] = useState(false);

    const productSearchInputRef = useRef<HTMLInputElement>(null);
    const productSearchBlurTimeout = useRef<number | null>(null);
    const itemsRef = useRef<OrderItem[]>([]);
    const scrollableContainerRef = useRef<HTMLElement>(null);
    const lastItemRef = useRef<HTMLDivElement>(null);

    const { items, addOrUpdateItem, updateItem, removeItem, resetItems, totalAmount, reorderItems } = useOrderManager({
        initialItems: originalOrder?.items || [],
    });
    useEffect(() => { itemsRef.current = items; }, [items]);

    const isCompleted = useMemo(() => !!originalOrder?.completedAt || !!originalOrder?.completionDetails, [originalOrder]);
    const isUpdated = useMemo(() => {
        if (!originalOrder?.createdAt || !originalOrder?.updatedAt) return false;
        // Add a small buffer to avoid flagging changes made within seconds of creation
        return new Date(originalOrder.updatedAt).getTime() > new Date(originalOrder.createdAt).getTime() + 1000;
    }, [originalOrder]);
    
    // --- Draft Logic (Restored & Enhanced) ---
    useEffect(() => {
        if (!originalOrder) return;
        
        resetItems(originalOrder.items || []);
        setDraftLoaded(false);

        const checkDraft = async () => {
            try {
                const draft = await getDraft<EditedOrderDraft>(originalOrder.id);
                if (draft && draft.items) {
                    showAlert(
                        "작성 중이던 수정 내역이 있습니다.\n불러오시겠습니까?",
                        () => { 
                            resetItems(draft.items); 
                            setDraftLoaded(true);
                            showToast("임시 저장된 내용을 불러왔습니다.", 'success');
                        },
                        '불러오기',
                        'bg-blue-600 hover:bg-blue-700',
                        () => { 
                            deleteDraft(originalOrder.id); 
                            setDraftLoaded(true); 
                        }, 
                        '삭제하고 새로 시작'
                    );
                } else {
                    setDraftLoaded(true);
                }
            } catch (e) {
                console.error("Draft check failed:", e);
                setDraftLoaded(true);
            }
        };
        
        checkDraft();
    }, [originalOrder?.id, resetItems, showAlert, showToast]);
    
    const originalItemsMemo = useMemo(() => normalizeItemsForComparison(originalOrder?.items || []), [originalOrder]);
    const currentItemsMemo = useMemo(() => normalizeItemsForComparison(items), [items]);
    
    const hasChanges = useMemo(() => {
        if (!originalOrder) return false;
        const originalOrderStr = (originalOrder?.items || []).map(i => i.barcode).join(',');
        const currentOrderStr = items.map(i => i.barcode).join(',');
        if(originalOrderStr !== currentOrderStr) return true;
        if (JSON.stringify(originalItemsMemo) !== JSON.stringify(currentItemsMemo)) return true;
        return false;
    }, [originalOrder, originalItemsMemo, currentItemsMemo, items]);

    const draftDataToSave = useMemo(() => ({ items }), [items]);
    const debouncedDraftData = useDebounce(draftDataToSave, 1000);

    useEffect(() => {
        if (!originalOrder || !draftLoaded) return;
        
        const save = async () => {
            if (hasChanges) {
                await saveDraft(originalOrder.id, debouncedDraftData as EditedOrderDraft);
            }
        };
        save();
    }, [debouncedDraftData, originalOrder, draftLoaded, hasChanges]);


    // --- UI Effects ---
    useEffect(() => {
        if (isOpen) {
            setIsMounted(true);
            const renderTimer = setTimeout(() => setIsRendered(true), 10);
            return () => clearTimeout(renderTimer);
        } else {
            setIsRendered(false);
            const unmountTimer = setTimeout(() => setIsMounted(false), animationDuration);
            return () => clearTimeout(unmountTimer);
        }
    }, [isOpen]);

    const prevItemsLength = useRef(originalOrder?.items?.length ?? 0);
    useEffect(() => {
        if (isRendered && lastItemRef.current) {
            const isAddingItem = items.length > prevItemsLength.current;
            setTimeout(() => {
                lastItemRef.current?.scrollIntoView({
                    behavior: isAddingItem ? 'smooth' : 'auto',
                    block: 'end',
                });
            }, 150);
        }
        prevItemsLength.current = items.length;
    }, [isRendered, items.length]);

    // --- Drag and Drop State and Handlers ---
    const dragIndex = useRef<number | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);

    const handleDragStart = (e: React.DragEvent, index: number) => {
        if (isCompleted) return;
        dragIndex.current = index;
        e.dataTransfer.effectAllowed = 'move';
        (e.currentTarget as HTMLElement).classList.add('dragging');
    };
    
    const handleDragEnter = (e: React.DragEvent, index: number) => {
        if (isCompleted) return;
        e.preventDefault();
        if (dragIndex.current === index) return;
        setDropIndex(index);
    };
    
    const handleDragOver = (e: React.DragEvent) => {
        if (isCompleted) return;
        e.preventDefault();
    };
    
    const handleDragEnd = (e: React.DragEvent) => {
        if (isCompleted) return;
        (e.currentTarget as HTMLElement).classList.remove('dragging');
        dragIndex.current = null;
        setDropIndex(null);
    };
    
    const handleDrop = () => {
        if (isCompleted) return;
        if (dragIndex.current !== null && dropIndex !== null) {
            const fromIndex = dragIndex.current;
            const toIndex = dropIndex > fromIndex ? dropIndex - 1 : dropIndex;
            if (fromIndex !== toIndex) {
                reorderItems(fromIndex, toIndex);
            }
        }
    };

    // --- Handlers ---
    const handleClose = useCallback(() => {
        if (hasChanges) {
            showAlert(
                "저장되지 않은 변경사항이 있습니다.\n변경사항은 임시 저장됩니다. 창을 닫으시겠습니까?",
                closeDetailModal,
                "닫기"
            );
        } else {
            closeDetailModal();
        }
    }, [hasChanges, showAlert, closeDetailModal]);
    
    const handleSave = async () => {
        if (!originalOrder || !hasChanges) return;
        setIsSaving(true);
        try {
            const updatedOrderData = { ...originalOrder, items, itemCount: items.length, total: totalAmount };
            await updateOrder(updatedOrderData);
            await deleteDraft(originalOrder.id);
            setLastModifiedOrderId(originalOrder.id);
            showToast("수정 사항이 저장되었습니다.", 'success');
            closeDetailModal();
        } catch (err) {
            showAlert('저장에 실패했습니다.');
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleAddProductFromSearch = useCallback((product: Product) => {
        const existingItem = items.find(item => item.barcode === product.barcode);
        openAddItemModal({
            product,
            existingItem: existingItem || null,
            trigger: 'search',
            onAdd: (details) => addOrUpdateItem(product, details),
            initialSettings: { unit: existingItem ? existingItem.unit : (isBoxUnitDefault ? '박스' : '개') }
        });
        setProductSearch('');
        setShowProductDropdown(false);
        productSearchInputRef.current?.blur();
    }, [items, openAddItemModal, addOrUpdateItem, isBoxUnitDefault]);
    
    const handleOpenScanner = useCallback(() => {
        const onScan = (barcode: string) => {
            const product = products.find(p => p.barcode === barcode);
            if (product) {
                const existingItem = itemsRef.current.find(item => item.barcode === product.barcode);
                openAddItemModal({
                    product,
                    existingItem,
                    trigger: 'scan',
                    onAdd: (details) => addOrUpdateItem(product, details),
                    onNextScan: handleOpenScanner,
                    initialSettings: { unit: existingItem ? existingItem.unit : (isBoxUnitDefault ? '박스' : '개') }
                });
            } else {
                showAlert("등록되지 않은 바코드입니다.");
            }
        };
        openScanner('modal', onScan, true);
    }, [openScanner, products, itemsRef, openAddItemModal, addOrUpdateItem, isBoxUnitDefault, showAlert]);

    const handleEditItem = useCallback((item: OrderItem) => {
        openEditItemModal({
            item: item,
            onSave: (updatedDetails) => updateItem(item.barcode, updatedDetails)
        });
    }, [openEditItemModal, updateItem]);
    
    const handleRemoveItem = useCallback((e: React.MouseEvent, item: OrderItem) => {
        e.stopPropagation();
        showAlert(
            `'${item.name}' 품목을 삭제하시겠습니까?`,
            () => removeItem(item.barcode),
            '삭제',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    }, [showAlert, removeItem]);
    
    const filteredProducts = useMemo(() => {
        const searchTerm = debouncedProductSearch.trim().toLowerCase();
        if (!searchTerm) return [];
        return products.filter(p => p.name.toLowerCase().includes(searchTerm) || p.barcode.includes(searchTerm)).slice(0, MAX_SEARCH_RESULTS);
    }, [products, debouncedProductSearch]);

    if (!isMounted || !originalOrder) return null;

    return createPortal(
        <div 
            className={`fixed inset-0 bg-black z-40 transition-opacity duration-300 ${isRendered ? 'bg-opacity-50' : 'bg-opacity-0'}`}
            onClick={handleClose}
            role="dialog"
            aria-modal="true"
        >
            <div 
                style={{ top: 'calc(3.5rem + env(safe-area-inset-top))' }}
                className={`absolute bottom-0 left-0 right-0 flex flex-col bg-white shadow-2xl transition-transform ${
                    isRendered
                        ? 'duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]' // Smooth ease-out
                        : 'duration-200 ease-in'
                } ${isRendered ? 'translate-y-0' : 'translate-y-full'} rounded-t-2xl will-change-transform border-t border-gray-100`}
                onClick={e => e.stopPropagation()}
            >
                <header className="relative bg-white py-2 px-4 flex-shrink-0 border-b border-gray-200 z-20 flex items-center justify-center rounded-t-2xl">
                    <div className="text-center">
                        <h2 className="text-lg font-bold text-gray-800 truncate" title={originalOrder.customer.name}>{originalOrder.customer.name}</h2>
                        <p className="text-sm text-gray-500">{new Date(originalOrder.date).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                        {isUpdated && (
                            <p className="text-xs text-gray-400 mt-0.5">
                                최초 발주일: {new Date(originalOrder.createdAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}
                            </p>
                        )}
                    </div>
                    <button onClick={handleClose} className="absolute top-1/2 right-4 -translate-y-1/2 p-2 text-gray-500 hover:bg-gray-200 rounded-full transition-colors" aria-label="닫기">
                        <RemoveIcon className="w-6 h-6"/>
                    </button>
                </header>

                {!isCompleted && (
                    <div className="w-full py-2 px-3 bg-white flex-shrink-0 z-10 border-b border-gray-200">
                        <div className="flex items-stretch gap-2 w-full max-w-2xl mx-auto">
                            <div className="relative flex-grow">
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
                                    placeholder="품목명 또는 바코드 검색"
                                    className="w-full px-3 h-11 border border-gray-300 bg-white rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder:text-gray-400 transition-colors duration-200 text-base pr-28"
                                    autoComplete="off"
                                />
                                <div className="absolute top-1/2 right-2 -translate-y-1/2 flex items-center">
                                    <ToggleSwitch id="edit-order-box-unit" label="박스" checked={isBoxUnitDefault} onChange={setIsBoxUnitDefault} color="blue" />
                                </div>
                                <SearchDropdown<Product>
                                    items={filteredProducts}
                                    renderItem={(p) => <ProductSearchResultItem product={p} onClick={handleAddProductFromSearch} />}
                                    show={showProductDropdown && !!debouncedProductSearch}
                                />
                            </div>
                            <button onClick={handleOpenScanner} className="w-11 h-11 bg-blue-600 text-white rounded-lg flex items-center justify-center font-bold hover:bg-blue-700 transition active:scale-95 shadow shadow-blue-500/30 flex-shrink-0">
                                <BarcodeScannerIcon className="w-6 h-6" />
                            </button>
                        </div>
                    </div>
                )}

                <main ref={scrollableContainerRef} className="flex-grow overflow-y-auto min-h-0" onDragOver={handleDragOver} onDrop={handleDrop}>
                    {items.length > 0 ? (
                        <div className="divide-y divide-gray-200">
                            {items.map((item, index) => {
                                const ref = index === items.length - 1 ? lastItemRef : null;
                                return (
                                    <React.Fragment key={item.barcode}>
                                        {dropIndex === index && <div className="h-16 bg-blue-100 border-2 border-dashed border-blue-400 m-2 rounded-lg" />}
                                        <div
                                            ref={ref}
                                            draggable={!isCompleted}
                                            onDragStart={(e) => handleDragStart(e, index)}
                                            onDragEnter={(e) => handleDragEnter(e, index)}
                                            onDragEnd={handleDragEnd}
                                        >
                                            <EditedItemRow
                                                item={item}
                                                isCompleted={isCompleted}
                                                onEdit={handleEditItem}
                                                onRemove={handleRemoveItem}
                                            />
                                        </div>
                                    </React.Fragment>
                                );
                            })}
                            {dropIndex === items.length && <div className="h-16 bg-blue-100 border-2 border-dashed border-blue-400 m-2 rounded-lg" />}
                        </div>
                    ) : (
                        <div className="text-center p-8 text-gray-500">
                            <p className="font-semibold">품목이 없습니다.</p>
                            {!isCompleted && <p className="text-sm mt-1">품목을 추가하여 발주를 시작하세요.</p>}
                        </div>
                    )}
                </main>
                
                <div className="flex-shrink-0 bg-white p-3 border-t border-gray-200">
                    <div className="max-w-2xl mx-auto">
                        <div className="flex justify-between items-center font-bold px-1">
                            <span className="text-sm text-gray-600">총 합계:</span>
                            <span className="text-lg text-gray-900 tracking-tighter">{totalAmount.toLocaleString()} 원</span>
                        </div>
                    </div>
                </div>
                <footer className="p-2 bg-white z-20 flex-shrink-0 safe-area-pb">
                    <div className="max-w-2xl mx-auto">
                        <div className="w-full">
                            {!isCompleted ? (
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleClose}
                                        className="flex-1 h-11 bg-gray-200 text-gray-800 rounded-lg font-bold hover:bg-gray-300 transition active:scale-95"
                                    >
                                        닫기
                                    </button>
                                    <button
                                        onClick={handleSave}
                                        disabled={!hasChanges || isSaving}
                                        className="relative flex-[2] h-11 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition shadow-lg shadow-blue-500/30 disabled:bg-gray-300 disabled:text-gray-500 disabled:shadow-none flex items-center justify-center active:scale-95"
                                    >
                                        <span className={isSaving ? 'opacity-0' : 'opacity-100'}>
                                            {hasChanges ? '변경사항 저장' : '변경사항 없음'}
                                        </span>
                                        {isSaving && (
                                            <div className="absolute inset-0 flex items-center justify-center">
                                                <SpinnerIcon className="w-6 h-6"/>
                                            </div>
                                        )}
                                    </button>
                                </div>
                            ) : (
                                <div className="w-full h-11 bg-gray-100 text-gray-400 rounded-lg font-bold text-base flex items-center justify-center border border-gray-200">
                                    완료된 발주 (수정 불가)
                                </div>
                            )}
                        </div>
                    </div>
                </footer>
            </div>
        </div>,
        document.body
    );
};

export default OrderDetailModal;