
import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { useDataState, useAlert, useMiscUI, useScanner } from '../context/AppContext';
import { ReceivingBatch, ReceivingItem, Product, Customer, ReceivingDraft } from '../types';
import * as receiveDb from '../services/receiveDbService';
import { addReceivingBatch, listenToReceivingBatchChanges, deleteReceivingBatch } from '../services/dbService';
import { executeUserQuery } from '../services/sqlService';
import { 
    SpinnerIcon, CheckSquareIcon, TrashIcon, 
    BarcodeScannerIcon, CheckCircleIcon, 
    UndoIcon, PencilSquareIcon, ChevronDownIcon
} from '../components/Icons';
import ReceiveItemModal from '../components/ReceiveItemModal';
import SearchDropdown from '../components/SearchDropdown';
import { useProductSearch } from '../hooks/useProductSearch';
import { useDebounce } from '../hooks/useDebounce';
import { useSortedCustomers } from '../hooks/useSortedCustomers';
import { isSaleActive } from '../hooks/useOrderManager';
import ActionModal from '../components/ActionModal';
import { useDraft } from '../hooks/useDraft';
import ProductSearchBar from '../components/ProductSearchBar';

interface ReceiveManagerPageProps {
    isActive: boolean;
    onClose: () => void;
}

const DRAFT_KEY = 'receiving-new-draft';

const getLocalTodayString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ReceiveListItem = memo(({ item, index, onRemove, product }: { item: ReceivingItem, index: number, onRemove: (id: number) => void, product?: Product }) => {
    const saleIsActive = product ? isSaleActive(product.saleStartDate, product.saleEndDate) : false;

    return (
        <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex justify-between items-center animate-fade-in-up">
            <div className="flex-grow min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono border border-slate-200 flex-shrink-0">
                        #{index}
                    </span>
                    {saleIsActive && (
                        <span className="bg-rose-100 text-rose-600 text-[10px] font-extrabold px-1.5 py-0.5 rounded flex-shrink-0 whitespace-nowrap border border-rose-200">
                            행사중
                        </span>
                    )}
                    <p className="font-bold text-gray-800 text-base truncate">{item.name}</p>
                </div>
                <div className="text-sm text-gray-600 pl-1 flex items-center gap-2">
                    <span className="font-medium text-gray-400">{Number(item.costPrice).toLocaleString()}원</span>
                    <span className="text-gray-300">×</span>
                    <span className={`font-bold px-1.5 rounded ${item.quantity < 0 ? 'text-rose-600 bg-rose-50' : 'text-indigo-600 bg-indigo-50'}`}>{item.quantity}</span>
                    <span className="text-gray-300">=</span>
                    <span className={`font-bold ${item.quantity < 0 ? 'text-rose-600' : 'text-gray-800'}`}>{(item.costPrice * item.quantity).toLocaleString()}원</span>
                </div>
            </div>
            <button onClick={() => onRemove(item.uniqueId)} className="text-gray-400 hover:text-rose-500 p-2.5 rounded-full hover:bg-rose-50 transition-colors ml-1 flex-shrink-0">
                <TrashIcon className="w-5 h-5" />
            </button>
        </div>
    );
});
ReceiveListItem.displayName = 'ReceiveListItem';

