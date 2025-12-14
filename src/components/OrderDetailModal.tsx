
import React, { useState, useMemo, useCallback, useRef, useEffect, memo } from 'react';
import { useDataState, useDataActions, useAlert, useModals, useScanner, useMiscUI } from '../context/AppContext';
import { OrderItem, Product, EditedOrderDraft, Order } from '../types';
import { RemoveIcon, ChatBubbleLeftIcon, SpinnerIcon, BarcodeScannerIcon } from './Icons';
import ToggleSwitch from './ToggleSwitch';
import { isSaleActive, useOrderManager } from '../hooks/useOrderManager';
import { useDebounce } from '../hooks/useDebounce';
import { getDraft, saveDraft, deleteDraft } from '../services/draftDbService';
import SearchDropdown from './SearchDropdown';
import ProductSearchResultItem from '../context/ProductSearchResultItem';
import { useProductSearch } from '../hooks/useProductSearch';
import ActionModal from './ActionModal';

const normalizeItemsForComparison = (items: OrderItem[]): Omit<OrderItem, 'price'>[] => {
    if (!items) return [];
    return items.map(({ barcode, name, quantity, unit, memo }) => ({
        barcode, name, quantity, unit, memo: memo || '',
    })).sort((a, b) => a.barcode.localeCompare(b.barcode));
};

// Item Status Type
type ItemStatus = 'new' | 'modified' | 'none';

