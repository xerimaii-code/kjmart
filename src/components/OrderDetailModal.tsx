
import React, { useState, useMemo, useCallback, useRef, useEffect, memo } from 'react';
import { useDataState, useDataActions, useAlert, useModals, useScanner, useMiscUI } from '../context/AppContext';
import { OrderItem, Product, EditedOrderDraft, Order } from '../types';
import { RemoveIcon, ChatBubbleLeftIcon, SpinnerIcon, DragHandleIcon } from './Icons';
import { isSaleActive, useOrderManager } from '../hooks/useOrderManager';
import { useDebounce } from '../hooks/useDebounce';
import { getDraft, saveDraft, deleteDraft } from '../services/draftDbService';
import { useProductSearch } from '../hooks/useProductSearch';
import ActionModal from './ActionModal';
import ProductSearchBar from './ProductSearchBar';

type ItemStatus = 'new' | 'modified' | 'none';

const EditedItemRow = memo(({ 
    item, product, isCompleted, status, onEdit, onRemove,
    isDragging, onDragStart, onDragEnd, onDragOver, onDrop 
}: { 
    item: OrderItem; 
    product?: Product;
    isCompleted: boolean; 
    status: ItemStatus; 
    onEdit: (item: OrderItem, product?: Product) => void; 
    onRemove: (e: React.MouseEvent, item: OrderItem) => void;
    isDragging: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
}) => {
    // [행사 정보 표시 로직 수정]
    // 1. 이미 저장된(박제된) 행사 정보(item.saleName)가 있다면 무조건 그것을 우선 사용합니다.
    // 2. 저장된 정보가 없고, 실시간 상품 정보(product)에 행사 정보가 있다면 그것을 사용합니다 (신규 추가된 경우 등).
    
    // 저장된 스냅샷이 있는지 확인
    const hasSnapshot = !!item.saleName;
    
    let saleActive = false;
    let dispEventPrice: number | undefined = undefined;
    let dispSalePrice: number | undefined = undefined;
    let dispSaleName: string | undefined = undefined;
    let dispSaleStart: string | undefined = undefined;
    let dispSaleEnd: string | undefined = undefined;

    if (hasSnapshot) {
        // 박제된 정보 사용 (Snapshot Prioritization)
        saleActive = !!item.saleEndDate && isSaleActive(item.saleStartDate, item.saleEndDate);
        if (saleActive) {
            dispEventPrice = item.eventPrice;
            dispSalePrice = item.salePrice;
            dispSaleName = item.saleName;
            dispSaleStart = item.saleStartDate;
            dispSaleEnd = item.saleEndDate;
            
            // [보정] 기존 데이터에 salePrice가 누락된 경우, 현재 상품 정보와 행사명이 같으면 가져옴
            if (!dispSalePrice && product && product.saleName === item.saleName) {
                dispSalePrice = product.salePrice;
            }
        }
    } else if (product) {
        // 박제된 정보가 없고 실시간 정보가 있는 경우 (Fallback to Live Data)
        saleActive = isSaleActive(product.saleStartDate, product.saleEndDate);
        if (saleActive) {
            dispEventPrice = product.eventCostPrice;
            dispSalePrice = product.salePrice;
            dispSaleName = product.saleName;
            dispSaleStart = product.saleStartDate;
            dispSaleEnd = product.saleEndDate;
        }
    }

    const hasEventInfo = saleActive && dispEventPrice !== undefined && dispEventPrice > 0;

    return (
        <div
            draggable={!isCompleted}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
            className={`relative flex items-center p-3 space-x-3 bg-white border-b border-gray-100 last:border-0 transition-all duration-200 ${!isCompleted ? 'cursor-pointer active:bg-gray-50' : ''} ${isDragging ? 'opacity-40 bg-indigo-50 scale-95 z-50' : 'opacity-100'} ${isCompleted ? 'opacity-90' : ''}`}
            onClick={() => !isCompleted && onEdit(item, product)}
        >
            {!isCompleted && (
                <div className="flex-shrink-0 text-gray-300">
                    <DragHandleIcon className="w-5 h-5" />
                </div>
            )}

            <div className="flex-grow min-w-0 pr-1 space-y-1">
                <div className="flex justify-between items-start gap-2">
                    <div className="flex flex-wrap items-center gap-1 flex-grow">
                        {status === 'new' && <span className="bg-teal-100 text-teal-700 text-[10px] font-bold px-1.5 py-0.5 rounded border border-teal-200 whitespace-nowrap">신규</span>}
                        {status === 'modified' && <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded border border-amber-200 whitespace-nowrap">수정</span>}
                        <p className="font-semibold text-gray-800 break-words whitespace-pre-wrap text-sm leading-snug">{item.name}</p>
                    </div>
                    {hasEventInfo && <span className="text-rose-500 text-[10px] font-black px-1.5 py-0.5 rounded-md border border-rose-200 bg-rose-50 animate-pulse">행사중</span>}
                </div>

                <div className="flex flex-wrap items-center justify-between text-xs">
                    <div className="flex items-center gap-1">
                        <span className="font-bold text-gray-500">{item.price.toLocaleString()}</span>
                        <span className="text-gray-400">× {item.quantity} =</span>
                        <span className="font-extrabold text-gray-800">{(item.price * item.quantity).toLocaleString()}</span>
                    </div>
                </div>

                {hasEventInfo && (
                    <div className="mt-1 px-2 py-1 bg-rose-50/50 border border-rose-100 border-dashed rounded-lg">
                        <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
                            <span className="font-black text-rose-500 uppercase">행사가</span>
                            <span className="font-bold text-rose-700">
                                {dispEventPrice!.toLocaleString()}
                                {dispSalePrice && dispSalePrice > 0 ? ` / ${dispSalePrice.toLocaleString()}` : ''}
                            </span>
                            <span className="text-rose-300 mx-1">|</span>
                            <div className="flex flex-col leading-tight">
                                <span className="text-gray-500 font-bold truncate">{dispSaleName}</span>
                                <span className="text-[9px] text-rose-400 font-mono">
                                    ({dispSaleStart?.slice(5)}~{dispSaleEnd?.slice(5)})
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {item.memo && (
                    <p className="text-xs text-amber-600 flex items-start gap-1.5 pt-0.5 font-medium">
                        <ChatBubbleLeftIcon className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                        <span className="break-all">{item.memo}</span>
                    </p>
                )}
            </div>
            
            <div className="flex items-center space-x-2 flex-shrink-0">
                <div className="flex flex-col items-end">
                    <span className="font-bold text-lg leading-none text-gray-800">{item.quantity}</span>
                    <span className="text-gray-500 font-medium text-[10px]">{item.unit}</span>
                </div>
                 {!isCompleted && (
                    <button onClick={(e) => onRemove(e, item)} className="text-gray-300 hover:text-rose-500 p-2.5 rounded-full transition-colors">
                        <RemoveIcon className="w-5 h-5"/>
                    </button>
                )}
            </div>
        </div>
    );
});
EditedItemRow.displayName = 'EditedItemRow';

const OrderDetailModal: React.FC = () => {
    const { products } = useDataState();
    const { updateOrder, addOrder } = useDataActions();
    const { showAlert, showToast } = useAlert();
    const { editingOrder: activeOrder, closeDetailModal, openAddItemModal, openEditItemModal, closeEditItemModal } = useModals();
    const { openScanner } = useScanner();
    
    const [isSaving, setIsSaving] = useState(false);
    const [draftLoaded, setDraftLoaded] = useState(false);
    const [isBoxUnitDefault, setIsBoxUnitDefault] = useState(false);
    
    const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
    const [dropIdx, setDropIdx] = useState<number | null>(null);

    // 세션 임시 캐시 (검색/스캔으로 불러온 상세 정보 저장)
    const sessionProductsRef = useRef<Map<string, Product>>(new Map());

    const { 
        searchTerm: productSearch, setSearchTerm: setProductSearch, 
        results: productSearchResults, isSearching: isSearchingProducts, 
        search, searchByBarcode
    } = useProductSearch('newOrder', 50, '상품조회_발주');
    const debouncedProductSearch = useDebounce(productSearch, 300);

    useEffect(() => {
        if (productSearchResults.length > 0) {
            productSearchResults.forEach(p => sessionProductsRef.current.set(p.barcode, p));
        }
    }, [productSearchResults]);

    const isProcessingScanRef = useRef(false);
    const itemsRef = useRef<OrderItem[]>([]);
    const { items, addOrUpdateItem, updateItem, removeItem, reorderItems, resetItems, totalAmount } = useOrderManager({
        initialItems: activeOrder?.items || [],
    });

    useEffect(() => { itemsRef.current = items; }, [items]);
    
    useEffect(() => { 
        const term = debouncedProductSearch.trim();
        if (term.length >= 2) {
            search(term); 
        } else if (term.length === 0) {
            search('');
        }
    }, [debouncedProductSearch, search]);

    const isCompleted = useMemo(() => !!activeOrder?.completedAt || !!activeOrder?.completionDetails, [activeOrder]);
    
    const originalItemsMap = useMemo(() => {
        const map = new Map<string, OrderItem>();
        if (activeOrder?.items) {
            activeOrder.items.forEach(item => {
                map.set(item.barcode, { ...item, memo: item.memo || '' });
            });
        }
        return map;
    }, [activeOrder]);

    const getItemStatus = useCallback((item: OrderItem): ItemStatus => {
        const original = originalItemsMap.get(item.barcode);
        if (!original) return 'new';
        if (original.quantity !== item.quantity || original.unit !== item.unit || (original.memo || '') !== (item.memo || '')) return 'modified';
        return 'none';
    }, [originalItemsMap]);

    const hasChanges = useMemo(() => {
        if (!activeOrder) return false;
        const originalLength = activeOrder.items?.length || 0;
        if (items.length !== originalLength) return true;
        const originalOrder = activeOrder.items?.map(i => i.barcode).join(',');
        const currentOrder = items.map(i => i.barcode).join(',');
        if (originalOrder !== currentOrder) return true;

        return items.some(item => getItemStatus(item) !== 'none');
    }, [items, activeOrder, getItemStatus]);

    useEffect(() => {
        if (!activeOrder) return;
        const checkDraft = async () => {
            try {
                const draft = await getDraft<EditedOrderDraft>(activeOrder.id);
                if (draft?.items) {
                    showAlert("작성 중이던 수정 내역이 있습니다.\n불러오시겠습니까?", () => { resetItems(draft.items); setDraftLoaded(true); }, '불러오기', 'bg-blue-600', () => { deleteDraft(activeOrder.id); setDraftLoaded(true); });
                } else setDraftLoaded(true);
            } catch (e) { setDraftLoaded(true); }
        };
        checkDraft();
    }, [activeOrder, resetItems, showAlert]);

    useEffect(() => {
        if (!activeOrder || !draftLoaded || isCompleted || !hasChanges) return;
        saveDraft(activeOrder.id, { items });
    }, [items, activeOrder, draftLoaded, isCompleted, hasChanges]);

    const handleOpenScanner = useCallback(() => {
        const onScan = async (barcode: string) => {
            if (isProcessingScanRef.current) return;
            isProcessingScanRef.current = true;
            try {
                let product = products.find(p => p.barcode === barcode);
                if (!product) {
                    product = await searchByBarcode(barcode);
                    if (product) sessionProductsRef.current.set(product.barcode, product);
                }
                
                if (product) {
                    const existingItem = itemsRef.current.find(item => item.barcode === product!.barcode);
                    openAddItemModal({
                        product, existingItem: existingItem || null, trigger: 'scan',
                        onAdd: (details) => { addOrUpdateItem(product!, details); isProcessingScanRef.current = false; },
                        onClose: () => { isProcessingScanRef.current = false; }, 
                        onNextScan: handleOpenScanner,
                        initialSettings: { unit: existingItem ? existingItem.unit : (isBoxUnitDefault ? '박스' : '개') },
                        timestamp: Date.now()
                    });
                } else { isProcessingScanRef.current = false; showAlert("등록되지 않은 상품입니다."); }
            } catch (e) { isProcessingScanRef.current = false; }
        };
        openScanner('modal', onScan, { continuous: true });
    }, [openScanner, products, openAddItemModal, addOrUpdateItem, isBoxUnitDefault, showAlert, searchByBarcode]);

    const handleDragStart = (idx: number) => setDraggedIdx(idx);
    const handleDragEnd = () => { setDraggedIdx(null); setDropIdx(null); };
    const handleDragOver = (e: React.DragEvent, idx: number) => {
        e.preventDefault();
        if (draggedIdx === idx) return;
        setDropIdx(idx);
    };
    const handleDrop = (e: React.DragEvent, targetIdx: number) => {
        e.preventDefault();
        if (draggedIdx === null || draggedIdx === targetIdx) return;
        reorderItems(draggedIdx, targetIdx);
        handleDragEnd();
    };

    if (!activeOrder) return null;

    const handleFinalUpdate = async () => {
        if (!activeOrder) return;
        setIsSaving(true);
        try {
            // [저장 로직 수정]
            // 기존에 저장된(Snapshot) 행사 정보를 덮어쓰지 않고 보존합니다.
            // 검색이나 스캔을 통해 명시적으로 'Rich Data'(세션)를 불러온 경우에만 갱신합니다.
            const itemsWithSnapshot: OrderItem[] = await Promise.all(items.map(async (item) => {
                let prod = sessionProductsRef.current.get(item.barcode) || products.find(p => p.barcode === item.barcode);
                
                // 로컬에도 없고 세션에도 없다면 온라인 조회 시도
                if (!prod && navigator.onLine) {
                    try { 
                        const onlineProd = await searchByBarcode(item.barcode);
                        if (onlineProd) {
                            prod = onlineProd;
                            sessionProductsRef.current.set(item.barcode, onlineProd);
                        }
                    } catch (e) {}
                }

                if (prod) {
                    // 세션(검색)에서 온 데이터인지 확인 (행사 정보가 온전한지 판단)
                    const isRichData = sessionProductsRef.current.has(item.barcode) || prod.saleStartDate !== undefined;

                    // Rich Data인 경우에만 스냅샷 갱신
                    if (isRichData) {
                        const saleActive = isSaleActive(prod.saleStartDate, prod.saleEndDate);
                        return {
                            ...item,
                            masterPrice: prod.costPrice,
                            eventPrice: saleActive ? prod.eventCostPrice : undefined,
                            salePrice: saleActive ? prod.salePrice : undefined,
                            saleName: saleActive ? prod.saleName : undefined,
                            saleStartDate: saleActive ? prod.saleStartDate : undefined, // [수정] 기간 저장
                            saleEndDate: saleActive ? prod.saleEndDate : undefined,     // [수정] 기간 저장
                            price: item.isModified ? item.price : ((saleActive && prod.eventCostPrice && prod.eventCostPrice > 0) ? prod.eventCostPrice : prod.costPrice)
                        };
                    } else {
                        // 불완전한 로컬 데이터라면, 기존에 저장된 스냅샷(행사 정보)을 그대로 유지합니다.
                        const wasEventItem = item.eventPrice && item.eventPrice > 0;
                        return {
                            ...item,
                            // 마스터 가격은 로컬 정보로 갱신 (단가 변동 반영)
                            masterPrice: prod.costPrice,
                            
                            // [중요] 기존 행사 정보 스냅샷 유지
                            eventPrice: item.eventPrice,
                            salePrice: item.salePrice,
                            saleName: item.saleName,
                            saleStartDate: item.saleStartDate, // [수정] 기존 기간 유지
                            saleEndDate: item.saleEndDate,     // [수정] 기존 기간 유지
                            
                            // 가격 유지 로직: 수동 수정값 > 기존 적용값 > 로컬 마스터값
                            price: item.isModified ? item.price : (wasEventItem ? item.price : prod.costPrice)
                        };
                    }
                }
                // 상품 정보 조회 실패 시 기존 정보 유지
                return item;
            }));

            const finalTotal = Math.floor(itemsWithSnapshot.reduce((sum, item) => sum + (item.price * item.quantity), 0));
            
            await updateOrder({ ...activeOrder, items: itemsWithSnapshot, total: finalTotal });
            await deleteDraft(activeOrder.id);
            showToast("수정 내역이 저장되었습니다.", 'success');
            closeDetailModal();
        } catch (err) { showAlert('저장에 실패했습니다.'); } finally { setIsSaving(false); }
    };

    const modalFooter = (
        <div className="w-full">
            <div className="flex justify-between items-center font-bold px-1 py-2 border-t border-gray-100 mb-2">
                <span className="text-sm text-gray-500">총 합계:</span>
                <span className="text-lg text-gray-900">{totalAmount.toLocaleString()} 원</span>
            </div>
            {!isCompleted ? (
                <div className="flex gap-2">
                    <button onClick={closeDetailModal} className="flex-1 h-12 bg-gray-100 text-gray-700 rounded-xl font-bold active:scale-95 transition-transform">닫기</button>
                    <button 
                        onClick={handleFinalUpdate} 
                        disabled={isSaving || !hasChanges} 
                        className={`flex-[2] h-12 rounded-xl font-bold shadow-lg active:scale-95 transition-transform flex items-center justify-center ${hasChanges ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-500'}`}
                    >
                        {isSaving ? <SpinnerIcon className="w-6 h-6 animate-spin"/> : '수정 내역 저장'}
                    </button>
                </div>
            ) : <button onClick={closeDetailModal} className="w-full h-12 bg-gray-100 text-gray-500 rounded-xl font-bold">확인 (수정 불가)</button>}
        </div>
    );

    return (
        <ActionModal isOpen={!!activeOrder} onClose={closeDetailModal} title={activeOrder.customer.name} disableBodyScroll={true} zIndexClass="z-[50]" footer={modalFooter}>
            <div className="flex flex-col h-full bg-white relative">
                {!isCompleted && (
                    <div className="p-3 bg-white border-b z-10">
                        <ProductSearchBar 
                            id="order-detail-search" 
                            searchTerm={productSearch} 
                            onSearchTermChange={setProductSearch} 
                            isSearching={isSearchingProducts} 
                            results={productSearchResults} 
                            onSelectProduct={(p) => {
                                sessionProductsRef.current.set(p.barcode, p);
                                openAddItemModal({ 
                                    product: p, 
                                    existingItem: itemsRef.current.find(i => i.barcode === p.barcode) || null, 
                                    trigger: 'search', 
                                    onAdd: (d) => addOrUpdateItem(p, d), 
                                    initialSettings: { unit: isBoxUnitDefault ? '박스' : '개' },
                                    timestamp: Date.now()
                                });
                            }} 
                            onScan={handleOpenScanner} 
                            isBoxUnit={isBoxUnitDefault} 
                            onBoxUnitChange={setIsBoxUnitDefault} 
                            showBoxToggle={true} 
                        />
                    </div>
                )}
                <div className="flex-grow overflow-y-auto p-0 bg-white">
                    {items.length === 0 ? <div className="py-20 text-center text-gray-400">목록이 비어있습니다.</div> : (
                        <div className="divide-y divide-gray-100 pb-20">
                            {items.map((item, index) => {
                                const prod = sessionProductsRef.current.get(item.barcode) || products.find(p => p.barcode === item.barcode);
                                return (
                                    <React.Fragment key={item.barcode}>
                                        {dropIdx === index && draggedIdx !== null && index < draggedIdx && <div className="h-1 bg-indigo-500 animate-pulse" />}
                                        <EditedItemRow 
                                            item={item} 
                                            product={prod}
                                            isCompleted={isCompleted} 
                                            status={getItemStatus(item)} 
                                            onEdit={(it, pr) => {
                                                openEditItemModal({ 
                                                    item: it, 
                                                    product: pr,
                                                    onSave: (det) => {
                                                        updateItem(it.barcode, { ...det, isModified: true });
                                                        closeEditItemModal();
                                                    }, 
                                                    onScanNext: handleOpenScanner 
                                                });
                                            }} 
                                            onRemove={(e, it) => { e.stopPropagation(); showAlert(`삭제하시겠습니까?`, () => removeItem(it.barcode), '삭제', 'bg-rose-500'); }}
                                            isDragging={draggedIdx === index}
                                            onDragStart={() => !isCompleted && handleDragStart(index)}
                                            onDragEnd={handleDragEnd}
                                            onDragOver={(e) => !isCompleted && handleDragOver(e, index)}
                                            onDrop={(e) => !isCompleted && handleDrop(e, index)}
                                        />
                                        {dropIdx === index && draggedIdx !== null && index > draggedIdx && <div className="h-1 bg-indigo-500 animate-pulse" />}
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </ActionModal>
    );
};

export default OrderDetailModal;
