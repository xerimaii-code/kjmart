import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAlert, useMiscUI, useScanner } from '../context/AppContext';
import { SpinnerIcon, CheckCircleIcon, TrashIcon, PencilSquareIcon, PlayCircleIcon, TableCellsIcon, BookmarkSquareIcon, StopCircleIcon, RemoveIcon, SparklesIcon, StarIcon, BarcodeScannerIcon } from '../components/Icons';
import { querySql, naturalLanguageToSql, aiChat, sqlToNaturalLanguage, generateQueryName } from '../services/sqlService';
import { subscribeToSavedQueries, addSavedQuery, deleteSavedQuery, updateSavedQuery, getValue, setValue } from '../services/dbService';
import { getCachedSchema } from '../services/schemaService';
import { getLearningContext } from '../services/learningService';
import ToggleSwitch from '../components/ToggleSwitch';

// --- TYPE DEFINITIONS ---
type QueryStatus = 'idle' | 'loading' | 'success' | 'error';
type QuerySaveType = 'sql' | 'natural';

interface QueryResult {
    recordset?: any[];
    rowsAffected?: number;
    answer?: string;
}
interface SavedQuery {
    id: string;
    name: string;
    query: string;
    type: 'sql' | 'natural';
    isQuickRun?: boolean;
    generatedSql?: string;
}

interface LearningItem {
    id: string;
    title: string;
    content: string;
}

const INITIAL_VISIBLE_ROWS = 50;
const ROWS_PER_LOAD = 100;

