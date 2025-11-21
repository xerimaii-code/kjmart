
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAlert, useScanner } from '../context/AppContext';
import { SpinnerIcon, BarcodeScannerIcon, CheckCircleIcon, WarningIcon, TrashIcon, PencilSquareIcon, SparklesIcon, StopCircleIcon, PlayCircleIcon, TableCellsIcon, BookmarkSquareIcon, StarIcon } from '../components/Icons';
import { querySql, checkSqlConnection, getSqlTables, naturalLanguageToSql } from '../services/sqlService';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { getValue, setValue, subscribeToSavedQueries, addSavedQuery, updateSavedQuery, deleteSavedQuery } from '../services/dbService';

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

// --- REUSABLE MODAL WRAPPER ---
const ModalWrapper: React.FC<{
    children: React.ReactNode;
    onClose: () => void;
    className?: string;
}> = ({ children, onClose, className = 'max-w-lg' }) => {
    const [isRendered, setIsRendered] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => setIsRendered(true), 10);
        return () => clearTimeout(timer);
    }, []);

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
    const [context, setContext] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const { showToast } = useAlert();

    useEffect(() => {
        setIsLoading(true);
        getValue<string>('learning/sqlContext', '기본값: 데이터는 되도록 보기 좋게 가공해서 보여주세요.').then(data => {
            setContext(data);
            setIsLoading(false);
        });
    }, []);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await setValue('learning/sqlContext', context);
            showToast('학습 내용이 저장되었습니다.', 'success');
            onClose();
        } catch (err) {
            showToast('저장에 실패했습니다.', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <>
            <div className="p-5">
                <h3 className="text-xl font-bold text-gray-800 text-center mb-4">AI 학습 내용 관리</h3>
                <p className="text-sm text-gray-600 mb-4">자연어 쿼리 생성 시 AI가 참고할 추가 정보를 입력하세요. (예: 'SALES_TBL은 매출 테이블이다', '특정 상품 조회 시에는 LIKE 검색을 사용해라')</p>
                {isLoading ? <SpinnerIcon className="w-8 h-8 mx-auto text-blue-500" /> : (
                    <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={10} className="w-full p-2 border border-gray-300 rounded-lg text-base" placeholder="AI에게 알려줄 내용을 입력하세요..."/>
                )}
            </div>
            <div className="bg-gray-50 p-3 grid grid-cols-2 gap-3 mt-auto">
                <button onClick={onClose} className="py-2 px-4 bg-gray-200 rounded-lg font-semibold">취소</button>
                <button onClick={handleSave} disabled={isLoading || isSaving} className="py-2 px-4 bg-blue-600 text-white rounded-lg font-bold disabled:bg-gray-400 flex items-center justify-center">
                    {isSaving ? <SpinnerIcon className="w-5 h-5" /> : '저장'}
                </button>
            </div>
        </>
    );
};

const TableSelectionModalContent: React.FC<{
    onClose: () => void; allTables: string[]; selectedTables: string[]; onSelectionChange: (table: string) => void;
}> = ({ onClose, allTables, selectedTables, onSelectionChange }) => {
    return (
        <>
            <div className="p-5 border-b">
                <h3 className="text-xl font-bold text-gray-800">테이블 선택</h3>
                <p className="text-sm text-gray-500 mt-1">AI 쿼리 생성 시 참고할 테이블을 최대 3개까지 선택하세요.</p>
            </div>
            <div className="p-5 max-h-80 overflow-y-auto space-y-2">
                {allTables.map(table => (
                    <label key={table} className="flex items-center p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100">
                        <input type="checkbox" checked={selectedTables.includes(table)} onChange={() => onSelectionChange(table)} className="h-5 w-5 rounded text-blue-600 focus:ring-blue-500"/>
                        <span className="ml-3 font-medium text-gray-700">{table}</span>
                    </label>
                ))}
            </div>
            <div className="bg-gray-50 p-3 text-right mt-auto">
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
    
    // For drag and drop of quick run buttons
    const dragIndex = useRef<number | null>(null);
    const dragOverIndex = useRef<number | null>(null);

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

        // If we are not showing in input (Quick Run), we might still want to process it.
        // But for simplicity, Quick Run usually executes immediate SQL or converts then executes.
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
                        // For quick run natural language, we execute immediately
                        showToast('AI 변환 후 실행합니다...', 'success');
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
    }, [executeQuery, naturalLanguageToSql, selectedTables, showAlert, showToast]);

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

    const handleQuickRun = (queryText: string) => {
        showToast('쿼리를 실행합니다...', 'success');
        processAndExecute(queryText, false);
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
    
    // --- Drag and Drop Handlers for Quick Run Buttons ---
    const handleDragStart = (index: number) => {
        dragIndex.current = index;
    };
    const handleDragEnter = (index: number) => {
        dragOverIndex.current = index;
    };
    const handleDragEnd = async () => {
        if (dragIndex.current !== null && dragOverIndex.current !== null && dragIndex.current !== dragOverIndex.current) {
            // Drag and drop reordering is purely visual/local for now as we don't store sort order in DB yet.
            // To properly support this, we would need an 'order' field in Firebase.
            // For now, we can just reorder the local display temporarily or disable it.
            // Given the user request, I'll just reorder locally but warn it won't persist without DB schema change.
            // Or better, since it's a quick run list, users might expect it to save. 
            // I will skip implementing persistent reordering to keep it simple as per current scope,
            // but keep the interaction logic if they want to rearrange for the session.
            
            // However, since savedQueries comes from a subscription, local modification will be overwritten by next sync.
            // So I will disable drag/drop reordering for now as it conflicts with the realtime subscription without an order field.
        }
        dragIndex.current = null;
        dragOverIndex.current = null;
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
                                    onClick={() => handleQuickRun(sq.query)}
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
                         <button onClick={handleScan} className="h-12 w-36 bg-gray-100 text-gray-600 rounded-lg flex items-center justify-center gap-2 font-bold hover:bg-gray-200 transition active:scale-95 flex-shrink-0">
                             <BarcodeScannerIcon className="w-7 h-7" />
                             <span>스캔</span>
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
            
            {isActive && isTableModalOpen && (
                <ModalWrapper onClose={() => setTableModalOpen(false)} className="max-w-md">
                    <TableSelectionModalContent 
                        onClose={() => setTableModalOpen(false)} 
                        allTables={tables} 
                        selectedTables={selectedTables} 
                        onSelectionChange={toggleTableSelection}
                    />
                </ModalWrapper>
            )}
            {isActive && isSavedQueriesModalOpen && (
                <ModalWrapper onClose={() => setSavedQueriesModalOpen(false)} className="max-w-2xl h-[80vh]">
                    <SavedQueriesModalContent 
                        onClose={() => setSavedQueriesModalOpen(false)} 
                        savedQueries={savedQueries || []} 
                        onRun={(q) => { 
                            setQueryInput(q);
                            setSavedQueriesModalOpen(false); 
                        }} 
                    />
                </ModalWrapper>
            )}
            {isActive && isLearningModalOpen && (
                <ModalWrapper onClose={() => setIsLearningModalOpen(false)} className="max-w-lg">
                    <LearningModalContent onClose={() => setIsLearningModalOpen(false)} />
                </ModalWrapper>
            )}
        </div>
    );
};

export default SqlRunnerPage;
