import React, { useState, useMemo, useCallback, useRef, useEffect, memo } from 'react';
import { useDataState, useDataActions, useAlert, useModals, useScanner, useMiscUI } from '../context/AppContext';
import { OrderItem, Product, EditedOrderDraft } from '../types';
import { RemoveIcon, ChatBubbleLeftIcon, SpinnerIcon, BarcodeScannerIcon, DocumentTextIcon } from './Icons';
import ToggleSwitch from './ToggleSwitch';
import { isSaleActive, useOrderManager } from '../hooks/useOrderManager';
import { useDebounce } from '../hooks/useDebounce';
import { getDraft, saveDraft, deleteDraft } from '../services/draftDbService';
import SearchDropdown from './SearchDropdown';

const MAX_SEARCH_RESULTS = 50;

// Helper to create a consistent, comparable representation of an item list.
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
    const saleIsActive = product ? isSaleActive(product.saleEndDate) : false;
    const hasSalePrice = product ? !!product.salePrice : false;

    return (
        <div
            ref={ref}
            className={`flex items-center p-3.5 space-x-3 transition-colors duration-200 ${!isCompleted ? 'cursor-pointer hover:bg-gray-50' : 'opacity-70'} ${isNew ? 'bg-green-50' : ''} ${isModified ? 'bg-amber-50' : ''}`}
            onClick={() => !isCompleted && onEdit(item)}
        >
            <div className="flex-grow min-w-0 pr-1 space-y-1.5">
                {/* Product Name */}
                <p className="font-semibold text-gray-800 break-words whitespace-pre-wrap flex items-center gap-2">
                    {isNew && <span className="text-xs font-bold text-white bg-green-500 rounded-full px-2 py-0.5 tracking-wide">NEW</span>}
                    {isModified && <span className="text-xs font-bold text-white bg-amber-500 rounded-full px-2 py-0.5 tracking-wide">수정</span>}
                    <span>{item.name}</span>
                </p>

                {/* Price info */}
                <>
                  <p className="text-sm font-bold text-blue-600">발주가: {item.price.toLocaleString()}원</p>
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
                                  {product.salePrice}원
                              </span>
                          )}
                      </div>
                  )}
                </>
                
                {/* Sale Period and Supplier */}
                {product && product.saleEndDate && (
                     <div className="text-xs text-gray-500">
                        <span className={saleIsActive ? 'font-bold text-blue-600' : 'text-gray-400'}>
                            행사기간: ~{product.saleEndDate}
                        </span>
                     </div>
                )}
                
                {/* Memo */}
                {item.memo && (
                    <p className="text-xs text-blue-600 flex items-start gap-1.5">
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

const ProductSearchResultItem: React.FC<{ product: Product, onClick: (product: Product) => void }> = ({ product, onClick }) => {
    const saleIsActive = isSaleActive(product.saleEndDate);
    const hasSalePrice = !!product.salePrice;

    return (
        <div onClick={() => onClick(product)} className="p-3 hover:bg-gray-100 cursor-pointer text-gray-700 border-b border-gray-100 last:border-b-0">
            <div className="flex flex-col items-start w-full gap-y-1">
                {/* Line 1: Product Name, Sale Badge */}
                <div className="flex items-center gap-2 flex-wrap w-full">
                    <p className="font-semibold text-gray-800 whitespace-pre-wrap">{product.name}</p>
                    {saleIsActive && hasSalePrice && (
                        <span className="text-xs font-bold text-white bg-red-500 rounded-full px-2 py-0.5 leading-none">SALE</span>
                    )}
                </div>

                {/* Line 2: Barcode */}
                <p className="text-sm text-gray-500">{product.barcode}</p>

                {/* Line 3: Prices */}
                <div className="text-sm text-gray-700 font-medium flex items-baseline gap-x-2 flex-wrap">
                    <span className={`${saleIsActive && hasSalePrice ? 'line-through text-gray-400' : 'font-bold'}`}>
                        {product.sellingPrice?.toLocaleString()}원
                    </span>
                    {hasSalePrice && (
                        <span 
                            className={`${saleIsActive ? 'text-red-600 font-bold' : 'text-gray-500'}`}
                            style={!saleIsActive ? { fontSize: '70%' } : {}}
                        >
                            {product.salePrice}원
                        </span>
                    )}
                    <span className="text-gray-500 text-xs">({product.costPrice?.toLocaleString()}원)</span>
                </div>

                {/* Line 4: Event Info */}
                {(product.saleEndDate || product.supplierName) && (
                    <div className="text-xs text-gray-500">
                        <div className="flex items-center gap-x-3">
                            {product.saleEndDate && (
                                <span className={saleIsActive ? 'font-bold text-blue-600' : 'text-gray-400'}>
                                    ~{product.saleEndDate}
                                </span>
                            )}
                            {product.supplierName && (
                                <span>{product.supplierName}</span>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// --- Main Modal Component ---

const OrderDetailModal: React.FC = () => {
    const { products } = useDataState();
    const { updateOrder } = useDataActions();
    const { showAlert, showToast } = useAlert();
    const { editingOrder: originalOrder, closeDetailModal, openAddItemModal, openEditItemModal, openMemoModal } = useModals();
    const { openScanner } = useScanner();
    const { setLastModifiedOrderId } = useMiscUI();

    const [isRendered, setIsRendered] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [draftLoaded, setDraftLoaded] = useState(false);

    const [memo, setMemo] = useState('');
    const [productSearch, setProductSearch] = useState('');
    const debouncedProductSearch = useDebounce(productSearch, 200);
    const [showProductDropdown, setShowProductDropdown] = useState(false);
    const [isBoxUnitDefault, setIsBoxUnitDefault] = useState(false);

    const productSearchInputRef = useRef<HTMLInputElement>(null);
    const productSearchBlurTimeout = useRef<number | null>(null);
    const itemsRef = useRef<OrderItem[]>([]);

    const { items, addOrUpdateItem, updateItem, removeItem, resetItems, totalAmount } = useOrderManager({
        initialItems: originalOrder?.items || [],
    });
    useEffect(() => { itemsRef.current = items; }, [items]);

    const isCompleted = useMemo(() => !!originalOrder?.completedAt || !!originalOrder?.completionDetails, [originalOrder]);
    
    // --- Draft Logic ---
    useEffect(() => {
        if (!originalOrder) return;
        setMemo(originalOrder.memo || '');
        resetItems(originalOrder.items || []);

        getDraft<EditedOrderDraft>(originalOrder.id).then(draft => {
            if (draft) {
                showAlert(
                    "임시 저장된 수정 내역이 있습니다.\n불러오시겠습니까?",
                    () => { resetItems(draft.items); setMemo(draft.memo); setDraftLoaded(true); },
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
    const originalMemo = useMemo(() => originalOrder?.memo || '', [originalOrder]);
    
    const hasChanges = useMemo(() => {
        if (!originalOrder) return false;
        return JSON.stringify(originalItemsMemo) !== JSON.stringify(currentItemsMemo) || originalMemo !== memo;
    }, [originalOrder, originalItemsMemo, currentItemsMemo, originalMemo, memo]);

    const draftDataToSave = useMemo(() => ({ items, memo }), [items, memo]);
    const debouncedDraftData = useDebounce(draftDataToSave, 500);

    useEffect(() => {
        if (!originalOrder || !draftLoaded || !hasChanges) return;
        saveDraft(originalOrder.id, debouncedDraftData as EditedOrderDraft);
    }, [debouncedDraftData, originalOrder, draftLoaded, hasChanges]);


    // --- UI Effects ---
    useEffect(() => {
        const timer = setTimeout(() => setIsRendered(true), 10);
        return () => clearTimeout(timer);
    }, []);

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
            // FIX: The `updateOrder` action from the context expects a full Order object including the updated items.
            const updatedOrderData = { ...originalOrder, items, itemCount: items.length, total: totalAmount, memo };
            await updateOrder(updatedOrderData);
            await deleteDraft(originalOrder.id);
            setLastModifiedOrderId(originalOrder.id);
            showToast('발주 내역이 성공적으로 수정되었습니다.', 'success');
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
            initialSettings: { unit: isBoxUnitDefault ? '박스' : '개' }
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
                    initialSettings: { unit: isBoxUnitDefault ? '박스' : '개' }
                });
            } else {
                showAlert("등록되지 않은 바코드입니다.");
            }
        };
        openScanner('modal', onScan, true);
    }, [openScanner, products, itemsRef, openAddItemModal, addOrUpdateItem, isBoxUnitDefault]);

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

    const handleOpenMemoModal = useCallback(() => {
        openMemoModal({ initialMemo: memo, onSave: (newMemo) => setMemo(newMemo) });
    }, [memo, openMemoModal]);
    
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

    if (!originalOrder) return null;

    return (
        <div className={`fixed inset-0 bg-black z-40 flex flex-col transition-opacity duration-300 ${isRendered ? 'bg-opacity-60' : 'bg-opacity-0'}`}>
            <div className={`w-full h-full flex flex-col bg-gray-100 transition-transform duration-300 ease-out ${isRendered ? 'translate-y-0' : 'translate-y-full'}`}>
                <header className="bg-white/80 backdrop-blur-xl p-3 flex-shrink-0 border-b border-gray-200/80 z-20">
                    <div className="flex items-center justify-between max-w-2xl mx-auto">
                        <button onClick={handleClose} className="px-4 py-2 text-blue-600 font-semibold rounded-lg hover:bg-blue-100 transition">닫기</button>
                        <div className="text-center">
                            <h2 className="text-lg font-bold text-gray-800 truncate" title={originalOrder.customer.name}>{originalOrder.customer.name}</h2>
                            <p className="text-xs text-gray-500">{new Date(originalOrder.date).toLocaleString('ko-KR')}</p>
                        </div>
                        <div className="w-16"></div>
                    </div>
                </header>
                
                {!isCompleted && (
                    <div className="p-3 bg-white/60 backdrop-blur-lg flex-shrink-0 z-10 border-b border-gray-200/80">
                         <div className="flex gap-2 w-full max-w-2xl mx-auto">
                            <div className="relative flex-grow">
                                <input
                                    ref={productSearchInputRef} type="text" value={productSearch}
                                    onChange={(e) => setProductSearch(e.target.value)}
                                    onFocus={() => { if (productSearchBlurTimeout.current) clearTimeout(productSearchBlurTimeout.current); setShowProductDropdown(true); }}
                                    onBlur={() => { productSearchBlurTimeout.current = window.setTimeout(() => setShowProductDropdown(false), 200); }}
                                    placeholder="품목명 또는 바코드 검색"
                                    className="w-full p-3 h-12 border-2 border-gray-300 bg-white rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-blue-500 placeholder:text-gray-400 text-base pr-28"
                                />
                                <div className="absolute top-1/2 right-3 -translate-y-1/2 flex items-center">
                                    <ToggleSwitch id="edit-order-box-unit" label="박스" checked={isBoxUnitDefault} onChange={setIsBoxUnitDefault} color="blue" />
                                </div>
                                <SearchDropdown<Product>
                                    items={filteredProducts}
                                    renderItem={(p) => <ProductSearchResultItem product={p} onClick={handleAddProductFromSearch} />}
                                    show={showProductDropdown}
                                />
                            </div>
                            <button onClick={handleOpenScanner} className="h-12 w-20 bg-blue-600 text-white rounded-xl flex flex-col items-center justify-center gap-1 font-bold hover:bg-blue-700 transition active:scale-95 shadow-lg shadow-blue-500/30">
                                <BarcodeScannerIcon className="w-6 h-6" />
                            </button>
                        </div>
                    </div>
                )}

                <main className="flex-grow overflow-y-auto">
                    <div className="p-3 pb-40 max-w-2xl mx-auto">
                        {isCompleted && (
                            <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded-r-lg mb-3" role="alert">
                                <p className="font-bold">완료된 발주</p>
                                <p className="text-sm">이 발주는 완료 처리되어 수정할 수 없습니다.</p>
                            </div>
                        )}
                        <div className="bg-white rounded-xl shadow-lg border border-gray-200/60 overflow-hidden">
                            <div className="divide-y divide-gray-100">
                                {items.map(item => (
                                    <EditedItemRow
                                        key={item.barcode}
                                        item={item}
                                        product={products.find(p => p.barcode === item.barcode)}
                                        isCompleted={isCompleted}
                                        isNew={newItems.has(item.barcode)}
                                        isModified={modifiedItems.has(item.barcode)}
                                        onEdit={handleEditItem}
                                        onRemove={handleRemoveItem}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </main>
                
                <footer className="absolute bottom-0 left-0 right-0 p-3 bg-white/80 backdrop-blur-xl border-t border-gray-200/60 z-10">
                    <div className="max-w-2xl mx-auto">
                        <div className="flex justify-between items-center font-bold mb-3 px-2">
                            <span className="text-lg text-gray-600">총 합계:</span>
                            <span className="text-2xl text-gray-900 tracking-tighter">{totalAmount.toLocaleString()} 원</span>
                        </div>
                        {!isCompleted && (
                             <div className="flex items-stretch gap-2">
                                <button onClick={handleOpenMemoModal} className="px-4 py-3 bg-gray-200 text-gray-700 rounded-xl font-bold text-base hover:bg-gray-300 transition shadow-sm flex items-center justify-center gap-2 flex-shrink-0 active:scale-95">
                                    <DocumentTextIcon className="w-5 h-5"/>
                                    <span className="hidden sm:inline">{memo ? '메모 수정' : '메모 추가'}</span>
                                </button>
                                <button onClick={handleSave} disabled={isSaving || !hasChanges} className="flex-grow bg-blue-600 text-white p-3 rounded-xl font-bold text-base hover:bg-blue-700 transition shadow-lg shadow-blue-500/40 disabled:bg-gray-400 disabled:shadow-none disabled:cursor-not-allowed flex items-center justify-center active:scale-95">
                                    {isSaving ? <SpinnerIcon className="w-6 h-6"/> : '변경사항 저장'}
                                </button>
                            </div>
                        )}
                    </div>
                </footer>
            </div>
        </div>
    );
};

export default OrderDetailModal;
