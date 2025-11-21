import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAlert } from '../context/AppContext';
import { SpinnerIcon, CheckCircleIcon, TrashIcon, PencilSquareIcon, PlayCircleIcon, TableCellsIcon, BookmarkSquareIcon, StopCircleIcon, RemoveIcon } from '../components/Icons';
import { querySql, naturalLanguageToSql } from '../services/sqlService';
import { subscribeToSavedQueries, addSavedQuery, updateSavedQuery, deleteSavedQuery } from '../services/dbService';
import { getCachedSchema } from '../services/schemaService';
import { getLearningContext } from '../services/learningService';
import ToggleSwitch from '../components/ToggleSwitch';

// --- TYPE DEFINITIONS ---
type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

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
    isActive: boolean;
    title?: string;
}> = ({ children, onClose, className = 'max-w-lg', isActive, title }) => {
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

    return createPortal(
        <div
            className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-50' : 'bg-transparent'}`}
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            <div
                className={`bg-white rounded-xl shadow-lg w-full ${className} flex flex-col max-h-[85vh] transition-[opacity,transform] duration-300 will-change-[opacity,transform] ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
                onClick={e => e.stopPropagation()}
            >
                {title && (
                    <div className="p-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0">
                        <h3 className="font-bold text-lg text-gray-800">{title}</h3>
                        <button onClick={onClose} className="p-1 text-gray-500 hover:bg-gray-100 rounded-full">
                            <RemoveIcon className="w-6 h-6" />
                        </button>
                    </div>
                )}
                <div className="overflow-y-auto p-4">
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
};


// --- MAIN PAGE COMPONENT ---
const SqlRunnerPage: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const { showAlert, showToast } = useAlert();
    const [queryInput, setQueryInput] = useState('');
    const [lastSuccessfulQuery, setLastSuccessfulQuery] = useState('');
    const [result, setResult] = useState<QueryResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<QueryStatus>('idle');
    const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
    const [useSelectedTablesOnly, setUseSelectedTablesOnly] = useState(true);
    
    const [allTables, setAllTables] = useState<string[]>([]);
    const [selectedTables, setSelectedTables] = useState<string[]>([]);

    const [isTableModalOpen, setTableModalOpen] = useState(false);
    const [isSavedQueriesModalOpen, setSavedQueriesModalOpen] = useState(false);
    
    const abortControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (isActive) {
            getCachedSchema().then(schema => {
                if (schema) {
                    setAllTables(Object.keys(schema).sort());
                }
            });
        }
        const unsubscribe = subscribeToSavedQueries(setSavedQueries);
        return () => unsubscribe();
    }, [isActive]);

    const executeQuery = useCallback(async (sql: string, naturalLang?: string) => {
        setStatus('loading');
        setResult(null);
        setError(null);
        setLastSuccessfulQuery('');
        abortControllerRef.current = new AbortController();

        try {
            const data = await querySql(sql, abortControllerRef.current.signal);
            setResult(data);
            setStatus('success');
            setLastSuccessfulQuery(naturalLang || sql);
        } catch (err: any) {
            if (err.name !== 'AbortError') {
                setError(err.message || '알 수 없는 오류가 발생했습니다.');
                setStatus('error');
            }
        }
    }, []);

    const processNaturalLanguageQuery = useCallback(async (prompt: string) => {
        setStatus('loading');
        setError(null);
        try {
            const schema = await getCachedSchema();
            if (!schema) {
                throw new Error("데이터베이스 스키마 정보를 로드할 수 없습니다.");
            }

            let schemaForQuery = schema;
            if (useSelectedTablesOnly && selectedTables.length > 0) {
                schemaForQuery = Object.fromEntries(
                    Object.entries(schema).filter(([tableName]) => selectedTables.includes(tableName))
                );
            }
            const context = await getLearningContext();
            const { sql } = await naturalLanguageToSql(prompt, schemaForQuery, context);
            
            if (sql) {
                showToast('AI가 SQL 쿼리를 생성했습니다.', 'success');
                setQueryInput(sql); // Show generated SQL in input
                executeQuery(sql, prompt);
            } else {
                throw new Error('AI가 유효한 SQL을 생성하지 못했습니다.');
            }
        } catch (err: any) {
            setError(err.message || 'AI 쿼리 생성 중 오류 발생');
            setStatus('error');
        }
    }, [executeQuery, selectedTables, useSelectedTablesOnly, showToast]);

    const processAndExecute = useCallback(async (input: string) => {
        const currentInput = input.trim();
        if (!currentInput) {
            showAlert('실행할 내용을 입력해주세요.');
            return;
        }

        // Handle '@' shortcut for saved queries
        if (currentInput.startsWith('@')) {
            const parts = currentInput.slice(1).split(/\s+/);
            const queryName = parts[0];
            const additionalPrompt = parts.slice(1).join(' ');

            const savedQuery = savedQueries.find(q => q.name.toLowerCase() === queryName.toLowerCase());

            if (!savedQuery) {
                showAlert(`'${queryName}' 이름으로 저장된 쿼리를 찾을 수 없습니다.`);
                return;
            }

            // If there's additional context, treat it as a combined natural language query
            if (additionalPrompt) {
                const combinedPrompt = `Based on the query or concept named "${savedQuery.name}" (which is: "${savedQuery.query}"), please perform the following additional request: "${additionalPrompt}"`;
                processNaturalLanguageQuery(combinedPrompt);
            } else {
                // Execute the saved query directly
                if (savedQuery.type === 'sql') {
                    executeQuery(savedQuery.query, `@${savedQuery.name}`);
                } else {
                    processNaturalLanguageQuery(savedQuery.query);
                }
            }
            return;
        }

        const isLikelySql = /^(SELECT|UPDATE|DELETE|INSERT|CREATE|DROP|ALTER|TRUNCATE)\b/i.test(currentInput);

        if (isLikelySql) {
            executeQuery(currentInput);
        } else {
            processNaturalLanguageQuery(currentInput);
        }
    }, [executeQuery, savedQueries, showAlert, processNaturalLanguageQuery]);

    const handleExecuteClick = () => {
        if (status === 'loading') {
            abortControllerRef.current?.abort();
            setStatus('idle');
            showToast('쿼리 실행이 중단되었습니다.', 'error');
            return;
        }
        processAndExecute(queryInput);
    };

    const handleSaveQuery = () => {
        const name = prompt('저장할 쿼리의 이름을 입력하세요:', '');
        if (name && lastSuccessfulQuery) {
            const isNatural = !/^(SELECT|UPDATE|DELETE|INSERT)\b/i.test(lastSuccessfulQuery);
            addSavedQuery({
                name,
                query: lastSuccessfulQuery,
                type: isNatural ? 'natural' : 'sql',
                isQuickRun: false
            }).then(() => showToast('쿼리가 저장되었습니다.', 'success'));
        }
    };

    const handleDeleteSavedQuery = (id: string) => {
        showAlert(
            '이 쿼리를 삭제하시겠습니까?',
            () => {
                deleteSavedQuery(id).then(() => showToast('쿼리가 삭제되었습니다.', 'success'));
            },
            '삭제',
            'bg-red-500 hover:bg-red-600'
        );
    };

    const handleLoadSavedQuery = (query: SavedQuery) => {
        setQueryInput(query.query);
        setSavedQueriesModalOpen(false);
    };
    
    const handleCopyResults = () => {
        if (!result || !result.recordset || result.recordset.length === 0) return;
        
        const headers = Object.keys(result.recordset[0]);
        const tsv = [
            headers.join('\t'),
            ...result.recordset.map(row => 
                headers.map(header => {
                    const value = row[header];
                    if (value === null || value === undefined) return '';
                    return String(value).replace(/\t|\n|\r/g, ' ');
                }).join('\t')
            )
        ].join('\n');

        navigator.clipboard.writeText(tsv).then(() => {
            showToast('결과가 클립보드에 복사되었습니다.', 'success');
        }, () => {
            showToast('복사에 실패했습니다.', 'error');
        });
    };
    
    const sortedTables = useMemo(() => {
        const selectedSet = new Set(selectedTables);
        const selected = allTables.filter(t => selectedSet.has(t)).sort((a, b) => a.localeCompare(b));
        const unselected = allTables.filter(t => !selectedSet.has(t)).sort((a, b) => a.localeCompare(b));
        return [...selected, ...unselected];
    }, [allTables, selectedTables]);

    const toggleTable = (table: string) => {
        setSelectedTables(prev => 
            prev.includes(table) ? prev.filter(t => t !== table) : [...prev, table]
        );
    };

    return (
        <div className="h-full flex flex-col bg-gray-50">
            <div className="p-3 bg-white border-b border-gray-200 z-10 flex flex-col gap-3 flex-shrink-0">
                <div className="flex items-center justify-center gap-2 flex-wrap">
                    <button onClick={() => setTableModalOpen(true)} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 text-sm active:scale-95 transition">
                        <TableCellsIcon className="w-5 h-5"/> <span>테이블 선택 ({selectedTables.length})</span>
                    </button>
                    <button onClick={() => setSavedQueriesModalOpen(true)} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 text-sm active:scale-95 transition">
                        <BookmarkSquareIcon className="w-5 h-5"/> <span>쿼리 관리</span>
                    </button>
                    <ToggleSwitch id="ai-scope" label="선택된 테이블만 참고" checked={useSelectedTablesOnly} onChange={setUseSelectedTablesOnly} />
                </div>
                <textarea 
                    value={queryInput} 
                    onChange={(e) => setQueryInput(e.target.value)}
                    onClick={(e) => e.currentTarget.focus()}
                    rows={3} 
                    placeholder="자연어나 SQL 쿼리를 입력하세요... (예: @오늘매출)"
                    className="w-full p-2 border border-gray-300 rounded-lg font-mono text-base text-gray-900 bg-white select-text focus:ring-blue-500 focus:border-blue-500"
                    style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
                />
                <button 
                    onClick={handleExecuteClick}
                    className="w-full h-12 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 text-lg transition active:scale-95 shadow-lg shadow-blue-500/30"
                >
                    {status === 'loading' ? <><StopCircleIcon className="w-7 h-7"/> <span>중지</span></> : <><PlayCircleIcon className="w-7 h-7"/> <span>실행</span></>}
                </button>
            </div>
            
            <main className="flex-grow p-3 flex overflow-hidden">
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm w-full flex flex-col h-full">
                    <div className="flex justify-between items-center mb-2 flex-shrink-0">
                        <h3 className="font-bold text-lg">결과</h3>
                        {status === 'success' && result && (
                             <div className="flex items-center gap-2">
                                <button onClick={handleSaveQuery} className="text-xs font-semibold px-2 py-1 bg-gray-100 rounded-md hover:bg-gray-200">이 쿼리 저장</button>
                                {result.recordset?.length > 0 && <button onClick={handleCopyResults} className="text-xs font-semibold px-2 py-1 bg-gray-100 rounded-md hover:bg-gray-200">결과 복사</button>}
                            </div>
                        )}
                    </div>

                    <div className="flex-grow overflow-auto">
                        {status === 'loading' && <div className="flex justify-center items-center h-full"><SpinnerIcon className="w-8 h-8 text-blue-500" /></div>}
                        {status === 'error' && <div className="p-4 bg-red-50 text-red-700 rounded-lg border border-red-200 font-medium">{error}</div>}
                        {status === 'success' && result && (
                            <div>
                                <p className="text-sm text-green-600 font-semibold mb-2 flex items-center gap-2"><CheckCircleIcon className="w-5 h-5"/>쿼리 성공! (영향 받은 행: {result.rowsAffected})</p>
                                {result.recordset?.length > 0 ? (
                                    <div className="border border-gray-200 rounded-lg overflow-auto">
                                        <table className="w-full text-sm text-left">
                                            <thead className="bg-gray-100 sticky top-0 z-10"><tr className="border-b">{Object.keys(result.recordset[0]).map(key => <th key={key} className="p-2 font-bold whitespace-nowrap">{key}</th>)}</tr></thead>
                                            <tbody>{result.recordset.map((row, i) => (<tr key={i} className="border-b last:border-b-0 hover:bg-gray-50">{Object.values(row).map((val: any, j) => <td key={j} className="p-2 whitespace-nowrap">{val === null ? 'NULL' : String(val)}</td>)}</tr>))}</tbody>
                                        </table>
                                    </div>
                                ) : <p className="text-gray-500">결과 데이터가 없습니다.</p>}
                            </div>
                        )}
                         {status === 'idle' && !result && <div className="flex justify-center items-center h-full text-gray-400">쿼리를 실행하여 결과를 확인하세요.</div>}
                    </div>
                </div>
            </main>

            {/* Table Selection Modal */}
            <ModalWrapper isActive={isTableModalOpen} onClose={() => setTableModalOpen(false)} title="테이블 선택">
                <div className="space-y-1">
                    <div className="flex gap-2 mb-3">
                         <button onClick={() => setSelectedTables([...allTables])} className="flex-1 py-2 text-sm bg-blue-50 text-blue-600 font-bold rounded-lg">전체 선택</button>
                         <button onClick={() => setSelectedTables([])} className="flex-1 py-2 text-sm bg-gray-100 text-gray-600 font-bold rounded-lg">전체 해제</button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 max-h-[60vh] overflow-y-auto">
                        {sortedTables.map(table => (
                            <label key={table} className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${selectedTables.includes(table) ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50 border-gray-200'}`}>
                                <input 
                                    type="checkbox" 
                                    checked={selectedTables.includes(table)} 
                                    onChange={() => toggleTable(table)}
                                    className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                                />
                                <span className="ml-3 font-medium text-gray-700">{table}</span>
                            </label>
                        ))}
                    </div>
                    <div className="mt-4 pt-2 border-t border-gray-100 flex justify-end">
                        <button onClick={() => setTableModalOpen(false)} className="px-4 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 active:scale-95">
                            완료 ({selectedTables.length})
                        </button>
                    </div>
                </div>
            </ModalWrapper>

            {/* Saved Queries Modal */}
            <ModalWrapper isActive={isSavedQueriesModalOpen} onClose={() => setSavedQueriesModalOpen(false)} title="저장된 쿼리">
                {savedQueries.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">저장된 쿼리가 없습니다.</p>
                ) : (
                    <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                        {savedQueries.map(q => (
                            <div key={q.id} className="p-3 border border-gray-200 rounded-lg hover:border-blue-300 transition-colors">
                                <div className="flex justify-between items-start mb-1">
                                    <h4 className="font-bold text-gray-800">{q.name}</h4>
                                    <div className="flex gap-1">
                                         <button onClick={() => handleLoadSavedQuery(q)} className="p-1.5 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md" title="불러오기">
                                            <PencilSquareIcon className="w-4 h-4"/>
                                        </button>
                                        <button onClick={() => handleDeleteSavedQuery(q.id)} className="p-1.5 text-red-600 bg-red-50 hover:bg-red-100 rounded-md" title="삭제">
                                            <TrashIcon className="w-4 h-4"/>
                                        </button>
                                    </div>
                                </div>
                                <p className="text-sm text-gray-600 line-clamp-2 font-mono bg-gray-50 p-1.5 rounded mb-2">{q.query}</p>
                                <button 
                                    onClick={() => {
                                        setQueryInput(q.query);
                                        setSavedQueriesModalOpen(false);
                                        if (q.type === 'sql') executeQuery(q.query);
                                        else processAndExecute(q.query);
                                    }}
                                    className="w-full py-2 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 active:scale-95 flex items-center justify-center gap-1"
                                >
                                    <PlayCircleIcon className="w-4 h-4" /> 바로 실행
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </ModalWrapper>
        </div>
    );
};

export default SqlRunnerPage;