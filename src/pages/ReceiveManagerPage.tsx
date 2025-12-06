
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDataState, useAlert, useMiscUI, useScanner, useModals } from '../context/AppContext';
import { ReceivingBatch, ReceivingItem, Product, Customer } from '../types';
import * as receiveDb from '../services/receiveDbService';
import { addReceivingBatch, getReceivingBatchesByDateRange } from '../services/dbService';
import { executeUserQuery } from '../services/sqlService';
import { 
    SpinnerIcon, CheckSquareIcon, CancelSquareIcon, TrashIcon, 
    BarcodeScannerIcon, ChevronLeftIcon, CheckCircleIcon, SearchIcon,
    CloudArrowDownIcon
} from '../components/Icons';
import ReceiveItemModal from '../components/ReceiveItemModal';
import ProductSearchResultItem from '../context/ProductSearchResultItem';
import SearchDropdown from '../components/SearchDropdown';
import { useProductSearch } from '../hooks/useProductSearch';
import { useDebounce } from '../hooks/useDebounce';
import ActionModal from '../components/ActionModal';

const ReceiveManagerPage: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    // Contexts
    const { customers, products } = useDataState();
    const { showAlert, showToast } = useAlert();
    const { sqlStatus } = useMiscUI();
    const { openScanner } = useScanner();

    // Mode: 'list' | 'edit'
    const [mode, setMode] = useState<'list' | 'edit'>('list');
    
    // List Mode State
    const [batches, setBatches] = useState<ReceivingBatch[]>([]);
    const [selectedBatches, setSelectedBatches] = useState<Set<number>>(new Set());
    const [isSending, setIsSending] = useState(false);
    const [loading, setLoading] = useState(false);

    // Edit Mode State
    const [editingBatch, setEditingBatch] = useState<ReceivingBatch | null>(null);
    // For new batch creation
    const [supplierSearch, setSupplierSearch] = useState('');
    const [selectedSupplier, setSelectedSupplier] = useState<Customer | null>(null);
    const [batchDate, setBatchDate] = useState(new Date().toISOString().slice(0, 10));
    const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
    
    // Items editing
    const [currentItems, setCurrentItems] = useState<ReceivingItem[]>([]);
    const [addItemModalProps, setAddItemModalProps] = useState<{ 
        isOpen: boolean; 
        product: Product | null;
        source: 'scan' | 'search'; // 'scan' | 'search' to toggle buttons
    }>({ isOpen: false, product: null, source: 'search' });

    // Firebase Load Modal State
    const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
    const [loadDate, setLoadDate] = useState(new Date().toISOString().slice(0, 10));
    const [remoteBatches, setRemoteBatches] = useState<ReceivingBatch[]>([]);
    const [isLoadingRemote, setIsLoadingRemote] = useState(false);
    const [selectedRemoteBatches, setSelectedRemoteBatches] = useState<Set<number>>(new Set());

    // Search for adding items
    const { searchTerm: productSearch, setSearchTerm: setProductSearch, results: productSearchResults, search: searchProduct } = useProductSearch('newOrder');
    const debouncedProductSearch = useDebounce(productSearch, 300);
    const [showProductDropdown, setShowProductDropdown] = useState(false);
    const productSearchInputRef = useRef<HTMLInputElement>(null);

    // Load batches on mount or active
    const loadBatches = useCallback(async () => {
        setLoading(true);
        try {
            const data = await receiveDb.getAllBatches();
            setBatches(data);
        } catch (e) {
            console.error(e);
            showToast('입고 내역을 불러오는데 실패했습니다.', 'error');
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        if (isActive && mode === 'list') {
            loadBatches();
        }
    }, [isActive, mode, loadBatches]);

    useEffect(() => {
        searchProduct(debouncedProductSearch);
    }, [debouncedProductSearch, searchProduct]);

    // Handle Send
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

        showAlert(
            `${uniqueSuppliers}개 거래처, 총 ${totalItems}개 품목을 서버(POS)로 전송하시겠습니까?`,
            async () => {
                setIsSending(true);
                let successCount = 0;
                let failCount = 0;

                // User-provided SQL for Receiving Registration
                // Uses device inputs for cost/price/dtcomcode/comcode and parts table for lstmoney0vat
                const safeInsertQuery = `
                    ; INSERT INTO dbo.dt900_ipgo (
                        day1, dtcomcode, comcode, comname, barcode, descr, 
                        money0vat, money1, itemcount, gubun, lstmoney0vat
                    )
                    SELECT
                        LEFT(@date + ':' + @time, 20),
                        LEFT(@dtcomcode, 10),
                        LEFT(@dtcomcode, 10), -- comcode gets same value as dtcomcode
                        LEFT(@comname, 20),   -- comname from device selection
                        LEFT(@barcode, 20),
                        LEFT(ISNULL(@item_name, ISNULL(p.descr, '')), 30),
                        @cost, 
                        @price, 
                        @qty,
                        CASE WHEN CAST(@qty AS INT) >= 0 THEN 'I' ELSE 'B' END,
                        ISNULL(p.money0vat, 0)
                    FROM (SELECT 1 AS dummy) AS t
                    LEFT JOIN dbo.parts AS p WITH (NOLOCK) ON p.barcode = @barcode
                `;

                try {
                    // Generate one unified timestamp for the entire batch transmission
                    const now = new Date();
                    const hh = now.getHours().toString().padStart(2, '0');
                    const mm = now.getMinutes().toString().padStart(2, '0');
                    const ss = now.getSeconds().toString().padStart(2, '0');
                    const unifiedTime = `${hh}:${mm}:${ss}`;

                    for (const batch of batchesToSend) {
                        try {
                            for (const item of batch.items) {
                                const params = {
                                    date: batch.date,
                                    time: unifiedTime,
                                    dtcomcode: batch.supplier.comcode, // dtcomcode (selected supplier)
                                    comname: batch.supplier.name,      // comname (selected supplier name)
                                    barcode: item.barcode,
                                    qty: item.quantity,
                                    cost: item.costPrice, // Device input cost
                                    price: item.sellingPrice, // Device input price
                                    item_name: item.name
                                };
                                
                                await executeUserQuery('입고등록_Direct', params, safeInsertQuery);
                            }

                            // 1. Update Firebase first to keep history (mark as sent)
                            const updatedBatch: ReceivingBatch = { ...batch, status: 'sent', sentAt: new Date().toISOString() };
                            await addReceivingBatch(updatedBatch);
                            
                            // 2. Delete from Local App Storage upon success
                            await receiveDb.deleteBatch(batch.id);
                            
                            successCount++;

                        } catch (err: any) {
                            console.error(`Failed to send batch ${batch.id}`, err);
                            failCount++;
                            throw new Error(`'${batch.supplier.name}' 전송 중 오류: ${err.message}`);
                        }
                    }
                    showToast(`${successCount}건 전송 완료 (앱에서 삭제됨)`, 'success');
                    setSelectedBatches(new Set());
                    await loadBatches();
                } catch (e: any) {
                    showAlert(e.message || '전송 중 알 수 없는 오류가 발생했습니다.');
                } finally {
                    setIsSending(false);
                }
            },
            '전송 (SQL)',
            'bg-blue-600 hover:bg-blue-700'
        );
    };

    // Firebase Load Handlers
    const handleFetchRemoteBatches = async () => {
        setIsLoadingRemote(true);
        setRemoteBatches([]);
        setSelectedRemoteBatches(new Set());
        try {
            const data = await getReceivingBatchesByDateRange(loadDate, loadDate);
            setRemoteBatches(data);
            if (data.length === 0) {
                showToast('해당 날짜에 저장된 입고 내역이 없습니다.', 'error');
            }
        } catch (e) {
            console.error(e);
            showAlert('서버에서 데이터를 불러오는데 실패했습니다.');
        } finally {
            setIsLoadingRemote(false);
        }
    };

    const handleImportBatches = async () => {
        if (selectedRemoteBatches.size === 0) return;
        
        const toImport = remoteBatches.filter(b => selectedRemoteBatches.has(b.id));
        try {
            for (const batch of toImport) {
                // When importing back to app, reset status to 'draft' or keep 'sent'? 
                // Usually if recovering to edit/resend, maybe draft. 
                // But let's keep original status or force draft if intended for correction.
                // Assuming recovery for re-send or check, let's just save as is. 
                // User can edit it.
                await receiveDb.saveOrUpdateBatch(batch);
            }
            showToast(`${toImport.length}건을 불러왔습니다.`, 'success');
            setIsLoadModalOpen(false);
            loadBatches();
        } catch (e) {
            showAlert('저장 중 오류가 발생했습니다.');
        }
    };

    const toggleRemoteSelect = (id: number) => {
        const newSet = new Set(selectedRemoteBatches);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedRemoteBatches(newSet);
    };

    // Helpers
    const toggleSelectBatch = (id: number) => {
        const newSet = new Set(selectedBatches);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedBatches(newSet);
    };

    const handleDeleteSelected = () => {
        if (selectedBatches.size === 0) return;
        showAlert(
            `선택한 ${selectedBatches.size}건의 입고 내역을 삭제하시겠습니까?`,
            async () => {
                try {
                    for (const id of selectedBatches) {
                        await receiveDb.deleteBatch(id);
                    }
                    showToast('삭제되었습니다.', 'success');
                    setSelectedBatches(new Set());
                    loadBatches();
                } catch(e) {
                    showAlert('삭제 중 오류가 발생했습니다.');
                }
            },
            '삭제',
            'bg-red-600'
        );
    };

    const startNewBatch = () => {
        setEditingBatch(null);
        setSelectedSupplier(null);
        setSupplierSearch('');
        setBatchDate(new Date().toISOString().slice(0, 10));
        setCurrentItems([]);
        setMode('edit');
    };

    const editBatch = (batch: ReceivingBatch) => {
        setEditingBatch(batch);
        setSelectedSupplier(batch.supplier);
        setSupplierSearch(batch.supplier.name);
        setBatchDate(batch.date);
        setCurrentItems(batch.items || []);
        setMode('edit');
    };

    // Edit Mode Logic
    const filteredSuppliers = useMemo(() => {
        if (selectedSupplier) return [];
        const term = supplierSearch.toLowerCase();
        if (!term) return [];
        return customers.filter(c => c.name.toLowerCase().includes(term) || c.comcode.includes(term)).slice(0, 20);
    }, [customers, supplierSearch, selectedSupplier]);

    const handleAddItem = (itemData: Omit<ReceivingItem, 'uniqueId'>) => {
        const newItem: ReceivingItem = { ...itemData, uniqueId: Date.now() + Math.random() };
        setCurrentItems(prev => [...prev, newItem]);
        setAddItemModalProps({ isOpen: false, product: null, source: 'search' });
        setProductSearch('');
    };

    const handleSaveBatch = async () => {
        if (!selectedSupplier) {
            showAlert('거래처를 선택해주세요.');
            return;
        }
        if (currentItems.length === 0) {
            showAlert('입고할 품목이 없습니다.');
            return;
        }

        const totalAmount = currentItems.reduce((sum, item) => sum + (item.costPrice * item.quantity), 0);
        const itemCount = currentItems.length;

        const batchToSave: ReceivingBatch = {
            id: editingBatch ? editingBatch.id : Date.now(),
            date: batchDate,
            supplier: selectedSupplier,
            items: currentItems,
            itemCount,
            totalAmount,
            status: editingBatch ? editingBatch.status : 'draft',
            sentAt: editingBatch?.sentAt
        };

        try {
            await receiveDb.saveOrUpdateBatch(batchToSave);
            // Also save to Firebase as draft immediately for backup
            await addReceivingBatch(batchToSave); 
            showToast('저장되었습니다.', 'success');
            setMode('list');
        } catch (e) {
            showAlert('저장에 실패했습니다.');
        }
    };

    const handleScan = () => {
        openScanner('modal', (code) => {
            const product = products.find(p => p.barcode === code);
            if (product) {
                // When scanned, source is 'scan', enabling "Scan Next"
                setAddItemModalProps({ isOpen: true, product, source: 'scan' });
            } else {
                showToast('등록되지 않은 상품입니다.', 'error');
            }
        }, true);
    };

    const handleRemoveItem = (uniqueId: number) => {
        setCurrentItems(prev => prev.filter(i => i.uniqueId !== uniqueId));
    };

    // Render List Mode
    if (mode === 'list') {
        return (
            <div className="flex flex-col h-full bg-gray-50">
                <div className="bg-white p-3 border-b flex justify-between items-center">
                    <div className="flex gap-2">
                        <button 
                            onClick={() => {
                                if (selectedBatches.size === batches.length) setSelectedBatches(new Set());
                                else setSelectedBatches(new Set(batches.map(b => b.id)));
                            }}
                            className="text-sm font-bold text-gray-600 flex items-center gap-1"
                        >
                            <CheckSquareIcon className="w-5 h-5" /> 전체
                        </button>
                        {selectedBatches.size > 0 && (
                            <button onClick={handleDeleteSelected} className="text-sm font-bold text-red-600 flex items-center gap-1">
                                <TrashIcon className="w-5 h-5" /> 삭제({selectedBatches.size})
                            </button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => setIsLoadModalOpen(true)} className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-bold shadow-sm active:scale-95 flex items-center gap-1 border border-gray-300 hover:bg-gray-200">
                            <CloudArrowDownIcon className="w-4 h-4" /> 서버 불러오기
                        </button>
                        <button onClick={startNewBatch} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-bold shadow-sm active:scale-95">
                            + 신규 등록
                        </button>
                    </div>
                </div>
                <div className="flex-grow overflow-y-auto p-2 space-y-2">
                    {batches.length === 0 ? (
                        <div className="text-center text-gray-400 mt-10">입고 내역이 없습니다.</div>
                    ) : (
                        batches.map(batch => (
                            <div key={batch.id} className={`bg-white p-3 rounded-xl border shadow-sm flex items-center gap-3 ${selectedBatches.has(batch.id) ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200'}`}>
                                <button onClick={() => toggleSelectBatch(batch.id)} className="text-gray-400 focus:outline-none">
                                    {selectedBatches.has(batch.id) ? <CheckSquareIcon className="w-6 h-6 text-blue-600" /> : <CancelSquareIcon className="w-6 h-6" />}
                                </button>
                                <div className="flex-grow min-w-0" onClick={() => editBatch(batch)}>
                                    <div className="flex justify-between items-start">
                                        <h3 className="font-bold text-gray-800 truncate">{batch.supplier.name}</h3>
                                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${batch.status === 'sent' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                            {batch.status === 'sent' ? '전송됨' : '작성중'}
                                        </span>
                                    </div>
                                    <div className="text-xs text-gray-500 mt-1 flex gap-2">
                                        <span>{batch.date}</span>
                                        <span>Items: {batch.itemCount}</span>
                                        <span>{batch.totalAmount.toLocaleString()}원</span>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
                {selectedBatches.size > 0 && (
                    <div className="p-3 bg-white border-t safe-area-pb">
                        <button 
                            onClick={handleSend}
                            disabled={isSending}
                            className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold text-lg shadow-lg active:scale-95 disabled:bg-gray-400 flex items-center justify-center gap-2"
                        >
                            {isSending ? <SpinnerIcon className="w-5 h-5" /> : <CheckCircleIcon className="w-5 h-5" />}
                            {selectedBatches.size}건 전송하기
                        </button>
                    </div>
                )}

                {/* Firebase Load Modal */}
                <ActionModal
                    isOpen={isLoadModalOpen}
                    onClose={() => setIsLoadModalOpen(false)}
                    title="서버 데이터 불러오기"
                    disableBodyScroll
                >
                    <div className="flex flex-col h-full bg-gray-50">
                        <div className="p-3 bg-white border-b flex gap-2 items-center">
                            <input 
                                type="date" 
                                value={loadDate} 
                                onChange={e => setLoadDate(e.target.value)} 
                                className="flex-grow border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold text-gray-700"
                            />
                            <button onClick={handleFetchRemoteBatches} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm shadow active:scale-95 whitespace-nowrap">
                                조회
                            </button>
                        </div>
                        <div className="flex-grow overflow-y-auto p-2">
                            {isLoadingRemote ? (
                                <div className="flex justify-center items-center h-40"><SpinnerIcon className="w-8 h-8 text-blue-500" /></div>
                            ) : remoteBatches.length === 0 ? (
                                <div className="text-center text-gray-400 mt-10">조회된 데이터가 없습니다.</div>
                            ) : (
                                <div className="space-y-2">
                                    {remoteBatches.map(batch => (
                                        <div key={batch.id} className={`bg-white p-3 rounded-xl border shadow-sm flex items-center gap-3 cursor-pointer ${selectedRemoteBatches.has(batch.id) ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200'}`} onClick={() => toggleRemoteSelect(batch.id)}>
                                            <div className="text-gray-400">
                                                {selectedRemoteBatches.has(batch.id) ? <CheckSquareIcon className="w-6 h-6 text-blue-600" /> : <CancelSquareIcon className="w-6 h-6" />}
                                            </div>
                                            <div className="flex-grow">
                                                <div className="flex justify-between">
                                                    <h3 className="font-bold text-gray-800">{batch.supplier.name}</h3>
                                                    <span className={`text-xs px-1.5 py-0.5 rounded ${batch.status === 'sent' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                                        {batch.status === 'sent' ? '전송됨' : '작성중'}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-gray-500 mt-1">
                                                    {batch.itemCount}품목 / {batch.totalAmount.toLocaleString()}원
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="p-3 bg-white border-t">
                            <button 
                                onClick={handleImportBatches} 
                                disabled={selectedRemoteBatches.size === 0}
                                className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold text-lg shadow-md active:scale-95 disabled:bg-gray-400"
                            >
                                {selectedRemoteBatches.size}건 가져오기
                            </button>
                        </div>
                    </div>
                </ActionModal>
            </div>
        );
    }

    // Render Edit Mode
    return (
        <div className="flex flex-col h-full bg-white">
            <div className="p-3 border-b flex items-center gap-2 bg-gray-50">
                <button onClick={() => setMode('list')} className="p-1 rounded-full hover:bg-gray-200">
                    <ChevronLeftIcon className="w-6 h-6 text-gray-600" />
                </button>
                <h2 className="font-bold text-lg text-gray-800 flex-grow text-center pr-8">
                    {editingBatch ? '입고 수정' : '신규 입고'}
                </h2>
            </div>
            
            <div className="p-3 space-y-3 flex-shrink-0 bg-white shadow-sm z-10">
                {/* Date & Supplier */}
                <div className="flex gap-2">
                    <input 
                        type="date" 
                        value={batchDate} 
                        onChange={e => setBatchDate(e.target.value)} 
                        className="w-32 border border-gray-300 rounded-lg px-2 text-sm font-bold text-gray-700 bg-white"
                    />
                    <div className="relative flex-grow">
                        <input 
                            type="text" 
                            value={supplierSearch} 
                            onChange={e => {
                                setSupplierSearch(e.target.value);
                                setSelectedSupplier(null);
                                setShowSupplierDropdown(true);
                            }}
                            onFocus={() => setShowSupplierDropdown(true)}
                            onBlur={() => setTimeout(() => setShowSupplierDropdown(false), 200)}
                            placeholder="거래처 검색"
                            className={`w-full h-10 px-3 border rounded-lg text-sm font-bold ${selectedSupplier ? 'bg-blue-50 border-blue-300 text-blue-800' : 'border-gray-300'}`}
                        />
                        <SearchDropdown<Customer>
                            items={filteredSuppliers}
                            show={showSupplierDropdown && !selectedSupplier}
                            renderItem={c => (
                                <div onMouseDown={() => { setSelectedSupplier(c); setSupplierSearch(c.name); setShowSupplierDropdown(false); }} className="p-3 hover:bg-gray-100 cursor-pointer border-b">
                                    <p className="font-bold text-gray-800">{c.name}</p>
                                    <p className="text-xs text-gray-500">{c.comcode}</p>
                                </div>
                            )}
                        />
                    </div>
                </div>

                {/* Product Search & Scan */}
                <div className="flex gap-2">
                    <div className="relative flex-grow">
                        <input
                            ref={productSearchInputRef}
                            type="text"
                            value={productSearch}
                            onChange={e => setProductSearch(e.target.value)}
                            onFocus={() => setShowProductDropdown(true)}
                            onBlur={() => setTimeout(() => setShowProductDropdown(false), 200)}
                            placeholder="상품명/바코드 검색"
                            className="w-full h-10 px-3 pl-9 border border-gray-300 rounded-lg text-sm"
                        />
                        <SearchIcon className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
                        <SearchDropdown<Product>
                            items={productSearchResults}
                            show={showProductDropdown && !!debouncedProductSearch}
                            renderItem={p => (
                                <ProductSearchResultItem 
                                    product={p} 
                                    onClick={(prod) => {
                                        setAddItemModalProps({ isOpen: true, product: prod, source: 'search' });
                                        setShowProductDropdown(false);
                                    }} 
                                />
                            )}
                        />
                    </div>
                    <button onClick={handleScan} className="w-12 bg-gray-800 text-white rounded-lg flex items-center justify-center active:scale-95">
                        <BarcodeScannerIcon className="w-6 h-6" />
                    </button>
                </div>
            </div>

            {/* Item List */}
            <div className="flex-grow overflow-y-auto p-2 bg-gray-50">
                {currentItems.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2">
                        <BarcodeScannerIcon className="w-12 h-12 opacity-20" />
                        <p>입고할 상품을 스캔하거나 검색하세요.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {currentItems.slice().reverse().map((item, idx) => (
                            <div key={item.uniqueId} className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm flex justify-between items-center animate-fade-in-up">
                                <div>
                                    <p className="font-bold text-gray-800 text-sm">{item.name}</p>
                                    <div className="text-xs text-gray-500 mt-0.5">
                                        <span>{Number(item.costPrice).toLocaleString()}원</span>
                                        <span className="mx-1">x</span>
                                        <span className="font-bold text-blue-600">{item.quantity}</span>
                                        <span className="mx-1">=</span>
                                        <span>{(item.costPrice * item.quantity).toLocaleString()}원</span>
                                    </div>
                                </div>
                                <button onClick={() => handleRemoveItem(item.uniqueId)} className="text-gray-400 hover:text-red-500 p-2">
                                    <TrashIcon className="w-5 h-5" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t bg-white safe-area-pb">
                <div className="flex justify-between items-center mb-2 px-1">
                    <span className="text-sm font-bold text-gray-600">총 {currentItems.length}건</span>
                    <span className="text-lg font-bold text-blue-600">
                        {currentItems.reduce((sum, i) => sum + (i.costPrice * i.quantity), 0).toLocaleString()}원
                    </span>
                </div>
                <button onClick={handleSaveBatch} className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold text-lg shadow-md active:scale-95">
                    저장하기
                </button>
            </div>

            {addItemModalProps.isOpen && (
                <ReceiveItemModal
                    isOpen={addItemModalProps.isOpen}
                    product={addItemModalProps.product}
                    currentItems={currentItems}
                    onClose={() => setAddItemModalProps({ ...addItemModalProps, isOpen: false })}
                    onAdd={handleAddItem}
                    onScanNext={
                        addItemModalProps.source === 'scan' 
                        ? () => { handleScan(); } 
                        : undefined
                    }
                />
            )}
        </div>
    );
};

export default ReceiveManagerPage;
