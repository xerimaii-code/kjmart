
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Customer, Product, ReceivingItem, ReceivingBatch, ReceivingDraft } from '../types';
import { useDataState, useScanner, useAlert, useModals, useMiscUI } from '../context/AppContext';
import { SpinnerIcon, SearchIcon, BarcodeScannerIcon, ChevronDownIcon, TrashIcon, CheckCircleIcon, BriefcaseIcon } from '../components/Icons';
import { useDebounce } from '../hooks/useDebounce';
import { useProductSearch } from '../hooks/useProductSearch';
import SearchDropdown from '../components/SearchDropdown';
import ProductSearchResultItem from '../context/ProductSearchResultItem';
import * as receiveDb from '../services/receiveDbService';
import { useDraft } from '../hooks/useDraft';

type View = 'entry' | 'list';
const DRAFT_KEY = 'receiving-entry-draft';

// --- Sub-components ---

const ReceivingItemRow: React.FC<{ item: ReceivingItem, onRemove: () => void }> = ({ item, onRemove }) => (
    <div className="flex items-center p-3 bg-white rounded-lg shadow-sm border">
        <div className="flex-grow min-w-0">
            <p className="font-bold text-gray-800 truncate">{item.name}</p>
            <p className="text-sm text-gray-500">{item.costPrice.toLocaleString()}원</p>
        </div>
        <div className="flex items-center gap-3">
            <span className="font-bold text-lg text-blue-600">{item.quantity}</span>
            <button onClick={onRemove} className="p-2 text-gray-400 hover:text-red-500 rounded-full hover:bg-red-50">
                <TrashIcon className="w-5 h-5" />
            </button>
        </div>
    </div>
);

// --- Main Manager Component ---

