
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Customer, Product, ReceivingItem, ReceivingBatch, ReceivingDraft } from '../types';
import { useDataState, useScanner, useAlert, useModals, useMiscUI } from '../context/AppContext';
import { SpinnerIcon, SearchIcon, BarcodeScannerIcon, ChevronDownIcon, TrashIcon, CheckCircleIcon, BriefcaseIcon, PencilSquareIcon, ChevronRightIcon } from '../components/Icons';
import { useDebounce } from '../hooks/useDebounce';
import { useProductSearch } from '../hooks/useProductSearch';
import SearchDropdown from '../components/SearchDropdown';
import ProductSearchResultItem from '../context/ProductSearchResultItem';
import * as receiveDb from '../services/receiveDbService';
import { addReceivingBatch } from '../services/dbService';
import { useDraft } from '../hooks/useDraft';
import ReceiveItemModal from '../components/ReceiveItemModal';

type View = 'entry' | 'list';
const DRAFT_KEY = 'receiving-entry-draft';

const ReceivingItemRow: React.FC<{ item: ReceivingItem, onRemove: () => void }> = ({ item, onRemove }) => (
    <div className="grid grid-cols-[1fr_55px_55px_35px_65px_25px] gap-2 items-center p-2 bg-white rounded-lg shadow-sm border text-xs">
        <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1">
                <p className="font-bold text-gray-800 truncate text-sm">{item.name || '(미등록 상품)'}</p>
                {item.isNew && <span className="bg-yellow-100 text-yellow-700 text-[10px] px-1.5 py-0.5 rounded font-bold whitespace-nowrap">신규</span>}
            </div>
            <p className="text-gray-400 font-mono">{item.barcode}</p>
        </div>
        <div className="text-right">
            <p className="font-mono">{(item.costPrice || 0).toLocaleString()}</p>
        </div>
        <div className="text-right">
            <p className="font-mono text-gray-600">{(item.sellingPrice || 0).toLocaleString()}</p>
        </div>
        <p className={`text-center font-bold text-base ${item.quantity < 0 ? 'text-red-600' : 'text-blue-600'}`}>{item.quantity}</p>
        <p className="text-right font-mono font-semibold">{((item.costPrice || 0) * item.quantity).toLocaleString()}</p>
        <button onClick={onRemove} className="p-1 text-gray-400 hover:text-red-500 rounded-full hover:bg-red-50">
            <TrashIcon className="w-4 h-4" />
        </button>
    </div>
);

