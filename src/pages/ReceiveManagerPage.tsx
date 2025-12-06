
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Customer, Product, ReceivingItem, ReceivingBatch, ReceivingDraft } from '../types';
import { useDataState, useScanner, useAlert, useModals, useMiscUI } from '../context/AppContext';
import { SpinnerIcon, SearchIcon, BarcodeScannerIcon, ChevronDownIcon, TrashIcon, CheckCircleIcon, BriefcaseIcon, PencilSquareIcon, ChevronRightIcon, GoogleDriveIcon, DatabaseIcon, CalendarIcon } from '../components/Icons';
import { useDebounce } from '../hooks/useDebounce';
import { useProductSearch } from '../hooks/useProductSearch';
import SearchDropdown from '../components/SearchDropdown';
import ProductSearchResultItem from '../context/ProductSearchResultItem';
import * as receiveDb from '../services/receiveDbService';
import { addReceivingBatch, deleteReceivingBatch, getReceivingBatchesByDateRange } from '../services/dbService';
import { executeUserQuery } from '../services/sqlService';
import { useDraft } from '../hooks/useDraft';
import ReceiveItemModal from '../components/ReceiveItemModal';

type View = 'entry' | 'list';
const DRAFT_KEY = 'receiving-entry-draft';

const getTodayString = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
};

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

// --- Cloud Load Modal Component ---
interface CloudLoadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (batches: ReceivingBatch[]) => void;
    onDelete: (batch: ReceivingBatch) => void;
    data: ReceivingBatch[];
    onSearch: (start: string, end: string) => void;
    isLoading: boolean;
}