const ReceiveManagerPage: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const { customers } = useDataState();
    const { openScanner } = useScanner();
    const { showAlert, showToast } = useAlert();
    const { sqlStatus } = useMiscUI();

    const [view, setView] = useState<View>('entry');
    const [batches, setBatches] = useState<ReceivingBatch[]>([]);
    const [draftCount, setDraftCount] = useState(0);

    // --- Entry View State (now with Draft support) ---
    const [currentDate, setCurrentDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [selectedSupplier, setSelectedSupplier] = useState<Customer | null>(null);
    const [currentItems, setCurrentItems] = useState<ReceivingItem[]>([]);
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [quantity, setQuantity] = useState<number | string>(1);
    const [isSavingBatch, setIsSavingBatch] = useState(false);
    
    // Draft Hook
    const { draft, isLoading: isDraftLoading, save: saveDraft, remove: removeDraft } = useDraft<ReceivingDraft>(DRAFT_KEY);
    
    // Product Search states
    const { searchTerm, setSearchTerm, results, isSearching, search } = useProductSearch('newOrder');
    const [showProductDropdown, setShowProductDropdown] = useState(false);
    const productSearchBlurTimeout = useRef<number | null>(null);
    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    const sortedCustomers = useMemo(() => {
        return [...customers].sort((a, b) => a.name.localeCompare(b.name));
    }, [customers]);

    useEffect(() => {
        search(debouncedSearchTerm);
    }, [debouncedSearchTerm, search]);

    // --- List View State ---
    const [selectedBatches, setSelectedBatches] = useState<Set<number>>(new Set());
    const [expandedBatch, setExpandedBatch] = useState<number | null>(null);
    const [isSending, setIsSending] = useState(false);
    
    // --- Draft and State Management ---
    useEffect(() => {
        if (draft) {
            setCurrentDate(draft.currentDate || new Date().toISOString().slice(0, 10));
            setSelectedSupplier(draft.selectedSupplier || null);
            setCurrentItems(draft.items || []);
        }
    }, [draft]);

    useEffect(() => {
        if (isDraftLoading) return;
        const hasContent = selectedSupplier || currentItems.length > 0;
        if (hasContent) {
            saveDraft({ currentDate, selectedSupplier, items: currentItems });
        }
    }, [currentDate, selectedSupplier, currentItems, isDraftLoading, saveDraft]);

    // --- General Logic ---

    const loadBatches = useCallback(async () => {
        const allBatches = await receiveDb.getAllBatches();
        setBatches(allBatches);
        const drafts = allBatches.filter(b => b.status === 'draft').length;
        setDraftCount(drafts);
    }, []);

    useEffect(() => {
        if (isActive) {
            loadBatches();
        }
    }, [isActive, loadBatches]);
    
    const resetEntryForm = () => {
        setCurrentDate(new Date().toISOString().slice(0, 10));
        setSelectedSupplier(null);
        setCurrentItems([]);
        setSelectedProduct(null);
        setSearchTerm('');
        setQuantity(1);
    };

    // --- Entry View Handlers ---

    const handleAddProduct = () => {
        if (!selectedProduct || Number(quantity) <= 0) return;
        
        const newItem: ReceivingItem = {
            barcode: selectedProduct.barcode,
            name: selectedProduct.name,
            costPrice: selectedProduct.costPrice,
            quantity: Number(quantity),
        };

        const existingIndex = currentItems.findIndex(i => i.barcode === newItem.barcode);
        if (existingIndex > -1) {
            const updatedItems = [...currentItems];
            updatedItems[existingIndex].quantity += newItem.quantity;
            setCurrentItems(updatedItems);
        } else {
            setCurrentItems(prev => [...prev, newItem]);
        }

        // Reset inputs for next item
        setSelectedProduct(null);
        setSearchTerm('');
        setQuantity(1);
    };

    const handleRemoveItem = (barcode: string) => {
        setCurrentItems(prev => prev.filter(item => item.barcode !== barcode));
    };

    const handleSaveBatch = async () => {
        if (!selectedSupplier) {
            showAlert('거래처를 선택해주세요.');
            return;
        }
        if (currentItems.length === 0) {
            showAlert('입고된 상품이 없습니다.');
            return;
        }
        
        setIsSavingBatch(true);
        try {
            const totalAmount = currentItems.reduce((sum, item) => sum + item.costPrice * item.quantity, 0);
            const newBatch: ReceivingBatch = {
                id: Date.now(),
                date: currentDate,
                supplier: selectedSupplier,
                items: currentItems,
                itemCount: currentItems.length,
                totalAmount,
                status: 'draft',
            };
            await receiveDb.saveOrUpdateBatch(newBatch);
            showToast('입고 내역이 저장되었습니다.', 'success');
            await removeDraft();
            resetEntryForm();
            await loadBatches();
        } catch (e) {
            showAlert('저장에 실패했습니다.');
        } finally {
            setIsSavingBatch(false);
        }
    };
    
    const handleProductSelect = (product: Product) => {
        setSelectedProduct(product);
        setSearchTerm(product.name);
        setShowProductDropdown(false);
    };

    const handleScan = () => {
        openScanner('modal', (barcode) => {
            setSearchTerm(barcode);
            search(barcode);
        }, false);
    };
    
    // --- List View Handlers ---

    const groupedBatches = useMemo(() => {
        const groups: Record<string, ReceivingBatch[]> = {};
        batches.forEach(batch => {
            const key = batch.supplier.comcode;
            if (!groups[key]) groups[key] = [];
            groups[key].push(batch);
        });
        return Object.values(groups).map(group => ({
            supplier: group[0].supplier,
            batches: group.sort((a, b) => b.id - a.id)
        }));
    }, [batches]);
    
    const toggleBatchSelection = (id: number) => {
        setSelectedBatches(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return newSet;
        });
    };

    const handleSend = () => {
        if (selectedBatches.size === 0) {
            showAlert('전송할 입고 내역을 선택해주세요.');
            return;
        }
        if (sqlStatus !== 'connected') {
            showAlert('서버에 연결할 수 없어 전송할 수 없습니다. 오프라인 모드입니다.');
            return;
        }
        
        showAlert(
            `${selectedBatches.size}개의 입고 내역을 서버로 전송하시겠습니까?`,
            async () => {
                setIsSending(true);
                try {
                    for (const id of selectedBatches) {
                        const batch = batches.find(b => b.id === id);
                        if (batch) {
                            // --- !! Placeholder for actual API call !! ---
                            // For this test, we just simulate a network delay
                            await new Promise(res => setTimeout(res, 500)); 
                            
                            // On success, update the batch status
                            const updatedBatch = { ...batch, status: 'sent' as 'sent', sentAt: new Date().toISOString() };
                            await receiveDb.saveOrUpdateBatch(updatedBatch);
                        }
                    }
                    showToast(`${selectedBatches.size}건 전송 완료`, 'success');
                    setSelectedBatches(new Set());
                    await loadBatches();
                } catch (e) {
                    showAlert('전송 중 오류가 발생했습니다.');
                } finally {
                    setIsSending(false);
                }
            },
            '전송'
        );
    };

    // --- Render Logic ---

    if (isDraftLoading) {
        return <div className="flex items-center justify-center h-full"><SpinnerIcon className="w-8 h-8 text-blue-500" /></div>;
    }

    if (view === 'list') {
        return (
            <div className="flex flex-col h-full bg-gray-50">
                <div className="flex-grow overflow-y-auto p-3 space-y-3">
                    {groupedBatches.length === 0 ? (
                        <div className="text-center text-gray-400 pt-16">
                            <p className="font-semibold">저장된 입고 내역이 없습니다.</p>
                        </div>
                    ) : (
                        groupedBatches.map(({ supplier, batches: supplierBatches }) => (
                            <div key={supplier.comcode} className="bg-white rounded-xl shadow-sm border p-3">
                                <h3 className="font-bold text-lg text-gray-800">{supplier.name}</h3>
                                <div className="divide-y divide-gray-100 mt-2">
                                    {supplierBatches.map(batch => (
                                        <div key={batch.id} className="py-2">
                                            <div className="flex items-center gap-3">
                                                {batch.status === 'draft' && (
                                                    <input 
                                                        type="checkbox" 
                                                        checked={selectedBatches.has(batch.id)} 
                                                        onChange={() => toggleBatchSelection(batch.id)}
                                                        className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                    />
                                                )}
                                                {batch.status === 'sent' && <CheckCircleIcon className="w-6 h-6 text-green-500" />}

                                                <div className="flex-grow" onClick={() => setExpandedBatch(b => b === batch.id ? null : batch.id)}>
                                                    <p className={`font-semibold ${batch.status === 'sent' ? 'text-gray-400' : 'text-gray-700'}`}>
                                                        {new Date(batch.date).toLocaleDateString()} - {batch.itemCount}개 품목
                                                    </p>
                                                    <p className="text-sm text-gray-500">{batch.totalAmount.toLocaleString()}원</p>
                                                </div>
                                                <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${expandedBatch === batch.id ? 'rotate-180' : ''}`} />
                                            </div>
                                            {expandedBatch === batch.id && (
                                                <div className="mt-3 pl-8 space-y-2">
                                                    {batch.items.map(item => <ReceivingItemRow key={item.barcode} item={item} onRemove={() => {}} />)}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>
                <div className="flex-shrink-0 p-3 bg-white border-t safe-area-pb grid grid-cols-2 gap-3">
                    <button onClick={() => setView('entry')} className="h-12 bg-gray-200 text-gray-700 font-bold rounded-lg">입고 등록</button>
                    <button onClick={handleSend} disabled={isSending || selectedBatches.size === 0} className="h-12 bg-blue-600 text-white font-bold rounded-lg disabled:bg-gray-400 flex items-center justify-center gap-2">
                        {isSending ? <SpinnerIcon className="w-5 h-5" /> : '선택 전송'}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-gray-50">
            {/* Header */}
            <div className="flex-shrink-0 bg-white p-3 border-b shadow-sm space-y-3">
                <div className="flex items-center gap-3">
                    <label htmlFor="receive-date" className="font-bold text-gray-700">입고일</label>
                    <input type="date" id="receive-date" value={currentDate} onChange={e => setCurrentDate(e.target.value)} className="flex-grow p-2 border rounded-lg" />
                </div>
                <select 
                    value={selectedSupplier?.comcode || ''} 
                    onChange={e => {
                        const supplier = customers.find(c => c.comcode === e.target.value);
                        setSelectedSupplier(supplier || null);
                    }} 
                    className="w-full p-2.5 border rounded-lg bg-white font-bold text-base border-gray-300 focus:ring-1 focus:ring-blue-500"
                >
                    <option value="">거래처를 선택하세요</option>
                    {sortedCustomers.map(c => <option key={c.comcode} value={c.comcode}>{c.name}</option>)}
                </select>
            </div>

            {/* Item Entry */}
            {selectedSupplier && (
                <div className="flex-shrink-0 bg-white p-3 border-b">
                    <div className="grid grid-cols-[1fr_auto] gap-2 items-start">
                        <div className="space-y-2">
                            <div className="relative">
                                <input type="text" placeholder="상품 검색 또는 스캔" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} onFocus={() => setShowProductDropdown(true)} onBlur={() => { productSearchBlurTimeout.current = window.setTimeout(() => setShowProductDropdown(false), 200); }} className="w-full h-14 p-3 pl-10 border rounded-lg text-lg" />
                                <SearchIcon className="w-6 h-6 absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
                                <SearchDropdown items={results} renderItem={p => <ProductSearchResultItem product={p} onClick={handleProductSelect} />} show={showProductDropdown && !!debouncedSearchTerm} />
                            </div>
                            {selectedProduct && (
                                <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg">
                                    <p className="flex-grow font-semibold text-blue-800 truncate">{selectedProduct.name}</p>
                                    <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} className="w-20 p-2 border rounded text-center font-bold text-lg" />
                                    <button onClick={handleAddProduct} className="px-4 py-2 bg-blue-600 text-white font-bold rounded-lg">추가</button>
                                </div>
                            )}
                        </div>
                        <button onClick={handleScan} className="w-20 h-full bg-gray-700 text-white rounded-lg flex flex-col items-center justify-center gap-1">
                            <BarcodeScannerIcon className="w-8 h-8" />
                            <span className="text-xs font-bold">스캔</span>
                        </button>
                    </div>
                </div>
            )}
            
            {/* Item List */}
            <div className="flex-grow overflow-y-auto p-3 space-y-2">
                {currentItems.length > 0 ? (
                    currentItems.map(item => <ReceivingItemRow key={item.barcode} item={item} onRemove={() => handleRemoveItem(item.barcode)} />)
                ) : (
                    <div className="text-center text-gray-400 pt-16">
                        <BriefcaseIcon className="w-16 h-16 mx-auto text-gray-300" />
                        <p className="mt-2 font-semibold">{selectedSupplier ? '입고 상품을 추가하세요.' : '거래처를 먼저 선택하세요.'}</p>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 p-3 bg-white border-t safe-area-pb grid grid-cols-10 gap-3">
                <button onClick={handleSaveBatch} disabled={isSavingBatch} className="col-span-7 h-14 bg-blue-600 text-white font-bold rounded-lg text-lg flex items-center justify-center disabled:bg-gray-400">
                    {isSavingBatch ? <SpinnerIcon className="w-6 h-6" /> : '현재 입고 저장'}
                </button>
                <button onClick={() => setView('list')} className="col-span-3 h-14 bg-gray-600 text-white font-bold rounded-lg relative">
                    <div className="flex flex-col items-center justify-center">
                        <span className="text-sm">목록</span>
                        <span className="text-xs">& 전송</span>
                    </div>
                    {draftCount > 0 && (
                        <div className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center border-2 border-white">
                            {draftCount}
                        </div>
                    )}
                </button>
            </div>
        </div>
    );
};

export default ReceiveManagerPage;