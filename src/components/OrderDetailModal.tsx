
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
    // Price is excluded from comparison because it can be updated from product data
    // but we only care about user-made changes (quantity, unit, memo).
    return items.map(({ barcode, name, quantity, unit, memo }) => ({
        barcode, name, quantity, unit, memo: memo || '',
    })).sort((a, b) => a.barcode.localeCompare(b.barcode));
};


// --- Sub-components for the Modal ---

const EditedItemRow = memo(React.forwardRef<HTMLDivElement, { item: OrderItem; product: Product | undefined; isCompleted: boolean, isNew: boolean, isModified: boolean, onEdit: (item: OrderItem) => void; onRemove: (e: React.MouseEvent, item: OrderItem) => void; }>(({ item, product, isCompleted, isNew, isModified, onEdit, onRemove }, ref) => {
    const saleIsActive = product ? isSaleActive(product.saleStartDate, product.saleEndDate) : false;
    const hasSalePrice = product ? (product.salePrice !== undefined && product.salePrice !== null) : false;

    return (
        <div
            ref={ref}
            className={`relative overflow-hidden flex items-center p-3 space-x-3 transition-colors duration-200 ${!isCompleted ? 'hover:bg-gray-50' : 'opacity-70'} ${isNew ? 'bg-green-50' : ''} ${isModified ? 'bg-amber-50' : ''}`}
            onClick={() => !isCompleted && onEdit(item)}
        >
            {saleIsActive && hasSalePrice && (
                <div className="sale-ribbon">할인</div>
            )}
            <div className="flex-grow min-w-0 pr-1 space-y-1">
                {/* Product Name */}
                <p className="font-semibold text-gray-800 break-words whitespace-pre-wrap flex items-center gap-2">
                    {isNew && <span className="text-xs font-bold text-white bg-green-500 rounded-full px-2 py-0.5 tracking-wide">신규</span>}
                    {isModified && <span className="text-xs font-bold text-white bg-amber-500 rounded-full px-2 py-0.5 tracking-wide">수정</span>}
                    <span>{item.name}</span>
                </p>

                {/* Price info */}
                <>
                  <p className="text-sm font-semibold text-blue-600">발주가: {item.price.toLocaleString()}원</p>
                  {product && (
                      <div className="text-xs flex items-baseline gap-x-1.5 flex-wrap text-gray-500">
                          <span>현재:</span>
                          <span className="font-semibold">{product.costPrice?.toLocaleString()}원</span>
                          <span className="text-gray-400">/</span>
                          <span className={`font-semibold ${saleIsActive && hasSalePrice ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                              {product.sellingPrice?.toLocaleString()}원
                          </span>
                          {hasSalePrice && (
                              <span
                                  className={`${saleIsActive ? 'text-red-600 font-bold' : 'text-gray-500'}`}
                                  style={!saleIsActive ? { fontSize: '80%' } : {}}
                              >
                                  {product.salePrice?.toLocaleString()}원
                              </span>
                          )}
                      </div>
                  )}
                </>
                
                {/* Sale Period and Supplier */}
                {product && (product.saleStartDate || product.saleEndDate) && (
                     <div className="text-xs text-gray-500">
                        <span className={saleIsActive ? 'font-semibold text-blue-600' : 'text-gray-400'}>
                            행사기간: {product.saleStartDate ? `${product.saleStartDate}~` : `~`}{product.saleEndDate}
                        </span>
                     </div>
                )}
                
                {/* Memo */}
                {item.memo && (
                    <p className="text-xs text-blue-600 flex items-start gap-1.5 pt-0.5">
                        <ChatBubbleLeftIcon className="w-4 h-4 flex-shrink-0 mt-px" />
                        <span className="break-all">{item.memo}</span>
                    </p>
                )}
            </div>
            <div className="flex items-center space-x-2 flex-shrink-0">
                <span className="w-14 text-center text-gray-800 font-bold text-lg select-none">{item.quantity}</span>
                <span className="w-10 text-center text-gray-600 font-medium select-none text-sm">{item.unit}</span>
                 {!isCompleted && (
                    <button onClick={(e) => onRemove(e, item)} className="text-gray-400 hover:text-rose-500 p-1.5 rounded-full hover:bg-rose-50 z-10 relative transition-colors">
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
    const { showAlert } = useAlert();
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
    
    // --- Draft Logic ---
    useEffect(() => {
        if (!originalOrder) return;
        resetItems(originalOrder.items || []);

        getDraft<EditedOrderDraft>(originalOrder.id).then(draft => {
            if (draft) {
                showAlert(
                    "임시 저장된 수정 내역이 있습니다.\n불러오시겠습니까?",
                    () => { resetItems(draft.items); setDraftLoaded(true); },
                    '불러오기',
                    'bg-blue-500 hover:bg-blue-600 focus:ring-blue-500',
                    () => { deleteDraft(originalOrder.id); setDraftLoaded(true); }
                );
            } else {
                setDraftLoaded(true);
            }
        });
    }, [originalOrder, resetItems, showAlert]);
    
    const originalItemsMemo = useMemo(() => normalizeItemsForComparison(originalOrder?.items || []), [originalOrder]);
    const currentItemsMemo = useMemo(() => normalizeItemsForComparison(items), [items]);
    
    const hasChanges = useMemo(() => {
        if (!originalOrder) return false;
        // 1. Check if the order of items has changed.
        const originalOrderStr = (originalOrder?.items || []).map(i => i.barcode).join(',');
        const currentOrderStr = items.map(i => i.barcode).join(',');
        if(originalOrderStr !== currentOrderStr) return true;

        // 2. Check if the content (quantity, unit, memo) of any item has changed.
        if (JSON.stringify(originalItemsMemo) !== JSON.stringify(currentItemsMemo)) return true;

        return false;
    }, [originalOrder, originalItemsMemo, currentItemsMemo, items]);

    const draftDataToSave = useMemo(() => ({ items }), [items]);
    const debouncedDraftData = useDebounce(draftDataToSave, 500);

    useEffect(() => {
        if (!originalOrder || !draftLoaded || !hasChanges) return;
        saveDraft(originalOrder.id, debouncedDraftData as EditedOrderDraft);
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
            // A short delay can help ensure rendering is complete
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
                "저장되지 않은 변경사항이 있습니다.\n변경사항은 임시 저장됩니다. 정말 닫으시겠습니까?",
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
    
    // --- Derived Data for Rendering ---
    const filteredProducts = useMemo(() => {
        const searchTerm = debouncedProductSearch.trim().toLowerCase();
        if (!searchTerm) return [];
        return products.filter(p => p.name.toLowerCase().includes(searchTerm) || p.barcode.includes(searchTerm)).slice(0, MAX_SEARCH_RESULTS);
    }, [products, debouncedProductSearch]);

    const { newItems, modifiedItems } = useMemo(() => {
        const originalBarcodes = new Set(originalItemsMemo.map(i => i.barcode));
        const originalItemMap = new Map(originalItemsMemo.map(i => [i.barcode, JSON.stringify(i)]));
        const newItemsSet = new Set<string>();
        const modifiedItemsSet = new Set<string>();

        items.forEach(item => {
            const normalizedCurrentItem = normalizeItemsForComparison([item])[0];
            if (!originalBarcodes.has(item.barcode)) {
                newItemsSet.add(item.barcode);
            } else if (originalItemMap.get(item.barcode) !== JSON.stringify(normalizedCurrentItem)) {
                modifiedItemsSet.add(item.barcode);
            }
        });
        return { newItems: newItemsSet, modifiedItems: modifiedItemsSet };
    }, [items, originalItemsMemo]);

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
                className={`absolute bottom-0 left-0 right-0 h-full flex flex-col bg-white shadow-2xl transition-transform ${
                    isRendered
                        ? 'duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]' // Smooth ease-out
                        : 'duration-200 ease-in'
                } ${isRendered ? 'translate-y-0' : 'translate-y-full'} rounded-t-2xl will-change-transform border-t border-gray-100`}
                onClick={e => e.stopPropagation()}
            >
                <header className="relative bg-white p-4 flex-shrink-0 border-b border-gray-200 z-20 flex items-center justify-center rounded-t-2xl">
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
                        <div className="grid grid-cols-[1fr_auto] items-stretch gap-2 w-full max-w-2xl mx-auto">
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
                                    placeholder="품목 추가..."
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
                            <button onClick={handleOpenScanner} className="w-20 bg-blue-600 text-white rounded-lg flex flex-col items-center justify-center gap-1 font-bold hover:bg-blue-700 transition active:scale-95 shadow shadow-blue-500/30">
                                <BarcodeScannerIcon className="w-6 h-6" />
                                <span className="text-xs">스캔</span>
                            </button>
                        </div>
                    </div>
                )}

                <main ref={scrollableContainerRef} className="flex-grow overflow-y-auto" onDragOver={handleDragOver} onDrop={handleDrop}>
                    {items.length > 0 ? (
                        <div className="divide-y divide-gray-200">
                            {items.map((item, index) => {
                                const product = products.find(p => p.barcode === item.barcode);
                                const isNew = newItems.has(item.barcode);
                                const isModified = modifiedItems.has(item.barcode);
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
                                            className={!isCompleted ? "cursor-grab" : ""}
                                        >
                                            <EditedItemRow
                                                item={item}
                                                product={product}
                                                isCompleted={isCompleted}
                                                isNew={isNew}
                                                isModified={isModified}
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
                
                {!isCompleted && hasChanges && (
                    <footer className="p-2 bg-white border-t border-gray-200 z-10 flex-shrink-0">
                        <div className="max-w-2xl mx-auto">
                            <div className="flex justify-between items-center font-bold mb-2 px-2">
                                <span className="text-lg text-gray-600">총 합계:</span>
                                <span className="text-2xl text-gray-900 tracking-tighter">{totalAmount.toLocaleString()} 원</span>
                            </div>
                            <button
                                onClick={handleSave}
                                disabled={isSaving}
                                className="relative w-full h-11 bg-blue-600 text-white rounded-lg font-bold text-base hover:bg-blue-700 transition shadow-lg shadow-blue-500/40 disabled:bg-gray-400 disabled:shadow-none disabled:cursor-not-allowed flex items-center justify-center active:scale-95"
                            >
                                <span className={isSaving ? 'opacity-0' : 'opacity-100'}>변경사항 저장</span>
                                {isSaving && (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <SpinnerIcon className="w-6 h-6"/>
                                    </div>
                                )}
                            </button>
                        </div>
                    </footer>
                )}
            </div>
        </div>,
        document.body
    );
};

export default OrderDetailModal;