const ReceiveManagerPage: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const { customers, products } = useDataState();
    const { openScanner } = useScanner();
    const { showAlert, showToast } = useAlert();
    const { sqlStatus } = useMiscUI();

    const [view, setView] = useState<View>('entry');
    const [batches, setBatches] = useState<ReceivingBatch[]>([]);
    const [draftCount, setDraftCount] = useState(0);

    const [currentDate, setCurrentDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [selectedSupplier, setSelectedSupplier] = useState<Customer | null>(null);
    const [currentItems, setCurrentItems] = useState<ReceivingItem[]>([]);
    const [isSavingBatch, setIsSavingBatch] = useState(false);
    const [receiveModalProps, setReceiveModalProps] = useState<{ product: Product } | null>(null);
    
    const { draft, isLoading: isDraftLoading, save: saveDraft, remove: removeDraft } = useDraft<ReceivingDraft>(DRAFT_KEY);
    
    const { searchTerm, setSearchTerm, results, isSearching, search } = useProductSearch('newOrder');
    const [showProductDropdown, setShowProductDropdown] = useState(false);
    const productSearchBlurTimeout = useRef<number | null>(null);
    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    const sortedCustomers = useMemo(() => {
        return [...(customers || [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }, [customers]);

    useEffect(() => {
        search(debouncedSearchTerm);
    }, [debouncedSearchTerm, search]);

    const [selectedBatches, setSelectedBatches] = useState<Set<number>>(new Set());
    const [isSending, setIsSending] = useState(false);
    
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

    const loadBatches = useCallback(async () => {
        try {
            const allBatches = await receiveDb.getAllBatches();
            setBatches(allBatches);
            const drafts = allBatches.filter(b => b.status === 'draft').length;
            setDraftCount(drafts);
        } catch (e) {
            console.error("Failed to load batches", e);
        }
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
        setSearchTerm('');
    };

    const handleReset = () => {
        showAlert(
            "작성 중인 내용을 초기화하시겠습니까?\n임시 저장된 내역도 삭제됩니다.",
            () => {
                removeDraft();
                resetEntryForm();
                showToast("초기화되었습니다.", 'success');
            },
            '초기화',
            'bg-red-500 hover:bg-red-600 focus:ring-red-500'
        );
    };

    const handleAddItem = (itemData: Omit<ReceivingItem, 'uniqueId'>) => {
        if (itemData.quantity === 0) return;
        const newItem: ReceivingItem = {
            ...itemData,
            uniqueId: Date.now() + Math.random(),
            // isNew is passed from ReceiveItemModal based on creation logic
        };
        setCurrentItems(prev => [...prev, newItem]);
    };

    const handleRemoveItem = (uniqueId: number) => {
        setCurrentItems(prev => prev.filter(item => item.uniqueId !== uniqueId));
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
            const totalAmount = currentItems.reduce((sum, item) => sum + (item.costPrice || 0) * item.quantity, 0);
            // 저장 시 모든 isNew 플래그 제거 (DB 저장 시점에는 모두 기존 항목이 됨)
            const itemsToSave = currentItems.map(item => ({ ...item, isNew: false }));
            
            const newBatch: ReceivingBatch = {
                id: Date.now(),
                date: currentDate,
                supplier: selectedSupplier,
                items: itemsToSave,
                itemCount: itemsToSave.length,
                totalAmount,
                status: 'draft',
            };

            if (sqlStatus === 'connected') {
                await addReceivingBatch(newBatch);
                newBatch.status = 'sent';
                newBatch.sentAt = new Date().toISOString();
                showToast('입고 내역이 서버에 저장되었습니다.', 'success');
            } else {
                showToast('오프라인 상태라 기기에 임시 저장되었습니다.', 'success');
            }

            await receiveDb.saveOrUpdateBatch(newBatch);
            await removeDraft();
            resetEntryForm();
            await loadBatches();
        } catch (e: any) {
            showAlert(`저장에 실패했습니다: ${e.message}`);
        } finally {
            setIsSavingBatch(false);
        }
    };
    
    const handleProductSelect = (product: Product) => {
        setReceiveModalProps({ product });
        setSearchTerm('');
        setShowProductDropdown(false);
    };

    const handleScan = () => {
        openScanner('modal', (barcode) => {
            const productList = products || [];
            const product = productList.find(p => p.barcode === barcode);
            if (product) {
                setReceiveModalProps({ product });
            } else {
                const placeholderProduct: Product = {
                    barcode: barcode,
                    name: '',
                    costPrice: 0,
                    sellingPrice: 0,
                };
                setReceiveModalProps({ product: placeholderProduct });
            }
        }, false);
    };
    
    const handleContinueBatch = (batch: ReceivingBatch) => {
        showAlert(
            "이 입고 내역을 불러와서 계속 작성하시겠습니까?\n현재 작성 중이던 내용은 사라집니다.",
            () => {
                setCurrentDate(batch.date);
                setSelectedSupplier(batch.supplier);
                // 불러온 기존 항목은 isNew를 false로 명시
                const existingItems = batch.items.map(item => ({ ...item, isNew: false }));
                setCurrentItems(existingItems);
                setView('entry');
            },
            '불러오기'
        );
    };

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
    
    const toggleBatchSelection = (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
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
                            await addReceivingBatch(batch);
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
                                <h3 className="font-bold text-lg text-gray-800 mb-2">{supplier.name}</h3>
                                <div className="space-y-1">
                                    {supplierBatches.map(batch => (
                                        <div 
                                            key={batch.id} 
                                            onClick={() => handleContinueBatch(batch)}
                                            className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg border border-gray-100 active:bg-blue-50 transition-colors cursor-pointer"
                                        >
                                            <div onClick={(e) => toggleBatchSelection(e, batch.id)} className="flex-shrink-0 p-1">
                                                {batch.status === 'draft' ? (
                                                    <input 
                                                        type="checkbox" 
                                                        checked={selectedBatches.has(batch.id)} 
                                                        onChange={() => {}} // Handled by onClick wrapper
                                                        className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 pointer-events-none"
                                                    />
                                                ) : (
                                                    <CheckCircleIcon className="w-6 h-6 text-green-500" />
                                                )}
                                            </div>

                                            <div className="flex-grow min-w-0">
                                                <div className="flex justify-between items-center">
                                                    <p className={`font-semibold text-sm ${batch.status === 'sent' ? 'text-gray-400' : 'text-gray-700'}`}>
                                                        {new Date(batch.date).toLocaleDateString()}
                                                    </p>
                                                    <span className="text-xs font-bold text-gray-500 bg-white px-1.5 py-0.5 rounded border border-gray-200">
                                                        {batch.itemCount}건
                                                    </span>
                                                </div>
                                                <p className="text-sm font-mono text-gray-600 mt-0.5">{batch.totalAmount.toLocaleString()}원</p>
                                            </div>
                                            <ChevronRightIcon className="w-4 h-4 text-gray-400" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>
                <div className="flex-shrink-0 p-3 bg-white border-t safe-area-pb grid grid-cols-2 gap-3">
                    <button onClick={() => setView('entry')} className="h-12 bg-gray-200 text-gray-700 font-bold rounded-lg">입고 등록</button>
                    <button onClick={handleSend} disabled={isSending || selectedBatches.size === 0} className="relative h-12 bg-blue-600 text-white font-bold rounded-lg disabled:bg-gray-400 flex items-center justify-center gap-2">
                        {isSending ? <SpinnerIcon className="w-5 h-5" /> : '선택 전송'}
                        {draftCount > 0 && (
                            <div className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center border-2 border-white">
                                {draftCount}
                            </div>
                        )}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
            <div className="flex-shrink-0 bg-white p-3 border-b shadow-sm space-y-2">
                <div className="flex items-center gap-3">
                    <label htmlFor="receive-date" className="font-bold text-gray-700 whitespace-nowrap w-12">입고일</label>
                    <input type="date" id="receive-date" value={currentDate} onChange={e => setCurrentDate(e.target.value)} className="flex-grow p-2 border rounded-lg bg-gray-50 text-sm font-semibold" />
                </div>
                <div className="flex items-center gap-3">
                    <label className="font-bold text-gray-700 whitespace-nowrap w-12">거래처</label>
                    {selectedSupplier ? (
                        <div className="flex-grow flex items-center gap-2">
                            <div className="flex-grow p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 font-bold text-sm truncate">
                                {selectedSupplier.name}
                            </div>
                            <button 
                                onClick={() => setSelectedSupplier(null)}
                                className="px-3 py-2.5 bg-gray-200 text-gray-700 font-bold rounded-lg text-xs whitespace-nowrap hover:bg-gray-300"
                            >
                                변경
                            </button>
                        </div>
                    ) : (
                        <select 
                            value="" 
                            onChange={e => {
                                const supplier = (customers || []).find(c => c.comcode === e.target.value);
                                setSelectedSupplier(supplier || null);
                            }} 
                            className="flex-grow p-2.5 border rounded-lg bg-white font-medium text-sm border-gray-300 focus:ring-1 focus:ring-blue-500"
                        >
                            <option value="">거래처를 선택하세요</option>
                            {sortedCustomers.map(c => <option key={c.comcode} value={c.comcode}>{c.name}</option>)}
                        </select>
                    )}
                </div>
            </div>

            {selectedSupplier && (
                <div className="flex-shrink-0 bg-white p-3 border-b">
                     <div className="flex items-stretch gap-2 w-full max-w-2xl mx-auto">
                        <div className="relative flex-grow">
                            <input
                                type="text"
                                placeholder="품목명 또는 바코드 검색"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                onFocus={() => setShowProductDropdown(true)}
                                onBlur={() => { productSearchBlurTimeout.current = window.setTimeout(() => setShowProductDropdown(false), 200); }}
                                className="w-full px-3 h-11 border border-gray-300 bg-white rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder:text-gray-400 transition-colors duration-200 text-base"
                                autoComplete="off"
                            />
                            <SearchDropdown items={results} renderItem={p => <ProductSearchResultItem product={p} onClick={handleProductSelect} />} show={showProductDropdown && !!debouncedSearchTerm} />
                        </div>
                        <button onClick={handleScan} className="w-24 h-11 bg-blue-600 text-white rounded-lg flex items-center justify-center font-bold hover:bg-blue-700 transition active:scale-95 shadow shadow-blue-500/30 flex-shrink-0 gap-1">
                            <BarcodeScannerIcon className="w-6 h-6" />
                            <span>스캔</span>
                        </button>
                    </div>
                </div>
            )}
            
            <div className="flex-grow overflow-y-auto p-2">
                {currentItems.length > 0 ? (
                    <div className="space-y-1.5">
                        <div className="grid grid-cols-[1fr_55px_55px_35px_65px_25px] gap-2 px-2 pb-1 text-[10px] font-bold text-gray-500">
                            <span>상품정보</span>
                            <span className="text-right">매입가</span>
                            <span className="text-right">판매가</span>
                            <span className="text-center">수량</span>
                            <span className="text-right">금액</span>
                            <span></span>
                        </div>
                        {currentItems.slice().reverse().map(item => <ReceivingItemRow key={item.uniqueId} item={item} onRemove={() => handleRemoveItem(item.uniqueId)} />)}
                    </div>
                ) : (
                    <div className="text-center text-gray-400 pt-16">
                        <BriefcaseIcon className="w-16 h-16 mx-auto text-gray-300" />
                        <p className="mt-2 font-semibold">{selectedSupplier ? '입고 상품을 추가하세요.' : '거래처를 먼저 선택하세요.'}</p>
                    </div>
                )}
            </div>

            <div className="flex-shrink-0 p-3 bg-white border-t safe-area-pb grid grid-cols-4 gap-2 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
                <button onClick={handleReset} className="h-14 bg-gray-200 text-gray-700 font-bold rounded-lg flex items-center justify-center transition active:scale-95">
                    초기화
                </button>
                <button onClick={handleSaveBatch} disabled={isSavingBatch} className="col-span-2 h-14 bg-blue-600 text-white font-bold rounded-lg text-lg flex items-center justify-center disabled:bg-gray-400 transition active:scale-95 shadow-md shadow-blue-500/30">
                    {isSavingBatch ? <SpinnerIcon className="w-6 h-6" /> : '입고 저장'}
                </button>
                <button onClick={() => setView('list')} className="h-14 bg-gray-600 text-white font-bold rounded-lg relative transition active:scale-95 shadow-md flex flex-col items-center justify-center">
                    <span className="text-sm">목록</span>
                    <span className="text-[10px]">& 전송</span>
                    {draftCount > 0 && (
                        <div className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center border-2 border-white">
                            {draftCount}
                        </div>
                    )}
                </button>
            </div>
             <ReceiveItemModal
                isOpen={!!receiveModalProps}
                product={receiveModalProps?.product || null}
                onClose={() => setReceiveModalProps(null)}
                onAdd={handleAddItem}
                onScanNext={handleScan}
                currentItems={currentItems}
            />
        </div>
    );
};

export default ReceiveManagerPage;