const EditedItemRow = memo(React.forwardRef<HTMLDivElement, { 
    item: OrderItem; 
    product?: Product; 
    isCompleted: boolean; 
    status: ItemStatus; // Added status prop
    onEdit: (item: OrderItem) => void; 
    onRemove: (e: React.MouseEvent, item: OrderItem) => void; 
}>(({ item, product, isCompleted, status, onEdit, onRemove }, ref) => {
    const saleIsActive = product ? isSaleActive(product.saleStartDate, product.saleEndDate) : false;

    return (
        <div
            ref={ref}
            className={`flex items-center p-3 space-x-3 bg-white border-b border-gray-100 last:border-0 ${!isCompleted ? 'cursor-pointer active:bg-gray-50' : 'opacity-80'}`}
            onClick={() => !isCompleted && onEdit(item)}
        >
            <div className="flex-grow min-w-0 pr-1 space-y-1">
                {/* Row 1: Name and Badge */}
                <div className="flex justify-between items-start gap-2">
                    <div className="flex flex-wrap items-center gap-1 flex-grow">
                        {/* Status Badges */}
                        {status === 'new' && (
                            <span className="bg-teal-100 text-teal-700 text-[10px] font-bold px-1.5 py-0.5 rounded border border-teal-200 whitespace-nowrap">
                                신규
                            </span>
                        )}
                        {status === 'modified' && (
                            <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded border border-amber-200 whitespace-nowrap">
                                수정
                            </span>
                        )}
                        <p className="font-semibold text-gray-800 break-words whitespace-pre-wrap text-sm leading-snug">
                            {item.name}
                        </p>
                    </div>
                    {!isCompleted && saleIsActive && (
                        <span className="bg-red-100 text-red-600 text-[10px] font-extrabold px-1.5 py-0.5 rounded flex-shrink-0 whitespace-nowrap border border-red-200">
                            행사중
                        </span>
                    )}
                </div>

                {/* Row 2: Price Info (Order vs Current) & Total */}
                <div className="flex flex-wrap items-center gap-x-2 text-xs">
                    <div className="flex items-center gap-1">
                        <span className="font-bold text-blue-600">{item.price.toLocaleString()}</span>
                        <span className="text-gray-400">× {item.quantity} =</span>
                        <span className="font-extrabold text-gray-800">{(item.price * item.quantity).toLocaleString()}</span>
                    </div>
                    
                    {!isCompleted && product && (
                        <>
                            <span className="text-gray-300">|</span>
                            <span className="text-gray-500">현재매입:</span>
                            {saleIsActive && product.eventCostPrice ? (
                                <div className="flex items-center gap-1">
                                    <span className="line-through text-gray-400">{product.costPrice.toLocaleString()}</span>
                                    <span className="text-red-600 font-bold">{product.eventCostPrice.toLocaleString()}</span>
                                </div>
                            ) : (
                                <span className="text-gray-700 font-medium">{product.costPrice?.toLocaleString()}</span>
                            )}
                        </>
                    )}
                </div>

                {/* Row 3: Sale Date (If Active) */}
                {!isCompleted && product && saleIsActive && (product.saleStartDate || product.saleEndDate) && (
                     <div className="text-[11px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded inline-block">
                        <span className="font-bold">행사기간: </span>
                        <span>{product.saleStartDate ? `${product.saleStartDate}~` : `~`}{product.saleEndDate}</span>
                     </div>
                )}

                {/* Row 4: Memo */}
                {item.memo && (
                    <p className="text-xs text-orange-600 flex items-start gap-1.5 pt-0.5 font-medium">
                        <ChatBubbleLeftIcon className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                        <span className="break-all">{item.memo}</span>
                    </p>
                )}
            </div>

            {/* Quantity and Actions */}
            <div className="flex items-center space-x-2 flex-shrink-0">
                <div className="flex flex-col items-end">
                    <span className={`font-bold text-lg select-none leading-none ${status !== 'none' ? 'text-blue-600' : 'text-gray-800'}`}>{item.quantity}</span>
                    <span className="text-gray-500 font-medium select-none text-[10px]">{item.unit}</span>
                </div>
                 {!isCompleted && (
                    <button onClick={(e) => onRemove(e, item)} className="text-gray-400 hover:text-red-500 p-2 rounded-full hover:bg-red-50 z-10 relative transition-colors">
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
    const { showAlert, showToast } = useAlert();
    const { editingOrder: activeOrderFromContext, closeDetailModal, openAddItemModal, openEditItemModal } = useModals();
    const { openScanner } = useScanner();
    const { setLastModifiedOrderId } = useMiscUI();
    
    // Cache the order to display during exit animation when global state is cleared
    const [cachedOrder, setCachedOrder] = useState<Order | null>(null);
    useEffect(() => {
        if (activeOrderFromContext) {
            setCachedOrder(activeOrderFromContext);
        }
    }, [activeOrderFromContext]);

    // Use cached version for rendering to persist data during exit animation
    const originalOrder = activeOrderFromContext || cachedOrder;
    // Determine if modal should be open based on global state
    const isOpen = !!activeOrderFromContext;

    const [isSaving, setIsSaving] = useState(false);
    const [draftLoaded, setDraftLoaded] = useState(false);

    const { 
        searchTerm: productSearch, 
        setSearchTerm: setProductSearch, 
        results: productSearchResults, 
        isSearching: isSearchingProducts, 
        search,
        searchByBarcode
    } = useProductSearch('newOrder', 50, '상품조회_발주');
    const debouncedProductSearch = useDebounce(productSearch, 300);

    useEffect(() => {
        search(debouncedProductSearch);
    }, [debouncedProductSearch, search]);

    const [showProductDropdown, setShowProductDropdown] = useState(false);
    const [isBoxUnitDefault, setIsBoxUnitDefault] = useState(false);

    const productSearchInputRef = useRef<HTMLInputElement>(null);
    const productSearchBlurTimeout = useRef<number | null>(null);
    const itemsRef = useRef<OrderItem[]>([]);
    const lastItemRef = useRef<HTMLDivElement>(null);

    const { items, addOrUpdateItem, updateItem, removeItem, resetItems, totalAmount, reorderItems } = useOrderManager({
        initialItems: originalOrder?.items || [],
    });
    useEffect(() => { itemsRef.current = items; }, [items]);

    const isCompleted = useMemo(() => !!originalOrder?.completedAt || !!originalOrder?.completionDetails, [originalOrder]);
    const isUpdated = useMemo(() => {
        if (!originalOrder?.createdAt || !originalOrder?.updatedAt) return false;
        return new Date(originalOrder.updatedAt).getTime() > new Date(originalOrder.createdAt).getTime() + 1000;
    }, [originalOrder]);
    
    // Create a Map of original items for fast comparison to detect changes per item
    const originalItemsMap = useMemo(() => {
        const map = new Map<string, OrderItem>();
        if (originalOrder?.items) {
            originalOrder.items.forEach(item => map.set(item.barcode, item));
        }
        return map;
    }, [originalOrder]);

    const getItemStatus = useCallback((item: OrderItem): ItemStatus => {
        const original = originalItemsMap.get(item.barcode);
        if (!original) return 'new';
        
        // Check for modifications (quantity, unit, memo)
        const isQuantityChanged = original.quantity !== item.quantity;
        const isUnitChanged = original.unit !== item.unit;
        const isMemoChanged = (original.memo || '') !== (item.memo || '');
        
        if (isQuantityChanged || isUnitChanged || isMemoChanged) {
            return 'modified';
        }
        return 'none';
    }, [originalItemsMap]);

    useEffect(() => {
        // Only run draft check if we have an active order context (i.e. just opened)
        if (!activeOrderFromContext) return;
        
        // Critical: Reset items immediately to the current order's items
        resetItems(activeOrderFromContext.items || []);
        setDraftLoaded(false);

        // Skip draft check if the order is already completed
        const isAlreadyCompleted = !!activeOrderFromContext.completedAt || !!activeOrderFromContext.completionDetails;
        if (isAlreadyCompleted) {
            setDraftLoaded(true);
            // Silently delete any stale draft for this completed order to avoid future alerts
            deleteDraft(activeOrderFromContext.id).catch(() => {});
            return;
        }

        const checkDraft = async () => {
            try {
                // Double check completion status inside async to be safe
                if (activeOrderFromContext.completedAt || activeOrderFromContext.completionDetails) {
                     setDraftLoaded(true);
                     return;
                }

                const draft = await getDraft<EditedOrderDraft>(activeOrderFromContext.id);
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
                            deleteDraft(activeOrderFromContext.id); 
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
    }, [activeOrderFromContext, resetItems, showAlert, showToast]);
    
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
        if (!originalOrder || !draftLoaded || isCompleted) return;
        
        const save = async () => {
            if (hasChanges) {
                await saveDraft(originalOrder.id, debouncedDraftData as EditedOrderDraft);
            }
        };
        save();
    }, [debouncedDraftData, originalOrder, draftLoaded, hasChanges, isCompleted]);

    const prevItemsLength = useRef(originalOrder?.items?.length ?? 0);
    useEffect(() => {
        if (items.length > prevItemsLength.current && lastItemRef.current) {
            setTimeout(() => {
                lastItemRef.current?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'end',
                });
            }, 150);
        }
        prevItemsLength.current = items.length;
    }, [items.length]);

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
        const existingItem = itemsRef.current.find(item => item.barcode === product.barcode);
        
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
    }, [openAddItemModal, addOrUpdateItem, isBoxUnitDefault, setProductSearch]);
    
    const handleOpenScanner = useCallback(() => {
        const onScan = async (barcode: string) => {
            let product = products.find(p => p.barcode === barcode);
            
            if (!product) {
                 showToast("온라인 상품 조회 중...", "success");
                 product = await searchByBarcode(barcode);
            }

            if (product) {
                const existingItem = itemsRef.current.find(item => item.barcode === product!.barcode);
                openAddItemModal({
                    product,
                    existingItem,
                    trigger: 'scan',
                    onAdd: (details) => addOrUpdateItem(product!, details),
                    onNextScan: handleOpenScanner,
                    initialSettings: { unit: existingItem ? existingItem.unit : (isBoxUnitDefault ? '박스' : '개') }
                });
            } else {
                showAlert("등록되지 않은 바코드입니다.");
            }
        };
        openScanner('modal', onScan, true);
    }, [openScanner, products, itemsRef, openAddItemModal, addOrUpdateItem, isBoxUnitDefault, showAlert, searchByBarcode, showToast]);

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
    
    if (!originalOrder) return null;

    const modalTitle = (
        <div className="text-center w-full">
            <h2 className="text-lg font-bold text-gray-800 truncate" title={originalOrder.customer.name}>{originalOrder.customer.name}</h2>
            <p className="text-sm text-gray-500 font-normal mt-0.5">{new Date(originalOrder.date).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}</p>
            {isUpdated && (
                <p className="text-xs text-gray-400">
                    최초 발주일: {new Date(originalOrder.createdAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
            )}
        </div>
    );

    const modalFooter = (
        <div className="w-full">
            <div className="bg-white pb-3 border-t border-gray-100 mb-2">
                <div className="flex justify-between items-center font-bold px-1 pt-2">
                    <span className="text-sm text-gray-600">총 합계:</span>
                    <span className="text-lg text-gray-900 tracking-tighter">{totalAmount.toLocaleString()} 원</span>
                </div>
            </div>
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
    );

    return (
        <ActionModal
            isOpen={isOpen}
            onClose={handleClose}
            title={modalTitle}
            disableBodyScroll={true}
            zIndexClass="z-[50]"
            footer={modalFooter}
        >
            <div className="flex flex-col h-full bg-white relative">
                {isSearchingProducts && (
                    <div className="absolute top-0 left-0 w-full h-1 bg-blue-100 z-[100] overflow-hidden">
                        <div className="h-full bg-blue-600 animate-[indeterminate_1.5s_infinite_linear] origin-left"></div>
                    </div>
                )}
                <style>{`
                    @keyframes indeterminate {
                        0% { transform: translateX(-100%); width: 100%; }
                        100% { transform: translateX(100%); width: 100%; }
                    }
                `}</style>

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
