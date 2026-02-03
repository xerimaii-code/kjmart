
import React, { useState, useMemo, useRef, useCallback } from 'react';
import { useDataState, useAlert } from '../context/AppContext';
import { getReceivingBatchesByDateRange, addReceivingBatch } from '../services/dbService';
import * as receiveDb from '../services/receiveDbService';
import { Customer, ReceivingBatch } from '../types';
import { useSortedCustomers } from '../hooks/useSortedCustomers';
import SearchDropdown from './SearchDropdown';
import { SpinnerIcon, SearchIcon, XMarkIcon, CheckSquareIcon, CheckCircleIcon } from './Icons';
import ActionModal from './ActionModal';

interface ReceivingBackupModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const ReceivingBackupModal: React.FC<ReceivingBackupModalProps> = ({ isOpen, onClose }) => {
    const { customers } = useDataState();
    const { showAlert, showToast } = useAlert();
    const { sortedCustomers, recordUsage } = useSortedCustomers(customers);

    const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [supplierSearch, setSupplierSearch] = useState('전체 거래처');
    const [selectedSupplier, setSelectedSupplier] = useState<Customer | null>(null);
    const [showDropdown, setShowDropdown] = useState(false);
    const supplierInputRef = useRef<HTMLInputElement>(null);
    const blurTimeoutRef = useRef<number | null>(null);

    const [searchedBatches, setSearchedBatches] = useState<ReceivingBatch[]>([]);
    const [selectedBatchIds, setSelectedBatchIds] = useState<Set<number>>(new Set());
    const [isLoading, setIsLoading] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    
    const filteredSuppliers = useMemo(() => {
        const term = supplierSearch.toLowerCase();
        const allOption: Customer = { comcode: '', name: '전체 거래처' };
        if (!term || term === '전체 거래처') return [allOption, ...sortedCustomers.slice(0, 50)];
        const list = sortedCustomers.filter(c => c.name.toLowerCase().includes(term) || c.comcode.includes(term));
        return [allOption, ...list.slice(0, 50)];
    }, [sortedCustomers, supplierSearch]);

    const handleSelectSupplier = (c: Customer) => {
        if (c.comcode === '') {
            setSelectedSupplier(null);
            setSupplierSearch('전체 거래처');
        } else {
            setSelectedSupplier(c);
            setSupplierSearch(c.name);
            recordUsage(c.comcode);
        }
        setShowDropdown(false);
    };
    
    const handleClearSupplier = () => {
        setSelectedSupplier(null);
        setSupplierSearch('');
        setTimeout(() => supplierInputRef.current?.focus(), 50);
    };
    
