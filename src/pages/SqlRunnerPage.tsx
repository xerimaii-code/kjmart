

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAlert, useScanner } from '../context/AppContext';
import { SpinnerIcon, BarcodeScannerIcon, CheckCircleIcon, WarningIcon, TrashIcon, PencilSquareIcon, SparklesIcon, StopCircleIcon, PlayCircleIcon, TableCellsIcon, BookmarkSquareIcon, StarIcon, ChevronDownIcon } from '../components/Icons';
import { querySql, checkSqlConnection, getSqlTables, naturalLanguageToSql } from '../services/sqlService';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { getValue, setValue, subscribeToSavedQueries, addSavedQuery, updateSavedQuery, deleteSavedQuery, getDatabase, ref, push, update, set } from '../services/dbService';

// --- TYPE DEFINITIONS ---
type QueryStatus = 'idle' | 'loading' | 'success' | 'error';
type SqlServerStatus = 'unknown' | 'connected' | 'error';

interface QueryResult {
    recordset: any[];
    rowsAffected: number;
}
interface SavedQuery {
    id: string;
    name: string;
    query: string;
    type: 'sql' | 'natural';
    isQuickRun?: boolean;
}
interface LearningItem {
    id: string;
    title: string;
    content: string;
}

// --- REUSABLE MODAL WRAPPER ---
const ModalWrapper: React.FC<{
    children: React.ReactNode;
    onClose: () => void;
    className?: string;
    isActive: boolean;
}> = ({ children, onClose, className = 'max-w-lg', isActive }) => {
    const [isRendered, setIsRendered] = useState(false);

    useEffect(() => {
        if (isActive) {
            const timer = setTimeout(() => setIsRendered(true), 10);
            return () => clearTimeout(timer);
        } else {
            setIsRendered(false);
        }
    }, [isActive]);

    if (!isActive) return null;

    return (
        <div
            className={`absolute inset-0 z-50 flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-50' : 'bg-transparent'}`}
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            <div
                className={`bg-white rounded-xl shadow-lg w-full ${className} flex flex-col overflow-hidden transition-[opacity,transform] duration-300 will-change-[opacity,transform] ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
                onClick={e => e.stopPropagation()}
            >
                {children}
            </div>
        </div>
    );
};


// --- MODAL CONTENT COMPONENTS ---
const LearningModalContent: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [items, setItems] = useState<LearningItem[]>([]);
    const [editingItem, setEditingItem] = useState<LearningItem | 'new' | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const { showToast, showAlert } = useAlert();

    const db = getDatabase();
    const dbRef = ref(db, 'learning/sqlContext');

    const loadData = useCallback(async () => {
        setIsLoading(true);
        const data = await getValue<string | { [key: string]: Omit<LearningItem, 'id'> }>('learning/sqlContext', '');
        if (typeof data === 'string') {
            // Handle migration from old string format
            const migratedItem = { id: 'default', title: '기본 학습 내용', content: data };
            setItems([migratedItem]);
        } else if (data) {
            const loadedItems = Object.entries(data).map(([id, value]) => ({ id, ...value }));
            setItems(loadedItems);
        } else {
            setItems([]);
        }
        setIsLoading(false);
    }, []);
    
    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleSave = async (itemToSave: LearningItem) => {
        if (!itemToSave.title.trim()) {
            showToast('제목을 입력해주세요.', 'error');
            return;
        }
        setIsSaving(true);
        try {
            if (itemToSave.id && itemToSave.id !== 'new') {
                const itemRef = ref(db, `learning/sqlContext/${itemToSave.id}`);
                await update(itemRef, { title: itemToSave.title, content: itemToSave.content });
            } else {
                const newItemRef = push(dbRef);
                await set(newItemRef, { title: itemToSave.title, content: itemToSave.content });
            }
            showToast('학습 내용이 저장되었습니다.', 'success');
            setEditingItem(null);
            await loadData();
        } catch (err) {
            showToast('저장에 실패했습니다.', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = (id: string) => {
        showAlert(
            '이 학습 내용을 삭제하시겠습니까?',
            async () => {
                try {
                    const itemRef = ref(db, `learning/sqlContext/${id}`);
                    await set(itemRef, null);
                    showToast('삭제되었습니다.', 'success');
                    setEditingItem(null);
                    await loadData();
                } catch (err) {
                    showToast('삭제에 실패했습니다.', 'error');
                }
            },
            '삭제',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    };

    const EditView: React.FC<{ item: LearningItem | 'new' }> = ({ item }) => {
        const isNew = item === 'new';
        const [currentItem, setCurrentItem] = useState(isNew ? { id: 'new', title: '', content: '' } : item);

        return (
            <div className="p-5 flex flex-col flex-grow">
                <input
                    type="text"
                    placeholder="제목"
                    value={currentItem.title}
                    onChange={e => setCurrentItem(prev => ({...prev, title: e.target.value}))}
                    className="w-full p-2 border border-gray-300 rounded-lg font-bold text-lg mb-3"
                />
                <textarea
                    placeholder="AI에게 알려줄 내용을 입력하세요..."
                    value={currentItem.content}
                    onChange={e => setCurrentItem(prev => ({...prev, content: e.target.value}))}
                    className="w-full p-2 border border-gray-300 rounded-lg text-base flex-grow"
                    rows={10}
                />
                <div className="mt-4 flex justify-between items-center">
                    <div>
                        {!isNew && (
                            <button onClick={() => handleDelete(currentItem.id)} className="px-4 py-2 bg-red-100 text-red-700 rounded-lg font-semibold hover:bg-red-200">
                                삭제
                            </button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => setEditingItem(null)} className="px-4 py-2 bg-gray-200 rounded-lg font-semibold">
                            취소
                        </button>
                        <button onClick={() => handleSave(currentItem)} disabled={isSaving} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold flex items-center justify-center w-24">
                            {isSaving ? <SpinnerIcon className="w-5 h-5" /> : '저장'}
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <>
            <div className="p-5 border-b flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-800">AI 학습 내용 관리</h3>
                 {!editingItem && (
                    <button onClick={() => setEditingItem('new')} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg font-bold">
                        새로 추가
                    </button>
                )}
            </div>
            {editingItem ? <EditView item={editingItem} /> : (
                 <div className="p-5 max-h-[60vh] overflow-y-auto flex-grow">
                    {isLoading ? <SpinnerIcon className="w-8 h-8 mx-auto text-blue-500" /> :
                     items.length === 0 ? <p className="text-center text-gray-500 py-8">학습 내용이 없습니다.</p> :
                     <ul className="space-y-2">
                        {items.map(item => (
                            <li key={item.id}>
                                <button onClick={() => setEditingItem(item)} className="w-full text-left p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition">
                                    <p className="font-bold text-gray-800 truncate">{item.title}</p>
                                    <p className="text-sm text-gray-500 truncate mt-1">{item.content || "내용 없음"}</p>
                                </button>
                            </li>
                        ))}
                    </ul>}
                 </div>
            )}
            <div className="bg-gray-50 p-3 text-right mt-auto border-t">
                <button onClick={onClose} className="px-6 py-2 bg-gray-700 text-white rounded-lg font-bold">
                    닫기
                </button>
            </div>
        </>
    );
};


const TableSelectionModalContent: React.FC<{
    onClose: () => void; allTables: string[]; selectedTables: string[]; onSelectionChange: (table: string) => void;
}> = ({ onClose, allTables, selectedTables, onSelectionChange }) => {
    
    const sortedAndGroupedTables = useMemo(() => {
        const selectedSet = new Set(selectedTables);
        const selected = allTables.filter(t => selectedSet.has(t)).sort();
        const unselected = allTables.filter(t => !selectedSet.has(t)).sort();
        return [...selected, ...unselected];
    }, [allTables, selectedTables]);
    
    return (
        <>
            <div className="p-5 border-b">
                <h3 className="text-xl font-bold text-gray-800">테이블 선택</h3>
                <p className="text-sm text-gray-500 mt-1">AI 쿼리 생성 시 참고할 테이블을 최대 3개까지 선택하세요.</p>
            </div>
            <div className="p-5 max-h-[60vh] overflow-y-auto">
                <div className="grid grid-cols-3 gap-2">
                    {sortedAndGroupedTables.map(table => {
                        const isSelected = selectedTables.includes(table);
                        return (
                            <label key={table} className={`flex items-center p-3 rounded-lg cursor-pointer transition-colors border ${isSelected ? 'bg-blue-50 border-blue-400' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}>
                                <input type="checkbox" checked={isSelected} onChange={() => onSelectionChange(table)} className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"/>
                                <span className={`ml-2 font-medium truncate ${isSelected ? 'text-blue-800' : 'text-gray-700'}`}>{table}</span>
                            </label>
                        );
                    })}
                </div>
            </div>
            <div className="bg-gray-50 p-3 text-right mt-auto border-t">
                <button onClick={onClose} className="px-6 py-2 bg-blue-600 text-white rounded-lg font-bold">확인</button>
            </div>
        </>
    );
};


