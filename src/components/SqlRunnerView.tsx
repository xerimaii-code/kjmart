
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAlert, useMiscUI, useDeviceSettings } from '../context/AppContext';
import { SpinnerIcon, TrashIcon, PencilSquareIcon, PlayCircleIcon, BookmarkSquareIcon, StopCircleIcon, SparklesIcon, StarIcon, ClipboardIcon, DragHandleIcon, WarningIcon, CheckCircleIcon, CalendarIcon, RemoveIcon, ShieldCheckIcon } from './Icons';
import { querySql, naturalLanguageToSql, aiChat, generateQueryName, UpdatePreview, QuerySqlResponse } from '../services/sqlService';
import { subscribeToSavedQueries, addSavedQuery, deleteSavedQuery, updateSavedQuery, getValue, setValue, db, ref, update } from '../services/dbService';
import { getCachedSchema } from '../services/schemaService';
import { getLearningContext } from '../services/learningService';
import { useAdjustForKeyboard } from '../hooks/useAdjustForKeyboard';
import ActionModal from './ActionModal';
import ToggleSwitch from './ToggleSwitch';

// --- TYPE DEFINITIONS ---
type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

interface SavedQuery {
    id: string;
    name: string;
    query: string;
    type: 'sql' | 'natural';
    isQuickRun?: boolean;
    isImportant?: boolean;
    order?: number;
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

// --- Helper Functions for Table Formatting ---
const isNumericColumn = (colName: string): boolean => {
    const numericKeywords = ['금액', '수량', '단가', '합계', '매출', '포인트', '가격', '금'];
    return numericKeywords.some(keyword => colName.includes(keyword));
};

const formatNumericValue = (val: any): string => {
    if (typeof val === 'number') {
        return val.toLocaleString();
    }
    const strVal = String(val);
    const num = Number(strVal.replace(/,/g, ''));
    if (!isNaN(num) && isFinite(num)) {
        // Only format if it looks like a plain number, not something like '12-34'
        if (/^-?\d+(\.\d+)?$/.test(strVal.replace(/,/g, ''))) {
            return num.toLocaleString();
        }
    }
    return strVal;
};

// CompactModal kept locally as it is specific to small dialogs in this page
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
                <header className="relative px-3 py-1.5 border-b border-gray-200">
                    <h2 className="text-sm font-bold text-gray-800 text-center">{title}</h2>
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

export const SqlRunnerView: React.FC<{ 
    onBack?: () => void;
    isActive: boolean;
    initialMode?: string;
    isModal?: boolean;
}> = ({ onBack, isActive, initialMode, isModal }) => {
    const { showAlert, showToast } = useAlert();
    const { allowDestructiveQueries } = useDeviceSettings();
    // Removed usage of sqlQueryInput from global context
    const [sqlQueryInput, setSqlQueryInput] = useState('');
    
    const [generatedSql, setGeneratedSql] = useState<string | null>(null);
    const [showGeneratedSql, setShowGeneratedSql] = useState(false);
    const [lastSuccessfulQuery, setLastSuccessfulQuery] = useState('');
    
    const [result, setResult] = useState<QuerySqlResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<QueryStatus>('idle');
    const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
    
    const [isSavedQueriesModalOpen, setSavedQueriesModalOpen] = useState(false);
    const [isAiModalOpen, setAiModalOpen] = useState(false);
    const [learningItems, setLearningItems] = useState<LearningItem[]>([]);
    const [visibleResultCount, setVisibleResultCount] = useState(INITIAL_VISIBLE_ROWS);
    
    const [editingQuery, setEditingQuery] = useState<SavedQuery | null>(null);
    const [editingLearningItem, setEditingLearningItem] = useState<LearningItem | null>(null);
    const [editLearningForm, setEditLearningForm] = useState<LearningItem | null>(null);

    const [isQueryInputModalOpen, setQueryInputModalOpen] = useState(false);
    const [modalQueryInput, setModalQueryInput] = useState('');

    const [isAiMode, setIsAiMode] = useState(false);
    const [updatePreview, setUpdatePreview] = useState<UpdatePreview | null>(null);
    
    // --- Real-time Report State ---
    const [isRealTimeReportModalOpen, setIsRealTimeReportModalOpen] = useState(false);
    const [reportDate, setReportDate] = useState(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    });
    const [activeReportTab, setActiveReportTab] = useState<'시간대별매출' | '거래처별매출' | '대분류별매출'>('시간대별매출');
    const [reportResult, setReportResult] = useState<QuerySqlResponse | null>(null);
    const [reportStatus, setReportStatus] = useState<QueryStatus>('idle');
    
    // --- Real-time Report Detail State ---
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [detailTitle, setDetailTitle] = useState('');
    const [detailResult, setDetailResult] = useState<QuerySqlResponse | null>(null);
    const [detailStatus, setDetailStatus] = useState<QueryStatus>('idle');
    // ----------------------------

    const [saveModalState, setSaveModalState] = useState<{
        query: string;
        type: 'sql';
        name: string;
        isGeneratingName: boolean;
    } | null>(null);

