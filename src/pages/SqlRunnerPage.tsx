import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAlert } from '../context/AppContext';
import { SpinnerIcon, BarcodeScannerIcon, CheckCircleIcon, TrashIcon, PencilSquareIcon, SparklesIcon, StopCircleIcon, PlayCircleIcon, TableCellsIcon, BookmarkSquareIcon, StarIcon, DocumentIcon } from '../components/Icons';
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
                    setAllTables(Object.keys(schema));
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

    const processAndExecute = useCallback(async (input: string) => {
        const currentInput = input.trim();
        if (!currentInput) {
            showAlert('실행할 내용을 입력해주세요.');
            return;
        }

        const isLikelySql = /^(SELECT|UPDATE|DELETE|INSERT|CREATE|DROP|ALTER|TRUNCATE)\b/i.test(currentInput);

        if (isLikelySql) {
            executeQuery(currentInput);
        } else {
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
                const { sql } = await naturalLanguageToSql(currentInput, schemaForQuery, context);
                
                if (sql) {
                    showToast('AI가 SQL 쿼리를 생성했습니다.', 'success');
                    setQueryInput(sql); // Show generated SQL in input
                    executeQuery(sql, currentInput);
                } else {
                    throw new Error('AI가 유효한 SQL을 생성하지 못했습니다.');
                }
            } catch (err: any) {
                setError(err.message || 'AI 쿼리 생성 중 오류 발생');
                setStatus('error');
            }
        }
    }, [executeQuery, selectedTables, useSelectedTablesOnly, showAlert, showToast]);

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

    return (
        <div className="h-full flex flex-col bg-gray-50">
            <div className="p-3 bg-white border-b border-gray-200 z-10 flex flex-col gap-3">
                <div className="flex items-center justify-center gap-2">
                    <button onClick={() => setTableModalOpen(true)} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 text-sm">
                        <TableCellsIcon className="w-5 h-5"/> <span>테이블 선택 ({selectedTables.length})</span>
                    </button>
                    <button onClick={() => setSavedQueriesModalOpen(true)} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 text-sm">
                        <BookmarkSquareIcon className="w-5 h-5"/> <span>쿼리 관리</span>
                    </button>
                    <ToggleSwitch id="ai-scope" label="선택된 테이블만 참고" checked={useSelectedTablesOnly} onChange={setUseSelectedTablesOnly} />
                </div>
                <textarea 
                    value={queryInput} 
                    onChange={(e) => setQueryInput(e.target.value)} 
                    rows={3} 
                    placeholder="자연어나 SQL 쿼리를 입력하세요..."
                    className="w-full p-2 border border-gray-300 rounded-lg font-mono text-base focus:ring-blue-500 focus:border-blue-500"
                />
                <button 
                    onClick={handleExecuteClick}
                    className="w-full h-12 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 text-lg transition active:scale-95 shadow-lg shadow-blue-500/30"
                >
                    {status === 'loading' ? <><StopCircleIcon className="w-7 h-7"/> <span>중지</span></> : <><PlayCircleIcon className="w-7 h-7"/> <span>실행</span></>}
                </button>
            </div>
            
            <main className="flex-grow overflow-hidden p-3 flex">
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm w-full flex flex-col">
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="font-bold text-lg">결과</h3>
                        {status === 'success' && result && (
                             <div className="flex items-center gap-2">
                                <button onClick={handleSaveQuery} className="text-xs font-semibold px-2 py-1 bg-gray-100 rounded-md hover:bg-gray-200">이 쿼리 저장</button>
                                <button onClick={handleCopyResults} className="text-xs font-semibold px-2 py-1 bg-gray-100 rounded-md hover:bg-gray-200">결과 복사</button>
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
        </div>
    );
};

export default SqlRunnerPage;