const SavedQueriesModalContent: React.FC<{
    onClose: () => void; savedQueries: SavedQuery[]; onRun: (query: string) => void;
}> = ({ onClose, savedQueries, onRun }) => {
    const [editingQuery, setEditingQuery] = useState<SavedQuery | null>(null);
    const { showToast } = useAlert();

    const handleSave = async () => {
        if (!editingQuery || !editingQuery.name.trim() || !editingQuery.query.trim()) return;
        
        try {
            if (editingQuery.id) {
                await updateSavedQuery(editingQuery.id, { 
                    name: editingQuery.name, 
                    query: editingQuery.query, 
                    type: editingQuery.type 
                });
                showToast('쿼리가 수정되었습니다.', 'success');
            } else {
                await addSavedQuery({
                    name: editingQuery.name, 
                    query: editingQuery.query, 
                    type: editingQuery.type,
                    isQuickRun: false
                });
                showToast('새 쿼리가 저장되었습니다.', 'success');
            }
            setEditingQuery(null);
        } catch (e) {
            showToast('저장 중 오류가 발생했습니다.', 'error');
        }
    };

    const handleDelete = async (id: string) => {
        if(confirm('정말 삭제하시겠습니까?')) {
            try {
                await deleteSavedQuery(id);
                showToast('쿼리가 삭제되었습니다.', 'success');
            } catch(e) {
                showToast('삭제 중 오류가 발생했습니다.', 'error');
            }
        }
    };

    const toggleQuickRun = async (query: SavedQuery) => {
        try {
            await updateSavedQuery(query.id, { isQuickRun: !query.isQuickRun });
        } catch(e) {
            showToast('설정 변경에 실패했습니다.', 'error');
        }
    };

    return (
        <>
            <div className="p-5 border-b flex justify-between items-center flex-shrink-0">
                <h3 className="text-xl font-bold text-gray-800">저장된 쿼리 관리</h3>
                <button onClick={() => setEditingQuery({id: '', name: '', query: '', type: 'sql'})} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold text-sm">새로 추가</button>
            </div>

            {editingQuery ? (
                 <div className="p-5 space-y-3 flex-grow flex flex-col overflow-y-auto">
                    <input type="text" placeholder="쿼리 이름" value={editingQuery.name} onChange={e => setEditingQuery({...editingQuery, name: e.target.value})} className="w-full p-2 border rounded-lg"/>
                    <textarea placeholder="쿼리 내용" value={editingQuery.query} onChange={e => setEditingQuery({...editingQuery, query: e.target.value})} className="w-full p-2 border rounded-lg flex-grow font-mono text-sm"/>
                    <div className="flex justify-end gap-3 mt-auto">
                        <button onClick={() => setEditingQuery(null)} className="px-4 py-2 bg-gray-200 rounded-lg font-semibold">취소</button>
                        <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold">저장</button>
                    </div>
                </div>
            ) : (
                <div className="p-5 overflow-y-auto flex-grow">
                    {savedQueries.length === 0 ? <p className="text-center text-gray-500">저장된 쿼리가 없습니다.</p> :
                     <ul className="space-y-2">
                        {savedQueries.map(q => (
                            <li key={q.id} className="p-3 bg-gray-50 rounded-lg flex items-center gap-3">
                                <div className="flex-shrink-0">
                                    <button onClick={() => toggleQuickRun(q)} className={`p-2 rounded-full ${q.isQuickRun ? 'text-yellow-500 bg-yellow-50' : 'text-gray-300 hover:text-gray-400'}`} title="빠른 실행 버튼에 추가">
                                        <StarIcon className="w-5 h-5" fill={q.isQuickRun ? "currentColor" : "none"} />
                                    </button>
                                </div>
                                <div className="flex-grow min-w-0">
                                    <p className="font-bold text-gray-800">{q.name}</p>
                                    <p className="text-xs text-gray-500 font-mono truncate">{q.query}</p>
                                </div>
                                <div className="flex-shrink-0 flex items-center">
                                  <button onClick={() => onRun(q.query)} className="p-2 text-blue-600 hover:bg-blue-100 rounded-full" title="입력창에 불러오기"><PlayCircleIcon className="w-6 h-6"/></button>
                                  <button onClick={() => setEditingQuery(q)} className="p-2 text-gray-500 hover:bg-gray-200 rounded-full" title="수정"><PencilSquareIcon className="w-5 h-5"/></button>
                                  <button onClick={() => handleDelete(q.id)} className="p-2 text-red-500 hover:bg-red-100 rounded-full" title="삭제"><TrashIcon className="w-5 h-5"/></button>
                                </div>
                            </li>
                        ))}
                    </ul>}
                </div>
            )}
            <div className="bg-gray-50 p-3 text-right border-t mt-auto flex-shrink-0">
                <button onClick={onClose} className="px-6 py-2 bg-gray-700 text-white rounded-lg font-bold">닫기</button>
            </div>
        </>
    );
};


