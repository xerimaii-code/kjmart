
import React, { useState, useMemo, useCallback, useRef, useEffect, memo } from 'react';
import { useDataState, useDataActions, useAlert, useModals, useScanner, useMiscUI } from '../context/AppContext';
import { OrderItem, Product, EditedOrderDraft, Order } from '../types';
import { RemoveIcon, ChatBubbleLeftIcon, SpinnerIcon } from './Icons';
import { isSaleActive, useOrderManager } from '../hooks/useOrderManager';
import { useDebounce } from '../hooks/useDebounce';
import { getDraft, saveDraft, deleteDraft } from '../services/draftDbService';
import { useProductSearch } from '../hooks/useProductSearch';
import ActionModal from './ActionModal';
import ProductSearchBar from './ProductSearchBar';

// Item Status Type
type ItemStatus = 'new' | 'modified' | 'none';

// Memoized Row for memory efficiency
const EditedItemRow = memo(({ 
    item, product, isCompleted, status, onEdit, onRemove 
}: { 
    item: OrderItem; 
    product?: Product; 
    isCompleted: boolean; 
    status: ItemStatus; 
    onEdit: (item: OrderItem) => void; 
    onRemove: (e: React.MouseEvent, item: OrderItem) => void; 
}) => {
    const saleIsActive = product ? isSaleActive(product.saleStartDate, product.saleEndDate) : false;

    return (
        <div
            className={`flex items-center p-3 space-x-3 bg-white border-b border-gray-100 last:border-0 ${!isCompleted ? 'cursor-pointer active:bg-gray-50' : 'opacity-80'}`}
            onClick={() => !isCompleted && onEdit(item)}
        >
            <div className="flex-grow min-w-0 pr-1 space-y-1">
                <div className="flex justify-between items-start gap-2">
                    <div className="flex flex-wrap items-center gap-1 flex-grow">
                        {status === 'new' && <span className="bg-teal-100 text-teal-700 text-[10px] font-bold px-1.5 py-0.5 rounded border border-teal-200">신규</span>}
                        {status === 'modified' && <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded border border-amber-200">수정</span>}
                        <p className="font-semibold text-gray-800 break-words whitespace-pre-wrap text-sm leading-snug">{item.name}</p>
                    </div>
                    {!isCompleted && saleIsActive && <span className="bg-red-100 text-red-600 text-[10px] font-extrabold px-1.5 py-0.5 rounded border border-red-200 flex-shrink-0">행사중</span>}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs">
                    <div className="flex items-center gap-1">
                        <span className="font-bold text-blue-600">{item.price.toLocaleString()}</span>
                        <span className="text-gray-400">× {item.quantity} =</span>
                        <span className="font-extrabold text-gray-800">{(item.price * item.quantity).toLocaleString()}</span>
                    </div>
                </div>
                {item.memo && (
                    <p className="text-[11px] text-amber-600 flex items-start gap-1 font-medium">
                        <ChatBubbleLeftIcon className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        <span className="break-all">{item.memo}</span>
                    </p>
                )}
            </div>
            <div className="flex items-center space-x-2 flex-shrink-0">
                <div className="flex flex-col items-end">
                    <span className={`font-bold text-lg leading-none ${status !== 'none' ? 'text-blue-600' : 'text-gray-800'}`}>{item.quantity}</span>
                    <span className="text-gray-500 font-medium text-[10px]">{item.unit}</span>
                </div>
                 {!isCompleted && (
                    <button onClick={(e) => onRemove(e, item)} className="text-gray-300 hover:text-red-500 p-2 rounded-full transition-colors">
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
    const { updateOrder } = useDataActions();
    const { showAlert, showToast } = useAlert();
    const { editingOrder: activeOrder, closeDetailModal, openAddItemModal, openEditItemModal } = useModals();
    const { openScanner } = useScanner();
    const { setLastModifiedOrderId } = useMiscUI();
    
    const [isSaving, setIsSaving] = useState(false);
    const [draftLoaded, setDraftLoaded] = useState(false);
    const [isBoxUnitDefault, setIsBoxUnitDefault] = useState(false);

    const { 
        searchTerm: productSearch, setSearchTerm: setProductSearch, 
        results: productSearchResults, isSearching: isSearchingProducts, 
        search, searchByBarcode
    } = useProductSearch('newOrder', 50, '상품조회_발주');
    const debouncedProductSearch = useDebounce(productSearch, 300);

    const isProcessingScanRef = useRef(false);
    const itemsRef = useRef<OrderItem[]>([]);
    const { items, addOrUpdateItem, updateItem, removeItem, resetItems, totalAmount } = useOrderManager({
        initialItems: activeOrder?.items || [],
    });

    useEffect(() => { itemsRef.current = items; }, [items]);
    useEffect(() => { search(debouncedProductSearch); }, [debouncedProductSearch, search]);

    const isCompleted = useMemo(() => !!activeOrder?.completedAt || !!activeOrder?.completionDetails, [activeOrder]);
    
    const originalItemsMap = useMemo(() => {
        const map = new Map<string, OrderItem>();
        if (activeOrder?.items) {
            activeOrder.items.forEach(item => {
                // 비교 시 null/undefined 방지를 위해 메모 필드 정규화하여 맵 생성
                map.set(item.barcode, {
                    ...item,
                    memo: item.memo || ''
                });
            });
        }
        return map;
    }, [activeOrder]);

    const getItemStatus = useCallback((item: OrderItem): ItemStatus => {
        const original = originalItemsMap.get(item.barcode);
        if (!original) return 'new';
        // 수량, 단위, 메모 중 하나라도 다르면 수정된 것으로 간주
        if (
            original.quantity !== item.quantity || 
            original.unit !== item.unit || 
            (original.memo || '') !== (item.memo || '')
        ) return 'modified';
        return 'none';
    }, [originalItemsMap]);

    // 실제 변경 사항이 있는지 여부 판단
    const hasChanges = useMemo(() => {
        if (!activeOrder) return false;
        const originalLength = activeOrder.items?.length || 0;
        if (items.length !== originalLength) return true;
        return items.some(item => getItemStatus(item) !== 'none');
    }, [items, activeOrder, getItemStatus]);

    useEffect(() => {
        if (!activeOrder) return;
        
        const checkDraft = async () => {
            try {
                const draft = await getDraft<EditedOrderDraft>(activeOrder.id);
                if (draft?.items) {
                    showAlert(
                        "작성 중이던 수정 내역이 있습니다.\n불러오시겠습니까?", 
                        () => { resetItems(draft.items); setDraftLoaded(true); }, 
                        '불러오기', 
                        'bg-blue-600', 
                        () => { deleteDraft(activeOrder.id); setDraftLoaded(true); }
                    );
                } else {
                    setDraftLoaded(true);
                }
            } catch (e) {
                setDraftLoaded(true);
            }
        };
        checkDraft();
    }, [activeOrder, resetItems, showAlert]);

    // 자동 임시 저장: 실제로 변경 사항(hasChanges)이 발생했을 때만 실행
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
                if (!product) product = await searchByBarcode(barcode);
                
                if (product) {
                    const existingItem = itemsRef.current.find(item => item.barcode === product!.barcode);
                    openAddItemModal({
                        product, existingItem, trigger: 'scan',
                        onAdd: (details) => { addOrUpdateItem(product!, details); isProcessingScanRef.current = false; },
                        onClose: () => { isProcessingScanRef.current = false; }, 
                        onNextScan: handleOpenScanner,
                        initialSettings: { unit: existingItem ? existingItem.unit : (isBoxUnitDefault ? '박스' : '개') },
                        timestamp: Date.now()
                    });
                } else {
                    isProcessingScanRef.current = false;
                    showAlert("등록되지 않은 상품입니다.");
                }
            } catch (e) { isProcessingScanRef.current = false; }
        };
        openScanner('modal', onScan, { continuous: true });
    }, [openScanner, products, openAddItemModal, addOrUpdateItem, isBoxUnitDefault, showAlert, searchByBarcode]);

    if (!activeOrder) return null;

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
                        onClick={async () => {
                            setIsSaving(true);
                            try {
                                await updateOrder({ ...activeOrder, items, total: totalAmount });
                                await deleteDraft(activeOrder.id);
                                showToast("저장되었습니다.", 'success');
                                closeDetailModal();
                            } catch (err) { 
                                showAlert('저장에 실패했습니다.'); 
                            } finally { 
                                setIsSaving(false); 
                            }
                        }} 
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
                        <ProductSearchBar id="order-detail-search" searchTerm={productSearch} onSearchTermChange={setProductSearch} isSearching={isSearchingProducts} results={productSearchResults} onSelectProduct={(p) => openAddItemModal({ product: p, existingItem: itemsRef.current.find(i => i.barcode === p.barcode) || null, trigger: 'search', onAdd: (d) => addOrUpdateItem(p, d), initialSettings: { unit: isBoxUnitDefault ? '박스' : '개' } })} onScan={handleOpenScanner} isBoxUnit={isBoxUnitDefault} onBoxUnitChange={setIsBoxUnitDefault} showBoxToggle={true} />
                    </div>
                )}
                <div className="flex-grow overflow-y-auto p-0 bg-white">
                    {items.length === 0 ? <div className="py-20 text-center text-gray-400">목록이 비어있습니다.</div> : (
                        <div className="divide-y divide-gray-100 pb-20">
                            {items.map(item => (
                                <EditedItemRow key={item.barcode} item={item} product={products.find(p => p.barcode === item.barcode)} isCompleted={isCompleted} status={getItemStatus(item)} onEdit={(it) => openEditItemModal({ item: it, onSave: (det) => updateItem(it.barcode, det), onScanNext: handleOpenScanner })} onRemove={(e, it) => { e.stopPropagation(); showAlert(`삭제하시겠습니까?`, () => removeItem(it.barcode), '삭제', 'bg-rose-500'); }} />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </ActionModal>
    );
};

export default OrderDetailModal;
