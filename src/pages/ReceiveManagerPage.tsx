
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
    <div className="grid grid-cols-[1fr_50px_50px_35px_60px_25px] gap-1 items-center p-1.5 bg-white rounded border border-gray-200 text-xs">
        <div className="flex flex-col min-w-0 leading-tight">
            <div className="flex items-center gap-1">
                <p className="font-bold text-gray-800 truncate">{item.name || '(미등록 상품)'}</p>
                {item.isNew && <span className="bg-yellow-100 text-yellow-700 text-[9px] px-1 py-0.5 rounded font-bold whitespace-nowrap leading-none">신규</span>}
            </div>
            <p className="text-gray-400 font-mono text-[10px]">{item.barcode}</p>
        </div>
        <div className="text-right">
            <p className="font-mono tracking-tight">{(item.costPrice || 0).toLocaleString()}</p>
        </div>
        <div className="text-right">
            <p className="font-mono text-gray-500 tracking-tight">{(item.sellingPrice || 0).toLocaleString()}</p>
        </div>
        <p className={`text-center font-bold text-sm ${item.quantity < 0 ? 'text-red-600' : 'text-blue-600'}`}>{item.quantity}</p>
        <p className="text-right font-mono font-semibold tracking-tight">{((item.costPrice || 0) * item.quantity).toLocaleString()}</p>
        <button onClick={onRemove} className="p-1 text-gray-400 hover:text-red-500 rounded-full hover:bg-red-50 flex items-center justify-center">
            <TrashIcon className="w-3.5 h-3.5" />
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
    
    // UI State for List View
    const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());
    
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
    
    // --- Data Loading & Sync ---

    const loadBatches = useCallback(async () => {
        try {
            const allBatches = await receiveDb.getAllBatches();
            setBatches(allBatches);
            
            // Count unique suppliers that have drafts (since we group drafts by supplier now)
            const draftSuppliers = new Set(
                allBatches.filter(b => b.status === 'draft').map(b => b.supplier.comcode)
            );
            setDraftCount(draftSuppliers.size);
        } catch (e) {
            console.error("Failed to load batches", e);
        }
    }, []);

    useEffect(() => {
        if (isActive) {
            loadBatches();
        }
    }, [isActive, loadBatches]);

    // Restore draft from local storage (if app was closed improperly)
    useEffect(() => {
        if (draft) {
            // Only restore if user hasn't explicitly started a new action
            if (!selectedSupplier && currentItems.length === 0) {
                setCurrentDate(draft.currentDate || new Date().toISOString().slice(0, 10));
                setSelectedSupplier(draft.selectedSupplier || null);
                setCurrentItems(draft.items || []);
            }
        }
    }, [draft]);

    // Auto-save current work to local draft
    useEffect(() => {
        if (isDraftLoading) return;
        const hasContent = selectedSupplier || currentItems.length > 0;
        if (hasContent) {
            saveDraft({ currentDate, selectedSupplier, items: currentItems });
        }
    }, [currentDate, selectedSupplier, currentItems, isDraftLoading, saveDraft]);


    // --- Actions ---

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

    // Consolidated Save: "One Bundle Per Supplier"
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
            // 1. Find existing 'draft' batches for this supplier to replace them
            const existingDrafts = batches.filter(b => 
                b.status === 'draft' && b.supplier.comcode === selectedSupplier.comcode
            );

            // 2. Delete existing drafts from DB (we are replacing them with a consolidated one)
            for (const draftBatch of existingDrafts) {
                await receiveDb.deleteBatch(draftBatch.id);
            }

            // 3. Create new consolidated batch
            // Reset 'isNew' flag on save, as they are now persisted
            const itemsToSave = currentItems.map(item => ({ ...item, isNew: false }));
            const totalAmount = itemsToSave.reduce((sum, item) => sum + (item.costPrice || 0) * item.quantity, 0);
            
            const newBatch: ReceivingBatch = {
                id: Date.now(),
                date: currentDate,
                supplier: selectedSupplier,
                items: itemsToSave,
                itemCount: itemsToSave.length,
                totalAmount,
                status: 'draft', // Saved as draft first (local save)
            };

            if (sqlStatus === 'connected') {
                // If online, send directly to server? The requirement implies "Send" is a separate step from "List".
                // But typically "Save" means save to device. 
                // "전송전에는 거래처라는 하나의 보따리" implies we keep it as draft until explicitly sent.
                await receiveDb.saveOrUpdateBatch(newBatch);
                showToast('기기에 저장되었습니다. (전송 대기)', 'success');
            } else {
                await receiveDb.saveOrUpdateBatch(newBatch);
                showToast('오프라인 상태라 기기에 임시 저장되었습니다.', 'success');
            }

            await removeDraft(); // Clear auto-save draft
            resetEntryForm();
            await loadBatches();
        } catch (e: any) {
            console.error(e);
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
    
    // Auto-load drafts when supplier is selected
    const handleSupplierChange = async (supplier: Customer) => {
        setSelectedSupplier(supplier);
        
        // Find existing draft batches for this supplier
        const supplierDrafts = batches.filter(b => 
            b.supplier.comcode === supplier.comcode && b.status === 'draft'
        );

        if (supplierDrafts.length > 0) {
            // Consolidate items from all draft batches (usually just one, but handle multiple just in case)
            const allItems = supplierDrafts.flatMap(b => b.items);
            // Mark loaded items as NOT new
            const cleanItems = allItems.map(i => ({...i, isNew: false}));
            
            setCurrentItems(cleanItems);
            
            // Use the date of the most recent draft
            const latestDate = supplierDrafts.sort((a,b) => b.id - a.id)[0].date;
            setCurrentDate(latestDate);
            
            showToast(`${supplier.name}의 작성 중인 내역을 불러왔습니다.`, 'success');
        } else {
            setCurrentItems([]);
            // Don't change date to keep user's selection or today
        }
    };

    // --- List View Logic ---

    // Group batches by Supplier. 
    // For 'draft' status, we treat them as a single group that can be toggled.
    // For 'sent' status, they are individual history items.
    const groupedBatches = useMemo(() => {
        const groups: Record<string, { supplier: Customer, drafts: ReceivingBatch[], sent: ReceivingBatch[] }> = {};
        
        batches.forEach(batch => {
            const key = batch.supplier.comcode;
            if (!groups[key]) {
                groups[key] = { supplier: batch.supplier, drafts: [], sent: [] };
            }
            if (batch.status === 'draft') {
                groups[key].drafts.push(batch);
            } else {
                groups[key].sent.push(batch);
            }
        });

        // Convert to array and sort
        return Object.values(groups).sort((a, b) => a.supplier.name.localeCompare(b.supplier.name));
    }, [batches]);
    
    const toggleSupplierDraftSelection = (e: React.MouseEvent, supplierCode: string) => {
        e.stopPropagation();
        const group = groupedBatches.find(g => g.supplier.comcode === supplierCode);
        if (!group || group.drafts.length === 0) return;

        const draftIds = group.drafts.map(b => b.id);
        const allSelected = draftIds.every(id => selectedBatches.has(id));

        setSelectedBatches(prev => {
            const newSet = new Set(prev);
            draftIds.forEach(id => {
                if (allSelected) newSet.delete(id);
                else newSet.add(id);
            });
            return newSet;
        });
    };

    const toggleSupplierExpand = (supplierCode: string) => {
        setExpandedSuppliers(prev => {
            const newSet = new Set(prev);
            if (newSet.has(supplierCode)) newSet.delete(supplierCode);
            else newSet.add(supplierCode);
            return newSet;
        });
    };

    const handleSend = () => {
        if (selectedBatches.size === 0) {
            showAlert('전송할 거래처(내역)를 선택해주세요.');
            return;
        }
        if (sqlStatus !== 'connected') {
            showAlert('서버에 연결할 수 없어 전송할 수 없습니다. 오프라인 모드입니다.');
            return;
        }
        
        // Calculate total items to send
        const batchesToSend = batches.filter(b => selectedBatches.has(b.id));
        const totalItems = batchesToSend.reduce((acc, b) => acc + b.itemCount, 0);
        const uniqueSuppliers = new Set(batchesToSend.map(b => b.supplier.name)).size;

        showAlert(
            `${uniqueSuppliers}개 거래처, 총 ${totalItems}개 품목을 서버로 전송하시겠습니까?`,
            async () => {
                setIsSending(true);
                try {
                    for (const batch of batchesToSend) {
                        await addReceivingBatch(batch); // Send to Firebase/Server
                        const updatedBatch = { ...batch, status: 'sent' as 'sent', sentAt: new Date().toISOString() };
                        await receiveDb.saveOrUpdateBatch(updatedBatch); // Update local status
                    }
                    showToast(`전송 완료`, 'success');
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

    // --- Render ---

    if (view === 'list') {
        return (
            <div className="flex flex-col h-full bg-gray-50">
                <div className="flex-grow overflow-y-auto p-2 space-y-2">
                    {groupedBatches.length === 0 ? (
                        <div className="text-center text-gray-400 pt-16">
                            <p className="font-semibold">저장된 입고 내역이 없습니다.</p>
                        </div>
                    ) : (
                        groupedBatches.map(({ supplier, drafts, sent }) => {
                            const hasDrafts = drafts.length > 0;
                            const isDraftSelected = drafts.every(d => selectedBatches.has(d.id)) && drafts.length > 0;
                            const isExpanded = expandedSuppliers.has(supplier.comcode);
                            
                            // Calculate draft totals
                            const draftItemCount = drafts.reduce((sum, b) => sum + b.itemCount, 0);
                            const draftTotalAmount = drafts.reduce((sum, b) => sum + b.totalAmount, 0);

                            return (
                                <div key={supplier.comcode} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                                    {/* Header: Supplier Name & Selection */}
                                    <div 
                                        onClick={() => toggleSupplierExpand(supplier.comcode)}
                                        className="flex items-center justify-between p-3 bg-white active:bg-gray-50 transition-colors cursor-pointer"
                                    >
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            {hasDrafts ? (
                                                <div onClick={(e) => toggleSupplierDraftSelection(e, supplier.comcode)} className="flex-shrink-0 p-1 cursor-pointer">
                                                    <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isDraftSelected ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300'}`}>
                                                        {isDraftSelected && <CheckCircleIcon className="w-4 h-4 text-white" />}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="w-7"></div> // Spacer
                                            )}
                                            
                                            <div className="flex-grow min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <h3 className="font-bold text-base text-gray-800 truncate">{supplier.name}</h3>
                                                    {hasDrafts && <span className="bg-orange-100 text-orange-700 text-[10px] px-1.5 py-0.5 rounded font-bold">전송대기</span>}
                                                </div>
                                                {hasDrafts && (
                                                    <p className="text-xs text-gray-500 mt-0.5">
                                                        {draftItemCount}건 / {draftTotalAmount.toLocaleString()}원
                                                    </p>
                                                )}
                                                {!hasDrafts && sent.length > 0 && (
                                                    <p className="text-xs text-green-600 mt-0.5">전송 완료됨</p>
                                                )}
                                            </div>
                                        </div>
                                        <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                    </div>

                                    {/* Body: Batches list */}
                                    {isExpanded && (
                                        <div className="border-t border-gray-100 bg-gray-50/50 p-2 space-y-2">
                                            {/* Drafts Section */}
                                            {hasDrafts && (
                                                <div className="bg-white border border-orange-200 rounded p-2">
                                                    <div className="flex justify-between items-center mb-2">
                                                        <span className="text-xs font-bold text-orange-600">작성 중인 내역 (보따리)</span>
                                                        <button 
                                                            onClick={() => {
                                                                handleSupplierChange(supplier);
                                                                setView('entry');
                                                            }}
                                                            className="flex items-center gap-1 text-xs text-blue-600 font-bold bg-blue-50 px-2 py-1 rounded hover:bg-blue-100"
                                                        >
                                                            <PencilSquareIcon className="w-3 h-3" /> 이어서 작성
                                                        </button>
                                                    </div>
                                                    <div className="space-y-1">
                                                        {drafts.flatMap(b => b.items).map((item) => (
                                                            <div key={item.uniqueId} className="flex justify-between items-center text-xs text-gray-600 border-b border-gray-100 last:border-0 pb-1">
                                                                <span className="truncate flex-grow pr-2">{item.name}</span>
                                                                <span className="font-mono flex-shrink-0">{item.quantity}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Sent History Section */}
                                            {sent.length > 0 && (
                                                <div className="space-y-1">
                                                    <p className="text-xs font-bold text-gray-500 px-1 mt-2">전송 완료 내역</p>
                                                    {sent.map(batch => (
                                                        <div key={batch.id} className="flex items-center justify-between p-2 bg-white rounded border border-gray-200">
                                                            <div>
                                                                <p className="text-xs text-gray-700 font-medium">{new Date(batch.sentAt || batch.date).toLocaleString()}</p>
                                                                <p className="text-[10px] text-gray-400">ID: {batch.id}</p>
                                                            </div>
                                                            <div className="text-right">
                                                                <p className="text-xs font-bold text-gray-800">{batch.itemCount}건</p>
                                                                <p className="text-[10px] text-gray-500">{batch.totalAmount.toLocaleString()}원</p>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
                <div className="flex-shrink-0 p-2 bg-white border-t safe-area-pb grid grid-cols-2 gap-2 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
                    <button onClick={() => setView('entry')} className="h-11 bg-gray-200 text-gray-700 font-bold rounded-lg hover:bg-gray-300">입고 등록</button>
                    <button onClick={handleSend} disabled={isSending || selectedBatches.size === 0} className="relative h-11 bg-blue-600 text-white font-bold rounded-lg disabled:bg-gray-400 flex items-center justify-center gap-2 hover:bg-blue-700">
                        {isSending ? <SpinnerIcon className="w-5 h-5" /> : `선택 전송 (${selectedBatches.size > 0 ? selectedBatches.size : 0})`}
                    </button>
                </div>
            </div>
        );
    }

    // --- Entry View ---

    return (
        <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
            <div className="flex-shrink-0 bg-white p-2 border-b shadow-sm space-y-2">
                <div className="flex items-center gap-2">
                    <label htmlFor="receive-date" className="font-bold text-gray-700 whitespace-nowrap w-10 text-sm">입고일</label>
                    <input type="date" id="receive-date" value={currentDate} onChange={e => setCurrentDate(e.target.value)} className="flex-grow p-1.5 border rounded bg-gray-50 text-sm font-semibold h-9" />
                </div>
                <div className="flex items-center gap-2">
                    <label className="font-bold text-gray-700 whitespace-nowrap w-10 text-sm">거래처</label>
                    {selectedSupplier ? (
                        <div className="flex-grow flex items-center gap-1">
                            <div className="flex-grow p-1.5 bg-blue-50 border border-blue-200 rounded text-blue-800 font-bold text-sm truncate h-9 flex items-center">
                                {selectedSupplier.name}
                            </div>
                            <button 
                                onClick={() => setSelectedSupplier(null)}
                                className="px-3 h-9 bg-gray-200 text-gray-700 font-bold rounded text-xs whitespace-nowrap hover:bg-gray-300"
                            >
                                변경
                            </button>
                        </div>
                    ) : (
                        <select 
                            value="" 
                            onChange={e => {
                                const supplier = (customers || []).find(c => c.comcode === e.target.value);
                                if (supplier) handleSupplierChange(supplier);
                            }} 
                            className="flex-grow p-1.5 border rounded bg-white font-medium text-sm border-gray-300 focus:ring-1 focus:ring-blue-500 h-9"
                        >
                            <option value="">거래처를 선택하세요</option>
                            {sortedCustomers.map(c => <option key={c.comcode} value={c.comcode}>{c.name}</option>)}
                        </select>
                    )}
                </div>
            </div>

            {selectedSupplier && (
                <div className="flex-shrink-0 bg-white p-2 border-b">
                     <div className="flex items-stretch gap-1 w-full max-w-2xl mx-auto">
                        <div className="relative flex-grow">
                            <input
                                type="text"
                                placeholder="품목명 또는 바코드 검색"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                onFocus={() => setShowProductDropdown(true)}
                                onBlur={() => { productSearchBlurTimeout.current = window.setTimeout(() => setShowProductDropdown(false), 200); }}
                                className="w-full px-2 h-10 border border-gray-300 bg-white rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder:text-gray-400 text-sm"
                                autoComplete="off"
                            />
                            <SearchDropdown items={results} renderItem={p => <ProductSearchResultItem product={p} onClick={handleProductSelect} />} show={showProductDropdown && !!debouncedSearchTerm} />
                        </div>
                        <button onClick={handleScan} className="w-20 h-10 bg-blue-600 text-white rounded flex items-center justify-center font-bold hover:bg-blue-700 transition active:scale-95 shadow shadow-blue-500/30 flex-shrink-0 gap-1 text-sm">
                            <BarcodeScannerIcon className="w-5 h-5" />
                            <span>스캔</span>
                        </button>
                    </div>
                </div>
            )}
            
            <div className="flex-grow overflow-y-auto p-2">
                {currentItems.length > 0 ? (
                    <div className="space-y-1">
                        <div className="grid grid-cols-[1fr_50px_50px_35px_60px_25px] gap-1 px-1 pb-1 text-[10px] font-bold text-gray-500 border-b border-gray-200 mb-1">
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
                        <BriefcaseIcon className="w-12 h-12 mx-auto text-gray-300" />
                        <p className="mt-2 text-sm font-semibold">{selectedSupplier ? '입고 상품을 추가하세요.' : '거래처를 먼저 선택하세요.'}</p>
                    </div>
                )}
            </div>

            <div className="flex-shrink-0 p-2 bg-white border-t safe-area-pb grid grid-cols-4 gap-2 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
                <button onClick={handleReset} className="h-12 bg-gray-200 text-gray-700 font-bold rounded-lg flex items-center justify-center transition active:scale-95 text-sm">
                    초기화
                </button>
                <button onClick={handleSaveBatch} disabled={isSavingBatch} className="col-span-2 h-12 bg-blue-600 text-white font-bold rounded-lg text-base flex items-center justify-center disabled:bg-gray-400 transition active:scale-95 shadow-md shadow-blue-500/30">
                    {isSavingBatch ? <SpinnerIcon className="w-5 h-5" /> : '입고 저장'}
                </button>
                <button onClick={() => setView('list')} className="h-12 bg-gray-600 text-white font-bold rounded-lg relative transition active:scale-95 shadow-md flex flex-col items-center justify-center">
                    <span className="text-sm">목록</span>
                    <span className="text-[9px]">& 전송</span>
                    {draftCount > 0 && (
                        <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white z-10">
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
