import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAlert } from '../context/AppContext';
import { SpinnerIcon, CheckCircleIcon, TrashIcon, PencilSquareIcon, PlayCircleIcon, TableCellsIcon, BookmarkSquareIcon, StopCircleIcon, RemoveIcon, SparklesIcon, StarIcon, ChevronDownIcon, MoreVerticalIcon } from '../components/Icons';
import { querySql, naturalLanguageToSql, aiChat } from '../services/sqlService';
import { subscribeToSavedQueries, addSavedQuery, deleteSavedQuery, updateSavedQuery, getValue, setValue } from '../services/dbService';
import { getCachedSchema } from '../services/schemaService';
import { getLearningContext } from '../services/learningService';

// --- TYPE DEFINITIONS ---
type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

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
    const [isAiModalOpen, setAiModalOpen] = useState(false);
    const [learningItems, setLearningItems] = useState<LearningItem[]>([]);
    
    // Expanded states
    const [expandedQueryId, setExpandedQueryId] = useState<string | null>(null);
    const [expandedLearningId, setExpandedLearningId] = useState<string | null>(null);

    // AI Mode State
    const [isAiMode, setIsAiMode] = useState(false);
    
    const abortControllerRef = useRef<AbortController | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Long press logic for table button
    const tableLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isTableLongPress = useRef(false);

    // Long press logic for execute button
    const executeLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isExecuteLongPress = useRef(false);
    
    // Long press logic for AI button
    const aiLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isAiLongPress = useRef(false);
    
    // Drag and Drop state for Learning Items
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

    // Load Learning Items when AI modal opens
    useEffect(() => {
        if (isAiModalOpen) {
            getValue('learning/sqlContext', {}).then((data: any) => {
                if (!data) {
                    setLearningItems([]);
                } else if (typeof data === 'string') {
                     setLearningItems([{ id: Date.now().toString(), title: '기본 컨텍스트', content: data }]);
                } else {
                    // If it's an object, we assume it's keyed by ID, but we want to respect an order if possible.
                    // Since Firebase Realtime DB keys are sorted strings, they often preserve insertion order if using push(),
                    // but here we might have saved an array-like object or map. 
                    // If we saved as an array (indices), Object.values works. 
                    // If we saved as a map, we might need a sort field. 
                    // For now, we treat it as a list.
                    const items = Array.isArray(data) 
                        ? data 
                        : Object.entries(data).map(([key, val]: [string, any]) => ({
                            id: key,
                            title: val.title || '제목 없음',
                            content: val.content || ''
                        }));
                    setLearningItems(items);
                }
            });
        }
    }, [isAiModalOpen]);

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
        setResult(null);
        
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

            if (isAiMode) {
                // Pure AI Mode
                const response = await aiChat(prompt, schemaForQuery, context);
                setResult({ answer: response.answer });
                setStatus('success');
                setLastSuccessfulQuery(prompt);
            } else {
                // Text to SQL Mode
                const { sql } = await naturalLanguageToSql(prompt, schemaForQuery, context);
                if (sql) {
                    showToast('AI가 SQL 쿼리를 생성했습니다.', 'success');
                    setQueryInput(sql); 
                    executeQuery(sql, prompt);
                } else {
                    throw new Error('AI가 유효한 SQL을 생성하지 못했습니다.');
                }
            }
        } catch (err: any) {
            setError(err.message || 'AI 처리 중 오류 발생');
            setStatus('error');
        }
    }, [executeQuery, selectedTables, useSelectedTablesOnly, showToast, isAiMode]);

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

            if (additionalPrompt) {
                const combinedPrompt = `Based on the query or concept named "${savedQuery.name}" (which is: "${savedQuery.query}"), please perform the following additional request: "${additionalPrompt}"`;
                processNaturalLanguageQuery(combinedPrompt);
            } else {
                if (savedQuery.type === 'sql') {
                    executeQuery(savedQuery.query, `@${savedQuery.name}`);
                } else {
                    processNaturalLanguageQuery(savedQuery.query);
                }
            }
            return;
        }

        const isLikelySql = /^(SELECT|UPDATE|DELETE|INSERT|CREATE|DROP|ALTER|TRUNCATE)\b/i.test(currentInput);

        if (isLikelySql && !isAiMode) {
            executeQuery(currentInput);
        } else {
            processNaturalLanguageQuery(currentInput);
        }
    }, [executeQuery, savedQueries, showAlert, processNaturalLanguageQuery, isAiMode]);

    // --- Table Button Handlers ---
    const handleTableButtonStart = () => {
        isTableLongPress.current = false;
        tableLongPressTimer.current = setTimeout(() => {
            isTableLongPress.current = true;
            setUseSelectedTablesOnly(prev => {
                 const next = !prev;
                 if (navigator.vibrate) navigator.vibrate(50);
                 showToast(next ? '선택된 테이블만 사용합니다.' : '전체 테이블을 사용합니다.', 'success');
                 return next;
            });
        }, 600);
    };

    const handleTableButtonEnd = (e: React.MouseEvent | React.TouchEvent) => {
        if (tableLongPressTimer.current) {
            clearTimeout(tableLongPressTimer.current);
            tableLongPressTimer.current = null;
        }
        if (!isTableLongPress.current) {
             setTableModalOpen(true);
        } else {
            if(e.cancelable && e.type !== 'touchend') e.preventDefault();
        }
    };

    // --- Execute Button Handlers ---
    const handleExecuteStart = () => {
        isExecuteLongPress.current = false;
        executeLongPressTimer.current = setTimeout(() => {
            isExecuteLongPress.current = true;
            setQueryInput(''); // Clear the input
            if (navigator.vibrate) navigator.vibrate(50);
            showToast('입력창이 초기화되었습니다.', 'success');
        }, 600);
    };

    const handleExecuteEnd = (e: React.MouseEvent | React.TouchEvent) => {
        if (executeLongPressTimer.current) {
            clearTimeout(executeLongPressTimer.current);
            executeLongPressTimer.current = null;
        }
        if (isExecuteLongPress.current) {
             if (e.cancelable && e.type !== 'touchend') e.preventDefault();
        }
    };

    const handleExecuteClickWrapped = () => {
        if (isExecuteLongPress.current) {
            isExecuteLongPress.current = false;
            // Do nothing else, as long press handled the clear
            return;
        }
        
        // Original click logic
        if (status === 'loading') {
            abortControllerRef.current?.abort();
            setStatus('idle');
            showToast('실행이 중단되었습니다.', 'error');
            return;
        }
        processAndExecute(queryInput);
    };
    
    // --- AI Button Handlers ---
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
        if (aiLongPressTimer.current) {
            clearTimeout(aiLongPressTimer.current);
            aiLongPressTimer.current = null;
        }
        if (!isAiLongPress.current) {
            // Short press: Trigger execution as AI/NL request
            if (status === 'loading') return;
            processAndExecute(queryInput);
        } else {
            if(e.cancelable && e.type !== 'touchend') e.preventDefault();
        }
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

    const handleDeleteSavedQuery = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        showAlert(
            '이 쿼리를 삭제하시겠습니까?',
            () => {
                deleteSavedQuery(id).then(() => showToast('쿼리가 삭제되었습니다.', 'success'));
            },
            '삭제',
            'bg-red-500 hover:bg-red-600'
        );
    };

    const handleLoadSavedQuery = (e: React.MouseEvent, query: SavedQuery) => {
        e.stopPropagation();
        setQueryInput(query.query);
        setSavedQueriesModalOpen(false);
    };
    
    const handleToggleQuickRun = (e: React.MouseEvent, query: SavedQuery) => {
        e.stopPropagation();
        updateSavedQuery(query.id, { isQuickRun: !query.isQuickRun });
    };
    
    const handleQuickRun = (query: SavedQuery) => {
        // Execute directly without setting input box
        if (query.type === 'sql') {
            executeQuery(query.query, `@${query.name}`);
        } else {
            processNaturalLanguageQuery(query.query);
        }
    };
    
    const toggleQueryExpand = (id: string) => {
        setExpandedQueryId(prev => prev === id ? null : id);
    };

    // --- AI Learning Modal Handlers ---
    const handleAddLearningItem = () => {
        const id = 'item_' + Date.now();
        const newItem = { id, title: '새 규칙', content: '' };
        setLearningItems([newItem, ...learningItems]);
        setExpandedLearningId(id); // Automatically expand new item
    };
    
    const handleUpdateLearningItem = (id: string, field: 'title' | 'content', value: string) => {
        setLearningItems(learningItems.map(item => item.id === id ? { ...item, [field]: value } : item));
    };
    
    const handleDeleteLearningItem = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setLearningItems(learningItems.filter(item => item.id !== id));
    };
    
    const toggleLearningExpand = (id: string) => {
        setExpandedLearningId(prev => prev === id ? null : id);
    };

    const saveAiContext = async () => {
        // We just save the array as is. Firebase handles array-like objects well, 
        // or we can save it as an object keyed by index if we want strict ordering.
        // To ensure order is preserved easily, we save as an array.
        try {
            await setValue('learning/sqlContext', learningItems);
            showToast('AI 학습 데이터가 저장되었습니다.', 'success');
            setAiModalOpen(false);
        } catch(e) {
            showAlert('저장에 실패했습니다.');
        }
    };
    
    // --- Drag and Drop for Learning Items ---
    const handleDragStart = (e: React.DragEvent, index: number) => {
        dragIndex.current = index;
        e.dataTransfer.effectAllowed = 'move';
        (e.currentTarget as HTMLElement).classList.add('dragging');
    };
    
    const handleDragEnter = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        if (dragIndex.current === index) return;
        setDropIndex(index);
    };
    
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };
    
    const handleDragEnd = (e: React.DragEvent) => {
        (e.currentTarget as HTMLElement).classList.remove('dragging');
        dragIndex.current = null;
        setDropIndex(null);
    };
    
    const handleDrop = () => {
        if (dragIndex.current !== null && dropIndex !== null) {
            const fromIndex = dragIndex.current;
            const toIndex = dropIndex > fromIndex ? dropIndex - 1 : dropIndex;
            if (fromIndex !== toIndex) {
                setLearningItems(prev => {
                    const result = Array.from(prev);
                    const [removed] = result.splice(fromIndex, 1);
                    result.splice(toIndex, 0, removed);
                    return result;
                });
            }
        }
    };

    
    const handleCopyResults = () => {
        let textToCopy = '';
        if (result?.answer) {
            textToCopy = result.answer;
        } else if (result?.recordset && result.recordset.length > 0) {
            const headers = Object.keys(result.recordset[0]);
            textToCopy = [
                headers.join('\t'),
                ...result.recordset.map(row => 
                    headers.map(header => {
                        const value = row[header];
                        if (value === null || value === undefined) return '';
                        return String(value).replace(/\t|\n|\r/g, ' ');
                    }).join('\t')
                )
            ].join('\n');
        }

        if (textToCopy) {
            navigator.clipboard.writeText(textToCopy).then(() => {
                showToast('결과가 클립보드에 복사되었습니다.', 'success');
            }, () => {
                showToast('복사에 실패했습니다.', 'error');
            });
        }
    };
    
    const sortedTables = useMemo(() => {
        const selectedSet = new Set(selectedTables);
        // Separate selected and unselected
        const selected = [...allTables].filter(t => selectedSet.has(t));
        const unselected = [...allTables].filter(t => !selectedSet.has(t));
        
        // Sort each group alphabetically
        selected.sort((a, b) => a.localeCompare(b, 'ko', { sensitivity: 'base' }));
        unselected.sort((a, b) => a.localeCompare(b, 'ko', { sensitivity: 'base' }));

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
                <div className="flex flex-col gap-2">
                    {/* Top Toolbar */}
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                        <button 
                            onMouseDown={handleTableButtonStart}
                            onMouseUp={handleTableButtonEnd}
                            onMouseLeave={handleTableButtonEnd}
                            onTouchStart={handleTableButtonStart}
                            onTouchEnd={handleTableButtonEnd}
                            className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 border rounded-lg font-semibold text-sm active:scale-95 transition select-none ${useSelectedTablesOnly ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                        >
                            <TableCellsIcon className="w-5 h-5"/> 
                            <span>
                                {useSelectedTablesOnly 
                                    ? `선택 테이블 (${selectedTables.length})` 
                                    : '전체 테이블'
                                }
                            </span>
                        </button>
                        
                        <button onClick={() => setSavedQueriesModalOpen(true)} className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 text-sm active:scale-95 transition">
                            <BookmarkSquareIcon className="w-5 h-5"/> <span>쿼리</span>
                        </button>
                        
                        <button onClick={() => setAiModalOpen(true)} className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 text-sm active:scale-95 transition">
                            <SparklesIcon className="w-5 h-5 text-purple-500"/> <span>AI학습</span>
                        </button>
                        
                        {/* Quick Run Buttons Divider */}
                        {savedQueries.some(q => q.isQuickRun) && <div className="w-px h-6 bg-gray-300 mx-1 flex-shrink-0"></div>}
                        
                        {/* Quick Run Buttons */}
                        {savedQueries.filter(q => q.isQuickRun).map(q => (
                            <button 
                                key={q.id} 
                                onClick={() => handleQuickRun(q)}
                                className="flex-shrink-0 px-3 py-2 bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-sm font-bold hover:bg-blue-200 active:scale-95 transition"
                            >
                                {q.name}
                            </button>
                        ))}
                    </div>
                    
                    {/* Query Input */}
                    <textarea 
                        ref={textareaRef}
                        value={queryInput} 
                        onChange={(e) => setQueryInput(e.target.value)}
                        rows={3} 
                        placeholder={isAiMode ? "AI에게 자유롭게 질문하세요... (예: 이번 달 매출 분석해줘)" : "자연어나 SQL 쿼리를 입력하세요... (예: @오늘매출)"}
                        className={`w-full p-2 border rounded-lg font-mono text-base text-gray-900 bg-white select-text transition-colors ${isAiMode ? 'border-purple-400 ring-1 ring-purple-400 focus:ring-purple-500 focus:border-purple-500' : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'}`}
                        style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                    />
                    
                    {/* Execution Controls */}
                    <div className="flex gap-2">
                        <button 
                            onMouseDown={handleExecuteStart}
                            onMouseUp={handleExecuteEnd}
                            onMouseLeave={handleExecuteEnd}
                            onTouchStart={handleExecuteStart}
                            onTouchEnd={handleExecuteEnd}
                            onClick={handleExecuteClickWrapped}
                            className={`flex-grow h-12 text-white font-bold rounded-lg flex items-center justify-center gap-2 text-lg transition active:scale-95 shadow-lg select-none ${isAiMode ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-500/30' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/30'}`}
                        >
                            {status === 'loading' ? <><StopCircleIcon className="w-7 h-7"/> <span>중지</span></> : <><PlayCircleIcon className="w-7 h-7"/> <span>실행</span></>}
                        </button>
                         <button 
                            onMouseDown={handleAiButtonStart}
                            onMouseUp={handleAiButtonEnd}
                            onMouseLeave={handleAiButtonEnd}
                            onTouchStart={handleAiButtonStart}
                            onTouchEnd={handleAiButtonEnd}
                            className={`flex items-center justify-center border rounded-lg font-semibold hover:opacity-90 active:scale-95 transition shadow-sm ${isAiMode ? 'bg-purple-100 border-purple-300 text-purple-600 px-3 w-auto' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50 w-16'}`}
                            aria-label="AI 모드"
                            title="짧게 누르면 AI 실행, 길게 누르면 AI 모드 전환"
                        >
                            <SparklesIcon className="w-7 h-7"/>
                            {isAiMode && <span className="ml-1 text-sm whitespace-nowrap">AI 모드</span>}
                        </button>
                    </div>
                </div>
            </div>
            
            <main className="flex-grow p-3 flex overflow-hidden">
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm w-full flex flex-col h-full">
                    <div className="flex justify-between items-center mb-2 flex-shrink-0">
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
                                {result.answer ? (
                                    <div className="prose prose-sm max-w-none bg-purple-50 p-4 rounded-lg border border-purple-100">
                                        <p className="whitespace-pre-wrap text-gray-800 leading-relaxed">{result.answer}</p>
                                    </div>
                                ) : (
                                    <>
                                        <p className="text-sm text-green-600 font-semibold mb-2 flex items-center gap-2"><CheckCircleIcon className="w-5 h-5"/>쿼리 성공! (영향 받은 행: {result.rowsAffected})</p>
                                        {result.recordset && result.recordset.length > 0 ? (
                                            <div className="border border-gray-200 rounded-lg overflow-auto">
                                                <table className="w-full text-sm text-left">
                                                    <thead className="bg-gray-100 sticky top-0 z-10"><tr className="border-b">{Object.keys(result.recordset[0]).map(key => <th key={key} className="p-2 font-bold whitespace-nowrap">{key}</th>)}</tr></thead>
                                                    <tbody>{result.recordset.map((row, i) => (<tr key={i} className="border-b last:border-b-0 hover:bg-gray-50">{Object.values(row).map((val: any, j) => <td key={j} className="p-2 whitespace-nowrap">{val === null ? 'NULL' : String(val)}</td>)}</tr>))}</tbody>
                                                </table>
                                            </div>
                                        ) : <p className="text-gray-500">결과 데이터가 없습니다.</p>}
                                    </>
                                )}
                            </div>
                        )}
                         {status === 'idle' && !result && (
                             <div className="flex flex-col justify-center items-center h-full text-gray-400 text-center p-4">
                                <p className="mb-2">쿼리를 실행하여 결과를 확인하세요.</p>
                                <p className="text-xs bg-gray-100 px-2 py-1 rounded">Tip: 실행 버튼을 길게 누르면 입력창이 초기화됩니다.</p>
                             </div>
                         )}
                    </div>
                </div>
            </main>

            {/* Table Selection Modal */}
            <ModalWrapper isActive={isTableModalOpen} onClose={() => setTableModalOpen(false)} title="테이블 선택">
                <div className="space-y-1">
                    <div className="p-3 bg-blue-50 text-blue-800 text-sm rounded-lg mb-3">
                        <p>💡 <strong>팁:</strong> '테이블' 버튼을 길게 누르면(0.6초) 전체 테이블/선택 테이블 모드가 전환됩니다.</p>
                    </div>
                    <div className="flex gap-2 mb-3">
                         <button onClick={() => setSelectedTables([...allTables])} className="flex-1 py-2 text-sm bg-blue-50 text-blue-600 font-bold rounded-lg">전체 선택</button>
                         <button onClick={() => setSelectedTables([])} className="flex-1 py-2 text-sm bg-gray-100 text-gray-600 font-bold rounded-lg">전체 해제</button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 max-h-[50vh] overflow-y-auto">
                        {sortedTables.map(table => (
                            <label key={table} className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${selectedTables.includes(table) ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50 border-gray-200'}`}>
                                <input 
                                    type="checkbox" 
                                    checked={selectedTables.includes(table)} 
                                    onChange={() => toggleTable(table)}
                                    className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                                />
                                <span className="ml-3 font-medium text-gray-700">{table}</span>
                                {selectedTables.includes(table) && <span className="ml-auto text-xs text-blue-600 font-bold">선택됨</span>}
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
                    <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                        {savedQueries.map(q => {
                            const isExpanded = expandedQueryId === q.id;
                            return (
                                <div key={q.id} className="border border-gray-200 rounded-lg overflow-hidden transition-colors hover:border-blue-300">
                                    <div 
                                        onClick={() => toggleQueryExpand(q.id)}
                                        className="flex justify-between items-center p-3 bg-white cursor-pointer hover:bg-gray-50"
                                    >
                                        <div className="flex items-center gap-3 flex-grow min-w-0">
                                            <button 
                                                onClick={(e) => handleToggleQuickRun(e, q)} 
                                                className={`p-1 rounded-md transition-colors flex-shrink-0 ${q.isQuickRun ? 'text-yellow-500 bg-yellow-50' : 'text-gray-300 hover:text-yellow-400'}`}
                                                title={q.isQuickRun ? "빠른 실행 해제" : "빠른 실행 등록"}
                                            >
                                                <StarIcon className={`w-5 h-5 ${q.isQuickRun ? 'fill-current' : ''}`} />
                                            </button>
                                            <h4 className="font-bold text-gray-800 truncate">{q.name}</h4>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                        </div>
                                    </div>
                                    
                                    {isExpanded && (
                                        <div className="p-3 bg-gray-50 border-t border-gray-100 animate-fade-in-down">
                                            <p className="text-sm text-gray-600 font-mono bg-white p-2 rounded border border-gray-200 mb-3 break-all whitespace-pre-wrap max-h-32 overflow-y-auto">{q.query}</p>
                                            <div className="flex gap-2">
                                                 <button onClick={(e) => handleLoadSavedQuery(e, q)} className="flex-1 py-2 text-sm font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200">
                                                    입력창으로 불러오기
                                                </button>
                                                <button onClick={(e) => handleDeleteSavedQuery(e, q.id)} className="px-3 py-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg border border-red-200" title="삭제">
                                                    <TrashIcon className="w-5 h-5"/>
                                                </button>
                                                <button 
                                                    onClick={() => {
                                                        handleQuickRun(q);
                                                        setSavedQueriesModalOpen(false);
                                                    }}
                                                    className="flex-1 py-2 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm"
                                                >
                                                    바로 실행
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </ModalWrapper>
            
            {/* AI Learning Context Modal */}
            <ModalWrapper isActive={isAiModalOpen} onClose={() => setAiModalOpen(false)} title="AI 학습 데이터 관리">
                <div className="space-y-4">
                    <div className="flex justify-between items-center bg-blue-50 p-3 rounded-lg">
                         <div className="flex items-start gap-2">
                            <SparklesIcon className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5"/>
                            <div className="text-sm text-gray-700">
                                <p className="font-semibold">자연어 질의 시 AI가 참고할 규칙 목록입니다.</p>
                                <p className="text-xs text-gray-500 mt-1">목록을 드래그하여 우선순위를 변경할 수 있습니다.</p>
                            </div>
                         </div>
                         <button onClick={handleAddLearningItem} className="flex-shrink-0 text-sm bg-white border border-blue-200 text-blue-600 px-3 py-1.5 rounded-lg font-bold hover:bg-blue-50 transition shadow-sm">추가</button>
                    </div>
                    
                    <div className="space-y-2 max-h-[50vh] overflow-y-auto" onDragOver={handleDragOver} onDrop={handleDrop}>
                        {learningItems.length === 0 ? (
                            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg bg-gray-50">
                                <p className="text-gray-400">등록된 규칙이 없습니다.</p>
                                <button onClick={handleAddLearningItem} className="mt-2 text-sm font-bold text-blue-500 hover:underline">새 규칙 추가하기</button>
                            </div>
                        ) : (
                            learningItems.map((item, index) => {
                                const isExpanded = expandedLearningId === item.id;
                                return (
                                    <React.Fragment key={item.id}>
                                        {dropIndex === index && <div className="drag-over-placeholder" />}
                                        <div 
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, index)}
                                            onDragEnter={(e) => handleDragEnter(e, index)}
                                            onDragEnd={handleDragEnd}
                                            className="border border-gray-200 rounded-lg bg-white shadow-sm overflow-hidden cursor-move"
                                        >
                                            <div 
                                                onClick={() => toggleLearningExpand(item.id)}
                                                className="flex items-center p-3 gap-2 hover:bg-gray-50 cursor-pointer"
                                            >
                                                <div className="text-gray-400 cursor-grab active:cursor-grabbing p-1">
                                                    <MoreVerticalIcon className="w-5 h-5"/>
                                                </div>
                                                <div className="flex-grow">
                                                    <input 
                                                        className="font-bold text-gray-800 bg-transparent border-none focus:ring-0 p-0 w-full placeholder-gray-300 cursor-pointer hover:underline focus:no-underline"
                                                        value={item.title}
                                                        onChange={(e) => handleUpdateLearningItem(item.id, 'title', e.target.value)}
                                                        onClick={(e) => e.stopPropagation()}
                                                        placeholder="규칙 제목 (예: 매출 정의)"
                                                    />
                                                </div>
                                                <button onClick={(e) => handleDeleteLearningItem(e, item.id)} className="text-gray-400 hover:text-red-500 p-1 transition-colors mr-1">
                                                    <TrashIcon className="w-4 h-4"/>
                                                </button>
                                                <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                            </div>

                                            {isExpanded && (
                                                <div className="p-3 bg-gray-50 border-t border-gray-100 animate-fade-in-down cursor-auto" onMouseDown={e => e.stopPropagation()}>
                                                    <textarea
                                                        className="w-full text-sm text-gray-700 bg-white rounded p-2 border border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
                                                        rows={4}
                                                        value={item.content}
                                                        onChange={(e) => handleUpdateLearningItem(item.id, 'content', e.target.value)}
                                                        placeholder="규칙 내용 (예: '매출'은 orders 테이블의 total 합계입니다.)"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </React.Fragment>
                                );
                            })
                        )}
                        {dropIndex === learningItems.length && <div className="drag-over-placeholder" />}
                    </div>
                    
                    <div className="pt-3 border-t border-gray-100 flex justify-end gap-2">
                        <button onClick={() => setAiModalOpen(false)} className="px-4 py-2 bg-gray-200 text-gray-700 font-bold rounded-lg hover:bg-gray-300">취소</button>
                        <button onClick={saveAiContext} className="px-4 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 shadow-lg shadow-blue-500/30">저장</button>
                    </div>
                </div>
            </ModalWrapper>
        </div>
    );
};

export default SqlRunnerPage;