    const handleSearch = async () => {
        setIsLoading(true);
        setHasSearched(true);
        setSearchedBatches([]);
        setSelectedBatchIds(new Set());
        try {
            let batches = await getReceivingBatchesByDateRange(selectedDate, selectedDate);
            batches = batches.filter(b => b.status === 'sent');

            if (selectedSupplier) {
                batches = batches.filter(b => b.supplier.comcode === selectedSupplier.comcode);
            }
            setSearchedBatches(batches);
            showToast(`${batches.length}건의 '전송완료' 백업을 찾았습니다.`, 'success');
        } catch (e: any) {
            showAlert(`조회 실패: ${e.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const toggleSelection = (id: number) => {
        setSelectedBatchIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedBatchIds.size === searchedBatches.length) {
            setSelectedBatchIds(new Set());
        } else {
            setSelectedBatchIds(new Set(searchedBatches.map(b => b.id)));
        }
    };

    const handleLoad = () => {
        if (selectedBatchIds.size === 0) {
            showAlert('불러올 내역을 선택해주세요.');
            return;
        }
        showAlert(
            `${selectedBatchIds.size}건의 입고 내역을 기기로 불러오시겠습니까?\n(새로운 미전송 전표로 복사됩니다)`,
            async () => {
                setIsProcessing(true);
                let successCount = 0;
                let failCount = 0;
                try {
                    const batchesToLoad = searchedBatches.filter(b => selectedBatchIds.has(b.id));
                    // 최신 데이터 우선 정렬 (ID 기준 내림차순 등으로 가정) 또는 순차 처리
                    for (let i = 0; i < batchesToLoad.length; i++) {
                        const batch = batchesToLoad[i];
                        try {
                            // [중요] 기존 ID를 그대로 쓰면 동기화 시 '전송됨'으로 인식되어 로컬에서 삭제될 수 있음.
                            // 따라서 새로운 ID(현재 시간 + 인덱스 오프셋)를 부여하여 '새로운 작성 글'로 인식시킴.
                            const newId = Date.now() + i;
                            
                            const recoveredBatch: ReceivingBatch = { 
                                ...batch, 
                                id: newId, 
                                status: 'draft',
                                sentAt: undefined // 전송 기록 초기화
                            };
                            
                            // 1. 로컬 DB에 저장 (즉시 표시용)
                            await receiveDb.saveOrUpdateBatch(recoveredBatch);
                            
                            // 2. 파이어베이스에도 'draft' 상태로 푸시 (동기화 유지용)
                            // 이렇게 해야 다른 기기나 앱 재시작 시에도 미전송 목록에 남음
                            await addReceivingBatch(recoveredBatch);

                            successCount++;
                        } catch(e) {
                            failCount++;
                            console.error(`Failed to load batch ${batch.id} locally`, e);
                        }
                    }
                    showAlert(`불러오기 완료\n- 성공: ${successCount}건\n- 실패: ${failCount}건`);
                    onClose();
                } catch (e: any) {
                    showAlert(`불러오기 실패: ${e.message}`);
                } finally {
                    setIsProcessing(false);
                }
            }, "불러오기", "bg-indigo-600"
        );
    };
    
    return (
        <ActionModal isOpen={isOpen} onClose={onClose} title="입고내역 백업 불러오기" zIndexClass="z-[70]">
            <div className="flex flex-col h-full bg-gray-50">
                <div className="p-3 bg-white border-b border-gray-200 space-y-3">
                    <div className="flex items-center gap-2">
                         <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="flex-1 h-10 border border-gray-300 rounded-lg px-2 text-sm font-bold text-gray-700 bg-white shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"/>
                    </div>
                    <div className="flex gap-2 items-stretch">
                        <div className="relative flex-grow">
                            <input ref={supplierInputRef} type="text" value={supplierSearch} onChange={(e) => { setSupplierSearch(e.target.value); setShowDropdown(true); }} onFocus={() => { if(blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current); setShowDropdown(true); }} onBlur={() => { blurTimeoutRef.current = window.setTimeout(() => setShowDropdown(false), 200); }} placeholder="거래처 선택" className={`w-full h-10 pl-3 pr-8 border rounded-lg text-sm font-bold transition-all focus:ring-2 focus:ring-blue-500 outline-none ${selectedSupplier || supplierSearch === '전체 거래처' ? 'bg-blue-50 text-blue-800 border-blue-300' : 'bg-white text-gray-700'}`}/>
                            {(selectedSupplier || supplierSearch) && <button onClick={handleClearSupplier} className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600" type="button"><XMarkIcon className="w-4 h-4" /></button>}
                            <SearchDropdown<Customer> items={filteredSuppliers} show={showDropdown} renderItem={(c) => (
                                <div onMouseDown={(e) => { e.preventDefault(); handleSelectSupplier(c); }} className={`p-3 hover:bg-gray-50 cursor-pointer border-b last:border-b-0 ${c.comcode === '' ? 'text-blue-600 font-bold bg-blue-50/30' : ''}`}>
                                    <p className="font-bold text-sm">{c.name}</p>
                                    {c.comcode && <p className="text-xs text-gray-500 mt-0.5">{c.comcode}</p>}
                                </div>
                            )} />
                        </div>
                        <button onClick={handleSearch} disabled={isLoading} className="w-12 h-10 bg-blue-600 text-white rounded-lg flex items-center justify-center font-bold hover:bg-blue-700 transition active:scale-95 shadow-md flex-shrink-0 disabled:bg-gray-400" aria-label="조회">
                            {isLoading ? <SpinnerIcon className="w-5 h-5 animate-spin" /> : <SearchIcon className="w-5 h-5" />}
                        </button>
                    </div>
                </div>

                <div className="flex-grow overflow-y-auto p-2">
                    {isLoading ? <div className="flex items-center justify-center h-full"><SpinnerIcon className="w-8 h-8 text-blue-500"/></div> :
                     searchedBatches.length === 0 ? <div className="p-10 text-center text-gray-400 font-bold">{hasSearched ? '조회된 백업이 없습니다.' : '날짜 선택 후 검색하세요.'}</div> :
                     <div className="space-y-2">
                        {searchedBatches.map(batch => (
                            <div key={batch.id} onClick={() => toggleSelection(batch.id)} className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition-all ${selectedBatchIds.has(batch.id) ? 'bg-indigo-50 border-indigo-300 ring-1 ring-indigo-200' : 'bg-white border-gray-200 hover:border-gray-300'}`}>
                                <div className="flex-shrink-0">
                                    {selectedBatchIds.has(batch.id) ? <CheckCircleIcon className="w-6 h-6 text-indigo-600" /> : <div className="w-5 h-5 rounded-full border-2 border-gray-300 bg-white"/>}
                                </div>
                                <div className="flex-grow min-w-0">
                                    <div className="flex justify-between items-center mb-1">
                                        <h4 className="font-bold text-gray-800 truncate">{batch.supplier.name}</h4>
                                        <span className="text-xs font-bold text-gray-500">{batch.date}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-gray-500">{batch.itemCount} 품목</span>
                                        <span className="font-bold text-indigo-600">{batch.totalAmount.toLocaleString()}원</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                     </div>
                    }
                </div>

                {searchedBatches.length > 0 && (
                    <div className="p-3 bg-white border-t space-y-3">
                        <div className="flex items-center justify-between px-1">
                             <button onClick={toggleSelectAll} className="flex items-center gap-2 text-sm font-bold text-gray-600 hover:bg-gray-100 px-2 py-1 rounded-lg transition-colors">
                                <CheckSquareIcon className="w-5 h-5" />
                                <span>{selectedBatchIds.size === searchedBatches.length ? '전체 해제' : '전체 선택'}</span>
                            </button>
                            <span className="text-sm font-bold">{selectedBatchIds.size} / {searchedBatches.length}개 선택</span>
                        </div>
                        <button onClick={handleLoad} disabled={isProcessing || selectedBatchIds.size === 0} className="w-full h-12 bg-indigo-600 text-white rounded-xl font-bold text-base flex items-center justify-center gap-2 disabled:bg-gray-300 active:scale-95 transition-all shadow-lg">
                            {isProcessing ? <SpinnerIcon className="w-6 h-6 animate-spin"/> : `선택 ${selectedBatchIds.size}건 불러오기`}
                        </button>
                    </div>
                )}
            </div>
        </ActionModal>
    );
};

export default ReceivingBackupModal;