// --- MAIN PAGE COMPONENT ---
const SqlRunnerPage: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const { showAlert, showToast } = useAlert();
    const { openScanner } = useScanner();

    const [queryInput, setQueryInput] = useState('');
    const [result, setResult] = useState<QueryResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<QueryStatus>('idle');
    const [sqlServerStatus, setSqlServerStatus] = useState<SqlServerStatus>('unknown');
    
    const [tables, setTables] = useState<string[]>([]);
    const [selectedTables, setSelectedTables] = useState<string[]>([]);

    const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
    const [recentQueries, setRecentQueries] = useLocalStorage<string[]>('sql-recent-queries', []);

    const [isTableModalOpen, setTableModalOpen] = useState(false);
    const [isSavedQueriesModalOpen, setSavedQueriesModalOpen] = useState(false);
    const [isLearningModalOpen, setIsLearningModalOpen] = useState(false);

    const abortControllerRef = useRef<AbortController | null>(null);
    const longPressTimer = useRef<number | null>(null);
    const longPressFired = useRef(false);
    
    // Subscribe to saved queries from Firebase
    useEffect(() => {
        const unsubscribe = subscribeToSavedQueries((queries) => {
            setSavedQueries(queries);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (isActive) {
            checkSqlConnection().then(() => setSqlServerStatus('connected')).catch(() => setSqlServerStatus('error'));
            getSqlTables().then(setTables).catch(() => showToast('테이블 목록을 불러오는 데 실패했습니다.', 'error'));
        }
    }, [isActive, showToast]);

    const executeQuery = useCallback(async (sql: string) => {
        setStatus('loading');
        setResult(null);
        setError(null);
        abortControllerRef.current = new AbortController();

        try {
            const data = await querySql(sql, abortControllerRef.current.signal);
            setResult(data);
            setStatus('success');
            setRecentQueries(prev => [sql, ...(prev || []).filter(q => q !== sql)].slice(0, 5));
        } catch (err: any) {
            if (err.name !== 'AbortError') {
                setError(err.message || '알 수 없는 오류가 발생했습니다.');
                setStatus('error');
            }
        }
    }, [setRecentQueries]);

    const processAndExecute = useCallback(async (input: string, showInInput = true) => {
        const currentInput = input.trim();
        if (!currentInput) {
            showAlert('실행할 내용을 입력해주세요.');
            return;
        }

        if (showInInput) {
             setQueryInput(currentInput);
        }

        const isLikelySql = /^(SELECT|UPDATE|DELETE|INSERT|CREATE|DROP|ALTER|TRUNCATE)\b/i.test(currentInput);

        if (isLikelySql) {
            const upperQuery = currentInput.toUpperCase();
            const isDangerous = ['UPDATE', 'DELETE', 'INSERT', 'TRUNCATE', 'DROP', 'ALTER'].some(kw => upperQuery.startsWith(kw));
            
            const run = () => executeQuery(currentInput);

            if (isDangerous) {
                showAlert(
                    '데이터를 변경/삭제하는 쿼리입니다.\n실행 시 되돌릴 수 없습니다. 계속하시겠습니까?',
                    run,
                    '실행',
                    'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
                );
            } else {
                run();
            }
        } else {
            setStatus('loading');
            setError(null);
            try {
                const { sql } = await naturalLanguageToSql(currentInput, selectedTables);
                if (sql) {
                    if (showInInput) {
                        setQueryInput(sql);
                        showToast('AI가 SQL 쿼리를 생성했습니다. 확인 후 다시 실행해주세요.', 'success');
                        setStatus('idle');
                    } else {
                        showToast(`✅ '${currentInput}' 쿼리를 실행했습니다.`, 'success');
                        executeQuery(sql);
                    }
                } else {
                    showToast('요청을 SQL로 변환할 수 없습니다.', 'error');
                    setStatus('error');
                    setError('AI가 유효한 SQL을 생성하지 못했습니다.');
                }
            } catch (err: any) {
                setError(err.message || 'AI 쿼리 생성 중 오류 발생');
                setStatus('error');
            }
        }
    }, [executeQuery, selectedTables, showAlert, showToast]);

    const handleExecuteClick = () => {
        if (longPressFired.current) {
            longPressFired.current = false;
            return;
        }
        if (status === 'loading') {
            abortControllerRef.current?.abort();
            setStatus('idle');
            showToast('쿼리 실행이 중단되었습니다.', 'error');
            return;
        }
        processAndExecute(queryInput, true);
    };

    const handleQuickRun = (query: SavedQuery) => {
        showToast(`✅ '${query.name}' 쿼리를 실행했습니다.`, 'success');
        processAndExecute(query.query, false);
    };

    const handlePressStart = useCallback(() => {
        longPressFired.current = false;
        longPressTimer.current = window.setTimeout(() => {
            longPressFired.current = true;
            setQueryInput('');
            showToast('입력창이 비워졌습니다.', 'success');
            if (navigator.vibrate) navigator.vibrate(50);
        }, 700);
    }, [showToast]);

    const handlePressEnd = useCallback(() => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    }, []);

    const handleScan = useCallback(() => {
        openScanner('modal', (barcode) => {
            const productSearchQuery = `SELECT * FROM products WHERE barcode = '${barcode}'`;
            setQueryInput(productSearchQuery);
            showToast('상품 검색 쿼리가 생성되었습니다.', 'success');
        }, false);
    }, [openScanner, showToast]);
    
    const toggleTableSelection = (table: string) => {
        setSelectedTables(prev => {
            if (prev.includes(table)) return prev.filter(t => t !== table);
            if (prev.length >= 3) {
                showToast('테이블은 최대 3개까지 선택할 수 있습니다.', 'error');
                return prev;
            }
            return [...prev, table];
        });
    };
    
    const quickRunQueries = savedQueries.filter(q => q.isQuickRun);

    return (
        <div className="h-full flex flex-col bg-gray-100">
            <header className="p-3 bg-white border-b border-gray-200 z-10 flex items-center justify-center gap-3">
                 <button onClick={() => setTableModalOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50">
                    <TableCellsIcon className="w-5 h-5"/> <span>테이블 선택 ({selectedTables.length})</span>
                </button>
                <button onClick={() => setSavedQueriesModalOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50">
                    <BookmarkSquareIcon className="w-5 h-5"/> <span>쿼리 관리</span>
                </button>
            </header>
            
            <main className="flex-grow overflow-y-auto p-3 space-y-4">
                <div className="bg-white p-4 rounded-xl border border-gray-200 space-y-3 shadow-sm">
                    {selectedTables.length > 0 && (
                        <div className="flex flex-wrap gap-2 items-center">
                            <span className="text-xs font-bold text-gray-500">선택된 테이블:</span>
                            {selectedTables.map(t => <span key={t} className="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs font-semibold rounded-full">{t}</span>)}
                        </div>
                    )}
                    <textarea value={queryInput} onChange={(e) => setQueryInput(e.target.value)} rows={2} placeholder="자연어나 SQL 쿼리를 입력하세요..." className="w-full p-2 border border-gray-300 rounded-lg font-mono text-base focus:ring-blue-500 focus:border-blue-500"/>
                    
                    {quickRunQueries.length > 0 && (
                        <div className="flex flex-wrap gap-2 justify-end">
                            {quickRunQueries.map((sq) => (
                                <button
                                    key={sq.id}
                                    onClick={() => handleQuickRun(sq)}
                                    className="px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-md font-semibold text-xs hover:bg-indigo-100 transition active:scale-95 flex items-center gap-1"
                                    title={sq.query}
                                >
                                    <StarIcon className="w-3 h-3 fill-current"/>
                                    {sq.name}
                                </button>
                            ))}
                        </div>
                    )}
                    
                    <div className="flex items-center justify-end gap-2">
                        <button 
                            onMouseDown={handlePressStart}
                            onMouseUp={handlePressEnd}
                            onMouseLeave={handlePressEnd}
                            onTouchStart={handlePressStart}
                            onTouchEnd={handlePressEnd}
                            onClick={handleExecuteClick}
                            className="flex-grow h-12 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 text-lg transition active:scale-95 shadow-lg shadow-blue-500/30"
                        >
                            {status === 'loading' ? <><StopCircleIcon className="w-7 h-7"/> <span>중지</span></> : <><PlayCircleIcon className="w-7 h-7"/> <span>AI 실행</span></>}
                        </button>
                         <button onClick={handleScan} className="h-12 w-18 bg-gray-100 text-gray-600 rounded-lg flex items-center justify-center gap-2 font-bold hover:bg-gray-200 transition active:scale-95 flex-shrink-0">
                             <BarcodeScannerIcon className="w-7 h-7" />
                         </button>
                        <button onClick={() => setIsLearningModalOpen(true)} className="h-12 w-12 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center font-bold hover:bg-indigo-200 transition active:scale-95 flex-shrink-0"><SparklesIcon className="w-7 h-7" /></button>
                    </div>
                </div>

                {recentQueries && recentQueries.length > 0 &&
                    <div className="bg-white p-3 rounded-xl border border-gray-200">
                        <h4 className="text-sm font-bold text-gray-600 mb-2">최근 실행</h4>
                        <div className="flex flex-wrap gap-1.5">
                            {recentQueries.map((rq, i) => (
                               <div key={i} className="bg-gray-100 rounded-md flex items-center">
                                    <button onClick={() => setQueryInput(rq)} className="text-xs p-1.5 pl-2.5 font-mono truncate max-w-xs hover:bg-gray-200 rounded-l-md">{rq}</button>
                                    <button onClick={() => setRecentQueries(p => p?.filter(q => q !== rq) || [])} className="p-1.5 hover:bg-gray-200 rounded-r-md"><TrashIcon className="w-3.5 h-3.5 text-gray-500"/></button>
                               </div>
                            ))}
                        </div>
                    </div>
                }

                <div className="bg-white p-4 rounded-xl border border-gray-200 min-h-[200px] shadow-sm">
                    <h3 className="font-bold text-lg mb-2">결과</h3>
                    {status === 'loading' && <div className="flex justify-center p-8"><SpinnerIcon className="w-8 h-8 text-blue-500" /></div>}
                    {status === 'error' && <div className="p-4 bg-red-50 text-red-700 rounded-lg border border-red-200 font-medium">{error}</div>}
                    {status === 'success' && result && (
                        <div>
                            <p className="text-sm text-green-600 font-semibold mb-2 flex items-center gap-2"><CheckCircleIcon className="w-5 h-5"/>쿼리 성공! (영향 받은 행: {result.rowsAffected})</p>
                            {result.recordset?.length > 0 ? (
                                <div className="overflow-auto max-h-[40vh] border border-gray-200 rounded-lg">
                                    <table className="w-full text-sm text-left">
                                        <thead className="bg-gray-100 sticky top-0"><tr className="border-b">{Object.keys(result.recordset[0]).map(key => <th key={key} className="p-2 font-bold whitespace-nowrap">{key}</th>)}</tr></thead>
                                        <tbody>{result.recordset.map((row, i) => (<tr key={i} className="border-b last:border-b-0 hover:bg-gray-50">{Object.values(row).map((val: any, j) => <td key={j} className="p-2 whitespace-nowrap">{val === null ? 'NULL' : String(val)}</td>)}</tr>))}</tbody>
                                    </table>
                                </div>
                            ) : <p className="text-gray-500">결과 데이터가 없습니다.</p>}
                        </div>
                    )}
                     {status === 'idle' && !result && <p className="text-center text-gray-400 pt-8">쿼리를 실행하여 결과를 확인하세요.</p>}
                </div>
            </main>
            
            <ModalWrapper onClose={() => setTableModalOpen(false)} className="max-w-xl" isActive={isActive && isTableModalOpen}>
                <TableSelectionModalContent 
                    onClose={() => setTableModalOpen(false)} 
                    allTables={tables} 
                    selectedTables={selectedTables} 
                    onSelectionChange={toggleTableSelection}
                />
            </ModalWrapper>
            <ModalWrapper onClose={() => setSavedQueriesModalOpen(false)} className="max-w-2xl h-[80vh]" isActive={isActive && isSavedQueriesModalOpen}>
                <SavedQueriesModalContent 
                    onClose={() => setSavedQueriesModalOpen(false)} 
                    savedQueries={savedQueries || []} 
                    onRun={(q) => { 
                        setQueryInput(q);
                        setSavedQueriesModalOpen(false); 
                    }} 
                />
            </ModalWrapper>
            <ModalWrapper onClose={() => setIsLearningModalOpen(false)} className="max-w-2xl h-[80vh]" isActive={isActive && isLearningModalOpen}>
                <LearningModalContent onClose={() => setIsLearningModalOpen(false)} />
            </ModalWrapper>
        </div>
    );
};

export default SqlRunnerPage;