    const [variableInputState, setVariableInputState] = useState<VariableInputState | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);
    const isProcessingVariableQuery = useRef(false);
    
    // Drag & Drop Refs
    const savedQueriesDragIndex = useRef<number | null>(null);
    const [savedQueriesDropIndex, setSavedQueriesDropIndex] = useState<number | null>(null);
    
    const learningDragIndex = useRef<number | null>(null);
    const [learningDropIndex, setLearningDropIndex] = useState<number | null>(null);

    const saveModalRef = useRef<HTMLDivElement>(null);
    const variableModalRef = useRef<HTMLDivElement>(null);
    
    useAdjustForKeyboard(saveModalRef, !!saveModalState);
    useAdjustForKeyboard(variableModalRef, !!variableInputState);

    // Long press handling for execute button
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isLongPressRef = useRef(false);

    // Long press handling for query input modal
    const inputLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleInputStart = useCallback(() => {
        if (inputLongPressTimerRef.current) clearTimeout(inputLongPressTimerRef.current);
        inputLongPressTimerRef.current = setTimeout(() => {
            setModalQueryInput(sqlQueryInput);
            setQueryInputModalOpen(true);
            if (navigator.vibrate) navigator.vibrate(50);
        }, 500);
    }, [sqlQueryInput]);

    const handleInputEnd = useCallback(() => {
        if (inputLongPressTimerRef.current) {
            clearTimeout(inputLongPressTimerRef.current);
            inputLongPressTimerRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (editingLearningItem) {
            setEditLearningForm(editingLearningItem);
        } else {
            setEditLearningForm(null);
        }
    }, [editingLearningItem]);


    useEffect(() => {
        const unsubscribe = subscribeToSavedQueries((queries: any[]) => {
            setSavedQueries(queries);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (initialMode === 'report') {
            setIsRealTimeReportModalOpen(true);
        }
    }, [initialMode]);

    useEffect(() => {
        if (isAiModalOpen) {
            getValue('learning/sqlContext', []).then((data: any) => {
                let items: LearningItem[] = [];
                if (Array.isArray(data)) {
                    items = data.filter(Boolean).map((item, index) => ({
                        ...item,
                        id: item.id || `item_${index}_${new Date().getTime()}_${Math.random().toString(36).substring(2)}`,
                    }));
                } else if (typeof data === 'object' && data !== null) {
                    items = Object.entries(data).map(([key, value]: [string, any]) => ({
                        ...(value || {}),
                        id: value?.id || key,
                    }));
                }
                
                // Sort "기본규칙" to the top
                items.sort((a, b) => {
                    if (a.title === '기본규칙') return -1;
                    if (b.title === '기본규칙') return 1;
                    return 0;
                });
                
                setLearningItems(items);
            });
        }
    }, [isAiModalOpen]);

    // --- Real-time Report Execution Logic ---
    useEffect(() => {
        if (!isRealTimeReportModalOpen || !savedQueries.length) return;

        const runReportQuery = async () => {
            setReportStatus('loading');
            setReportResult(null);
            
            const savedQuery = savedQueries.find(q => q.name === activeReportTab);
            
            if (!savedQuery) {
                setReportStatus('error');
                return;
            }

            try {
                // Manually substitute @date variable with the selected date string
                let sql = savedQuery.query.replace(/@date\b/g, `'${reportDate}'`);
                // Remove backticks to prevent SQL syntax errors in MSSQL
                sql = sql.replace(/`/g, '');
                
                const data = await querySql(sql, new AbortController().signal);
                setReportResult(data);
                setReportStatus('success');
            } catch (err: any) {
                console.error("Report execution failed:", err);
                setReportStatus('error');
            }
        };

        const timer = setTimeout(() => {
            runReportQuery();
        }, 300); // Debounce slightly

        return () => clearTimeout(timer);

    }, [isRealTimeReportModalOpen, activeReportTab, reportDate, savedQueries]);
    
    // --- Detail Report Logic ---
    const handleReportRowClick = async (row: any) => {
        // Assume the first column is the key (Time, Vendor Name, Category Name)
        const keys = Object.keys(row);
        if (keys.length === 0) return;
        
        const targetValue = row[keys[0]];
        const targetQueryName = `${activeReportTab}_상세`;
        
        const savedQuery = savedQueries.find(q => q.name === targetQueryName);
        
        if (!savedQuery) {
            showToast(`'${targetQueryName}' 쿼리를 찾을 수 없습니다.`, 'error');
            return;
        }

        setIsDetailModalOpen(true);
        setDetailTitle(`${targetValue} 상세 내역`);
        setDetailStatus('loading');
        setDetailResult(null);

        try {
            // Replace @date and @target variables
            let sql = savedQuery.query
                .replace(/@date\b/g, `'${reportDate}'`)
                .replace(/@target\b/g, `'${targetValue}'`);
            
            sql = sql.replace(/`/g, '');

            const data = await querySql(sql, new AbortController().signal);
            setDetailResult(data);
            setDetailStatus('success');
        } catch (err: any) {
            console.error("Detail report execution failed:", err);
            setDetailStatus('error');
        }
    };

    const executeQuery = useCallback(async (sql: string, naturalLang?: string, confirmed?: boolean) => {
        setStatus('loading');
        setResult(null);
        setError(null);
        abortControllerRef.current = new AbortController();
    
        // If not destructive allowed and query is DELETE/INSERT, block it on frontend for better UX (backend also checks)
        if (!allowDestructiveQueries && /^\s*(delete|insert)\s/i.test(sql.trim()) && !confirmed) {
            showAlert('데이터 보안을 위해 INSERT 및 DELETE 쿼리는 실행할 수 없습니다.\n설정 > SQL 실행 설정에서 제한을 해제할 수 있습니다.');
            setStatus('idle');
            return;
        }
    
        try {
            // Remove backticks to prevent SQL syntax errors in MSSQL
            const sanitizedSql = sql.replace(/`/g, '');
            const data = await querySql(sanitizedSql, abortControllerRef.current.signal, confirmed, allowDestructiveQueries);
    
            if (data.preview) {
                setUpdatePreview(data.preview || null);
                setLastSuccessfulQuery(sanitizedSql); 
                setStatus('idle'); 
            } else {
                setResult(data);
                setStatus('success');
                const queryToSave = naturalLang || sql;
                setLastSuccessfulQuery(queryToSave);
                setVisibleResultCount(INITIAL_VISIBLE_ROWS);
            }
        } catch (err: any) {
            if (err.name === 'AbortError') {
                setStatus('idle');
            } else {
                setError(err.message || '알 수 없는 오류가 발생했습니다.');
                setStatus('error');
            }
        }
    }, [showAlert, allowDestructiveQueries]);

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
        let isFromSaved = false;

        if (typeof queryToRun === 'string') {
            if (queryToRun.startsWith('@')) {
                const savedQueryName = queryToRun.slice(1).split(/\s+/)[0];
                const savedQuery = savedQueries.find(q => q.name.toLowerCase() === savedQueryName.toLowerCase());
                if (savedQuery) {
                    finalQueryDef = savedQuery;
                    isFromSaved = true;
                } else {
                    executeQuery(queryToRun, undefined, undefined);
                    return;
                }
            } else {
                executeQuery(queryToRun, undefined, undefined);
                return;
            }
        } else {
            finalQueryDef = queryToRun;
            isFromSaved = true;
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
                executeQuery(queryText, `@${queryName}`, undefined);
            } else if (queryType === 'natural') {
                processNaturalLanguageQuery(queryText);
            }
            if (isFromSaved) {
                setSavedQueriesModalOpen(false);
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
        setShowGeneratedSql(false);

        if (currentInput.startsWith('@')) {
            const queryName = currentInput.slice(1).split(/\s+/)[0];
            const savedQuery = savedQueries.find(q => q.name.toLowerCase() === queryName.toLowerCase());
            if (savedQuery) {
                runQueryWithVariableCheck(savedQuery);
                return;
            }
        }

        const isLikelySql = /^(SELECT|UPDATE|DELETE|INSERT|CREATE|DROP|ALTER|TRUNCATE)\b/i.test(currentInput);
        if (isLikelySql && !isAiMode) executeQuery(currentInput, undefined, undefined);
        else processNaturalLanguageQuery(currentInput);
    }, [executeQuery, savedQueries, showAlert, processNaturalLanguageQuery, isAiMode, runQueryWithVariableCheck]);
    
    const handleExecuteClickWrapped = () => {
        if (status === 'loading') {
            abortControllerRef.current?.abort();
            showToast('실행이 중단되었습니다.', 'error');
        } else {
            processAndExecute(sqlQueryInput);
        }
    };

    // Long Press Logic
    const handleExecuteButtonDown = () => {
        if (status === 'loading') return; // Don't trigger long press if loading (stop button)
        isLongPressRef.current = false;
        longPressTimerRef.current = setTimeout(() => {
            isLongPressRef.current = true;
            setSqlQueryInput('');
            showToast('입력창이 초기화되었습니다.');
            if (navigator.vibrate) navigator.vibrate(50);
        }, 500);
    };

    const handleExecuteButtonUp = () => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

    const handleExecuteButtonClick = () => {
        if (isLongPressRef.current) return;
        handleExecuteClickWrapped();
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

    const handleAddNewQuery = () => {
        setSavedQueriesModalOpen(false);
        setEditingQuery({
            id: 'new',
            name: '',
            query: '',
            type: 'sql',
            isQuickRun: false,
            isImportant: false,
        });
    };

    const handleSaveEditingQuery = () => {
        if (!editingQuery) return;
    
        const { id, name, query, isQuickRun, isImportant } = editingQuery;
        if (!name.trim() || !query.trim()) {
            showAlert('쿼리 이름과 내용을 모두 입력해주세요.');
            return;
        }
        
        const isLikelySql = /^(SELECT|UPDATE|DELETE|INSERT|CREATE|DROP|ALTER|TRUNCATE)\b/i.test(query.trim());
        const detectedType: 'sql' | 'natural' = isLikelySql ? 'sql' : 'natural';
    
        const dataToSave = {
            name: name.trim(),
            query: query.trim(),
            type: detectedType,
            isQuickRun: !!isQuickRun,
            isImportant: !!isImportant,
        };

        const performSave = () => {
            if (id === 'new') {
                addSavedQuery({ ...dataToSave, order: savedQueries.length })
                    .then(() => {
                        showToast('쿼리가 추가되었습니다.', 'success');
                        setEditingQuery(null);
                        setSavedQueriesModalOpen(true);
                    })
                    .catch(err => {
                        console.error(err);
                        showAlert('쿼리 추가에 실패했습니다.');
                    });
            } else {
                updateSavedQuery(id, dataToSave)
                    .then(() => {
                        showToast('쿼리가 수정되었습니다.', 'success');
                        setEditingQuery(null);
                        setSavedQueriesModalOpen(true);
                    })
                    .catch(err => {
                        console.error(err);
                        showAlert('쿼리 수정에 실패했습니다.');
                    });
            }
        };

        // Important query protection check for modification
        if (id !== 'new' && isImportant) {
            showAlert(
                "이 쿼리는 '중요'로 설정되어 있습니다.\n쿼리 수정 시 연동된 기능(매출 속보, 상세 조회 등)이 작동하지 않을 수 있습니다.\n\n그래도 수정하시겠습니까?",
                performSave,
                "수정 저장",
                "bg-amber-500 hover:bg-amber-600"
            );
        } else {
            performSave();
        }
    };

    const handleDeleteQuery = (q: SavedQuery) => {
        const deleteAction = () => deleteSavedQuery(q.id);

        if (q.isImportant) {
            showAlert(
                `경고: '${q.name}' 쿼리는 중요 쿼리로 설정되어 있습니다.\n\n이 쿼리를 삭제하면 앱의 주요 기능(매출 속보 등)이 작동하지 않을 수 있습니다.\n정말 삭제하시겠습니까?`,
                deleteAction,
                '삭제 (위험)',
                'bg-red-600 hover:bg-red-700 font-bold'
            );
        } else {
            showAlert(
                `'${q.name}' 쿼리를 삭제하시겠습니까?`, 
                deleteAction, 
                '삭제', 
                'bg-rose-500'
            );
        }
    };

    // AI Learning Rules
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
                    // Save as array to maintain order
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
    
    // Learning Items Drag & Drop
    const handleLearningDragStart = (e: React.DragEvent, index: number) => {
        // Prevent dragging the first item if it is "기본규칙"
        if (index === 0 && learningItems[0]?.title === '기본규칙') {
            e.preventDefault();
            return;
        }
        learningDragIndex.current = index;
        e.dataTransfer.effectAllowed = 'move';
        (e.currentTarget as HTMLElement).classList.add('dragging');
    };

    const handleLearningDragEnter = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        // Prevent dropping above "기본규칙" (index 0)
        if (index === 0 && learningItems[0]?.title === '기본규칙') return;
        
        if (learningDragIndex.current !== index) {
            setLearningDropIndex(index);
        }
    };

    const handleLearningDragEnd = (e: React.DragEvent) => {
        (e.currentTarget as HTMLElement).classList.remove('dragging');
        learningDragIndex.current = null;
        setLearningDropIndex(null);
    };

    const handleLearningDragOver = (e: React.DragEvent) => e.preventDefault();

    const handleLearningDrop = async () => {
        if (learningDragIndex.current !== null && learningDropIndex !== null) {
            const from = learningDragIndex.current;
            const to = learningDropIndex > from ? learningDropIndex - 1 : learningDropIndex;
            
            // Validate: cannot move to index 0 if it's reserved for "기본규칙"
            if (to === 0 && learningItems[0]?.title === '기본규칙') return;

            if (from !== to) {
                const newItems = [...learningItems];
                const [removed] = newItems.splice(from, 1);
                newItems.splice(to, 0, removed);
                
                try {
                    // Save the reordered array directly to maintain order
                    await setValue('learning/sqlContext', newItems);
                    setLearningItems(newItems);
                    showToast('규칙 순서가 저장되었습니다.', 'success');
                } catch (err) {
                    showAlert('순서 저장에 실패했습니다.');
                }
            }
        }
    };

    // Saved Queries D&D
    const handleSavedQueriesDragStart = (e: React.DragEvent, index: number) => {
        savedQueriesDragIndex.current = index; e.dataTransfer.effectAllowed = 'move';
        (e.currentTarget as HTMLElement).classList.add('dragging');
    };
    const handleSavedQueriesDragEnter = (e: React.DragEvent, index: number) => {
        e.preventDefault(); if (savedQueriesDragIndex.current !== index) setSavedQueriesDropIndex(index);
    };
    const handleSavedQueriesDragEnd = (e: React.DragEvent) => {
        (e.currentTarget as HTMLElement).classList.remove('dragging');
        savedQueriesDragIndex.current = null; setSavedQueriesDropIndex(null);
    };
    const handleSavedQueriesDragOver = (e: React.DragEvent) => e.preventDefault();
    const handleSavedQueriesDrop = async () => {
        if (savedQueriesDragIndex.current !== null && savedQueriesDropIndex !== null && db) {
            const from = savedQueriesDragIndex.current;
            const to = savedQueriesDropIndex > from ? savedQueriesDropIndex - 1 : savedQueriesDropIndex;
            if (from !== to) {
                const reordered = [...savedQueries];
                const [removed] = reordered.splice(from, 1);
                reordered.splice(to, 0, removed);
                
                const updates: { [key: string]: number } = {};
                reordered.forEach((q, index) => {
                    updates[`/saved-queries/${q.id}/order`] = index;
                });
                try {
                    await update(ref(db), updates);
                    showToast('쿼리 순서가 저장되었습니다.', 'success');
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
    
    const handleClearResults = useCallback(() => {
        setResult(null);
        setError(null);
        setStatus('idle');
        setGeneratedSql(null);
        setLastSuccessfulQuery('');
    }, []);

    const handleSaveLearningItem = async () => {
        if (!editLearningForm) return;
        
        const isNew = !learningItems.some(item => item.id === editLearningForm.id);
        const finalItems = isNew
            ? [editLearningForm, ...learningItems]
            : learningItems.map(item => item.id === editLearningForm.id ? editLearningForm : item);
        
        // Ensure "기본규칙" stays at top if it exists
        finalItems.sort((a, b) => {
            if (a.title === '기본규칙') return -1;
            if (b.title === '기본규칙') return 1;
            return 0;
        });

        try {
            // Save as array to maintain order
            await setValue('learning/sqlContext', finalItems);
            setLearningItems(finalItems);
            showToast('AI 학습 데이터가 저장되었습니다.', 'success');
            setEditingLearningItem(null);
            setAiModalOpen(true);
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
    
    const quickRunQueries = useMemo(() => savedQueries.filter(q => q.isQuickRun).sort((a, b) => (a.order ?? 999) - (b.order ?? 999)), [savedQueries]);
    
    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleExecuteClickWrapped();
        }
    };

    const VariableInputModal: React.FC<{
        state: VariableInputState | null;
        onClose: () => void;
        onExecute: (finalQuery: string, values: Record<string, string>) => Promise<void>;
    }> = ({ state, onClose, onExecute }) => {
        const [values, setValues] = useState<Record<string, string>>({});
        const formRef = useRef<HTMLFormElement>(null);
        
        useEffect(() => {
            if (state) {
                const initialValues = state.variables.reduce((acc, v) => ({ ...acc, [v]: '' }), {});
                setValues(initialValues);
                setTimeout(() => {
                    if (formRef.current) {
                        const input = formRef.current.querySelector<HTMLInputElement>('input[type="text"]');
                        input?.focus();
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
                        className="w-full h-11 bg-blue-600 text-white font-bold rounded-lg transition hover:bg-blue-700 active:scale-95 shadow-lg shadow-blue-500/30"
                    >
                        실행
                    </button>
                }
            >
                <p className="text-sm text-gray-600 mb-4">쿼리 실행에 필요한 값을 입력해주세요.</p>
                <form ref={formRef} onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-4">
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

    const renderResult = () => {
        if (!result && status !== 'error') return null;

        if (status === 'error') {
            const handleCopyError = () => {
                if (error) {
                    navigator.clipboard.writeText(error)
                        .then(() => showToast('오류 메시지가 복사되었습니다.', 'success'))
                        .catch(() => showToast('복사 실패.', 'error'));
                }
            };
            return (
                <div className="flex flex-col items-center justify-center h-full text-center p-4">
                    <WarningIcon className="w-16 h-16 text-red-400 mb-4" />
                    <p className="text-lg font-bold text-gray-800 mb-2">오류가 발생했습니다</p>
                    <div className="relative w-full max-w-md bg-red-50 p-4 rounded-lg border border-red-100 text-left">
                        <pre className="text-sm text-red-800 break-words whitespace-pre-wrap font-mono select-text">
                            <code>{error}</code>
                        </pre>
                        <button 
                            onClick={handleCopyError}
                            className="absolute top-2 right-2 p-1.5 text-gray-500 hover:bg-red-100 rounded-full transition-colors"
                            title="오류 복사"
                        >
                            <ClipboardIcon className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            );
        }

        if (result?.answer) {
            const handleCopyAnswer = () => {
                if (result.answer) {
                    navigator.clipboard.writeText(result.answer)
                        .then(() => showToast('AI 답변이 복사되었습니다.', 'success'))
                        .catch(() => showToast('복사 실패.', 'error'));
                }
            };
            return (
                // Changed h-full to min-h-full for scrolling
                <div className="p-4 min-h-full flex flex-col items-center justify-center text-center">
                    <SparklesIcon className="w-12 h-12 text-blue-500 mb-4 flex-shrink-0" />
                    <div className="relative bg-white p-6 rounded-2xl shadow-sm border border-blue-100 max-w-lg w-full text-left">
                        <p className="text-lg text-gray-800 leading-relaxed font-medium whitespace-pre-wrap select-text">{result.answer}</p>
                        <button 
                            onClick={handleCopyAnswer}
                            className="absolute top-2 right-2 p-1.5 text-gray-400 hover:bg-gray-100 rounded-full transition-colors"
                            title="답변 복사"
                        >
                            <ClipboardIcon className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            );
        }

        if (result?.rowsAffected !== undefined && !result.recordset) {
            return (
                <div className="flex flex-col items-center justify-center h-full text-center p-4">
                    <CheckCircleIcon className="w-16 h-16 text-green-500 mb-4" />
                    <p className="text-xl font-bold text-gray-800">실행 완료</p>
                    <p className="text-gray-600 mt-2">{result.rowsAffected}개 행이 영향을 받았습니다.</p>
                </div>
            );
        }

        if (result?.recordset) {
            if (result.recordset.length === 0) {
                return (
                    <div className="flex flex-col items-center justify-center h-full text-center p-4 text-gray-500">
                        <p>조회 결과가 없습니다.</p>
                    </div>
                );
            }

            const columns = Object.keys(result.recordset[0]);
            
            return (
                <div className="flex flex-col h-full">
                    <div className="flex-shrink-0 bg-gray-50 p-2 border-b flex justify-between items-center text-xs text-gray-500">
                        <span>총 {result.recordset.length}개 결과</span>
                        <div className="flex gap-2">
                            <button onClick={handleCopyResults} className="flex items-center gap-1 hover:text-blue-600 transition-colors">
                                <ClipboardIcon className="w-4 h-4" /> <span>복사</span>
                            </button>
                            <button onClick={handleClearResults} className="flex items-center gap-1 hover:text-red-600 transition-colors">
                                <TrashIcon className="w-4 h-4" /> <span>지우기</span>
                            </button>
                        </div>
                    </div>
                    <div className="flex-grow overflow-auto">
                        <table className="w-full text-sm text-left border-collapse">
                            <thead className="bg-gray-100 text-gray-700 font-bold sticky top-0 z-10 shadow-sm border-b">
                                <tr>
                                    {columns.map((col) => (
                                        <th key={col} className="p-3 whitespace-nowrap bg-gray-100 border-r last:border-r-0 border-gray-200">{col}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-100">
                                {result.recordset.slice(0, visibleResultCount).map((row, rowIndex) => (
                                    <tr key={rowIndex} className="hover:bg-blue-50 transition-colors">
                                        {columns.map((col, colIndex) => (
                                            <td key={`${rowIndex}-${colIndex}`} className="p-3 whitespace-nowrap border-r last:border-r-0 border-gray-100 text-gray-600 font-mono">
                                                {row[col] === null ? <span className="text-gray-300 italic">NULL</span> : String(row[col])}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {result.recordset.length > visibleResultCount && (
                            <div className="p-4 text-center">
                                <button 
                                    onClick={() => setVisibleResultCount(prev => prev + ROWS_PER_LOAD)}
                                    className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 text-sm font-semibold transition-colors"
                                >
                                    더 보기 ({result.recordset.length - visibleResultCount}개 남음)
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        return null;
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
            <ActionModal
              isOpen={!!updatePreview}
              onClose={handleCancelUpdate}
              title="수정 미리보기 (0건)"
              zIndexClass="z-[90]"
              footer={<button onClick={handleCancelUpdate} className="w-full h-11 bg-gray-200 text-gray-700 rounded-lg font-semibold text-base hover:bg-gray-300 transition shadow-sm flex items-center justify-center active:scale-95">닫기</button>}
            >
              <div className="p-8 text-center">
                <p className="font-semibold text-lg">UPDATE 쿼리와 일치하는 데이터가 없습니다.</p>
                <p className="text-sm text-gray-500 mt-2">데이터가 수정되지 않습니다.</p>
              </div>
            </ActionModal>
          );
        }
        
        const allKeys = Object.keys(changes[0].afterRow);
    
        return (
            <ActionModal
                isOpen={!!updatePreview}
                onClose={handleCancelUpdate}
                title={`수정 미리보기 (${changes.length}건)`}
                zIndexClass="z-[90]"
                footer={
                     <div className="grid grid-cols-2 gap-3">
                        <button onClick={handleCancelUpdate} className="h-11 px-4 bg-gray-200 text-gray-700 rounded-lg font-semibold text-base hover:bg-gray-300 transition shadow-sm flex items-center justify-center active:scale-95">취소</button>
                        <button onClick={handleConfirmUpdate} className="h-11 bg-blue-600 text-white px-4 rounded-lg font-bold text-base hover:bg-blue-700 transition shadow-lg shadow-blue-500/40 flex items-center justify-center active:scale-95">확인 및 실행</button>
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
            </ActionModal>
        );
    };

    return (
        <div className="h-full flex flex-col bg-gray-50" data-no-swipe="true">
            {!isModal && (
                <header className="flex-shrink-0 p-3 bg-white border-b flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-2">
                        {onBack && (
                            <button onClick={onBack} className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1 font-semibold">
                                 <span className="text-xl">←</span>
                                 <span>메뉴</span>
                            </button>
                        )}
                        <div>
                            <h2 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                                SQL Runner (AI)
                                {allowDestructiveQueries && (
                                    <span className="text-xs px-2 py-0.5 bg-red-100 text-red-600 rounded-full font-bold border border-red-200">
                                        ⚠ 제한 해제됨
                                    </span>
                                )}
                            </h2>
                        </div>
                    </div>
                </header>
            )}
            <div className="flex-shrink-0 p-2 border-b bg-white">
                <div className="flex gap-2 overflow-x-auto no-scrollbar">
                    {quickRunQueries.length > 0 ? (
                        quickRunQueries.map(q => (
                            <button
                                key={q.id}
                                onClick={() => runQueryWithVariableCheck(q)}
                                className="px-3 py-1.5 bg-gray-100 border border-gray-200 rounded-full font-semibold text-gray-700 text-sm hover:bg-gray-200 transition active:scale-95 flex-grow flex-shrink min-w-0"
                            >
                                <span className="truncate block">{q.name}</span>
                            </button>
                        ))
                    ) : (
                        <p className="text-xs text-gray-400 text-center w-full py-1">빠른 실행 쿼리를 추가해보세요.</p>
                    )}
                </div>
            </div>
            
            <main className="flex-grow overflow-y-auto relative">
                {status === 'idle' ? (
                    <div className="flex items-center justify-center h-full text-center text-gray-400 p-4">
                        <div>
                            <SparklesIcon className="w-16 h-16 mx-auto text-gray-300" />
                            <p className="mt-4 font-semibold text-lg">무엇을 도와드릴까요?</p>
                            <p className="text-sm mt-1">하단 입력창에 SQL을 입력하거나 자연어로 질문해보세요.</p>
                        </div>
                    </div>
                ) : status === 'loading' ? (
                    <div className="flex flex-col items-center justify-center h-full text-center p-8 space-y-4 animate-fade-in-up">
                        <div className="relative">
                            <div className="w-16 h-16 border-4 border-blue-100 rounded-full"></div>
                            <div className="absolute top-0 left-0 w-16 h-16 border-4 border-blue-500 rounded-full animate-spin border-t-transparent"></div>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <SparklesIcon className="w-6 h-6 text-blue-500 animate-pulse" />
                            </div>
                        </div>
                        <div>
                            <p className="text-lg font-bold text-gray-800">{isAiMode ? "AI가 생각 중입니다..." : "쿼리 실행 중..."}</p>
                            <p className="text-sm text-gray-500 mt-1">잠시만 기다려주세요.</p>
                        </div>
                    </div>
                ) : (
                    renderResult()
                )}
            </main>
            
            <footer className="flex-shrink-0 p-2 bg-white border-t space-y-2 pb-safe">
                {generatedSql && status !== 'loading' && (
                    <div className="p-2 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex items-center gap-2">
                            <button onClick={() => setShowGeneratedSql(s => !s)} className="text-xs font-semibold text-blue-600 hover:underline">
                                {showGeneratedSql ? 'SQL 숨기기' : 'SQL 보기'}
                            </button>
                            <button onClick={handleSaveGeneratedSql} className="text-xs font-semibold text-blue-600 hover:underline">
                                SQL 저장
                            </button>
                        </div>
                        {showGeneratedSql && (
                            <pre className="text-xs p-2 bg-white rounded-md overflow-x-auto mt-2 border"><code>{generatedSql}</code></pre>
                        )}
                    </div>
                )}
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        value={sqlQueryInput}
                        onChange={(e) => setSqlQueryInput(e.target.value)}
                        onKeyDown={handleInputKeyDown}
                        onMouseDown={handleInputStart}
                        onTouchStart={handleInputStart}
                        onMouseUp={handleInputEnd}
                        onTouchEnd={handleInputEnd}
                        onMouseLeave={handleInputEnd}
                        onTouchMove={handleInputEnd}
                        onContextMenu={(e) => e.preventDefault()}
                        className="w-full h-11 px-4 border border-gray-300 bg-white rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors text-base text-gray-800 placeholder:text-gray-400"
                        placeholder={isAiMode ? "AI에게 자유롭게 질문하세요..." : "SQL 또는 자연어 입력..."}
                        autoComplete="off"
                    />
                    <button
                        onClick={() => setIsAiMode(!isAiMode)}
                        className={`w-11 h-11 flex-shrink-0 rounded-lg flex items-center justify-center transition-colors shadow-sm ${
                            isAiMode ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                        title="AI 채팅 모드 전환"
                    >
                        <SparklesIcon className={`w-6 h-6 transition-transform ${isAiMode ? 'animate-pulse' : ''}`} />
                    </button>
                </div>
                <div className="flex items-stretch gap-2">
                     <button
                        onMouseDown={handleExecuteButtonDown}
                        onTouchStart={handleExecuteButtonDown}
                        onMouseUp={handleExecuteButtonUp}
                        onTouchEnd={handleExecuteButtonUp}
                        onMouseLeave={handleExecuteButtonUp}
                        onClick={handleExecuteButtonClick}
                        className={`flex-grow h-14 rounded-lg flex items-center justify-center font-bold text-lg transition-all duration-200 active:scale-95 shadow-lg ${
                            status === 'loading'
                                ? 'bg-rose-500 hover:bg-rose-600 text-white'
                                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/30'
                        }`}
                        aria-label={status === 'loading' ? '실행 중단' : '실행'}
                    >
                        {status === 'loading' ? <StopCircleIcon className="w-7 h-7" /> : <PlayCircleIcon className="w-7 h-7" />}
                        <span className="ml-2">{status === 'loading' ? '중단' : '실행'}</span>
                    </button>
                     <button onClick={() => setSavedQueriesModalOpen(true)} className="flex-shrink-0 w-20 h-14 bg-white border border-gray-300 rounded-lg font-semibold text-gray-700 text-sm flex flex-col items-center justify-center text-center gap-1 hover:bg-gray-50 transition active:scale-95">
                        <BookmarkSquareIcon className="w-5 h-5" />
                        <span>저장된<br/>쿼리</span>
                    </button>
                    <button onClick={() => setAiModalOpen(true)} className="flex-shrink-0 w-20 h-14 bg-white border border-gray-300 rounded-lg font-semibold text-gray-700 text-sm flex flex-col items-center justify-center text-center gap-1 hover:bg-gray-50 transition active:scale-95">
                        <SparklesIcon className="w-5 h-5" />
                        <span>AI<br/>학습</span>
                    </button>
                </div>
            </footer>

            {renderUpdatePreviewModal()}

            <ActionModal
                isOpen={isRealTimeReportModalOpen}
                onClose={() => { setIsRealTimeReportModalOpen(false); onBack && onBack(); }}
                title="실시간 매출 속보"
                zIndexClass="z-[90]"
            >
                <div className="flex flex-col h-full bg-gray-50">
                    <div className="flex-shrink-0 bg-white p-3 border-b shadow-sm space-y-3 sticky top-0 z-10">
                        <div className="flex justify-center w-full">
                            <div className="inline-flex items-center gap-3 bg-white border border-gray-300 rounded-2xl px-5 py-2 shadow-sm">
                                <CalendarIcon className="w-5 h-5 text-blue-600" />
                                <input 
                                    type="date" 
                                    value={reportDate} 
                                    onChange={(e) => setReportDate(e.target.value)} 
                                    className="border-none p-0 text-lg font-bold text-gray-800 focus:ring-0 bg-transparent text-center w-36 outline-none cursor-pointer"
                                />
                            </div>
                        </div>
                        <div className="flex bg-gray-100 rounded-lg p-1">
                            {['시간대별매출', '거래처별매출', '대분류별매출'].map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveReportTab(tab as any)}
                                    className={`flex-1 py-2 px-1 text-lg sm:text-xl font-bold rounded-md transition-all duration-200 ${
                                        activeReportTab === tab 
                                            ? 'bg-white text-blue-600 shadow-sm' 
                                            : 'text-gray-500 hover:text-gray-700'
                                    }`}
                                >
                                    {tab.replace('매출', '')}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex-grow overflow-hidden p-2 flex flex-col">
                        {reportStatus === 'loading' && (
                            <div className="flex flex-col items-center justify-center h-full space-y-3">
                                <SpinnerIcon className="w-8 h-8 text-blue-500" />
                                <p className="text-gray-500 font-medium">데이터 불러오는 중...</p>
                            </div>
                        )}
                        {reportStatus === 'error' && (
                            <div className="flex flex-col items-center justify-center h-full text-center p-4">
                                <p className="text-red-500 font-bold mb-2">데이터 조회 실패</p>
                                <p className="text-sm text-gray-500">
                                    '{activeReportTab}' 쿼리를 찾을 수 없거나 실행 중 오류가 발생했습니다.
                                    <br/>저장된 쿼리 이름을 확인해주세요.
                                </p>
                            </div>
                        )}
                        {reportStatus === 'success' && reportResult?.recordset && (
                           <div className="bg-white rounded-lg border shadow-sm overflow-auto flex-grow">
                                {reportResult.recordset.length === 0 ? (
                                    <div className="flex items-center justify-center h-full">
                                        <p className="p-8 text-center text-gray-500 font-medium">데이터가 없습니다.</p>
                                    </div>
                                ) : (() => {
                                    const columns = Object.keys(reportResult.recordset[0] || {});
                                    return (
                                        <table className="min-w-full text-base text-left">
                                            <thead className="bg-gray-50 text-gray-700 font-semibold border-b sticky top-0 z-10 shadow-sm">
                                                <tr>
                                                    {columns.map((key) => (
                                                        <th key={key} className="px-1 py-2 whitespace-nowrap bg-gray-50 text-center">{key}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {reportResult.recordset.map((row, idx) => (
                                                    <tr key={idx} onClick={() => handleReportRowClick(row)} className="hover:bg-blue-50 transition-colors cursor-pointer active:bg-blue-100">
                                                        {columns.map((col, vIdx) => (
                                                            <td key={vIdx} className={`px-1 py-2 whitespace-nowrap font-mono text-gray-600 ${isNumericColumn(col) ? 'text-right' : 'text-left'}`}>
                                                                {isNumericColumn(col) ? formatNumericValue(row[col]) : String(row[col])}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                </div>
            </ActionModal>

            <ActionModal
                isOpen={isDetailModalOpen}
                onClose={() => setIsDetailModalOpen(false)}
                title={detailTitle}
                zIndexClass="z-[100]"
            >
                <div className="flex flex-col h-full bg-gray-50">
                    <div className="flex-grow overflow-hidden p-2 flex flex-col">
                        {detailStatus === 'loading' && (
                            <div className="flex flex-col items-center justify-center h-full space-y-3">
                                <SpinnerIcon className="w-8 h-8 text-blue-500" />
                                <p className="text-gray-500 font-medium">상세 내역 조회 중...</p>
                            </div>
                        )}
                        {detailStatus === 'error' && (
                            <div className="flex flex-col items-center justify-center h-full text-center p-4">
                                <p className="text-red-500 font-bold mb-2">조회 실패</p>
                                <p className="text-sm text-gray-500">
                                    상세 데이터를 불러오는 중 오류가 발생했습니다.
                                </p>
                            </div>
                        )}
                        {detailStatus === 'success' && detailResult?.recordset && (
                            <div className="bg-white rounded-lg border shadow-sm overflow-auto flex-grow">
                                {detailResult.recordset.length === 0 ? (
                                     <div className="flex items-center justify-center h-full">
                                        <p className="p-8 text-center text-gray-500 font-medium">상세 내역이 없습니다.</p>
                                    </div>
                                ) : (() => {
                                    const columns = Object.keys(detailResult.recordset[0] || {});
                                    return (
                                        <table className="min-w-full text-base text-left">
                                            <thead className="bg-gray-50 text-gray-700 font-semibold border-b sticky top-0 z-10 shadow-sm">
                                                <tr>
                                                    {columns.map((key) => (
                                                        <th key={key} className="px-1 py-2 whitespace-nowrap bg-gray-50 text-center">{key}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {detailResult.recordset.map((row, idx) => (
                                                    <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                                        {columns.map((col, vIdx) => (
                                                            <td key={vIdx} className={`px-1 py-2 whitespace-nowrap font-mono text-gray-600 ${isNumericColumn(col) ? 'text-right' : 'text-left'}`}>
                                                                {isNumericColumn(col) ? formatNumericValue(row[col]) : String(row[col])}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                </div>
            </ActionModal>

            <ActionModal
                isOpen={isSavedQueriesModalOpen}
                onClose={() => setSavedQueriesModalOpen(false)}
                title="저장된 쿼리"
                heightClass="h-[70vh]"
                zIndexClass="z-[90]"
                footer={
                    <button onClick={handleAddNewQuery} className="w-full h-11 bg-blue-600 text-white font-bold rounded-lg transition hover:bg-blue-700 active:scale-95 shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2">
                        <PencilSquareIcon className="w-5 h-5" />
                        <span>새 쿼리 추가</span>
                    </button>
                }
            >
                 <div className="p-2" onDragOver={handleSavedQueriesDragOver} onDrop={handleSavedQueriesDrop}>
                    {savedQueries.length === 0 ? (
                        <p className="text-center text-gray-500 py-8">저장된 쿼리가 없습니다.</p>
                    ) : (
                        <div className="space-y-2">
                            {savedQueries.map((q, index) => (
                                <React.Fragment key={q.id}>
                                    {savedQueriesDropIndex === index && <div className="h-16 bg-blue-100 border-2 border-dashed border-blue-400 rounded-lg" />}
                                    <div 
                                        draggable
                                        onDragStart={(e) => handleSavedQueriesDragStart(e, index)}
                                        onDragEnter={(e) => handleSavedQueriesDragEnter(e, index)}
                                        onDragEnd={handleSavedQueriesDragEnd}
                                        className="bg-white p-3 rounded-lg border border-gray-200 flex items-center gap-2"
                                    >
                                        <div className="cursor-grab p-1" title="순서 변경">
                                            <DragHandleIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
                                        </div>
                                        <div className="flex-grow min-w-0 cursor-pointer" onClick={() => runQueryWithVariableCheck(q)}>
                                            <div className="flex items-center gap-2">
                                                <p className="font-bold text-gray-800 truncate">{q.name}</p>
                                                {q.isImportant && (
                                                    <ShieldCheckIcon className="w-4 h-4 text-blue-500" title="중요 쿼리 (보호됨)" />
                                                )}
                                            </div>
                                        </div>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); updateSavedQuery(q.id, { isQuickRun: !q.isQuickRun }); }}
                                            className={`p-2 rounded-full transition-colors flex-shrink-0 ${q.isQuickRun ? 'text-yellow-500 bg-yellow-50 hover:bg-yellow-100' : 'text-gray-300 hover:bg-gray-100 hover:text-gray-400'}`}
                                            title={q.isQuickRun ? "빠른 실행 해제" : "빠른 실행 추가"}
                                        >
                                            <StarIcon className="w-5 h-5" fill={q.isQuickRun ? "currentColor" : "none"} />
                                        </button>
                                        <button onClick={() => { setEditingQuery(q); setSavedQueriesModalOpen(false); }} className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors flex-shrink-0"><PencilSquareIcon className="w-5 h-5" /></button>
                                        <button onClick={() => handleDeleteQuery(q)} className="p-2 text-gray-500 hover:bg-rose-50 hover:text-rose-600 rounded-full transition-colors flex-shrink-0"><TrashIcon className="w-5 h-5" /></button>
                                    </div>
                                </React.Fragment>
                            ))}
                            {savedQueriesDropIndex === savedQueries.length && <div className="h-16 bg-blue-100 border-2 border-dashed border-blue-400 rounded-lg" />}
                        </div>
                    )}
                </div>
            </ActionModal>
            
            <ActionModal
                isOpen={!!editingQuery}
                onClose={() => { setEditingQuery(null); setSavedQueriesModalOpen(true); }}
                title={editingQuery?.id === 'new' ? "새 쿼리 만들기" : "쿼리 수정"}
                heightClass="h-[70vh]"
                zIndexClass="z-[90]"
                footer={
                    <div className="w-full flex flex-col gap-3">
                        {editingQuery && (
                            <div className="flex items-center justify-between px-1">
                                <ToggleSwitch 
                                    id="is-important-query" 
                                    label="중요 쿼리 (보호 설정)" 
                                    checked={!!editingQuery.isImportant} 
                                    onChange={(checked) => setEditingQuery({ ...editingQuery, isImportant: checked })} 
                                    color="blue"
                                />
                            </div>
                        )}
                        <button onClick={handleSaveEditingQuery} className="w-full h-11 bg-blue-600 text-white font-bold rounded-lg transition hover:bg-blue-700 active:scale-95 shadow-lg shadow-blue-500/30">저장</button>
                    </div>
                }
            >
                {editingQuery && (
                    <div className="flex flex-col h-full">
                        <div className="p-2 border-b border-gray-200">
                            <input
                                id="query-name"
                                type="text"
                                value={editingQuery.name}
                                onChange={(e) => setEditingQuery({ ...editingQuery, name: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 bg-white rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm font-bold"
                                placeholder="쿼리 이름 입력"
                            />
                        </div>
                        <textarea
                            id="query-content"
                            value={editingQuery.query}
                            onChange={(e) => setEditingQuery({ ...editingQuery, query: e.target.value })}
                            className="flex-grow w-full p-3 bg-white focus:outline-none font-mono text-sm resize-none"
                            placeholder="SELECT * FROM ..."
                        />
                    </div>
                )}
            </ActionModal>

            <ActionModal
                isOpen={isAiModalOpen}
                onClose={() => setAiModalOpen(false)}
                title="AI 학습 규칙"
                heightClass="h-[70vh]"
                zIndexClass="z-[90]"
                footer={
                    <button onClick={handleAddLearningItem} className="w-full h-11 bg-blue-600 text-white font-bold rounded-lg transition hover:bg-blue-700 active:scale-95 shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2">
                        <PencilSquareIcon className="w-5 h-5" />
                        <span>새 규칙 추가</span>
                    </button>
                }
            >
                <div className="p-2" onDragOver={handleLearningDragOver} onDrop={handleLearningDrop}>
                    {learningItems.length === 0 ? (
                        <p className="text-center text-gray-500 py-8">저장된 학습 규칙이 없습니다.</p>
                    ) : (
                        <div className="space-y-2">
                            {learningItems.map((item, index) => {
                                const isDefaultRule = item.title === '기본규칙';
                                return (
                                    <React.Fragment key={item.id}>
                                        {learningDropIndex === index && <div className="h-12 bg-blue-100 border-2 border-dashed border-blue-400 rounded-lg" />}
                                        <div 
                                            draggable={!isDefaultRule}
                                            onDragStart={(e) => handleLearningDragStart(e, index)}
                                            onDragEnter={(e) => handleLearningDragEnter(e, index)}
                                            onDragEnd={handleLearningDragEnd}
                                            className={`bg-white p-3 rounded-lg border flex items-center gap-3 ${
                                                isDefaultRule 
                                                    ? 'border-blue-200 bg-blue-50/50' 
                                                    : 'border-gray-200'
                                            }`}
                                        >
                                            {isDefaultRule ? (
                                                <div className="p-1" title="고정됨">
                                                    <StarIcon className="w-5 h-5 text-blue-500 flex-shrink-0" fill="currentColor" />
                                                </div>
                                            ) : (
                                                <div className="cursor-grab p-1" title="순서 변경">
                                                    <DragHandleIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
                                                </div>
                                            )}
                                            
                                            <div className="flex-grow min-w-0 cursor-pointer" onClick={() => { setEditingLearningItem(item); setAiModalOpen(false); }}>
                                                <p className={`font-bold truncate ${isDefaultRule ? 'text-blue-800' : 'text-gray-800'}`}>
                                                    {item.title}
                                                </p>
                                            </div>
                                            
                                            <button onClick={(e) => handleDeleteLearningItem(e, item.id)} className="p-2 text-gray-500 hover:bg-rose-50 hover:text-rose-600 rounded-full transition-colors flex-shrink-0">
                                                <TrashIcon className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </React.Fragment>
                                );
                            })}
                            {learningDropIndex === learningItems.length && <div className="h-12 bg-blue-100 border-2 border-dashed border-blue-400 rounded-lg" />}
                        </div>
                    )}
                </div>
            </ActionModal>
            
            <ActionModal
                isOpen={!!editingLearningItem}
                onClose={() => { setEditingLearningItem(null); setAiModalOpen(true); }}
                title={editLearningForm?.id.startsWith('item_') ? "새 규칙 추가" : "규칙 수정"}
                heightClass="h-[70vh]"
                zIndexClass="z-[90]"
                footer={<button onClick={handleSaveLearningItem} className="w-full h-11 bg-blue-600 text-white font-bold rounded-lg transition hover:bg-blue-700 active:scale-95 shadow-lg shadow-blue-500/30">저장</button>}
            >
                {editLearningForm && (
                    <div className="flex flex-col h-full">
                        <div className="p-2 border-b border-gray-200">
                            <input
                                id="learning-title"
                                type="text"
                                value={editLearningForm.title}
                                onChange={(e) => setEditLearningForm({ ...editLearningForm, title: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 bg-white rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm font-bold"
                                placeholder="규칙 제목 입력"
                            />
                        </div>
                        <textarea
                            id="learning-content"
                            value={editLearningForm.content}
                            onChange={(e) => setEditLearningForm({ ...editLearningForm, content: e.target.value })}
                            className="flex-grow w-full p-3 bg-white focus:outline-none font-mono text-sm resize-none"
                            placeholder="규칙 내용 입력..."
                        />
                    </div>
                )}
            </ActionModal>


            <CompactModal
                containerRef={saveModalRef}
                isOpen={!!saveModalState}
                onClose={() => setSaveModalState(null)}
                title="쿼리 저장"
                footer={
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={() => setSaveModalState(null)}
                            className="h-11 px-4 bg-gray-200 text-gray-700 rounded-lg font-semibold text-base hover:bg-gray-300 transition shadow-sm flex items-center justify-center active:scale-95"
                        >
                            취소
                        </button>
                        <button
                            onClick={() => {
                                if (saveModalState) {
                                    addSavedQuery({ name: saveModalState.name, query: saveModalState.query, type: saveModalState.type, order: savedQueries.length })
                                        .then(() => {
                                            showToast('쿼리가 저장되었습니다.', 'success');
                                            setSaveModalState(null);
                                        })
                                        .catch(err => showAlert('저장 실패: ' + err.message));
                                }
                            }}
                            disabled={saveModalState?.isGeneratingName}
                            className="w-full h-11 bg-blue-600 text-white font-bold rounded-lg transition hover:bg-blue-700 active:scale-95 shadow-lg shadow-blue-500/30 disabled:bg-gray-400"
                        >
                            저장하기
                        </button>
                    </div>
                }
            >
                {saveModalState && (
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="save-query-name" className="block text-sm font-bold text-gray-700 mb-2">쿼리 이름</label>
                            <div className="relative">
                                <input
                                    id="save-query-name" type="text" value={saveModalState.name}
                                    onChange={(e) => setSaveModalState({ ...saveModalState, name: e.target.value })}
                                    className="w-full px-4 py-2.5 border border-gray-300 bg-white rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                />
                                {saveModalState.isGeneratingName && <SpinnerIcon className="w-5 h-5 text-blue-500 absolute top-1/2 right-3 -translate-y-1/2" />}
                            </div>
                        </div>
                        <div>
                             <label className="block text-sm font-bold text-gray-700 mb-2">쿼리 내용</label>
                             <pre className="text-xs p-2 bg-gray-100 rounded-md overflow-x-auto"><code>{saveModalState.query}</code></pre>
                        </div>
                    </div>
                )}
            </CompactModal>
            
            <VariableInputModal
                state={variableInputState}
                onClose={() => { setVariableInputState(null); isProcessingVariableQuery.current = false; }}
                onExecute={async (finalQuery, values) => {
                    await executeQuery(finalQuery, `@${variableInputState?.query.name} (${Object.values(values).join(', ')})`, undefined);
                    setVariableInputState(null);
                    isProcessingVariableQuery.current = false;
                    setSavedQueriesModalOpen(false);
                }}
            />

            <ActionModal
                isOpen={isQueryInputModalOpen}
                onClose={() => setQueryInputModalOpen(false)}
                title="쿼리 입력"
                heightClass="h-[35vh]"
                zIndexClass="z-[90]"
                footer={
                    <div className="flex items-center justify-between gap-3 w-full">
                        <div className="flex items-center">
                            <button
                                onClick={() => setIsAiMode(!isAiMode)}
                                className={`flex items-center justify-center gap-1 px-3 h-11 rounded-lg font-bold text-sm transition-colors ${
                                    isAiMode ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                                }`}
                            >
                                <SparklesIcon className={`w-4 h-4 ${isAiMode ? 'animate-pulse' : ''}`} />
                                <span>{isAiMode ? 'AI ON' : 'AI OFF'}</span>
                            </button>
                        </div>
                        <div className="flex gap-2 flex-1 justify-end">
                            <button onClick={() => setQueryInputModalOpen(false)} className="h-11 px-4 bg-gray-200 text-gray-700 rounded-lg font-semibold text-base hover:bg-gray-300 transition shadow-sm flex items-center justify-center active:scale-95">
                                취소
                            </button>
                            <button 
                                onClick={() => {
                                    setSqlQueryInput(modalQueryInput);
                                    setQueryInputModalOpen(false);
                                }}
                                className="h-11 px-6 bg-blue-600 text-white font-bold rounded-lg transition hover:bg-blue-700 active:scale-95 shadow-lg shadow-blue-500/30"
                            >
                                입력
                            </button>
                        </div>
                    </div>
                }
            >
                <div className="h-full flex flex-col">
                    <textarea
                        value={modalQueryInput}
                        onChange={(e) => setModalQueryInput(e.target.value)}
                        className="flex-grow w-full p-3 bg-white focus:outline-none font-mono text-base resize-none leading-relaxed"
                        placeholder={isAiMode ? "AI에게 자유롭게 질문하세요..." : "SQL 또는 자연어를 입력하세요..."}
                        autoFocus
                    />
                </div>
            </ActionModal>
        </div>
    );
};