const CloudLoadModal: React.FC<CloudLoadModalProps> = ({ isOpen, onClose, onConfirm, onDelete, data, onSearch, isLoading }) => {
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [isRendered, setIsRendered] = useState(false);
    
    // Default range: Today ~ Today (Local Time)
    const [startDate, setStartDate] = useState(getTodayString);
    const [endDate, setEndDate] = useState(getTodayString);

    useEffect(() => {
        if (isOpen) {
            setSelectedIds(new Set());
            // Initial auto-search for today
            const today = getTodayString();
            setStartDate(today);
            setEndDate(today);
            onSearch(today, today);
            
            const timer = setTimeout(() => setIsRendered(true), 10);
            return () => clearTimeout(timer);
        } else {
            setIsRendered(false);
        }
    }, [isOpen]); 

    const handleSearchClick = (e: React.FormEvent) => {
        e.preventDefault();
        onSearch(startDate, endDate);
    };

    const groupedData = useMemo(() => {
        const groups: Record<string, ReceivingBatch[]> = {};
        data.forEach(batch => {
            const date = batch.date;
            if (!groups[date]) groups[date] = [];
            groups[date].push(batch);
        });
        return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
    }, [data]);

    const toggleSelection = (id: number) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleDateSelection = (dateBatches: ReceivingBatch[]) => {
        const allSelected = dateBatches.every(b => selectedIds.has(b.id));
        setSelectedIds(prev => {
            const next = new Set(prev);
            dateBatches.forEach(b => {
                if (allSelected) next.delete(b.id);
                else next.add(b.id);
            });
            return next;
        });
    };
    
    const handleSelectAll = () => {
        const allIds = data.map(b => b.id);
        const isAllSelected = allIds.every(id => selectedIds.has(id));
        
        if (isAllSelected) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(allIds));
        }
    };

    const handleDelete = (e: React.MouseEvent, batch: ReceivingBatch) => {
        e.stopPropagation();
        onDelete(batch);
    };

    const handleConfirm = () => {
        const selectedBatches = data.filter(b => selectedIds.has(b.id));
        onConfirm(selectedBatches);
    };

    if (!isOpen) return null;

    return createPortal(
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-50' : 'bg-transparent'}`} role="dialog" aria-modal="true">
            <div className={`bg-white rounded-xl shadow-lg w-full max-w-lg flex flex-col max-h-[85vh] transition-[opacity,transform] duration-300 will-change-[opacity,transform] ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
                
                {/* Header with Date Search */}
                <div className="p-4 border-b space-y-3 bg-white rounded-t-xl z-10">
                    <div className="flex justify-between items-center">
                        <h3 className="text-lg font-bold text-gray-800">클라우드 데이터 불러오기</h3>
                        <button onClick={onClose} className="p-1 text-gray-500 hover:bg-gray-100 rounded-full">
                            <ChevronDownIcon className="w-6 h-6" />
                        </button>
                    </div>
                    <form onSubmit={handleSearchClick} className="flex gap-2 items-center bg-gray-50 p-2 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-1 flex-grow">
                            <input 
                                type="date" 
                                value={startDate} 
                                onChange={(e) => setStartDate(e.target.value)} 
                                className="w-full bg-white border border-gray-300 rounded px-2 py-1.5 text-xs font-semibold"
                            />
                            <span className="text-gray-400">~</span>
                            <input 
                                type="date" 
                                value={endDate} 
                                onChange={(e) => setEndDate(e.target.value)} 
                                className="w-full bg-white border border-gray-300 rounded px-2 py-1.5 text-xs font-semibold"
                            />
                        </div>
                        <button 
                            type="submit" 
                            disabled={isLoading}
                            className="bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-1 flex-shrink-0 h-full"
                        >
                            {isLoading ? <SpinnerIcon className="w-3 h-3" /> : <SearchIcon className="w-3 h-3" />}
                            조회
                        </button>
                    </form>
                    
                    {data.length > 0 && (
                        <div className="flex items-center justify-between px-1">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input 
                                    type="checkbox" 
                                    checked={data.length > 0 && data.every(b => selectedIds.has(b.id))}
                                    onChange={handleSelectAll}
                                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                />
                                <span className="text-sm font-bold text-gray-600">전체 선택 ({data.length})</span>
                            </label>
                        </div>
                    )}
                </div>
                
                <div className="flex-grow overflow-y-auto p-2 space-y-3 bg-gray-50">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                            <SpinnerIcon className="w-8 h-8 text-blue-500 mb-2" />
                            <p>데이터를 불러오는 중...</p>
                        </div>
                    ) : groupedData.length === 0 ? (
                        <div className="text-center text-gray-500 py-20 flex flex-col items-center">
                            <CalendarIcon className="w-12 h-12 text-gray-300 mb-2" />
                            <p className="font-medium">조회된 데이터가 없습니다.</p>
                            <p className="text-xs mt-1">기간을 변경하여 조회해보세요.</p>
                        </div>
                    ) : (
                        groupedData.map(([date, batches]) => {
                            const isDateSelected = batches.every(b => selectedIds.has(b.id));
                            return (
                                <div key={date} className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                                    <div 
                                        className="bg-gray-100 px-3 py-2 flex items-center justify-between cursor-pointer active:bg-gray-200 transition-colors"
                                        onClick={() => toggleDateSelection(batches)}
                                    >
                                        <div className="flex items-center gap-2">
                                            <input 
                                                type="checkbox" 
                                                checked={isDateSelected}
                                                onChange={() => {}}
                                                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 pointer-events-none"
                                            />
                                            <span className="font-bold text-gray-700">{date}</span>
                                        </div>
                                        <span className="text-xs text-gray-500 font-medium">{batches.length}건</span>
                                    </div>
                                    <div className="divide-y divide-gray-100">
                                        {batches.map(batch => (
                                            <div 
                                                key={batch.id} 
                                                className="px-3 py-2.5 flex items-center gap-3 hover:bg-blue-50 cursor-pointer"
                                                onClick={() => toggleSelection(batch.id)}
                                            >
                                                <input 
                                                    type="checkbox" 
                                                    checked={selectedIds.has(batch.id)}
                                                    onChange={() => {}}
                                                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 pointer-events-none flex-shrink-0"
                                                />
                                                <div className="flex-grow min-w-0">
                                                    <div className="flex justify-between items-start">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <p className="font-semibold text-sm text-gray-800 truncate">{batch.supplier.name}</p>
                                                            {batch.status === 'draft' ? 
                                                                <span className="text-[10px] bg-orange-100 text-orange-600 px-1 rounded font-bold">작성중</span> : 
                                                                <span className="text-[10px] bg-green-100 text-green-600 px-1 rounded font-bold">완료</span>
                                                            }
                                                        </div>
                                                        <span className="text-xs text-gray-400 whitespace-nowrap">{new Date(batch.id).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                                    </div>
                                                    <div className="flex justify-between text-xs text-gray-500 mt-0.5">
                                                        <span>품목 {batch.itemCount}개</span>
                                                        <span className="font-mono">{batch.totalAmount.toLocaleString()}원</span>
                                                    </div>
                                                </div>
                                                <button 
                                                    onClick={(e) => handleDelete(e, batch)} 
                                                    className="p-2 text-gray-400 hover:text-red-600 rounded-full hover:bg-red-50 transition-colors"
                                                    title="클라우드에서 삭제"
                                                >
                                                    <TrashIcon className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                <div className="p-3 border-t bg-white grid grid-cols-2 gap-3">
                    <button onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-bold">취소</button>
                    <button 
                        onClick={handleConfirm} 
                        disabled={selectedIds.size === 0}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold disabled:bg-gray-300 flex items-center justify-center gap-2 transition-all active:scale-95"
                    >
                        <span>{selectedIds.size}건 불러오기</span>
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};


const ReceiveManagerPage: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const { customers, products, userQueries } = useDataState();
    const { openScanner } = useScanner();
    const { showAlert, showToast } = useAlert();
    const { sqlStatus } = useMiscUI();

    const [view, setView] = useState<View>('entry');
    const [batches, setBatches] = useState<ReceivingBatch[]>([]);
    const [draftCount, setDraftCount] = useState(0);

    // Initial state set to today's local date
    const [currentDate, setCurrentDate] = useState(getTodayString);
    const [selectedSupplier, setSelectedSupplier] = useState<Customer | null>(null);
    const [currentItems, setCurrentItems] = useState<ReceivingItem[]>([]);
    const [isSavingBatch, setIsSavingBatch] = useState(false);
    const [receiveModalProps, setReceiveModalProps] = useState<{ product: Product } | null>(null);
    
    // UI State for List View
    const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());
    
    // Cloud Load Modal State
    const [isCloudModalOpen, setIsCloudModalOpen] = useState(false);
    const [cloudBatches, setCloudBatches] = useState<ReceivingBatch[]>([]);
    const [isCloudLoading, setIsCloudLoading] = useState(false);

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
            
            const drafts = allBatches.filter(b => b.status === 'draft');
            const draftSuppliers = new Set(drafts.map(b => b.supplier.comcode));
            setDraftCount(draftSuppliers.size);
            
            // Auto-select all drafts initially
            const draftIds = drafts.map(b => b.id);
            if (draftIds.length > 0) {
                // Only select if not already manually modified (simple heuristic: if set is empty)
                setSelectedBatches(prev => prev.size === 0 ? new Set(draftIds) : prev);
            }
        } catch (e) {
            console.error("Failed to load batches", e);
        }
    }, []);

    useEffect(() => {
        if (isActive) {
            loadBatches();
        }
    }, [isActive, loadBatches]);

    useEffect(() => {
        if (view === 'list') {
            // Re-evaluate default selection when entering list view
            const drafts = batches.filter(b => b.status === 'draft');
            setSelectedBatches(new Set(drafts.map(b => b.id)));
        }
    }, [view, batches]);

    // Restore draft from local storage (if app was closed improperly)
    useEffect(() => {
        if (draft) {
            // Only restore if user hasn't explicitly started a new action
            if (!selectedSupplier && currentItems.length === 0) {
                setCurrentDate(draft.currentDate || getTodayString());
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
        setCurrentDate(getTodayString());
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
    // Also saves to Firebase for multi-device sync
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
            const itemsToSave = currentItems.map(item => ({ ...item, isNew: false }));
            const totalAmount = itemsToSave.reduce((sum, item) => sum + (item.costPrice || 0) * item.quantity, 0);
            
            const newBatch: ReceivingBatch = {
                id: Date.now(),
                date: currentDate,
                supplier: selectedSupplier,
                items: itemsToSave,
                itemCount: itemsToSave.length,
                totalAmount,
                status: 'draft',
            };

            // Save to Local DB
            await receiveDb.saveOrUpdateBatch(newBatch);
            
            // Save to Firebase (Cloud Backup/Sync)
            // Note: This does NOT send to SQL Server yet.
            try {
                await addReceivingBatch(newBatch);
            } catch (fbError) {
                console.warn("Firebase sync failed:", fbError);
            }

            if (sqlStatus === 'connected') {
                showToast('저장 완료 (서버 전송 대기)', 'success');
            } else {
                showToast('오프라인 저장 완료', 'success');
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
    
    const handleSupplierChange = async (supplier: Customer) => {
        setSelectedSupplier(supplier);
        const supplierDrafts = batches.filter(b => 
            b.supplier.comcode === supplier.comcode && b.status === 'draft'
        );

        if (supplierDrafts.length > 0) {
            const allItems = supplierDrafts.flatMap(b => b.items);
            const cleanItems = allItems.map(i => ({...i, isNew: false}));
            setCurrentItems(cleanItems);
            const latestDate = supplierDrafts.sort((a,b) => b.id - a.id)[0].date;
            setCurrentDate(latestDate);
            showToast(`${supplier.name}의 작성 중인 내역을 불러왔습니다.`, 'success');
        } else {
            setCurrentItems([]);
        }
    };

    // --- List View Logic ---

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
            showAlert('SQL 서버에 연결되어 있지 않아 전송할 수 없습니다.');
            return;
        }

        const batchesToSend = batches.filter(b => selectedBatches.has(b.id));
        const totalItems = batchesToSend.reduce((acc, b) => acc + b.itemCount, 0);
        const uniqueSuppliers = new Set(batchesToSend.map(b => b.supplier.name)).size;

        // Use a dynamic User Query named '입고등록'
        const insertQueryDef = userQueries.find(q => q.name === '입고등록');
        if (!insertQueryDef) {
            showAlert("설정 > SQL Runner에서 '입고등록' 쿼리를 추가해주세요.");
            return;
        }

        showAlert(
            `${uniqueSuppliers}개 거래처, 총 ${totalItems}개 품목을 서버(POS)로 전송하시겠습니까?`,
            async () => {
                setIsSending(true);
                let successCount = 0;
                let failCount = 0;

                try {
                    for (const batch of batchesToSend) {
                        try {
                            // 1. Send items one by one (or handled by backend logic if adapted)
                            for (const item of batch.items) {
                                const params = {
                                    date: batch.date,
                                    comcode: batch.supplier.comcode,
                                    barcode: item.barcode,
                                    qty: item.quantity,
                                    cost: item.costPrice,
                                    price: item.sellingPrice,
                                    item_name: item.name
                                };
                                // Execute SQL Insert with the Safe Query via User Query mechanism
                                const result = await executeUserQuery('입고등록', params, insertQueryDef.query);
                                
                                // DEBUG: Show result for 'Kwangdong Pharm' if requested by user
                                if (batch.supplier.name.includes("광동")) {
                                    alert(`광동제약 전송 결과: ${JSON.stringify(result)}`);
                                }
                            }

                            // 2. If all items in batch succeeded, update status
                            const updatedBatch = { ...batch, status: 'sent' as 'sent', sentAt: new Date().toISOString() };
                            
                            // Update Local
                            await receiveDb.saveOrUpdateBatch(updatedBatch);
                            
                            // Update Firebase (so other devices see it as sent)
                            await addReceivingBatch(updatedBatch);
                            
                            successCount++;

                        } catch (err: any) {
                            console.error(`Failed to send batch ${batch.id}`, err);
                            failCount++;
                            // Don't continue if a batch fails - stopping might be safer, or continue? 
                            // Let's alert and stop to prevent partial mess.
                            throw new Error(`'${batch.supplier.name}' 전송 중 오류: ${err.message}`);
                        }
                    }
                    showToast(`${successCount}건 전송 완료`, 'success');
                    setSelectedBatches(new Set()); // Clear selection
                    await loadBatches();
                } catch (e: any) {
                    showAlert(e.message || '전송 중 알 수 없는 오류가 발생했습니다.');
                } finally {
                    setIsSending(false);
                }
            },
            '전송 (SQL)'
        );
    };

    // --- Cloud Load Handlers ---

    const handleLoadFromCloud = async () => {
        // Just open the modal, do not fetch immediately (or modal will do initial fetch)
        setIsCloudModalOpen(true);
    };

    const handleCloudSearch = async (startDate: string, endDate: string) => {
        setIsCloudLoading(true);
        try {
            const remoteBatches = await getReceivingBatchesByDateRange(startDate, endDate);
            if (remoteBatches.length === 0) {
                showToast("해당 기간의 데이터가 없습니다.", 'error');
            }
            setCloudBatches(remoteBatches);
        } catch (e) {
            console.error(e);
            showAlert("데이터를 불러오는 데 실패했습니다.");
        } finally {
            setIsCloudLoading(false);
        }
    };

    const handleCloudLoadConfirm = async (selectedBatches: ReceivingBatch[]) => {
        if (selectedBatches.length === 0) {
            setIsCloudModalOpen(false);
            return;
        }

        try {
            // Save to local IndexedDB
            for (const batch of selectedBatches) {
                await receiveDb.saveOrUpdateBatch(batch);
            }
            
            await loadBatches();
            showToast(`${selectedBatches.length}건의 데이터를 불러왔습니다.`, 'success');
            setIsCloudModalOpen(false);
        } catch (e) {
            console.error(e);
            showAlert("데이터 저장 중 오류가 발생했습니다.");
        }
    };

    const handleCloudDelete = async (batch: ReceivingBatch) => {
        showAlert(
            `'${batch.supplier.name}' (${batch.date}) 내역을 클라우드에서 영구 삭제하시겠습니까?`,
            async () => {
                try {
                    await deleteReceivingBatch(batch.id);
                    setCloudBatches(prev => prev.filter(b => b.id !== batch.id));
                    showToast("삭제되었습니다.", 'success');
                } catch (e) {
                    console.error(e);
                    showToast("삭제 실패", 'error');
                }
            },
            "삭제",
            "bg-red-500 hover:bg-red-600 focus:ring-red-500"
        );
    };

    // --- Render ---

    if (view === 'list') {
        return (
            <div className="flex flex-col h-full bg-gray-50">
                <div className="bg-white p-2 border-b flex justify-between items-center shadow-sm z-10">
                    <h2 className="font-bold text-gray-800 ml-2">입고 목록</h2>
                    <button 
                        onClick={handleLoadFromCloud} 
                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-100 transition-colors"
                    >
                        <DatabaseIcon className="w-3 h-3" />
                        클라우드 불러오기
                    </button>
                </div>

                <div className="flex-grow overflow-y-auto p-2 space-y-2">
                    {groupedBatches.length === 0 ? (
                        <div className="text-center text-gray-400 pt-16">
                            <p className="font-semibold">저장된 입고 내역이 없습니다.</p>
                        </div>
                    ) : (
                        groupedBatches.map(({ supplier, drafts, sent }) => {
                            const hasDrafts = drafts.length > 0;
                            const isDraftSelected = drafts.length > 0 && drafts.every(d => selectedBatches.has(d.id));
                            const isExpanded = expandedSuppliers.has(supplier.comcode);
                            
                            const draftItemCount = drafts.reduce((sum, b) => sum + b.itemCount, 0);
                            const draftTotalAmount = drafts.reduce((sum, b) => sum + b.totalAmount, 0);

                            // Skip rendering if no drafts and not expanded (hide completed unless user digs)
                            if (!hasDrafts && sent.length > 0 && !isExpanded) {
                                return null; 
                            }

                            if (!hasDrafts && sent.length === 0) return null;

                            return (
                                <div key={supplier.comcode} className={`bg-white rounded-lg shadow-sm border overflow-hidden ${hasDrafts ? 'border-orange-200' : 'border-gray-200 opacity-75'}`}>
                                    {/* Header */}
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
                                                <div className="w-7"></div>
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
                                                    <p className="text-xs text-green-600 mt-0.5">전송 완료됨 ({sent.length}건)</p>
                                                )}
                                            </div>
                                        </div>
                                        <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                    </div>

                                    {/* Body */}
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
                                                <div className="space-y-1 mt-2">
                                                    <p className="text-xs font-bold text-gray-500 px-1">전송 완료 내역</p>
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
            <CloudLoadModal 
                isOpen={isCloudModalOpen}
                onClose={() => setIsCloudModalOpen(false)}
                onConfirm={handleCloudLoadConfirm}
                onDelete={handleCloudDelete}
                data={cloudBatches}
                onSearch={handleCloudSearch}
                isLoading={isCloudLoading}
            />
        </div>
    );
};

export default ReceiveManagerPage;
