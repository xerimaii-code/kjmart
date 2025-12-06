
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDataState, useAlert, useMiscUI, useScanner, useModals } from '../context/AppContext';
import { ReceivingBatch, ReceivingItem, Product, Customer } from '../types';
import * as receiveDb from '../services/receiveDbService';
import { addReceivingBatch } from '../services/dbService';
import { executeUserQuery } from '../services/sqlService';
import { 
    SpinnerIcon, CheckSquareIcon, CancelSquareIcon, TrashIcon, 
    BarcodeScannerIcon, ChevronLeftIcon, CheckCircleIcon, SearchIcon
} from '../components/Icons';
import ReceiveItemModal from '../components/ReceiveItemModal';
import ProductSearchResultItem from '../context/ProductSearchResultItem';
import SearchDropdown from '../components/SearchDropdown';
import { useProductSearch } from '../hooks/useProductSearch';
import { useDebounce } from '../hooks/useDebounce';

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
    const [addItemModalProps, setAddItemModalProps] = useState<{ isOpen: boolean, product: Product | null }>({ isOpen: false, product: null });

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

                // Safe Insert Query with Semicolon to prevent 'Incorrect syntax near with' error
                // This ensures the statement is properly terminated before the WITH clause if concatenated.
                const safeInsertQuery = `
                    ; INSERT INTO dbo.dt900_ipgo (
                        day1, dtcomcode, comcode, comname, barcode, descr, 
                        money0vat, money1, itemcount, gubun, lstmoney0vat
                    )
                    SELECT
                        LEFT(@date + ':' + @time, 20),
                        LEFT(@comcode, 10),
                        LEFT(ISNULL(p.comcode, ''), 10),
                        LEFT(ISNULL(c.comname, ''), 20),
                        LEFT(@barcode, 20),
                        LEFT(ISNULL(@item_name, ISNULL(p.descr, '')), 30),
                        @cost, 
                        @price, 
                        @qty,
                        CASE WHEN CAST(@qty AS INT) >= 0 THEN 'I' ELSE 'B' END,
                        ISNULL(p.money0vat, 0)
                    FROM (SELECT 1 AS dummy) AS t
                    LEFT JOIN dbo.parts AS p WITH (NOLOCK) ON p.barcode = @barcode
                    LEFT JOIN dbo.comp AS c WITH (NOLOCK) ON c.comcode = p.comcode
                `;

                try {
                    const now = new Date();
                    const hh = now.getHours().toString().padStart(2, '0');
                    const mm = now.getMinutes().toString().padStart(2, '0');
                    const mmm = now.getMilliseconds().toString().padStart(3, '0');
                    const unifiedTime = `${hh}:${mm}:${mmm}`;

                    for (const batch of batchesToSend) {
                        try {
                            for (const item of batch.items) {
                                const params = {
                                    date: batch.date,
                                    time: unifiedTime,
                                    comcode: batch.supplier.comcode,
                                    barcode: item.barcode,
                                    qty: item.quantity,
                                    cost: item.costPrice,
                                    price: item.sellingPrice,
                                    item_name: item.name
                                };
                                // Pass the safe hardcoded query directly
                                await executeUserQuery('입고등록_Direct', params, safeInsertQuery);
                            }

                            const updatedBatch: ReceivingBatch = { ...batch, status: 'sent', sentAt: new Date().toISOString() };
                            
                            await receiveDb.saveOrUpdateBatch(updatedBatch);
                            await addReceivingBatch(updatedBatch);
                            
                            successCount++;

                        } catch (err: any) {
                            console.error(`Failed to send batch ${batch.id}`, err);
                            failCount++;
                            throw new Error(`'${batch.supplier.name}' 전송 중 오류: ${err.message}`);
                        }
                    }
                    showToast(`${successCount}건 전송 완료`, 'success');
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
        setAddItemModalProps({ isOpen: false, product: null });
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
                setAddItemModalProps({ isOpen: true, product });
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
                                        setAddItemModalProps({ isOpen: true, product: prod });
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
                    onScanNext={() => {
                        // Re-open scanner after adding
                        handleScan();
                    }}
                />
            )}
        </div>
    );
};

export default ReceiveManagerPage;
