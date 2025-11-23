import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAlert, useMiscUI, useScanner } from '../context/AppContext';
import { SpinnerIcon, CheckCircleIcon, TrashIcon, PencilSquareIcon, PlayCircleIcon, TableCellsIcon, BookmarkSquareIcon, StopCircleIcon, RemoveIcon, SparklesIcon, StarIcon, BarcodeScannerIcon, SaveIcon } from '../components/Icons';
import { querySql, naturalLanguageToSql, aiChat, generateQueryName, UpdatePreview } from '../services/sqlService';
import { subscribeToSavedQueries, addSavedQuery, deleteSavedQuery, updateSavedQuery, getValue, setValue } from '../services/dbService';
import { getCachedSchema } from '../services/schemaService';
import { getLearningContext } from '../services/learningService';
import ToggleSwitch from '../components/ToggleSwitch';
import { useAdjustForKeyboard } from '../hooks/useAdjustForKeyboard';

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
    generatedSql?: string;
}

interface LearningItem {
    id: string;
    title: string;
    content: string;
}

interface VariableInputState {
    query: SavedQuery;
    variables: string[];
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
    headerActions?: React.ReactNode;
    containerRef?: React.Ref<HTMLDivElement>;
}> = ({ isOpen, onClose, title, children, footer, headerActions, containerRef }) => {
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
                ref={containerRef}
                style={{ top: 'calc(3.5rem + env(safe-area-inset-top))' }}
                className={`absolute bottom-0 left-0 right-0 flex flex-col bg-gray-50 shadow-lg transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.32,1.25,0.37,1.02)] ${isRendered ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'} rounded-t-2xl will-change-[opacity,transform]`}
                onClick={e => e.stopPropagation()}
            >
                <header className="relative bg-white p-4 flex-shrink-0 border-b border-gray-200 z-20 rounded-t-2xl flex items-center justify-center">
                    <h2 className="text-base font-bold text-gray-800 truncate">{title}</h2>
                    <div className="absolute top-1/2 right-4 -translate-y-1/2 flex items-center gap-2">
                        {headerActions}
                        <button onClick={onClose} className="p-2 text-gray-500 hover:bg-gray-200 rounded-full transition-colors" aria-label="닫기">
                            <RemoveIcon className="w-6 h-6"/>
                        </button>
                    </div>
                </header>
                <main className="flex-grow overflow-y-auto">
                    {children}
                </main>
                {footer && (
                     <footer className="p-3 bg-white border-t border-gray-200 z-10 flex-shrink-0">
                        <div className="max-w-2xl mx-auto">
                           {footer}
                        </div>
                    </footer>
                )}
            </div>
        </div>,
        document.body
    );
};

const CompactModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    containerRef?: React.Ref<HTMLDivElement>;
}> = ({ isOpen, onClose, title, children, footer, containerRef }) => {
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
            className={`fixed inset-0 bg-black z-[90] flex items-center justify-center p-4 transition-opacity duration-300 ${isRendered ? 'bg-opacity-50' : 'bg-opacity-0'}`}
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            <div 
                ref={containerRef}
                className={`bg-white rounded-xl shadow-lg w-full max-w-sm transition-[opacity,transform] duration-300 will-change-[opacity,transform] ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
                onClick={e => e.stopPropagation()}
            >
                <header className="relative p-4 border-b border-gray-200">
                    <h2 className="text-lg font-bold text-gray-800 text-center">{title}</h2>
                </header>
                <main className="p-4 max-h-[60vh] overflow-y-auto">
                    {children}
                </main>
                {footer && (
                     <footer className="px-4 py-3 bg-gray-50 rounded-b-xl">
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
    
    const [isSavedQueriesModalOpen, setSavedQueriesModalOpen] = useState(false);
    const [isAiModalOpen, setAiModalOpen] = useState(false);
    const [learningItems, setLearningItems] = useState<LearningItem[]>([]);
    const [visibleResultCount, setVisibleResultCount] = useState(INITIAL_VISIBLE_ROWS);
    
    const [editingQuery, setEditingQuery] = useState<SavedQuery | null>(null);
    const [editingLearningItem, setEditingLearningItem] = useState<LearningItem | null>(null);

    const [isAiMode, setIsAiMode] = useState(false);
    const [updatePreview, setUpdatePreview] = useState<UpdatePreview | null>(null);
    
    const [saveModalState, setSaveModalState] = useState<{
        query: string;
        type: 'sql';
        name: string;
        isGeneratingName: boolean;
    } | null>(null);

    const [variableInputState, setVariableInputState] = useState<VariableInputState | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const isProcessingVariableQuery = useRef(false);

    const executeLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isExecuteLongPress = useRef(false);
    const aiLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isAiLongPress = useRef(false);
    
    const dragIndex = useRef<number | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);

    const saveModalRef = useRef<HTMLDivElement>(null);
    const variableModalRef = useRef<HTMLDivElement>(null);
    
    useAdjustForKeyboard(saveModalRef, !!saveModalState);
    useAdjustForKeyboard(variableModalRef, !!variableInputState);


    useEffect(() => {
        const unsubscribe = subscribeToSavedQueries(setSavedQueries);
        return () => unsubscribe();
    }, []);

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
    
    const executeQuery = useCallback(async (sql: string, naturalLang?: string, confirmed?: boolean) => {
        setStatus('loading');
        setResult(null);
        setError(null);
        abortControllerRef.current = new AbortController();
    
        if (/^\s*(delete|insert)\s/i.test(sql.trim()) && !confirmed) {
            showAlert('데이터 보안을 위해 INSERT 및 DELETE 쿼리는 실행할 수 없습니다.');
            setStatus('idle');
            return;
        }
    
        try {
            const data = await querySql(sql, abortControllerRef.current.signal, confirmed);
    
            if (data.preview) {
                setUpdatePreview(data.preview);
                setLastSuccessfulQuery(sql); 
                setStatus('idle'); 
            } else {
                setResult(data);
                setStatus('success');
                const queryToSave = naturalLang || sql;
                setLastSuccessfulQuery(queryToSave);
                setVisibleResultCount(INITIAL_VISIBLE_ROWS);
            }
        } catch (err: any) {
            if (err.name !== 'AbortError') {
                setError(err.message || '알 수 없는 오류가 발생했습니다.');
                setStatus('error');
            }
        }
    }, [showAlert]);

    const processNaturalLanguageQuery = useCallback(async (prompt: string) => {
        setStatus('loading');
        setError(null);
        setResult(null);
        setGeneratedSql(null);
        
        try {
            const schema = await getCachedSchema();
            if (!schema) throw new Error("데이터베이스 스키마 정보를 로드할 수 없습니다.");
            
            const context = await getLearningContext();
            
            const userCurrentDate = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

            if (isAiMode) {
                const response = await aiChat(prompt, schema, context, userCurrentDate);
                setResult({ answer: response.answer });
                setStatus('success');
                setLastSuccessfulQuery(prompt);
            } else {
                const { sql } = await naturalLanguageToSql(prompt, schema, context);
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
    }, [executeQuery, isAiMode]);

    const runQueryWithVariableCheck = useCallback((queryToRun: SavedQuery | string) => {
        if (isProcessingVariableQuery.current) return;

        let finalQueryDef: SavedQuery;

        if (typeof queryToRun === 'string') {
            if (queryToRun.startsWith('@')) {
                const savedQueryName = queryToRun.slice(1).split(/\s+/)[0];
                const savedQuery = savedQueries.find(q => q.name.toLowerCase() === savedQueryName.toLowerCase());
                if (savedQuery) {
                    finalQueryDef = savedQuery;
                } else {
                    executeQuery(queryToRun);
                    return;
                }
            } else {
                executeQuery(queryToRun);
                return;
            }
        } else {
            finalQueryDef = queryToRun;
        }

        const { query: queryText, name: queryName, type: queryType } = finalQueryDef;

        const variableRegex = /@([a-zA-Z0-9_]+)/g;
        const detectedVariables = [...new Set(Array.from((queryText || '').matchAll(variableRegex), m => m[1]))];
        
        if (queryType === 'sql' && detectedVariables.length > 0) {
            isProcessingVariableQuery.current = true;
            setVariableInputState({
                query: finalQueryDef,
                variables: detectedVariables,
            });
        } else {
            if (queryType === 'sql') {
                executeQuery(queryText, `@${queryName}`);
            } else if (queryType === 'natural') {
                processNaturalLanguageQuery(queryText);
            }
        }
    }, [savedQueries, executeQuery, processNaturalLanguageQuery]);

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
                runQueryWithVariableCheck(savedQuery);
                return;
            }
        }

        const isLikelySql = /^(SELECT|UPDATE|DELETE|INSERT|CREATE|DROP|ALTER|TRUNCATE)\b/i.test(currentInput);
        if (isLikelySql && !isAiMode) executeQuery(currentInput);
        else processNaturalLanguageQuery(currentInput);
    }, [executeQuery, savedQueries, showAlert, processNaturalLanguageQuery, isAiMode, runQueryWithVariableCheck]);

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
        if (isAiLongPress.current && e.cancelable && e.type !== 'touchend') {
            e.preventDefault();
        } else if (!isAiLongPress.current) {
            setAiModalOpen(true);
        }
    };

    const openSaveQueryModal = async (queryToSave: string, type: 'sql') => {
        if (type === 'sql' && !/select/i.test(queryToSave)) {
            showAlert('SELECT 쿼리만 저장할 수 있습니다.');
            return;
        }

        setSaveModalState({
            query: queryToSave,
            type: 'sql',
            name: '이름 생성 중...',
            isGeneratingName: true,
        });

        try {
            const summary = `Result: ${result?.recordset?.length ?? result?.rowsAffected ?? 0} rows.`;
            const { name: suggestedName } = await generateQueryName(queryToSave, summary);
            setSaveModalState(prevState => prevState ? { ...prevState, name: suggestedName || '', isGeneratingName: false } : null);
        } catch (err) {
            console.error(err);
            showToast('AI 이름 추천에 실패했습니다.', 'error');
            setSaveModalState(prevState => prevState ? { ...prevState, name: '', isGeneratingName: false } : null);
        }
    };
    
    const handleSaveGeneratedSql = async () => {
        if (generatedSql) {
            await openSaveQueryModal(generatedSql, 'sql');
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

    const handleAddNewQuery = () => {
        setSavedQueriesModalOpen(false);
        setEditingQuery({
            id: 'new',
            name: '',
            query: '',
            type: 'sql',
            isQuickRun: false,
        });
    };

    const handleSaveEditingQuery = () => {
        if (!editingQuery) return;

        const { id, name, query, type, isQuickRun } = editingQuery;
        if (!name.trim() || !query.trim()) {
            showAlert('쿼리 이름과 내용을 모두 입력해주세요.');
            return;
        }

        if (id === 'new') {
            addSavedQuery({ name, query, type, isQuickRun })
                .then(() => {
                    showToast('쿼리가 추가되었습니다.', 'success');
                    setEditingQuery(null);
                })
                .catch(err => {
                    console.error(err);
                    showAlert('쿼리 추가에 실패했습니다.');
                });
        } else {
            updateSavedQuery(id, { name, query, type, isQuickRun })
                .then(() => {
                    showToast('쿼리가 수정되었습니다.', 'success');
                    setEditingQuery(null);
                })
                .catch(err => {
                    console.error(err);
                    showAlert('쿼리 수정에 실패했습니다.');
                });
        }
    };


    const handleAddLearningItem = () => {
        setAiModalOpen(false);
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
    
    const handleConfirmUpdate = useCallback(() => {
        if (!lastSuccessfulQuery) return;
        setUpdatePreview(null);
        executeQuery(lastSuccessfulQuery, undefined, true);
    }, [lastSuccessfulQuery, executeQuery]);

    const handleCancelUpdate = useCallback(() => {
        setUpdatePreview(null);
    }, []);

    const hasRecordset = result?.recordset && result.recordset.length > 0;
    const successText = `쿼리 성공! ${hasRecordset ? `결과: ${result.recordset.length}건` : `영향 받은 행: ${result?.rowsAffected ?? 0}`}`;
    
    const VariableInputModal: React.FC<{
        state: VariableInputState | null;
        onClose: () => void;
        onExecute: (finalQuery: string, values: Record<string, string>) => Promise<void>;
    }> = ({ state, onClose, onExecute }) => {
        const [values, setValues] = useState<Record<string, string>>({});
        
        useEffect(() => {
            if (state) {
                const initialValues = state.variables.reduce((acc, v) => ({ ...acc, [v]: '' }), {});
                setValues(initialValues);
                setTimeout(() => {
                    const inputs = document.querySelectorAll<HTMLInputElement>('form input[type="text"]');
                    if (inputs.length > 0) {
                        inputs[0].focus();
                    }
                }, 150);
            }
        }, [state]);
    
        if (!state) return null;
    
        const handleSubmit = async () => {
            let finalQuery = state.query.query;
            for (const variable of state.variables) {
                const value = values[variable] || '';
                const escapedValue = value.replace(/'/g, "''");
                const regex = new RegExp(`@${variable}\\b`, 'g');
                finalQuery = finalQuery.replace(regex, `'${escapedValue}'`);
            }
            await onExecute(finalQuery, values);
        };
    
        const handleInputChange = (variable: string, value: string) => {
            setValues(prev => ({ ...prev, [variable]: value }));
        };
        
        const handleKeyDown = (e: React.KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const form = e.currentTarget.closest('form');
                if (form) {
                    const inputs = Array.from(form.querySelectorAll('input')) as HTMLInputElement[];
                    const currentIndex = inputs.findIndex(input => input === e.target);
                    if (currentIndex > -1 && currentIndex < inputs.length - 1) {
                        inputs[currentIndex + 1].focus();
                    } else {
                        handleSubmit();
                    }
                }
            }
        };
    
        return (
            <CompactModal
                containerRef={variableModalRef}
                isOpen={!!state}
                onClose={onClose}
                title={`'${state.query.name}' 실행`}
                footer={
                    <button
                        onClick={handleSubmit}
                        className="w-full h-12 bg-blue-600 text-white font-bold rounded-lg transition hover:bg-blue-700 active:scale-95 shadow-lg shadow-blue-500/30"
                    >
                        실행
                    </button>
                }
            >
                <p className="text-sm text-gray-600 mb-4">쿼리 실행에 필요한 값을 입력해주세요.</p>
                <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-4">
                    {state.variables.map((variable, index) => (
                        <div key={variable}>
                            <label htmlFor={`var-${variable}`} className="block text-sm font-bold text-gray-700 mb-2">
                                @{variable}
                            </label>
                            <input
                                id={`var-${variable}`}
                                type="text"
                                value={values[variable] || ''}
                                onChange={(e) => handleInputChange(variable, e.target.value)}
                                onKeyDown={handleKeyDown}
                                className="w-full px-4 py-2.5 border border-gray-300 bg-white rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                autoComplete="off"
                            />
                        </div>
                    ))}
                </form>
            </CompactModal>
        );
    };

    const renderUpdatePreviewModal = () => {
        if (!updatePreview) return null;
    
        const { before, after, primaryKeys } = updatePreview;
    
        const beforeMap = new Map();
        if(before.length > 0 && primaryKeys.length > 0) {
            before.forEach(row => {
                const key = primaryKeys.map(pk => row[pk]).join('|');
                beforeMap.set(key, row);
            });
        }
    
        const changes = after.map((afterRow, index) => {
            let beforeRow = before[index]; // Fallback for no primary keys
            if (primaryKeys.length > 0) {
                 const key = primaryKeys.map(pk => afterRow[pk]).join('|');
                 beforeRow = beforeMap.get(key) || before[index];
            }
            return { beforeRow, afterRow };
        });
    
        if (changes.length === 0) {
          return (
            <FullScreenModal
              isOpen={!!updatePreview}
              onClose={handleCancelUpdate}
              title="수정 미리보기 (0건)"
              footer={<button onClick={handleCancelUpdate} className="w-full h-12 bg-gray-200 text-gray-700 rounded-lg font-semibold text-base hover:bg-gray-300 transition shadow-sm flex items-center justify-center active:scale-95">닫기</button>}
            >
              <div className="p-8 text-center">
                <p className="font-semibold text-lg">UPDATE 쿼리와 일치하는 데이터가 없습니다.</p>
                <p className="text-sm text-gray-500 mt-2">데이터가 수정되지 않습니다.</p>
              </div>
            </FullScreenModal>
          );
        }
        
        const allKeys = Object.keys(changes[0].afterRow);
    
        return (
            <FullScreenModal
                isOpen={!!updatePreview}
                onClose={handleCancelUpdate}
                title={`수정 미리보기 (${changes.length}건)`}
                footer={
                     <div className="grid grid-cols-2 gap-3">
                        <button onClick={handleCancelUpdate} className="h-12 px-4 bg-gray-200 text-gray-700 rounded-lg font-semibold text-base hover:bg-gray-300 transition shadow-sm flex items-center justify-center active:scale-95">취소</button>
                        <button onClick={handleConfirmUpdate} className="h-12 bg-blue-600 text-white px-4 rounded-lg font-bold text-base hover:bg-blue-700 transition shadow-lg shadow-blue-500/40 flex items-center justify-center active:scale-95">확인 및 실행</button>
                    </div>
                }
            >
                <div className="p-2 text-sm">
                    <p className="px-2 pb-2 text-xs text-gray-600">아래와 같이 데이터가 수정됩니다. 변경사항을 확인 후 실행하세요.</p>
                    <div className="overflow-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-gray-100 sticky top-0">
                                <tr className="border-b">
                                    <th className="p-2 font-bold text-left border-r w-1/4">필드</th>
                                    <th className="p-2 font-bold text-left">수정 전 (Before)</th>
                                    <th className="p-2 font-bold text-left">수정 후 (After)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {changes.map((change, index) => (
                                    <React.Fragment key={index}>
                                        <tr className="bg-gray-50 border-t border-b">
                                            <td colSpan={3} className="p-1.5 font-bold text-gray-700">
                                                #{index + 1}
                                                {primaryKeys.length > 0 && ` (${primaryKeys.map(pk => `${pk}: ${change.afterRow[pk]}`).join(', ')})`}
                                            </td>
                                        </tr>
                                        {allKeys.map(key => {
                                            const beforeValue = change.beforeRow?.[key];
                                            const afterValue = change.afterRow[key];
                                            const isChanged = String(beforeValue) !== String(afterValue);
                                            return (
                                                <tr key={key} className={`border-b ${isChanged ? 'bg-yellow-50' : ''}`}>
                                                    <td className="p-2 font-semibold text-gray-600 border-r align-top">{key}</td>
                                                    <td className="p-2 align-top break-all font-mono">{String(beforeValue ?? 'NULL')}</td>
                                                    <td className={`p-2 align-top break-all font-mono ${isChanged ? 'font-bold text-blue-700' : ''}`}>{String(afterValue ?? 'NULL')}</td>
                                                </tr>
                                            );
                                        })}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </FullScreenModal>
        );
    };

    const renderResult = () => {
        if (status === 'loading') {
            return (
                <div className="h-full flex flex-col items-center justify-center p-4">
                    <SpinnerIcon className="w-10 h-10 text-blue-500" />
                    <p className="mt-4 text-gray-600 font-semibold">쿼리 실행 중...</p>
                    <p className="text-sm text-gray-500">{isAiMode ? "AI가 답변을 생성하고 있습니다." : "데이터베이스에서 결과를 기다립니다."}</p>
                </div>
            );
        }
        if (status === 'error' && error) {
            return (
                <div className="h-full flex flex-col items-center justify-center p-4 text-center">
                    <div className="bg-red-50 p-6 rounded-xl border border-red-200 max-w-md w-full">
                         <h3 className="font-bold text-red-700 text-lg mb-2">오류 발생</h3>
                         <p className="text-red-600 text-sm whitespace-pre-wrap break-words">{error}</p>
                    </div>
                </div>
            );
        }
        if (status === 'success' && result) {
            if (result.answer) {
                return (
                    <div className="p-4 space-y-4">
                         <div className="bg-green-50 p-4 rounded-xl border border-green-200">
                            <h3 className="font-bold text-green-800 text-lg mb-2">AI 답변</h3>
                            <p className="text-green-700 whitespace-pre-wrap">{result.answer}</p>
                        </div>
                         <button onClick={handleCopyResults} className="w-full h-11 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition">답변 복사</button>
                    </div>
                );
            }
            if (hasRecordset) {
                const headers = Object.keys(result.recordset[0]);
                const visibleRows = result.recordset.slice(0, visibleResultCount);
                return (
                    <div className="p-2 space-y-3">
                         <div className="bg-green-50 p-3 rounded-lg border border-green-200 text-center">
                            <p className="font-semibold text-green-800">{successText}</p>
                        </div>
                        <div className="overflow-auto">
                            <table className="w-full text-xs text-left border-collapse">
                                <thead className="bg-gray-100 sticky top-0 z-10">
                                    <tr>
                                        {headers.map(header => <th key={header} className="p-2 font-bold border-b-2 border-gray-300">{header}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {visibleRows.map((row, i) => (
                                        <tr key={i} className="border-b border-gray-200 hover:bg-gray-50">
                                            {headers.map(header => <td key={header} className="p-2 font-mono whitespace-pre-wrap break-all">{String(row[header])}</td>)}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {result.recordset.length > visibleResultCount && (
                            <button
                                onClick={() => setVisibleResultCount(prev => prev + ROWS_PER_LOAD)}
                                className="w-full h-11 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition"
                            >
                                {result.recordset.length - visibleResultCount}개 더 보기
                            </button>
                        )}
                        <button onClick={handleCopyResults} className="w-full h-11 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition">결과 복사</button>
                    </div>
                );
            }
             return (
                <div className="h-full flex flex-col items-center justify-center p-4">
                     <div className="bg-green-50 p-6 rounded-xl border border-green-200 text-center">
                        <CheckCircleIcon className="w-12 h-12 text-green-500 mx-auto mb-3" />
                        <p className="font-bold text-green-800 text-lg">{successText}</p>
                    </div>
                </div>
            );
        }
        return (
             <div className="h-full flex items-center justify-center p-4">
                 <div className="text-center text-gray-400">
                    <SparklesIcon className="w-16 h-16 mx-auto mb-2 text-gray-300" />
                    <p className="font-semibold">쿼리를 실행하여 결과를 확인하세요.</p>
                </div>
            </div>
        );
    };


    return (
        <div className="h-full flex flex-col bg-gray-100">
            <div className="flex-grow flex flex-col overflow-hidden">
                <div className="flex-grow overflow-y-auto">
                    {renderResult()}
                </div>
            
                <div className="flex-shrink-0 p-2 bg-white border-t border-gray-200 mt-auto">
                     {generatedSql && (
                        <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 mb-2">
                             <div className="flex justify-between items-center mb-1">
                                <h4 className="text-sm font-bold text-blue-800">생성된 SQL</h4>
                                <div className="flex gap-2">
                                     <button onClick={handleSaveGeneratedSql} className="text-xs font-semibold text-blue-600 bg-blue-100 hover:bg-blue-200 px-2 py-1 rounded-md">저장</button>
                                </div>
                            </div>
                            <pre className="text-xs text-blue-700 bg-white p-2 rounded whitespace-pre-wrap font-mono">{generatedSql}</pre>
                        </div>
                    )}
                    
                    <div className="relative">
                        <textarea
                            ref={textareaRef}
                            value={sqlQueryInput}
                            onChange={(e) => setSqlQueryInput(e.target.value)}
                            placeholder={isAiMode ? "AI에게 질문해보세요..." : "SQL 쿼리 또는 질문을 입력하세요 (@쿼리이름 실행 가능)"}
                            className="w-full p-3 pr-12 text-base bg-gray-100 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                            rows={3}
                            disabled={status === 'loading'}
                        />
                        <div className="absolute top-2 right-2">
                             <button onClick={handleBarcodeScan} className="p-2 text-gray-500 hover:bg-gray-200 rounded-full transition-colors" aria-label="바코드 스캔">
                                <BarcodeScannerIcon className="w-6 h-6" />
                            </button>
                        </div>
                    </div>
                    
                    <div className="mt-2 flex items-stretch gap-2">
                        <button
                            onMouseDown={handleExecuteStart}
                            onMouseUp={handleExecuteEnd}
                            onTouchStart={handleExecuteStart}
                            onTouchEnd={handleExecuteEnd}
                            onClick={handleExecuteClickWrapped}
                            className={`relative flex-grow h-14 px-4 rounded-lg font-bold text-lg transition shadow-md flex items-center justify-center active:scale-95 ${
                                status === 'loading' ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-500/30 text-white'
                                : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/30 text-white'
                            }`}
                        >
                            {status === 'loading' ? <StopCircleIcon className="w-7 h-7" /> : <PlayCircleIcon className="w-7 h-7" />}
                            <span className="ml-2">{status === 'loading' ? '중단' : '실행'}</span>
                        </button>

                        <button onClick={() => setSavedQueriesModalOpen(true)} className="h-14 w-20 bg-gray-200 text-gray-700 rounded-lg font-semibold text-xs hover:bg-gray-300 transition shadow-sm flex flex-col items-center justify-center active:scale-95">
                            <BookmarkSquareIcon className="w-6 h-6 mb-1"/>
                            <span>쿼리</span>
                        </button>
                        <button
                            onMouseDown={handleAiButtonStart}
                            onMouseUp={handleAiButtonEnd}
                            onTouchStart={handleAiButtonStart}
                            onTouchEnd={handleAiButtonEnd}
                            className={`h-14 w-14 rounded-lg font-semibold text-xs transition shadow-sm flex flex-col items-center justify-center active:scale-95 ${isAiMode ? 'bg-purple-100 text-purple-700' : 'bg-gray-200 text-gray-700'}`}
                        >
                            <SparklesIcon className="w-6 h-6 mb-1" />
                            <span>AI 학습</span>
                        </button>
                    </div>
                </div>
            </div>
            
            <FullScreenModal
                isOpen={isSavedQueriesModalOpen}
                onClose={() => setSavedQueriesModalOpen(false)}
                title="저장된 쿼리"
                footer={
                    <button onClick={handleAddNewQuery} className="w-full h-12 bg-blue-600 text-white font-bold rounded-lg transition hover:bg-blue-700 active:scale-95 shadow-lg shadow-blue-500/30">
                        새 쿼리 추가
                    </button>
                }
            >
                <div className="p-2 space-y-2">
                    {savedQueries.map(q => (
                        <div key={q.id} className="bg-white p-3 rounded-lg border border-gray-200 flex items-center gap-3">
                             <button
                                onClick={() => runQueryWithVariableCheck(q)}
                                className="flex-grow text-left"
                             >
                                <p className="font-bold text-gray-800 flex items-center gap-2">
                                    {q.isQuickRun && <StarIcon className="w-4 h-4 text-yellow-500 flex-shrink-0" />}
                                    <span>{q.name}</span>
                                </p>
                                <p className="text-xs text-gray-500 mt-1 font-mono truncate">{q.query}</p>
                            </button>
                            <div className="flex-shrink-0 flex items-center gap-1">
                                <button
                                    onClick={() => { setSavedQueriesModalOpen(false); setEditingQuery(q); }}
                                    className="p-2 text-gray-500 hover:bg-gray-200 rounded-full"
                                >
                                    <PencilSquareIcon className="w-5 h-5"/>
                                </button>
                                <button
                                    onClick={() => showAlert(`'${q.name}' 쿼리를 삭제하시겠습니까?`, () => deleteSavedQuery(q.id), '삭제', 'bg-rose-500')}
                                    className="p-2 text-gray-500 hover:bg-rose-100 hover:text-rose-600 rounded-full"
                                >
                                    <TrashIcon className="w-5 h-5"/>
                                </button>
                            </div>
                        </div>
                    ))}
                    {savedQueries.length === 0 && <p className="text-center text-gray-500 p-8">저장된 쿼리가 없습니다.</p>}
                </div>
            </FullScreenModal>
            
            <FullScreenModal
                isOpen={isAiModalOpen}
                onClose={() => setAiModalOpen(false)}
                title="AI 학습 및 규칙"
                footer={
                     <button onClick={handleAddLearningItem} className="w-full h-12 bg-blue-600 text-white font-bold rounded-lg transition hover:bg-blue-700 active:scale-95 shadow-lg shadow-blue-500/30">
                        새 규칙 추가
                    </button>
                }
            >
                <div className="p-2" onDragOver={handleDragOver} onDrop={handleDrop}>
                    {learningItems.map((item, index) => (
                        <React.Fragment key={item.id}>
                            {dropIndex === index && <div className="h-1 bg-blue-300 rounded-full my-1"/>}
                            <div
                                draggable
                                onDragStart={(e) => handleDragStart(e, index)}
                                onDragEnter={(e) => handleDragEnter(e, index)}
                                onDragEnd={handleDragEnd}
                                className="bg-white p-3 rounded-lg border border-gray-200 flex items-center gap-3 cursor-grab mb-2"
                            >
                                <div className="flex-grow" onClick={() => { setAiModalOpen(false); setEditingLearningItem(item); }}>
                                    <p className="font-bold text-gray-800">{item.title}</p>
                                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.content}</p>
                                </div>
                                 <button
                                    onClick={(e) => handleDeleteLearningItem(e, item.id)}
                                    className="p-2 text-gray-500 hover:bg-rose-100 hover:text-rose-600 rounded-full flex-shrink-0"
                                >
                                    <TrashIcon className="w-5 h-5"/>
                                </button>
                            </div>
                         </React.Fragment>
                    ))}
                    {dropIndex === learningItems.length && <div className="h-1 bg-blue-300 rounded-full my-1"/>}
                    {learningItems.length === 0 && <p className="text-center text-gray-500 p-8">학습된 규칙이 없습니다.</p>}
                </div>
            </FullScreenModal>
            
            {editingQuery && (
                <FullScreenModal
                    isOpen={true}
                    onClose={() => setEditingQuery(null)}
                    title={editingQuery.id === 'new' ? '새 쿼리 추가' : '쿼리 편집'}
                    footer={<button onClick={handleSaveEditingQuery} className="w-full h-12 bg-blue-600 text-white font-bold rounded-lg">저장</button>}
                >
                    <div className="p-4 space-y-4">
                        <div>
                            <label className="text-sm font-bold text-gray-700 mb-2 block">쿼리 이름</label>
                            <input
                                type="text"
                                value={editingQuery.name}
                                onChange={e => setEditingQuery({ ...editingQuery, name: e.target.value })}
                                className="w-full p-3 border border-gray-300 rounded-lg text-base"
                            />
                        </div>
                        <div>
                             <label className="text-sm font-bold text-gray-700 mb-2 block">쿼리 내용</label>
                            <textarea
                                value={editingQuery.query}
                                onChange={e => setEditingQuery({ ...editingQuery, query: e.target.value })}
                                className="w-full p-3 border border-gray-300 rounded-lg font-mono text-sm"
                                rows={8}
                            />
                        </div>
                        <div className="flex bg-gray-100 rounded-lg p-1">
                            <button onClick={() => setEditingQuery({ ...editingQuery, type: 'sql' })} className={`flex-1 py-2 text-sm font-bold ${editingQuery.type === 'sql' ? 'bg-white shadow rounded' : ''}`}>SQL</button>
                            <button onClick={() => setEditingQuery({ ...editingQuery, type: 'natural' })} className={`flex-1 py-2 text-sm font-bold ${editingQuery.type === 'natural' ? 'bg-white shadow rounded' : ''}`}>자연어</button>
                        </div>
                        <div className="pt-2">
                             <ToggleSwitch id="quick-run" label="빠른 실행 쿼리" checked={!!editingQuery.isQuickRun} onChange={c => setEditingQuery({ ...editingQuery, isQuickRun: c })} color="blue" />
                        </div>
                    </div>
                </FullScreenModal>
            )}

            {editingLearningItem && (
                 <FullScreenModal
                    isOpen={true}
                    onClose={() => setEditingLearningItem(null)}
                    title={learningItems.some(i => i.id === editingLearningItem.id) ? '규칙 편집' : '새 규칙 추가'}
                    footer={<button onClick={() => handleSaveLearningItem(editingLearningItem)} className="w-full h-12 bg-blue-600 text-white font-bold rounded-lg">저장</button>}
                >
                    <div className="p-4 space-y-4 flex flex-col h-full">
                        <div>
                            <label className="text-sm font-bold text-gray-700 mb-2 block">규칙 제목</label>
                            <input
                                type="text"
                                placeholder="예: 인기 상품 기준"
                                value={editingLearningItem.title}
                                onChange={e => setEditingLearningItem({ ...editingLearningItem, title: e.target.value })}
                                className="w-full p-3 border border-gray-300 rounded-lg text-base"
                            />
                        </div>
                        <div className="flex-grow flex flex-col">
                            <label className="text-sm font-bold text-gray-700 mb-2 block">규칙 내용</label>
                            <textarea
                                placeholder="AI에게 알려줄 규칙이나 맥락을 자유롭게 작성하세요."
                                value={editingLearningItem.content}
                                onChange={e => setEditingLearningItem({ ...editingLearningItem, content: e.target.value })}
                                className="w-full p-3 border border-gray-300 rounded-lg text-sm flex-grow"
                            />
                        </div>
                    </div>
                </FullScreenModal>
            )}

            {saveModalState && (
                <CompactModal
                    containerRef={saveModalRef}
                    isOpen={true}
                    onClose={() => setSaveModalState(null)}
                    title="쿼리 저장"
                    footer={
                        <div className="grid grid-cols-2 gap-3">
                            <button onClick={() => setSaveModalState(null)} className="h-12 bg-gray-200 text-gray-700 rounded-lg font-semibold">취소</button>
                            <button
                                onClick={async () => {
                                    if (saveModalState.name) {
                                        await addSavedQuery({
                                            name: saveModalState.name,
                                            query: saveModalState.query,
                                            type: saveModalState.type,
                                        });
                                        showToast('쿼리가 저장되었습니다.', 'success');
                                        setSaveModalState(null);
                                    }
                                }}
                                className="h-12 bg-blue-600 text-white font-bold rounded-lg"
                                disabled={!saveModalState.name || saveModalState.isGeneratingName}
                            >
                                저장
                            </button>
                        </div>
                    }
                >
                    <div className="space-y-4">
                        <div>
                            <label className="text-sm font-bold text-gray-700 mb-2 block">쿼리 이름</label>
                            <div className="relative">
                                <input
                                    type="text"
                                    value={saveModalState.name}
                                    onChange={e => setSaveModalState({ ...saveModalState, name: e.target.value })}
                                    className="w-full p-3 border border-gray-300 rounded-lg text-base"
                                    disabled={saveModalState.isGeneratingName}
                                />
                                {saveModalState.isGeneratingName && <SpinnerIcon className="w-5 h-5 text-blue-500 absolute top-1/2 right-3 -translate-y-1/2" />}
                            </div>
                        </div>
                        <div>
                             <label className="text-sm font-bold text-gray-700 mb-2 block">쿼리 내용</label>
                            <textarea
                                readOnly
                                value={saveModalState.query}
                                className="w-full p-3 border border-gray-300 rounded-lg font-mono text-sm bg-gray-50"
                                rows={5}
                            />
                        </div>
                    </div>
                </CompactModal>
            )}
            
            <VariableInputModal
                state={variableInputState}
                onClose={() => { setVariableInputState(null); isProcessingVariableQuery.current = false; }}
                onExecute={async (finalQuery) => {
                    setVariableInputState(null);
                    await executeQuery(finalQuery);
                    isProcessingVariableQuery.current = false;
                }}
            />

            {renderUpdatePreviewModal()}
        </div>
    );
};

export default SqlRunnerPage;