// --- REUSABLE MODAL WRAPPERS ---
const FullScreenModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
}> = ({ isOpen, onClose, title, children, footer }) => {
    const [isRendered, setIsRendered] = useState(false);

    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => setIsRendered(true), 10);
            return () => clearTimeout(timer);
        } else {
            setIsRendered(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return createPortal(
        <div 
            className={`fixed inset-0 bg-black z-[90] transition-opacity duration-300 ${isRendered ? 'bg-opacity-50' : 'bg-opacity-0'}`}
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            <div 
                style={{ top: 'calc(3.5rem + env(safe-area-inset-top))' }}
                className={`absolute bottom-0 left-0 right-0 flex flex-col bg-gray-50 shadow-lg transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.32,1.25,0.37,1.02)] ${isRendered ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'} rounded-t-2xl will-change-[opacity,transform]`}
                onClick={e => e.stopPropagation()}
            >
                <header className="relative bg-white p-4 flex-shrink-0 border-b border-gray-200 z-20 rounded-t-2xl flex items-center justify-center">
                    <h2 className="text-lg font-bold text-gray-800 truncate">{title}</h2>
                    <button onClick={onClose} className="absolute top-1/2 right-4 -translate-y-1/2 p-2 text-gray-500 hover:bg-gray-200 rounded-full transition-colors" aria-label="닫기">
                        <RemoveIcon className="w-6 h-6"/>
                    </button>
                </header>
                <main className="flex-grow overflow-y-auto">
                    {children}
                </main>
                {footer && (
                     <footer className="p-3 bg-white border-t border-gray-200 z-10 flex-shrink-0">
                        {footer}
                    </footer>
                )}
            </div>
        </div>,
        document.body
    );
};


// --- MAIN PAGE COMPONENT ---
const SqlRunnerPage: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const { showAlert, showToast } = useAlert();
    const { sqlQueryInput, setSqlQueryInput } = useMiscUI();
    const { openScanner } = useScanner();
    
    const [generatedSql, setGeneratedSql] = useState<string | null>(null);
    const [lastSuccessfulQuery, setLastSuccessfulQuery] = useState('');
    
    const [result, setResult] = useState<QueryResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<QueryStatus>('idle');
    const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
    const [useSelectedTablesOnly, setUseSelectedTablesOnly] = useState(false);
    
    const [allTables, setAllTables] = useState<string[]>([]);
    const [selectedTables, setSelectedTables] = useState<string[]>([]);

    const [isTableModalOpen, setTableModalOpen] = useState(false);
    const [isSavedQueriesModalOpen, setSavedQueriesModalOpen] = useState(false);
    const [isAiModalOpen, setAiModalOpen] = useState(false);
    const [learningItems, setLearningItems] = useState<LearningItem[]>([]);
    const [visibleResultCount, setVisibleResultCount] = useState(INITIAL_VISIBLE_ROWS);
    
    const [editingQuery, setEditingQuery] = useState<SavedQuery | null>(null);
    const [editingLearningItem, setEditingLearningItem] = useState<LearningItem | null>(null);
    const [queryViewStates, setQueryViewStates] = useState<Record<string, 'natural' | 'sql'>>({});

    const [isAiMode, setIsAiMode] = useState(false);
    
    const abortControllerRef = useRef<AbortController | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const tableButtonLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isTableButtonLongPress = useRef(false);
    const executeLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isExecuteLongPress = useRef(false);
    const aiLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isAiLongPress = useRef(false);
    
    const dragIndex = useRef<number | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);


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

    useEffect(() => {
        if (isAiModalOpen) {
            getValue('learning/sqlContext', []).then((data: any) => {
                const items = Array.isArray(data) 
                    ? data.map((item, index) => ({ id: item.id || `item_${index}_${Date.now()}`, ...item }))
                    : [];
                setLearningItems(items);
            });
        }
    }, [isAiModalOpen]);

    const executeQuery = useCallback(async (sql: string, naturalLang?: string) => {
        setStatus('loading');
        setResult(null);
        setError(null);
        abortControllerRef.current = new AbortController();

        try {
            const data = await querySql(sql, abortControllerRef.current.signal);
            setResult(data);
            setStatus('success');
            const queryToSave = naturalLang || sql;
            setLastSuccessfulQuery(queryToSave);
            setVisibleResultCount(INITIAL_VISIBLE_ROWS);
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
        setResult(null);
        setGeneratedSql(null);
        
        try {
            const schema = await getCachedSchema();
            if (!schema) throw new Error("데이터베이스 스키마 정보를 로드할 수 없습니다.");

            let schemaForQuery = useSelectedTablesOnly && selectedTables.length > 0
                ? Object.fromEntries(Object.entries(schema).filter(([tableName]) => selectedTables.includes(tableName)))
                : schema;
            
            const context = await getLearningContext();
            
            const userCurrentDate = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

            if (isAiMode) {
                const response = await aiChat(prompt, schemaForQuery, context, userCurrentDate);
                setResult({ answer: response.answer });
                setStatus('success');
                setLastSuccessfulQuery(prompt);
            } else {
                const { sql } = await naturalLanguageToSql(prompt, schemaForQuery, context);
                if (sql) {
                    setGeneratedSql(sql);
                    executeQuery(sql, prompt);
                } else {
                    throw new Error('AI가 유효한 SQL을 생성하지 못했습니다.');
                }
            }
        } catch (err: any) {
            setError(err.message || 'AI 처리 중 오류 발생');
            setStatus('error');
        }
    }, [executeQuery, selectedTables, useSelectedTablesOnly, isAiMode]);

    const processAndExecute = useCallback(async (input: string) => {
        const currentInput = input.trim();
        if (!currentInput) {
            showAlert('실행할 내용을 입력해주세요.');
            return;
        }

        setGeneratedSql(null);

        if (currentInput.startsWith('@')) {
            const queryName = currentInput.slice(1).split(/\s+/)[0];
            const savedQuery = savedQueries.find(q => q.name.toLowerCase() === queryName.toLowerCase());
            if (savedQuery) {
                if (savedQuery.type === 'sql') executeQuery(savedQuery.query, `@${savedQuery.name}`);
                else processNaturalLanguageQuery(savedQuery.query);
                return;
            }
        }

        const isLikelySql = /^(SELECT|UPDATE|DELETE|INSERT|CREATE|DROP|ALTER|TRUNCATE)\b/i.test(currentInput);
        if (isLikelySql && !isAiMode) executeQuery(currentInput);
        else processNaturalLanguageQuery(currentInput);
    }, [executeQuery, savedQueries, showAlert, processNaturalLanguageQuery, isAiMode]);

    const handleExecuteStart = () => {
        isExecuteLongPress.current = false;
        executeLongPressTimer.current = setTimeout(() => {
            isExecuteLongPress.current = true;
            setSqlQueryInput('');
            if (navigator.vibrate) navigator.vibrate(50);
            showToast('입력창이 초기화되었습니다.', 'success');
        }, 600);
    };

    const handleExecuteEnd = (e: React.MouseEvent | React.TouchEvent) => {
        if (executeLongPressTimer.current) clearTimeout(executeLongPressTimer.current);
        if (isExecuteLongPress.current && e.cancelable && e.type !== 'touchend') e.preventDefault();
    };

    const handleExecuteClickWrapped = () => {
        if (isExecuteLongPress.current) {
            isExecuteLongPress.current = false; return;
        }
        if (status === 'loading') {
            abortControllerRef.current?.abort();
            setStatus('idle');
            showToast('실행이 중단되었습니다.', 'error');
        } else {
            processAndExecute(sqlQueryInput);
        }
    };
    
    const handleAiButtonStart = () => {
        isAiLongPress.current = false;
        aiLongPressTimer.current = setTimeout(() => {
            isAiLongPress.current = true;
            setIsAiMode(prev => {
                const next = !prev;
                if (navigator.vibrate) navigator.vibrate(50);
                showToast(next ? '완전 생성형 AI 모드 활성화' : '기본(Text-to-SQL) 모드 활성화', 'success');
                return next;
            });
        }, 600);
    };

    const handleAiButtonEnd = (e: React.MouseEvent | React.TouchEvent) => {
        if (aiLongPressTimer.current) clearTimeout(aiLongPressTimer.current);
        if (!isAiLongPress.current) {
            if (status !== 'loading') processAndExecute(sqlQueryInput);
        } else if(e.cancelable && e.type !== 'touchend') {
            e.preventDefault();
        }
    };

    const handleTableButtonStart = () => {
        isTableButtonLongPress.current = false;
        tableButtonLongPressTimer.current = setTimeout(() => {
            isTableButtonLongPress.current = true;
            setUseSelectedTablesOnly(prev => {
                const next = !prev;
                if(navigator.vibrate) navigator.vibrate(50);
                showToast(next ? '선택된 테이블만 사용' : '모든 테이블 사용', 'success');
                return next;
            });
        }, 600);
    };

    const handleTableButtonEnd = (e: React.MouseEvent | React.TouchEvent) => {
        if (tableButtonLongPressTimer.current) clearTimeout(tableButtonLongPressTimer.current);
        if (isTableButtonLongPress.current && e.cancelable && e.type !== 'touchend') e.preventDefault();
    };

    const handleTableButtonClick = () => {
        if (isTableButtonLongPress.current) {
            isTableButtonLongPress.current = false; return;
        }
        setTableModalOpen(true);
    };


    const handleSaveQuery = async () => {
        const currentQuery = sqlQueryInput.trim();
        if (!currentQuery) {
            showAlert("저장할 쿼리가 없습니다.");
            return;
        }
        
        const isCurrentlyNatural = !( /^(SELECT|UPDATE|DELETE|INSERT|CREATE|DROP|ALTER|TRUNCATE)\b/i.test(currentQuery));
    
        const summary = result?.answer
            ? `AI Answer: ${result.answer.substring(0, 100)}...`
            : `Result: ${result?.recordset?.length ?? result?.rowsAffected ?? 0} rows. Columns: ${result?.recordset?.[0] ? Object.keys(result.recordset[0]).join(', ') : 'N/A'}`;
    
        try {
            const { name: suggestedName } = await generateQueryName(currentQuery, summary);
            const name = prompt('저장할 쿼리의 이름을 입력하세요:', suggestedName || '');
    
            if (name) {
                const queryData: Omit<SavedQuery, 'id'> = {
                    name,
                    query: currentQuery,
                    type: isCurrentlyNatural ? 'natural' : 'sql',
                    isQuickRun: false,
                };
                if (isCurrentlyNatural && generatedSql) { (queryData as any).generatedSql = generatedSql; }
                await addSavedQuery(queryData);
                showToast('쿼리가 저장되었습니다.', 'success');
            }
        } catch (err: any) {
            showToast(`이름 생성 실패: ${err.message}`, 'error');
            const name = prompt('저장할 쿼리의 이름을 입력하세요:');
            if (name) {
                const queryData: Omit<SavedQuery, 'id'> = { name, query: currentQuery, type: isCurrentlyNatural ? 'natural' : 'sql', isQuickRun: false };
                if (isCurrentlyNatural && generatedSql) { (queryData as any).generatedSql = generatedSql; }
                await addSavedQuery(queryData);
                showToast('쿼리가 저장되었습니다.', 'success');
            }
        }
    };
    
    const handleConvertToSql = () => {
        if (generatedSql) {
            setSqlQueryInput(generatedSql);
            setResult(null);
            setStatus('idle');
            setGeneratedSql(null);
            showToast('SQL 쿼리가 실행창에 채워졌습니다.', 'success');
        }
    };
    
    const handleConvertToNaturalLanguage = async () => {
        const sqlToConvert = generatedSql || (isOriginalQuerySql ? lastSuccessfulQuery : null);
        
        if (!sqlToConvert) {
            showToast('자연어로 변환할 SQL 쿼리가 없습니다.', 'error');
            return;
        }
    
        setStatus('loading');
        try {
            const { naturalLanguage } = await sqlToNaturalLanguage(sqlToConvert);
            setSqlQueryInput(naturalLanguage);
            setResult(null);
            setStatus('idle');
            showToast('자연어 설명이 실행창에 채워졌습니다.', 'success');
        } catch (err: any) {
            showToast('자연어 변환에 실패했습니다.', 'error');
            setStatus('error');
            setError(err.message);
        }
    };
    
    const handleBarcodeScan = useCallback(() => {
        openScanner(
            'sql-runner' as any,
            (barcode) => {
                setSqlQueryInput(prev => `${prev}${prev ? ' ' : ''}${barcode}`);
                textareaRef.current?.focus();
            },
            false
        );
    }, [openScanner, setSqlQueryInput]);

    const handleQuickRun = (query: SavedQuery) => {
        setSavedQueriesModalOpen(false);
        if (query.type === 'sql') executeQuery(query.query, `@${query.name}`);
        else processNaturalLanguageQuery(query.query);
    };

    const handleAddLearningItem = () => {
        const id = 'item_' + Date.now();
        const newItem = { id, title: '', content: '' };
        setEditingLearningItem(newItem);
    };
    
    const handleDeleteLearningItem = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        const itemToDelete = learningItems.find(item => item.id === id);
        if (!itemToDelete) return;

        showAlert(
            `'${itemToDelete.title || '이 규칙'}'을(를) 삭제하시겠습니까?`,
            async () => {
                const newItems = learningItems.filter(item => item.id !== id);
                try {
                    await setValue('learning/sqlContext', newItems);
                    setLearningItems(newItems);
                    showToast('규칙이 삭제되었습니다.', 'success');
                } catch (err) {
                    showAlert('규칙 삭제에 실패했습니다.');
                }
            },
            '삭제',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    };
    
    const handleDragStart = (e: React.DragEvent, index: number) => {
        dragIndex.current = index; e.dataTransfer.effectAllowed = 'move';
        (e.currentTarget as HTMLElement).classList.add('dragging');
    };
    const handleDragEnter = (e: React.DragEvent, index: number) => {
        e.preventDefault(); if (dragIndex.current !== index) setDropIndex(index);
    };
    const handleDragOver = (e: React.DragEvent) => e.preventDefault();
    const handleDragEnd = (e: React.DragEvent) => {
        (e.currentTarget as HTMLElement).classList.remove('dragging');
        dragIndex.current = null; setDropIndex(null);
    };
    const handleDrop = async () => {
        if (dragIndex.current !== null && dropIndex !== null) {
            const from = dragIndex.current; const to = dropIndex > from ? dropIndex - 1 : dropIndex;
            if (from !== to) {
                const reorderedItems = [...learningItems];
                const [removed] = reorderedItems.splice(from, 1);
                reorderedItems.splice(to, 0, removed);
                try {
                    await setValue('learning/sqlContext', reorderedItems);
                    setLearningItems(reorderedItems);
                    showToast('규칙 순서가 저장되었습니다.', 'success');
                } catch (err) {
                    showAlert('순서 저장에 실패했습니다.');
                }
            }
        }
    };

    const handleCopyResults = () => {
        let text = result?.answer;
        if (!text && result?.recordset?.length) {
            const headers = Object.keys(result.recordset[0]);
            text = [
                headers.join('\t'),
                ...result.recordset.map(r => headers.map(h => String(r[h] ?? '').replace(/\s/g, ' ')).join('\t'))
            ].join('\n');
        }
        if (text) navigator.clipboard.writeText(text).then(() => showToast('복사 완료.', 'success'), () => showToast('복사 실패.', 'error'));
    };
    
    const sortedTables = useMemo(() => {
        const s = new Set(selectedTables);
        return [...allTables].sort((a, b) => {
            const aSel = s.has(a); const bSel = s.has(b);
            if (aSel !== bSel) return aSel ? -1 : 1;
            return a.localeCompare(b, 'ko');
        });
    }, [allTables, selectedTables]);

    const toggleTable = (t: string) => setSelectedTables(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);

    const handleSaveUpdatedQuery = (id: string, updates: Partial<SavedQuery>) => {
        updateSavedQuery(id, updates).then(() => showToast('쿼리가 수정되었습니다.', 'success'));
        setEditingQuery(null);
    };

    const handleSaveLearningItem = async (itemToSave: LearningItem) => {
        const isNew = !learningItems.some(item => item.id === itemToSave.id);
        const newItems = isNew
            ? [itemToSave, ...learningItems]
            : learningItems.map(item => item.id === itemToSave.id ? itemToSave : item);

        try {
            await setValue('learning/sqlContext', newItems);
            setLearningItems(newItems);
            showToast('AI 학습 데이터가 저장되었습니다.', 'success');
            setEditingLearningItem(null);
        } catch (e) {
            showAlert('저장에 실패했습니다.');
        }
    };

    const toggleQueryView = (queryId: string) => {
        setQueryViewStates(prev => ({
            ...prev,
            [queryId]: (prev[queryId] === 'sql') ? 'natural' : 'sql'
        }));
    };

    const hasRecordset = result?.recordset && result.recordset.length > 0;
    const successText = `쿼리 성공! ${hasRecordset ? `결과: ${result.recordset.length}건` : `영향 받은 행: ${result?.rowsAffected ?? 0}`}`;

    const isOriginalQuerySql = lastSuccessfulQuery && /^(SELECT|UPDATE|DELETE|INSERT|CREATE|DROP|ALTER|TRUNCATE)\b/i.test(lastSuccessfulQuery);

    return (
        <div className="h-full flex flex-col bg-gray-50">
            <div className="p-2 bg-white border-b border-gray-200 z-10 flex flex-col gap-2 flex-shrink-0">
                 <div className="flex items-center gap-2 flex-wrap">
                    <button 
                        onMouseDown={handleTableButtonStart}
                        onMouseUp={handleTableButtonEnd}
                        onMouseLeave={handleTableButtonEnd}
                        onTouchStart={handleTableButtonStart}
                        onTouchEnd={handleTableButtonEnd}
                        onClick={handleTableButtonClick}
                        className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 border rounded-lg font-semibold text-sm active:scale-95 transition select-none ${useSelectedTablesOnly ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    >
                        <TableCellsIcon className="w-5 h-5"/> 
                        <span className="truncate">{useSelectedTablesOnly ? `선택 (${selectedTables.length})` : '전체 테이블'}</span>
                    </button>
                    <button onClick={() => setSavedQueriesModalOpen(true)} className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 text-sm active:scale-95 transition"><BookmarkSquareIcon className="w-5 h-5"/> <span>저장된 쿼리</span></button>
                    <button onClick={() => setAiModalOpen(true)} className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 text-sm active:scale-95 transition"><SparklesIcon className="w-5 h-5 text-purple-500"/> <span>AI 학습</span></button>
                </div>
                {savedQueries.some(q => q.isQuickRun) && (
                    <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-gray-200/80">
                         {savedQueries.filter(q => q.isQuickRun).map(q => (<button key={q.id} onClick={() => handleQuickRun(q)} className="flex-shrink-0 px-2 py-1 bg-blue-100 text-blue-700 border border-blue-200 rounded-md text-xs font-bold hover:bg-blue-200 active:scale-95 transition">{q.name}</button>))}
                    </div>
                )}
                <textarea 
                    ref={textareaRef} value={sqlQueryInput} onChange={(e) => setSqlQueryInput(e.target.value)}
                    placeholder={isAiMode ? "AI에게 자유롭게 질문하세요..." : "자연어나 SQL 쿼리를 입력하세요..."}
                    className={`w-full h-20 p-2 border rounded-lg font-mono text-base text-gray-900 bg-white select-text transition-colors resize-none ${isAiMode ? 'border-purple-400 ring-1 ring-purple-400 focus:ring-purple-500 focus:border-purple-500' : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'}`}
                    style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
                    autoComplete="off" autoCapitalize="none" spellCheck={false}
                />
                <div className="flex gap-2">
                    <button onMouseDown={handleExecuteStart} onMouseUp={handleExecuteEnd} onMouseLeave={handleExecuteEnd} onTouchStart={handleExecuteStart} onTouchEnd={handleExecuteEnd} onClick={handleExecuteClickWrapped} className={`flex-grow h-12 text-white font-bold rounded-lg flex items-center justify-center gap-2 text-lg transition active:scale-95 shadow-lg select-none ${isAiMode ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-500/30' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/30'}`}>
                        {status === 'loading' ? <><StopCircleIcon className="w-7 h-7"/> <span>중지</span></> : <><PlayCircleIcon className="w-7 h-7"/> <span>실행</span></>}
                    </button>
                     <button
                        onClick={handleBarcodeScan}
                        className="flex items-center justify-center border rounded-lg font-semibold bg-white border-gray-300 text-gray-600 hover:bg-gray-50 active:scale-95 transition shadow-sm w-16"
                        aria-label="바코드 스캔"
                        title="바코드 스캔"
                    >
                        <BarcodeScannerIcon className="w-7 h-7" />
                    </button>
                    <button onMouseDown={handleAiButtonStart} onMouseUp={handleAiButtonEnd} onMouseLeave={handleAiButtonEnd} onTouchStart={handleAiButtonStart} onTouchEnd={handleAiButtonEnd} className={`flex items-center justify-center border rounded-lg font-semibold hover:opacity-90 active:scale-95 transition shadow-sm ${isAiMode ? 'bg-purple-100 border-purple-300 text-purple-600 px-3 w-auto' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50 w-16'}`} aria-label="AI 모드" title="짧게 누르면 AI 실행, 길게 누르면 AI 모드 전환">
                        <SparklesIcon className="w-7 h-7"/>
                        {isAiMode && <span className="ml-1 text-sm whitespace-nowrap">AI 모드</span>}
                    </button>
                </div>
            </div>
            <main className="flex-grow p-3 flex overflow-hidden">
                <div className="relative bg-white p-4 rounded-xl border border-gray-200 shadow-sm w-full flex flex-col h-full">
                    {(status === 'success' || status === 'error') && (
                        <button
                            onClick={() => { setResult(null); setError(null); setStatus('idle'); setGeneratedSql(null); }}
                            className="absolute top-2 right-2 z-10 p-1 text-gray-400 hover:bg-gray-100 rounded-full transition-colors"
                            aria-label="결과 지우기" title="결과 지우기"
                        >
                            <RemoveIcon className="w-4 h-4" />
                        </button>
                    )}
                    <div className="flex justify-end items-center mb-2 flex-shrink-0 h-8 pr-8">
                        {status === 'success' && result && (
                            <div className="flex items-center gap-2">
                                <button onClick={handleSaveQuery} className="text-xs font-semibold px-2 py-1 bg-gray-100 rounded-md hover:bg-gray-200">이 쿼리 저장</button>
                                <button onClick={handleCopyResults} className="text-xs font-semibold px-2 py-1 bg-gray-100 rounded-md hover:bg-gray-200">결과 복사</button>
                                {generatedSql && !isAiMode && (<button onClick={handleConvertToSql} className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200">SQL로 변환</button>)}
                                {isOriginalQuerySql && !result.answer && (<button onClick={handleConvertToNaturalLanguage} className="text-xs font-semibold px-2 py-1 bg-purple-100 text-purple-700 rounded-md hover:bg-purple-200">자연어로 변환</button>)}
                            </div>
                        )}
                    </div>
                    <div className="flex-grow overflow-auto select-text" style={{ userSelect: 'text', WebkitUserSelect: 'text' }}>
                        {status === 'loading' && <div className="flex justify-center items-center h-full"><SpinnerIcon className="w-8 h-8 text-blue-500" /></div>}
                        {status === 'error' && <div className="p-4 bg-red-50 text-red-700 rounded-lg border border-red-200 font-medium">{error}</div>}
                        {status === 'success' && result && (
                            <div>
                                {result.answer ? (<div className="prose prose-sm max-w-none bg-purple-50 p-4 rounded-lg border border-purple-100"><p className="whitespace-pre-wrap text-gray-800 leading-relaxed">{result.answer}</p></div>) : (
                                    <>
                                        <p className="text-sm text-green-600 font-semibold mb-2 flex items-center gap-2"><CheckCircleIcon className="w-5 h-5"/>{successText}</p>
                                        {hasRecordset ? (
                                            <>
                                                <div className="border border-gray-200 rounded-lg overflow-auto">
                                                    <table className="w-full text-sm text-left">
                                                        <thead className="bg-gray-100 sticky top-0 z-10">
                                                            <tr className="border-b">{Object.keys(result.recordset[0]).map(k => <th key={k} className="p-2 font-bold whitespace-nowrap">{k}</th>)}</tr>
                                                        </thead>
                                                        <tbody>
                                                            {result.recordset.slice(0, visibleResultCount).map((r, i) => (
                                                                <tr key={i} className="border-b last:border-b-0 hover:bg-gray-50">
                                                                    {Object.values(r).map((v: any, j) => <td key={j} className="p-2 whitespace-nowrap">{v === null ? 'NULL' : String(v)}</td>)}
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                                {result.recordset.length > visibleResultCount && (
                                                    <div className="text-center mt-4">
                                                        <p className="text-sm text-gray-500 mb-2">총 {result.recordset.length.toLocaleString()}개 결과 중 {Math.min(visibleResultCount, result.recordset.length).toLocaleString()}개 표시</p>
                                                        <button onClick={() => setVisibleResultCount(prev => prev + ROWS_PER_LOAD)} className="px-6 py-2 bg-gray-100 text-gray-800 font-bold rounded-lg hover:bg-gray-200 transition active:scale-95 shadow-sm">더 보기</button>
                                                    </div>
                                                )}
                                            </>
                                        ) : <p className="text-gray-500">결과 데이터가 없습니다.</p>}
                                    </>
                                )}
                            </div>
                        )}
                        {status === 'idle' && !result && !error && (
                            <div className="flex flex-col justify-center items-center h-full text-gray-400 text-center p-4">
                                <div className="text-left text-xs space-y-2 bg-gray-100 p-4 rounded-lg text-gray-500 max-w-md w-full">
                                    <h4 className="font-bold text-gray-600 mb-1">💡 숨겨진 기능 팁</h4>
                                    <p><strong>- 실행 버튼 (길게 누르기):</strong> 입력창 내용을 초기화합니다.</p>
                                    <p><strong>- AI 버튼 (길게 누르기):</strong> 'AI 모드'를 활성화/비활성화합니다.</p>
                                    <p><strong>- 빠른 실행:</strong> '저장된 쿼리'에서 별표(★)를 눌러 단축 버튼을 만들 수 있습니다.</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </main>

            <FullScreenModal isOpen={isTableModalOpen} onClose={() => setTableModalOpen(false)} title="테이블 선택">
                <div className="p-4 bg-white rounded-xl border border-gray-200">
                    <ToggleSwitch id="table-scope" label="선택된 테이블만 AI가 참고" checked={useSelectedTablesOnly} onChange={setUseSelectedTablesOnly} color="blue" />
                </div>
                <div className="mt-3 space-y-1">
                    {sortedTables.map(t => (
                        <div key={t} onClick={() => toggleTable(t)} className={`p-3 rounded-lg font-medium cursor-pointer transition-colors ${selectedTables.includes(t) ? 'bg-blue-100 text-blue-800' : 'bg-white hover:bg-gray-100 text-gray-700'}`}>
                           <label className="flex items-center gap-3 w-full cursor-pointer">
                                <input type="checkbox" checked={selectedTables.includes(t)} onChange={() => {}} className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                <span>{t}</span>
                            </label>
                        </div>
                    ))}
                </div>
            </FullScreenModal>
            
            <FullScreenModal isOpen={isSavedQueriesModalOpen} onClose={() => setSavedQueriesModalOpen(false)} title="저장된 쿼리">
                <div className="space-y-2">
                    {savedQueries.map(q => (
                        <div key={q.id} className="bg-white p-3 rounded-lg border border-gray-200 group">
                            <div className="flex items-center gap-2">
                                <p className="font-bold text-gray-800 flex-grow cursor-pointer" onClick={() => handleQuickRun(q)}>{q.name}</p>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                     <button onClick={() => handleSaveUpdatedQuery(q.id, { isQuickRun: !q.isQuickRun })} className={`p-1.5 rounded-full transition-colors ${q.isQuickRun ? 'text-yellow-500 bg-yellow-100' : 'text-gray-400 hover:bg-gray-100'}`} title="빠른 실행 등록/해제">
                                        <StarIcon className="w-5 h-5"/>
                                    </button>
                                    <button onClick={() => setEditingQuery(q)} className="p-1.5 rounded-full text-gray-400 hover:bg-gray-100" title="수정"><PencilSquareIcon className="w-5 h-5"/></button>
                                    <button onClick={() => showAlert(`'${q.name}' 쿼리를 삭제하시겠습니까?`, () => deleteSavedQuery(q.id), '삭제', 'bg-rose-500')} className="p-1.5 rounded-full text-gray-400 hover:bg-red-100 hover:text-red-600" title="삭제"><TrashIcon className="w-5 h-5"/></button>
                                </div>
                            </div>
                             <div className="mt-2 text-sm text-gray-600">
                                {q.type === 'natural' && q.generatedSql ? (
                                    <>
                                        <p className={`whitespace-pre-wrap font-mono p-2 rounded bg-gray-50 text-xs ${queryViewStates[q.id] === 'sql' ? 'hidden' : ''}`}>{q.query}</p>
                                        <p className={`whitespace-pre-wrap font-mono p-2 rounded bg-gray-50 text-xs ${queryViewStates[q.id] !== 'sql' ? 'hidden' : ''}`}>{q.generatedSql}</p>
                                        <button onClick={() => toggleQueryView(q.id)} className="text-xs font-semibold mt-1 text-blue-600 hover:underline">{queryViewStates[q.id] === 'sql' ? '자연어 보기' : 'SQL 보기'}</button>
                                    </>
                                ) : (
                                    <p className="whitespace-pre-wrap font-mono p-2 rounded bg-gray-50 text-xs">{q.query}</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </FullScreenModal>

            <FullScreenModal isOpen={isAiModalOpen} onClose={() => setAiModalOpen(false)} title="AI 학습 데이터 관리" footer={
                 <button onClick={handleAddLearningItem} className="w-full h-12 bg-blue-600 text-white font-bold rounded-lg transition hover:bg-blue-700 active:scale-95 shadow-lg shadow-blue-500/30">규칙 추가</button>
            }>
                <div className="space-y-2" onDragOver={handleDragOver} onDrop={handleDrop}>
                    {learningItems.map((item, index) => (
                         <React.Fragment key={item.id}>
                            {dropIndex === index && <div className="drag-over-placeholder !h-16" />}
                            <div onDragStart={(e) => handleDragStart(e, index)} onDragEnter={(e) => handleDragEnter(e, index)} onDragEnd={handleDragEnd} draggable className="bg-white p-3 rounded-lg border border-gray-200 cursor-grab" onClick={() => setEditingLearningItem(item)}>
                                <div className="flex items-center justify-between gap-2">
                                    <p className="font-bold text-gray-800 flex-grow truncate">{item.title}</p>
                                    <button onClick={(e) => handleDeleteLearningItem(e, item.id)} className="p-1.5 rounded-full text-gray-400 hover:bg-red-100 hover:text-red-600 flex-shrink-0" title="삭제"><TrashIcon className="w-5 h-5"/></button>
                                </div>
                            </div>
                         </React.Fragment>
                    ))}
                    {dropIndex === learningItems.length && <div className="drag-over-placeholder !h-16" />}
                </div>
            </FullScreenModal>
            
            {/* Edit Modals */}
             <FullScreenModal isOpen={!!editingQuery} onClose={() => setEditingQuery(null)} title="저장된 쿼리 수정" footer={
                 <button onClick={() => { if (editingQuery) handleSaveUpdatedQuery(editingQuery.id, { name: editingQuery.name, query: editingQuery.query }); }} className="w-full h-12 bg-blue-600 text-white font-bold rounded-lg transition hover:bg-blue-700 active:scale-95 shadow-lg shadow-blue-500/30">저장</button>
             }>
                {editingQuery && (
                    <div className="space-y-4 p-2">
                        <input type="text" value={editingQuery.name} onChange={e => setEditingQuery({ ...editingQuery, name: e.target.value })} placeholder="쿼리 이름" className="w-full p-3 border border-gray-300 rounded-lg text-lg font-bold" />
                        <textarea value={editingQuery.query} onChange={e => setEditingQuery({ ...editingQuery, query: e.target.value })} placeholder="쿼리 내용" className="w-full h-40 p-3 border border-gray-300 rounded-lg font-mono text-sm" />
                    </div>
                )}
            </FullScreenModal>
            
            <FullScreenModal isOpen={!!editingLearningItem} onClose={() => setEditingLearningItem(null)} title={editingLearningItem?.title ? 'AI 학습 규칙 수정' : 'AI 학습 규칙 추가'} footer={
                 <button onClick={() => { if (editingLearningItem) handleSaveLearningItem(editingLearningItem); }} className="w-full h-12 bg-blue-600 text-white font-bold rounded-lg transition hover:bg-blue-700 active:scale-95 shadow-lg shadow-blue-500/30">저장</button>
            }>
                 {editingLearningItem && (
                    <div className="space-y-4 p-2">
                        <input type="text" value={editingLearningItem.title} onChange={e => setEditingLearningItem({ ...editingLearningItem, title: e.target.value })} placeholder="규칙 제목" className="w-full p-3 border border-gray-300 rounded-lg text-lg font-bold" />
                        <textarea value={editingLearningItem.content} onChange={e => setEditingLearningItem({ ...editingLearningItem, content: e.target.value })} placeholder="규칙 내용" className="w-full h-48 p-3 border border-gray-300 rounded-lg font-mono text-sm" />
                    </div>
                 )}
            </FullScreenModal>

        </div>
    );
};

export default SqlRunnerPage;