const ReceiveManagerPage: React.FC<ReceiveManagerPageProps> = ({ isActive, onClose }) => {
    const { customers, products } = useDataState();
    const { showAlert, showToast } = useAlert();
    const { sqlStatus, checkSql } = useMiscUI();
    const { openScanner } = useScanner();
    
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [batches, setBatches] = useState<ReceivingBatch[]>([]);
    const [selectedBatches, setSelectedBatches] = useState<Set<number>>(new Set());
    const [expandedBatches, setExpandedBatches] = useState<Set<number>>(new Set());
    const [isSending, setIsSending] = useState(false);
    const [loading, setLoading] = useState(false);

    const [editingBatch, setEditingBatch] = useState<ReceivingBatch | null>(null);
    const [supplierSearch, setSupplierSearch] = useState('');
    const [selectedSupplier, setSelectedSupplier] = useState<Customer | null>(null);
    const [batchDate, setBatchDate] = useState(getLocalTodayString());
    const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
    const [currentItems, setCurrentItems] = useState<ReceivingItem[]>([]);
    
    const [addItemModalProps, setAddItemModalProps] = useState<{ 
        isOpen: boolean; 
        product: Product | null; 
        source: 'scan' | 'search'; 
        scanTimestamp?: number; 
    }>({ isOpen: false, product: null, source: 'search' });

    const { draft, isLoading: isDraftLoading, save: saveDraft, remove: removeDraft } = useDraft<ReceivingDraft>(DRAFT_KEY);

    const latestItemsRef = useRef(currentItems);
    const latestSupplierRef = useRef(selectedSupplier);
    const latestDateRef = useRef(batchDate);
    const editingBatchRef = useRef(editingBatch);
    
    const isProcessingScanRef = useRef(false);
    const navLock = useRef(false);

    useEffect(() => {
        latestItemsRef.current = currentItems;
        latestSupplierRef.current = selectedSupplier;
        latestDateRef.current = batchDate;
        editingBatchRef.current = editingBatch;
    }, [currentItems, selectedSupplier, batchDate, editingBatch]);

    const { 
        searchTerm: productSearch, 
        setSearchTerm: setProductSearch, 
        results: productSearchResults, 
        isSearching: isSearchingProducts, 
        search: searchProduct,
        searchByBarcode
    } = useProductSearch('productInquiry', 50, '상품조회');
    
    const debouncedProductSearch = useDebounce(productSearch, 300);
    const supplierSearchInputRef = useRef<HTMLInputElement>(null);
    const supplierSearchBlurTimeout = useRef<number | null>(null);
    const { sortedCustomers, recordUsage } = useSortedCustomers(customers);

    const openItemModal = (props: typeof addItemModalProps) => {
        if (navLock.current) return;
        navLock.current = true;
        setTimeout(() => { navLock.current = false; }, 500);

        if (window.history.state?.modal === 'receiveItem') {
            setAddItemModalProps({ ...props, scanTimestamp: Date.now() });
            return;
        }
        window.history.pushState({ modal: 'receiveItem' }, '', '');
        setAddItemModalProps({ ...props, scanTimestamp: Date.now() });
    };

    const closeItemModal = () => {
        isProcessingScanRef.current = false;

        if (window.history.state?.modal === 'receiveItem') {
            window.history.back();
        } else {
            setAddItemModalProps(prev => ({ ...prev, isOpen: false }));
        }
    };

    useEffect(() => {
        const handlePopState = (event: PopStateEvent) => {
            const modal = event.state?.modal;
            if (addItemModalProps.isOpen && modal !== 'receiveItem') {
                closeItemModal(); 
            } else if (isEditorOpen && modal !== 'receiveEditor' && modal !== 'receiveItem') {
                setIsEditorOpen(false);
            }
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [addItemModalProps.isOpen, isEditorOpen]);

    const openEditor = () => {
        if (navLock.current) return;
        navLock.current = true;
        setTimeout(() => { navLock.current = false; }, 500);

        if (window.history.state?.modal === 'receiveEditor') {
            setIsEditorOpen(true);
            return;
        }
        window.history.pushState({ modal: 'receiveEditor' }, '', '');
        setIsEditorOpen(true);
    };

    const closeEditor = () => {
        if (window.history.state?.modal === 'receiveEditor') {
            window.history.back();
        } else {
            setIsEditorOpen(false);
        }
    };

    useEffect(() => {
        if (isEditorOpen && !isDraftLoading && !editingBatch) {
            const hasData = selectedSupplier || (currentItems && currentItems.length > 0);
            if (hasData) {
                saveDraft({
                    currentDate: batchDate,
                    selectedSupplier: selectedSupplier,
                    items: currentItems
                });
            }
        }
    }, [isEditorOpen, isDraftLoading, editingBatch, selectedSupplier, currentItems, batchDate, saveDraft]);

    const refreshLocalBatches = useCallback(async (silent = false) => {
        if (!silent) setLoading(prev => batches.length === 0 ? true : prev);
        try {
            const localBatches = await receiveDb.getAllBatches();
            setBatches(localBatches);
        } catch (e) {
            console.error("Failed to load batches", e);
        } finally {
            if (!silent) setLoading(false);
        }
    }, [batches.length]);

    useEffect(() => {
        if (!isActive) return;
        refreshLocalBatches();
        const unsubscribe = listenToReceivingBatchChanges({
            onAdd: async (remoteBatch) => {
                if (remoteBatch.status === 'sent') await receiveDb.deleteBatch(remoteBatch.id);
                else await receiveDb.saveOrUpdateBatch(remoteBatch);
                refreshLocalBatches(true);
            },
            onChange: async (remoteBatch) => {
                if (remoteBatch.status === 'sent') await receiveDb.deleteBatch(remoteBatch.id);
                else await receiveDb.saveOrUpdateBatch(remoteBatch);
                refreshLocalBatches(true);
            },
            onRemove: async (batchId) => {
                await receiveDb.deleteBatch(Number(batchId));
                refreshLocalBatches(true);
            }
        });
        return () => unsubscribe();
    }, [isActive, refreshLocalBatches]);

    useEffect(() => {
        const term = debouncedProductSearch.trim();
        if (term.length >= 2) {
            searchProduct(term);
        } else if (term.length === 0) {
            searchProduct('');
        }
    }, [debouncedProductSearch, searchProduct]);

    const handleSend = async () => {
        if (isSending) return;
        if (selectedBatches.size === 0) {
            showAlert('전송할 거래처(내역)를 선택해주세요.');
            return;
        }
        if (sqlStatus !== 'connected') {
            const connected = await checkSql();
            if (!connected) {
                showAlert('SQL 서버에 연결되어 있지 않아 전송할 수 없습니다.');
                return;
            }
        }
        executeBatchSend();
    };

    const executeBatchSend = async () => {
        const batchesToSend = batches.filter(b => selectedBatches.has(b.id));
        setIsSending(true);
        const results = { success: 0, fail: 0 };
        const successIds: number[] = [];
        
        const insertQuery = `INSERT INTO dbo.dt900_ipgo (day1, dtcomcode, comcode, comname, barcode, descr, money0vat, money1, itemcount, gubun, lstmoney0vat) SELECT @time, @dtcomcode, @dtcomcode, LEFT(@comname, 10), @barcode, LEFT(ISNULL(@item_name, ''), 30), @cost, @price, @qty, CASE WHEN CAST(@qty AS INT) >= 0 THEN 'I' ELSE 'B' END, ISNULL(p.money0vat, 0) FROM (SELECT 1 AS dummy) AS t LEFT JOIN dbo.parts AS p WITH (NOLOCK) ON p.barcode = @barcode`;
        
        const now = new Date();
        const unifiedTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:00`; 

        for (const batch of batchesToSend) {
            let sqlSuccess = true;
            let sentItemIds = new Set<number>();
            try {
                for (const item of batch.items) {
                    const params = {
                        time: `${batch.date} ${unifiedTime}`,
                        dtcomcode: batch.supplier.comcode ? batch.supplier.comcode.substring(0, 5) : '',
                        comname: batch.supplier.name ? batch.supplier.name.substring(0, 6) : '',
                        barcode: item.barcode ? item.barcode.substring(0, 14) : '',
                        qty: Number(item.quantity), 
                        cost: Number(item.costPrice), 
                        price: Number(item.sellingPrice),
                        item_name: item.name ? item.name.substring(0, 15) : ''
                    };
                    try {
                        await executeUserQuery('입고등록_Direct', params, insertQuery);
                        sentItemIds.add(item.uniqueId);
                    } catch (itemErr: any) { 
                        console.error(`Item send failed: ${item.name}`, itemErr);
                        sqlSuccess = false; 
                        break; 
                    }
                }
            } catch (err: any) { 
                console.error(`Batch send failed: ${batch.supplier.name}`, err);
                sqlSuccess = false; 
            }

            if (sqlSuccess) {
                successIds.push(batch.id);
                results.success++;
                try {
                    const updatedBatch: ReceivingBatch = { ...batch, status: 'sent', sentAt: new Date().toISOString() };
                    await addReceivingBatch(updatedBatch);
                } catch (fbErr) { 
                    console.warn('Firebase backup failed after SQL success', fbErr);
                }
            } else {
                if (sentItemIds.size > 0) {
                    const remainingItems = batch.items.filter(item => !sentItemIds.has(item.uniqueId));
                    if (remainingItems.length < batch.items.length) {
                        const updatedBatch = { ...batch, items: remainingItems, itemCount: remainingItems.length };
                        await receiveDb.saveOrUpdateBatch(updatedBatch);
                    }
                }
                results.fail++;
            }
        }
        
        for(const id of successIds) { await receiveDb.deleteBatch(id); }
        setBatches(prev => prev.filter(b => !successIds.includes(b.id)));
        setSelectedBatches(prev => { 
            const next = new Set(prev); 
            successIds.forEach(id => next.delete(id)); 
            return next; 
        });
        setIsSending(false);
        refreshLocalBatches(true);
        
        if (results.fail > 0) showAlert(`전송 결과:\n성공 ${results.success}건 / 실패 ${results.fail}건\n네트워크 또는 SQL 서버 상태를 확인하세요.`);
        else showToast(`${results.success}건 전송 완료`, 'success');
    };

    const toggleSelectBatch = (id: number) => {
        const newSet = new Set(selectedBatches);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedBatches(newSet);
    };

    const toggleAccordion = (id: number) => {
        const newSet = new Set(expandedBatches);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setExpandedBatches(newSet);
    };

    const handleDeleteSelected = () => {
        if (selectedBatches.size === 0) return;
        showAlert(
            `선택한 ${selectedBatches.size}건의 입고 내역을 삭제하시겠습니까?`,
            async () => {
                try {
                    for (const id of selectedBatches) {
                        await receiveDb.deleteBatch(id);
                        try { await deleteReceivingBatch(id); } catch (e) {}
                    }
                    showToast('삭제되었습니다.', 'success');
                    setSelectedBatches(new Set());
                    setBatches(prev => prev.filter(b => !selectedBatches.has(b.id)));
                } catch(e) { showAlert('삭제 중 오류가 발생했습니다.'); }
            },
            '삭제', 'bg-rose-600'
        );
    };

    const hasDraft = useMemo(() => !isDraftLoading && draft && ((draft.items && draft.items.length > 0) || !!draft.selectedSupplier), [draft, isDraftLoading]);

    const setupNewBatchState = () => {
        setEditingBatch(null); setSelectedSupplier(null); setSupplierSearch('');
        setBatchDate(getLocalTodayString()); setCurrentItems([]);
    };

    const handleResumeDraft = () => {
        if (!draft) return;
        setEditingBatch(null); setSelectedSupplier(draft.selectedSupplier);
        setSupplierSearch(draft.selectedSupplier ? draft.selectedSupplier.name : '');
        setBatchDate(draft.currentDate || getLocalTodayString());
        setCurrentItems(draft.items || []);
        showToast("작성 중이던 내용을 불러왔습니다.", "success");
        openEditor();
    };

    const startNewBatch = () => { setupNewBatchState(); openEditor(); };
    const editBatch = (batch: ReceivingBatch) => {
        setEditingBatch(batch); setSelectedSupplier(batch.supplier);
        setSupplierSearch(batch.supplier.name); setBatchDate(batch.date);
        setCurrentItems(batch.items || []); openEditor();
    };

    const filteredSuppliers = useMemo(() => {
        const term = supplierSearch.toLowerCase();
        if (!term) return sortedCustomers.slice(0, 50); 
        return sortedCustomers.filter(c => 
            c.name.toLowerCase().includes(term) || c.comcode.includes(term)
        ).slice(0, 50);
    }, [sortedCustomers, supplierSearch]);

    const handleSelectSupplier = (customer: Customer) => {
        setSelectedSupplier(customer); 
        setSupplierSearch(customer.name); 
        setShowSupplierDropdown(false); 
        recordUsage(customer.comcode);
        
        if (!editingBatch) {
            saveDraft({
                currentDate: batchDate,
                selectedSupplier: customer,
                items: currentItems
            });
        }

        setTimeout(() => {
            const productInput = document.querySelector('input[placeholder*="품목명"]') as HTMLInputElement;
            if (productInput) productInput.focus();
        }, 150);
    };

    const handleClearSupplier = () => {
        setSelectedSupplier(null); 
        setSupplierSearch(''); 
        requestAnimationFrame(() => supplierSearchInputRef.current?.focus());
        
        if (!editingBatch) {
            saveDraft({
                currentDate: batchDate,
                selectedSupplier: null,
                items: currentItems
            });
        }
    };

    const handleAddItem = useCallback((itemData: Omit<ReceivingItem, 'uniqueId'>) => {
        setCurrentItems(prev => {
            // [원복] 중복 합산 로직을 삭제하고 항상 새로운 항목으로 추가합니다.
            const newItem: ReceivingItem = { ...itemData, uniqueId: Date.now() + Math.random() };
            const updatedItems = [...prev, newItem];

            if (!editingBatchRef.current) {
                saveDraft({
                    currentDate: latestDateRef.current,
                    selectedSupplier: latestSupplierRef.current,
                    items: updatedItems
                });
            }
            return updatedItems;
        });
        
        setProductSearch('');
        isProcessingScanRef.current = false;
    }, [saveDraft, setProductSearch]); 

    const handleRemoveItem = useCallback((uniqueId: number) => {
        setCurrentItems(prev => {
            const updatedItems = prev.filter(i => i.uniqueId !== uniqueId);
            if (!editingBatchRef.current) {
                saveDraft({
                    currentDate: latestDateRef.current,
                    selectedSupplier: latestSupplierRef.current,
                    items: updatedItems
                });
            }
            return updatedItems;
        });
    }, [saveDraft]);

    const handleSaveBatch = async () => {
        if (!selectedSupplier) { showAlert('거래처를 선택해주세요.'); return; }
        if (currentItems.length === 0) { showAlert('입고할 품목이 없습니다.'); return; }
        const totalAmount = currentItems.reduce((sum, item) => sum + (item.costPrice * item.quantity), 0);
        const batchToSave: ReceivingBatch = {
            id: editingBatch ? editingBatch.id : Date.now(),
            date: batchDate, supplier: selectedSupplier, items: currentItems,
            itemCount: currentItems.length, totalAmount,
            status: editingBatch ? editingBatch.status : 'draft',
            sentAt: editingBatch?.sentAt
        };
        try {
            await receiveDb.saveOrUpdateBatch(batchToSave);
            try { await addReceivingBatch(batchToSave); } catch (e) {}
            if (!editingBatch) removeDraft();
            showToast('저장되었습니다.', 'success');
            closeEditor();
            setTimeout(() => refreshLocalBatches(true), 50);
        } catch (e: any) { showAlert(`저장에 실패했습니다. (${e.message})`); }
    };

    const handleClearForm = () => {
        showAlert("작성 중인 내용을 모두 지우시겠습니까?", () => {
            setSelectedSupplier(null); setSupplierSearch(''); setCurrentItems([]); removeDraft(); showToast("초기화되었습니다.", 'success');
        }, "초기화", "bg-rose-500 hover:bg-rose-500");
    };

    const onScanDetected = async (code: string) => {
        if (isProcessingScanRef.current) return;
        isProcessingScanRef.current = true;

        try {
            // [수정] searchByBarcode를 사용하여 온라인 우선 검색 (행사 정보 확보용)
            let product = await searchByBarcode(code);
            
            if (product) {
                openItemModal({ isOpen: true, product, source: 'scan' });
            } else {
                const unregisteredProduct: Product = { barcode: code, name: '', costPrice: 0, sellingPrice: 0, spec: '' };
                openItemModal({ isOpen: true, product: unregisteredProduct, source: 'scan' });
                showToast('미등록 상품입니다. 정보를 입력하세요.', 'success');
            }
        } catch (error) {
            isProcessingScanRef.current = false;
            console.error("Error processing scan:", error);
            showToast("상품을 처리하는 중 오류가 발생했습니다.", 'error');
        }
    };

    const handleScanButtonClick = () => {
        openScanner('modal', onScanDetected, { continuous: true });
    };

    const currentTotalAmount = currentItems.reduce((sum, i) => sum + (i.costPrice * i.quantity), 0);
    const isUnregisteredBarcode = productSearchResults.length === 0 && /^\d{7,}$/.test(debouncedProductSearch);
    const reversedItems = useMemo(() => currentItems.slice().reverse(), [currentItems]);

    return (
        <>
            <div className="flex flex-col h-full bg-white">
                <div className="bg-white p-3 border-b flex justify-between items-center shadow-sm z-10">
                    <div className="flex gap-2">
                        <button 
                            onClick={() => {
                                if (selectedBatches.size === batches.length) setSelectedBatches(new Set());
                                else setSelectedBatches(new Set(batches.map(b => b.id)));
                            }}
                            className="text-sm font-bold text-gray-600 flex items-center gap-1 hover:bg-gray-100 px-2 py-1 rounded-lg transition-colors"
                        >
                            <CheckSquareIcon className="w-5 h-5" /> 전체
                        </button>
                        {selectedBatches.size > 0 && (
                            <button onClick={handleDeleteSelected} className="text-sm font-bold text-rose-600 flex items-center gap-1 hover:bg-rose-50 px-2 py-1 rounded-lg transition-colors">
                                <TrashIcon className="w-5 h-5" /> 삭제({selectedBatches.size})
                            </button>
                        )}
                        <button onClick={() => refreshLocalBatches(false)} className="text-sm font-bold text-gray-500 flex items-center gap-1 hover:text-indigo-600 hover:bg-gray-100 px-2 py-1 rounded-lg transition-colors">
                            <UndoIcon className="w-4 h-4" /> 새로고침
                        </button>
                    </div>
                    
                    <div className="flex gap-2">
                        {hasDraft ? (
                             <button onClick={handleResumeDraft} className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-md active:scale-95 hover:bg-amber-700 transition-colors flex items-center gap-2 animate-fade-in-up">
                                <PencilSquareIcon className="w-4 h-4" />
                                <span className="hidden sm:inline">이어서 작성</span>
                                <span className="sm:hidden">이어서</span>
                            </button>
                        ) : (
                            <button onClick={startNewBatch} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-md active:scale-95 hover:bg-indigo-700 transition-colors">
                                + 신규 등록
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex-grow overflow-y-auto">
                    {loading && batches.length === 0 ? (
                        <div className="flex justify-center items-center h-40"><SpinnerIcon className="w-8 h-8 text-indigo-500" /></div>
                    ) : batches.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                            <p className="text-lg font-semibold">입고 내역이 없습니다</p>
                            <p className="text-sm mt-1">신규 등록하거나 설정에서 백업을 불러오세요.</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-100">
                            {batches.map(batch => {
                                const isExpanded = expandedBatches.has(batch.id);
                                const isSelected = selectedBatches.has(batch.id);
                                return (
                                    <div key={batch.id} className={`transition-colors duration-200 ${isSelected ? 'bg-indigo-50' : 'bg-white'}`}>
                                        <div className="flex items-stretch min-h-[3.5rem]">
                                            <div onClick={() => toggleSelectBatch(batch.id)} className="w-12 flex items-center justify-center cursor-pointer active:bg-gray-100 transition-colors">
                                                {isSelected ? <CheckCircleIcon className="w-6 h-6 text-indigo-600" /> : <div className="w-5 h-5 rounded-full border-2 border-gray-300"></div>}
                                            </div>
                                            <div onClick={() => toggleAccordion(batch.id)} className="flex-grow flex flex-col justify-center py-3 pr-4 pl-1 cursor-pointer active:bg-gray-50 transition-colors min-w-0">
                                                <div className="flex justify-between items-center mb-1">
                                                    <h3 className="font-bold text-gray-800 text-base truncate pr-2">{batch.supplier.name}</h3>
                                                    <div className="flex items-center gap-2 flex-shrink-0">
                                                        {batch.status === 'draft' && <span className="text-[10px] text-amber-600 font-bold border border-amber-200 bg-amber-50 px-1 rounded">미전송</span>}
                                                        <span className={`text-[10px] font-bold ${batch.status === 'sent' ? 'text-emerald-600' : 'text-gray-400'}`}>{batch.status === 'sent' ? '전송됨' : '작성중'}</span>
                                                        <ChevronDownIcon className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between text-xs text-gray-500">
                                                    <div className="flex items-center gap-3">
                                                        <span className="font-medium text-gray-500">{batch.date}</span>
                                                        <span><strong className="text-gray-700">{batch.itemCount}</strong> 품목</span>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <span className={`font-bold text-sm ${batch.totalAmount < 0 ? 'text-rose-600' : 'text-gray-800'}`}>{batch.totalAmount.toLocaleString()}</span>
                                                        <span className="text-xs text-gray-500 font-normal">원</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="w-12 flex items-center justify-center">
                                                <button onClick={(e) => { e.stopPropagation(); editBatch(batch); }} className="p-2 text-gray-400 hover:text-indigo-600 active:bg-gray-100 rounded-full transition-all"><PencilSquareIcon className="w-5 h-5" /></button>
                                            </div>
                                        </div>
                                        <div className={`transition-all duration-300 ease-in-out overflow-hidden bg-slate-50 ${isExpanded ? 'max-h-96 opacity-100 border-t border-gray-100' : 'max-h-0 opacity-0'}`}>
                                            <div className="pl-12 pr-4 py-2 space-y-1">
                                                {batch.items.slice(0, 5).map((item, idx) => (
                                                    <div key={idx} className="flex justify-between items-center text-sm py-1 border-b border-gray-200 last:border-0">
                                                        <span className="truncate font-medium text-gray-600 flex-1 pr-2">{item.name}</span>
                                                        <div className={`flex items-center gap-3 flex-shrink-0 text-xs ${item.quantity < 0 ? 'text-rose-500 font-bold' : 'text-gray-500'}`}>
                                                            <span>{item.quantity}</span>
                                                            <span className="w-16 text-right font-mono text-gray-500">{item.costPrice.toLocaleString()}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                                {batch.items.length > 5 && <div className="text-center py-2 text-xs text-gray-400">...외 {batch.items.length - 5}개</div>}
                                                {batch.items.length === 0 && <div className="text-center py-2 text-xs text-gray-400">품목 없음</div>}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
                {selectedBatches.size > 0 && (
                    <div className="p-3 bg-white border-t safe-area-pb shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-20">
                        <button onClick={handleSend} disabled={isSending} className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-bold text-lg shadow-lg active:scale-95 disabled:bg-gray-400 flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors">
                            {isSending ? <SpinnerIcon className="w-5 h-5 animate-spin" /> : <CheckCircleIcon className="w-6 h-6" />}
                            {selectedBatches.size}건 전송하기
                        </button>
                    </div>
                )}
            </div>

            <ActionModal
                isOpen={isEditorOpen}
                onClose={closeEditor}
                title={editingBatch ? "입고 수정" : "신규 입고"}
                disableBodyScroll
                zIndexClass="z-[50]"
                headerActions={(!editingBatch && (currentItems.length > 0 || selectedSupplier)) ? <button onClick={handleClearForm} className="text-xs text-rose-500 font-bold px-2 py-1 bg-rose-50 rounded hover:bg-rose-100">초기화</button> : undefined}
            >
                <div className="flex flex-col h-full bg-white">
                    {isSearchingProducts && <div className="absolute top-0 left-0 w-full h-1 bg-indigo-100 z-[60] overflow-hidden"><div className="h-full bg-indigo-600 animate-[indeterminate_1.5s_infinite_linear] origin-left"></div></div>}
                    <div className="p-3 flex-shrink-0 bg-white shadow-sm z-10 border-b border-gray-100 relative flex flex-col">
                        <div className="flex gap-2 z-50">
                            <div className="relative flex-shrink-0">
                                <input 
                                    type="date" 
                                    value={batchDate} 
                                    onChange={e => { 
                                        setBatchDate(e.target.value); 
                                        if(!editingBatchRef.current) saveDraft({ currentDate: e.target.value, selectedSupplier, items: currentItems }); 
                                    }} 
                                    className="h-11 px-2 border border-gray-300 rounded-xl text-sm font-bold text-gray-700 bg-white shadow-sm focus:ring-2 focus:ring-indigo-500 w-[115px]"
                                />
                            </div>

                            <div className="relative flex-grow">
                                <input 
                                    ref={supplierSearchInputRef} 
                                    type="text" 
                                    value={supplierSearch} 
                                    onChange={e => { setSupplierSearch(e.target.value); setShowSupplierDropdown(true); }} 
                                    onFocus={() => {
                                        if(supplierSearchBlurTimeout.current) clearTimeout(supplierSearchBlurTimeout.current);
                                        setShowSupplierDropdown(true);
                                    }} 
                                    onBlur={() => {
                                        supplierSearchBlurTimeout.current = window.setTimeout(() => setShowSupplierDropdown(false), 200);
                                    }}
                                    placeholder="거래처 검색 (선택)" 
                                    readOnly={!!selectedSupplier} 
                                    className={`w-full h-11 px-4 border rounded-xl text-base transition-all shadow-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${selectedSupplier ? 'bg-indigo-50 border-indigo-500 text-indigo-800 font-bold pr-20' : 'border-gray-300 bg-white font-medium'}`} 
                                />
                                {selectedSupplier && <button onClick={handleClearSupplier} className="absolute top-1/2 right-2 -translate-y-1/2 h-7 px-2.5 rounded-md flex items-center justify-center gap-1 font-semibold transition bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 active:scale-95 text-xs">변경</button>}
                                <SearchDropdown<Customer> items={filteredSuppliers} show={showSupplierDropdown && !selectedSupplier} renderItem={c => <div onMouseDown={() => handleSelectSupplier(c)} className="p-3 hover:bg-gray-50 cursor-pointer border-b last:border-b-0"><p className="font-bold text-gray-800">{c.name}</p><p className="text-xs text-gray-500 mt-0.5">{c.comcode}</p></div>} />
                            </div>
                        </div>
                        
                        <div className={`transition-all duration-300 ease-in-out ${selectedSupplier ? 'max-h-24 opacity-100 mt-3' : 'max-h-0 opacity-0 mt-0'}`}>
                            <div className="flex gap-2">
                                <div className="relative flex-grow z-40">
                                    <ProductSearchBar id="receive-manager-search" searchTerm={productSearch} onSearchTermChange={setProductSearch} isSearching={isSearchingProducts} results={productSearchResults} onSelectProduct={(p) => { openItemModal({ isOpen: true, product: p, source: 'search' }); }} onScan={handleScanButtonClick} isBoxUnit={false} onBoxUnitChange={() => {}} placeholder="품목 검색 (상품조회)" showBoxToggle={false} />
                                    {isUnregisteredBarcode && <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-rose-200 rounded-lg shadow-lg z-50"><div onMouseDown={(e) => { e.preventDefault(); const unregisteredProduct: Product = { barcode: debouncedProductSearch, name: '', costPrice: 0, sellingPrice: 0, spec: '', }; openItemModal({ isOpen: true, product: unregisteredProduct, source: 'search' }); }} className="p-4 hover:bg-rose-50 cursor-pointer flex items-center justify-center gap-2 group"><div className="bg-rose-100 p-1.5 rounded-full"><BarcodeScannerIcon className="w-5 h-5 text-rose-600" /></div><div className="text-left"><p className="text-sm font-bold text-rose-600">'{debouncedProductSearch}' 미등록 입고</p><p className="text-xs text-rose-400">터치하여 상품 정보 입력 후 입고</p></div></div></div>}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="flex-grow overflow-y-auto p-3 bg-slate-50">
                        {currentItems.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-3">
                                <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center"><BarcodeScannerIcon className="w-8 h-8 text-gray-400" /></div>
                                <div className="text-center"><p className="font-bold text-gray-500">목록이 비어있습니다</p><p className="text-sm mt-1">입고할 상품을 스캔하거나 검색하세요.</p></div>
                            </div>
                        ) : (
                            <div className="space-y-3 pb-20">
                                {reversedItems.map((item, idx) => {
                                    const product = products.find(p => p.barcode === item.barcode);
                                    return <ReceiveListItem key={item.uniqueId} item={item} index={currentItems.length - idx} onRemove={handleRemoveItem} product={product} />;
                                })}
                            </div>
                        )}
                    </div>
                    <div className="p-3 border-t bg-white safe-area-pb shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-20">
                        <div className="justify-between flex items-center mb-3 px-1">
                            <span className="text-sm font-bold text-gray-500">총 {currentItems.length}건</span>
                            <div className="flex items-end gap-1"><span className={`text-lg font-bold tracking-tight ${currentTotalAmount < 0 ? 'text-rose-600' : 'text-indigo-600'}`}>{currentTotalAmount.toLocaleString()}</span><span className="text-sm font-bold text-gray-600 mb-0.5">원</span></div>
                        </div>
                        <button onClick={handleSaveBatch} className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-bold text-lg shadow-lg active:scale-95 hover:bg-indigo-700 transition-colors">저장하기</button>
                    </div>
                </div>
            </ActionModal>

            {addItemModalProps.isOpen && (
                <ReceiveItemModal
                    key={`receive-${addItemModalProps.product?.barcode}-${addItemModalProps.scanTimestamp || Date.now()}`}
                    isOpen={true}
                    product={addItemModalProps.product}
                    currentItems={currentItems}
                    onClose={closeItemModal}
                    onAdd={handleAddItem}
                    onScanNext={addItemModalProps.source === 'scan' ? () => {} : undefined}
                    timestamp={addItemModalProps.scanTimestamp}
                />
            )}
        </>
    );
};

export default ReceiveManagerPage;
