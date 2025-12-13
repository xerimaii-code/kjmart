
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAlert, useMiscUI, useDeviceSettings, useDataState } from '../context/AppContext';
import { SpinnerIcon, TrashIcon, PencilSquareIcon, PlayCircleIcon, BookmarkSquareIcon, StopCircleIcon, SparklesIcon, StarIcon, ClipboardIcon, DragHandleIcon, CalendarIcon, ChevronDownIcon } from './Icons';
import { querySql, naturalLanguageToSql, aiChat, generateQueryName, UpdatePreview, QuerySqlResponse, executeUserQuery } from '../services/sqlService';
import { addUserQuery, deleteUserQuery, updateUserQuery, getValue, setValue, db, ref, update } from '../services/dbService';
import { getCachedSchema } from '../services/schemaService';
import { getLearningContext } from '../services/learningService';
import { useAdjustForKeyboard } from '../hooks/useAdjustForKeyboard';
import ActionModal from './ActionModal';
import ToggleSwitch from './ToggleSwitch';
import { UserQuery } from '../types';

// --- TYPE DEFINITIONS ---
type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

interface LearningItem {
    id: string;
    title: string;
    content: string;
}

interface VariableInputState {
    query: UserQuery;
    variables: string[];
}

const INITIAL_VISIBLE_ROWS = 50;

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
    const { userQueries } = useDataState();

    const [sqlQueryInput, setSqlQueryInput] = useState('');
    
    const [generatedSql, setGeneratedSql] = useState<string | null>(null);
    const [showGeneratedSql, setShowGeneratedSql] = useState(false);
    const [lastSuccessfulQuery, setLastSuccessfulQuery] = useState('');
    
    const [result, setResult] = useState<QuerySqlResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<QueryStatus>('idle');
    
    const [isUserQueriesModalOpen, setUserQueriesModalOpen] = useState(false);
    const [isAiModalOpen, setAiModalOpen] = useState(false);
    const [isExpandedInputOpen, setIsExpandedInputOpen] = useState(false);

    const [learningItems, setLearningItems] = useState<LearningItem[]>([]);
    const [visibleResultCount, setVisibleResultCount] = useState(INITIAL_VISIBLE_ROWS);
    
    const [editingQuery, setEditingQuery] = useState<UserQuery | null>(null);
    const [editingLearningItem, setEditingLearningItem] = useState<LearningItem | null>(null);
    const [editLearningForm, setEditLearningForm] = useState<LearningItem | null>(null);

    const [isAiMode, setIsAiMode] = useState(false);
    
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
    const userQueriesDragIndex = useRef<number | null>(null);
    const [userQueriesDropIndex, setUserQueriesDropIndex] = useState<number | null>(null);
    
    const learningDragIndex = useRef<number | null>(null);
    const [learningDropIndex, setLearningDropIndex] = useState<number | null>(null);

    const saveModalRef = useRef<HTMLDivElement>(null);
    const variableModalRef = useRef<HTMLDivElement>(null);
    
    useAdjustForKeyboard(saveModalRef, !!saveModalState);
    useAdjustForKeyboard(variableModalRef, !!variableInputState);

    // Long press handling for execute button
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isLongPressRef = useRef(false);

    // Long press handling for input expansion
    const inputLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // --- REPORT VIEW STATE & LOGIC ---
    const [viewMode, setViewMode] = useState(initialMode);
    const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [activeReportTab, setActiveReportTab] = useState<'hourly' | 'customer' | 'category'>('hourly');
    const [reportData, setReportData] = useState<any[] | null>(null);
    const [reportStatus, setReportStatus] = useState<QueryStatus>('idle');
    const [reportError, setReportError] = useState<string | null>(null);

    // --- DETAIL MODAL STATE ---
    const [isDetailModalOpen, setDetailModalOpen] = useState(false);
    const [detailResult, setDetailResult] = useState<QuerySqlResponse | null>(null);
    const [detailStatus, setDetailStatus] = useState<QueryStatus>('idle');
    const [detailError, setDetailError] = useState<string | null>(null);
    const [detailTitle, setDetailTitle] = useState('');

    useEffect(() => {
        if (isActive) {
            setViewMode(initialMode);
        }
    }, [initialMode, isActive]);

    const runReportQuery = useCallback(async (tab: 'hourly' | 'customer' | 'category', date: string) => {
        const queryConfig = {
            hourly: { queryName: '시간대별매출', nameForError: '시간대별 매출' },
            customer: { queryName: '거래처별매출', nameForError: '거래처별 매출' },
            category: { queryName: '대분류별매출', nameForError: '대분류별 매출' },
        };
    
        const { queryName, nameForError } = queryConfig[tab];
        const findQuery = (name: string) => userQueries.find(q => q.isImportant && q.name === name);
        const targetQuery = findQuery(queryName);
    
        if (!targetQuery) {
            setReportError(`'${nameForError}' 기능에 필요한 쿼리를 찾을 수 없습니다.\n\n필요한 쿼리 이름: '${queryName}'\n\n[설정]에서 위 이름으로 '중요' 표시된 쿼리가 있는지 확인해주세요.`);
            setReportData(null);
            setReportStatus('error');
            return;
        }
    
        setReportStatus('loading');
        setReportError(null);
    
        try {
            // 다양한 사용자 쿼리를 지원하기 위해 여러 개의 일반적인 날짜 변수명을 전달합니다.
            const params = { date: date, 일자: date, searchDate: date, reportDate: date, startDate: date, endDate: date };
            const result = await executeUserQuery(targetQuery.name, params, targetQuery.query);
            setReportData(result);
            setReportStatus('success');
        } catch (e: any) {
            setReportError(e.message || '데이터를 불러오는 데 실패했습니다.');
            setReportData(null);
            setReportStatus('error');
        }
    }, [userQueries]);
    
    useEffect(() => {
        if (isActive && viewMode === 'report') {
            runReportQuery(activeReportTab, selectedDate);
        }
    }, [isActive, viewMode, activeReportTab, selectedDate, runReportQuery]);

    const handleClearResults = useCallback(() => {
        setResult(null);
        setError(null);
        setStatus('idle');
        setGeneratedSql(null);
        setLastSuccessfulQuery('');
    }, []);
    
    const executeQuery = useCallback(async (sql: string, naturalLang?: string, confirmed?: boolean) => {
        setStatus('loading');
        setResult(null);
        setError(null);
        abortControllerRef.current = new AbortController();
    
        if (!allowDestructiveQueries && /^\s*(delete|insert)\s/i.test(sql.trim()) && !confirmed) {
            showAlert('데이터 보안을 위해 INSERT 및 DELETE 쿼리는 실행할 수 없습니다.\n설정 > SQL 실행 설정에서 제한을 해제할 수 있습니다.');
            setStatus('idle');
            return;
        }
    
        try {
            const sanitizedSql = sql.replace(/`/g, '');
            const data = await querySql(sanitizedSql, abortControllerRef.current.signal, confirmed, allowDestructiveQueries);
    
            if (data.preview) {
                showAlert('데이터 변경 미리보기가 지원되지 않는 뷰입니다.');
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

    const handleReportRowClick = useCallback(async (row: any) => {
        const config = {
            hourly: { detailQueryName: '시간대별매출_상세', titleSuffix: '시 상세' },
            customer: { detailQueryName: '거래처별매출_상세', titleSuffix: ' 상세' },
            category: { detailQueryName: '대분류별매출_상세', titleSuffix: ' 상세' },
        };

        const { detailQueryName, titleSuffix } = config[activeReportTab];
        
        const detailQuery = userQueries.find(q => q.isImportant && q.name === detailQueryName);

        if (!detailQuery) {
            showAlert(`상세 조회를 위한 '${detailQueryName}' 쿼리가 없습니다.\n[설정]에서 '중요' 표시된 쿼리가 있는지 확인해주세요.`);
            return;
        }

        const firstColumnKey = Object.keys(row)[0];
        if (!firstColumnKey) {
            showAlert('상세 조회에 필요한 키 값을 찾을 수 없습니다.');
            return;
        }
        const paramValue = row[firstColumnKey];
    
        // Build params object, carefully avoiding case-insensitive duplicates.
        const params: Record<string, any> = {};
        const addedKeys = new Set<string>();

        const addParam = (key: string, value: any) => {
            if (!key) return;
            // Trim whitespace to prevent 'Day1_Param ' vs 'day1_param' duplication
            const normalizedKey = key.trim();
            const lowerKey = normalizedKey.toLowerCase();
            
            if (!addedKeys.has(lowerKey)) {
                params[normalizedKey] = value;
                addedKeys.add(lowerKey);
            }
        };

        // Priority 1: The specific value from the clicked column.
        addParam(firstColumnKey, paramValue);

        // Priority 2: Generic aliases for the clicked value.
        addParam('value', paramValue);
        addParam('param', paramValue);
        addParam('key', paramValue);
        addParam('code', paramValue);
        addParam('id', paramValue);
        addParam('selectedValue', paramValue);
        addParam('target', paramValue);
        addParam('filter', paramValue);
        addParam('keyword', paramValue);

        // Priority 3: General date parameters for the report.
        addParam('date', selectedDate);
        addParam('dt', selectedDate);
        // Removed 'day1_param' to prevent conflicts with legacy queries that declare it
        addParam('일자', selectedDate);
        addParam('searchDate', selectedDate);
        addParam('reportDate', selectedDate);
        addParam('startDate', selectedDate);
        addParam('endDate', selectedDate);
        addParam('sdate', selectedDate);
        addParam('edate', selectedDate);
        
        // Open Modal and show loading state
        setDetailModalOpen(true);
        setDetailStatus('loading');
        setDetailResult(null);
        setDetailError(null);
        setDetailTitle(`${paramValue}${titleSuffix}`);
        
        try {
            // Use the proper parameterized user query execution service
            const resultData = await executeUserQuery(detailQuery.name, params, detailQuery.query);
            setDetailResult({ recordset: resultData });
            setDetailStatus('success');
        } catch (e: any) {
            setDetailError(e.message || '상세 내역을 불러오는 데 실패했습니다.');
            setDetailStatus('error');
        }
    
    }, [activeReportTab, userQueries, showAlert, selectedDate]);

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

    const runQueryWithVariableCheck = useCallback((queryToRun: UserQuery | string) => {
        if (isProcessingVariableQuery.current) return;

        let finalQueryDef: UserQuery;
        let isFromSaved = false;

        if (typeof queryToRun === 'string') {
            if (queryToRun.startsWith('@')) {
                const userQueryName = queryToRun.slice(1).split(/\s+/)[0];
                const userQuery = userQueries.find(q => q.name.toLowerCase() === userQueryName.toLowerCase());
                if (userQuery) {
                    finalQueryDef = userQuery;
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
                setUserQueriesModalOpen(false);
            }
        }
    }, [userQueries, executeQuery, processNaturalLanguageQuery]);

    useEffect(() => {
        if (editingLearningItem) {
            setEditLearningForm(editingLearningItem);
        } else {
            setEditLearningForm(null);
        }
    }, [editingLearningItem]);

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
                
                items.sort((a, b) => {
                    if (a.title === '기본규칙') return -1;
                    if (b.title === '기본규칙') return 1;
                    return 0;
                });
                
                setLearningItems(items);
            });
        }
    }, [isAiModalOpen]);

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
            const userQuery = userQueries.find(q => q.name.toLowerCase() === queryName.toLowerCase());
            if (userQuery) {
                runQueryWithVariableCheck(userQuery);
                return;
            }
        }

        const isLikelySql = /^(SELECT|UPDATE|DELETE|INSERT|CREATE|DROP|ALTER|TRUNCATE)\b/i.test(currentInput);
        if (isLikelySql && !isAiMode) executeQuery(currentInput, undefined, undefined);
        else processNaturalLanguageQuery(currentInput);
    }, [executeQuery, userQueries, showAlert, processNaturalLanguageQuery, isAiMode, runQueryWithVariableCheck]);
    
    const handleExecuteClickWrapped = () => {
        if (status === 'loading') {
            abortControllerRef.current?.abort();
            showToast('실행이 중단되었습니다.', 'error');
        } else {
            processAndExecute(sqlQueryInput);
            setIsExpandedInputOpen(false);
        }
    };

    const handleExecuteButtonDown = () => {
        if (status === 'loading') return; 
        isLongPressRef.current = false;
        longPressTimerRef.current = setTimeout(() => {
            isLongPressRef.current = true;
            setSqlQueryInput('');
            showToast('입력창이 초기화되었습니다.', 'success');
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

    // --- Input Long Press Handlers ---
    const handleInputStart = () => {
        inputLongPressTimerRef.current = setTimeout(() => {
            setIsExpandedInputOpen(true);
            if (navigator.vibrate) navigator.vibrate(50);
        }, 500);
    };

    const handleInputEnd = () => {
        if (inputLongPressTimerRef.current) {
            clearTimeout(inputLongPressTimerRef.current);
            inputLongPressTimerRef.current = null;
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
    
    const handleAddNewQuery = () => {
        setUserQueriesModalOpen(false);
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
                addUserQuery({ ...dataToSave, order: userQueries.length })
                    .then(() => {
                        showToast('쿼리가 추가되었습니다.', 'success');
                        setEditingQuery(null);
                        setUserQueriesModalOpen(true);
                    })
                    .catch(err => {
                        console.error(err);
                        showAlert('쿼리 추가에 실패했습니다.');
                    });
            } else {
                updateUserQuery(id, dataToSave)
                    .then(() => {
                        showToast('쿼리가 수정되었습니다.', 'success');
                        setEditingQuery(null);
                        setUserQueriesModalOpen(true);
                    })
                    .catch(err => {
                        console.error(err);
                        showAlert('쿼리 수정에 실패했습니다.');
                    });
            }
        };

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

    const handleDeleteQuery = (q: UserQuery) => {
        const deleteAction = () => deleteUserQuery(q.id);

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

    const handleAddLearningItem = () => {
        setAiModalOpen(false);
        const id = 'item_' + Date.now();
        const newItem = { id, title: '', content: '' };
        setEditingLearningItem(newItem);
    };
    
    const confirmDeleteLearningItem = (id: string) => {
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
                    
                    if (editLearningForm?.id === id) {
                        setEditLearningForm(null);
                        setAiModalOpen(true);
                    }
                } catch (err) {
                    showAlert('규칙 삭제에 실패했습니다.');
                }
            },
            '삭제',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    };
    
    const handleDeleteLearningItem = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        confirmDeleteLearningItem(id);
    };
    
    const handleLearningDragStart = (e: React.DragEvent, index: number) => {
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
            
            if (to === 0 && learningItems[0]?.title === '기본규칙') return;

            if (from !== to) {
                const newItems = [...learningItems];
                const [removed] = newItems.splice(from, 1);
                newItems.splice(to, 0, removed);
                try {
                    await setValue('learning/sqlContext', newItems);
                    setLearningItems(newItems);
                    showToast('규칙 순서가 저장되었습니다.', 'success');
                } catch (err) {
                    showAlert('순서 저장에 실패했습니다.');
                }
            }
        }
    };

    const handleUserQueriesDragStart = (e: React.DragEvent, index: number) => {
        userQueriesDragIndex.current = index; e.dataTransfer.effectAllowed = 'move';
        (e.currentTarget as HTMLElement).classList.add('dragging');
    };
    const handleUserQueriesDragEnter = (e: React.DragEvent, index: number) => {
        e.preventDefault(); if (userQueriesDragIndex.current !== index) setUserQueriesDropIndex(index);
    };
    const handleUserQueriesDragEnd = (e: React.DragEvent) => {
        (e.currentTarget as HTMLElement).classList.remove('dragging');
        userQueriesDragIndex.current = null; setUserQueriesDropIndex(null);
    };
    const handleUserQueriesDragOver = (e: React.DragEvent) => e.preventDefault();
    const handleUserQueriesDrop = async () => {
        if (userQueriesDragIndex.current !== null && userQueriesDropIndex !== null && db) {
            const from = userQueriesDragIndex.current;
            const to = userQueriesDropIndex > from ? userQueriesDropIndex - 1 : userQueriesDropIndex;
            if (from !== to) {
                const reordered = [...userQueries];
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
    
    const handleSaveLearningItem = async () => {
        if (!editLearningForm) return;
        const isNew = !learningItems.some(item => item.id === editLearningForm.id);
        const finalItems = isNew
            ? [editLearningForm, ...learningItems]
            : learningItems.map(item => item.id === editLearningForm.id ? editLearningForm : item);
        
        finalItems.sort((a, b) => {
            if (a.title === '기본규칙') return -1;
            if (b.title === '기본규칙') return 1;
            return 0;
        });

        try {
            await setValue('learning/sqlContext', finalItems);
            setLearningItems(finalItems);
            showToast('AI 학습 데이터가 저장되었습니다.', 'success');
            setEditingLearningItem(null);
            setAiModalOpen(true);
        } catch (e) {
            showAlert('저장에 실패했습니다.');
        }
    };
    
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
    
        return (
            <CompactModal
                isOpen={!!state}
                onClose={onClose}
                title="변수 입력"
                containerRef={variableModalRef}
                footer={
                    <div className="flex gap-2">
                        <button onClick={onClose} className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-bold">취소</button>
                        <button onClick={handleSubmit} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-bold">실행</button>
                    </div>
                }
            >
                <form ref={formRef} onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-3">
                    {state.variables.map(variable => (
                        <div key={variable}>
                            <label className="block text-sm font-bold text-gray-700 mb-1">{variable}</label>
                            <input
                                type="text"
                                value={values[variable] || ''}
                                onChange={(e) => setValues(prev => ({ ...prev, [variable]: e.target.value }))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    ))}
                </form>
            </CompactModal>
        );
    };

    const quickRunQueries = useMemo(() => userQueries.filter(q => q.isQuickRun).sort((a, b) => (a.order ?? 999) - (b.order ?? 999)), [userQueries]);

    // --- REPORT VIEW RENDER ---
    if (viewMode === 'report') {
        const d = new Date(selectedDate + 'T00:00:00'); // Ensure correct date parsing
        const formattedDate = `${d.getFullYear()}. ${(d.getMonth() + 1).toString().padStart(2, '0')}. ${d.getDate().toString().padStart(2, '0')}.`;

        return (
            <div className="flex flex-col h-full bg-gray-50">
                <div className="p-3 bg-white border-b border-gray-200 space-y-3 flex-shrink-0">
                    <div className="relative flex items-center justify-center h-12 border border-gray-200 rounded-xl bg-white shadow-sm">
                        <CalendarIcon className="absolute left-4 w-5 h-5 text-gray-400 pointer-events-none" />
                        <span className="text-lg font-bold text-gray-800">{formattedDate}</span>
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            aria-label="날짜 선택"
                        />
                        <ChevronDownIcon className="absolute right-4 w-5 h-5 text-gray-400 pointer-events-none" />
                    </div>
                    
                    <div className="flex bg-gray-100 rounded-lg p-1">
                        <button onClick={() => setActiveReportTab('hourly')} className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-colors ${activeReportTab === 'hourly' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>시간대별</button>
                        <button onClick={() => setActiveReportTab('customer')} className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-colors ${activeReportTab === 'customer' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>거래처별</button>
                        <button onClick={() => setActiveReportTab('category')} className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-colors ${activeReportTab === 'category' ? 'bg-white text-blue-600 shadow' : 'text-gray-600'}`}>대분류별</button>
                    </div>
                </div>

                <div className="flex-grow overflow-y-auto p-2">
                    {reportStatus === 'loading' && <div className="flex items-center justify-center h-full"><SpinnerIcon className="w-8 h-8 text-blue-500" /></div>}
                    {reportStatus === 'error' && <div className="p-4 mt-8 text-center text-red-600 bg-red-50 rounded-lg whitespace-pre-line">{reportError}</div>}
                    {reportStatus === 'success' && reportData && (
                        reportData.length > 0 ? (
                            <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                                <table className="min-w-full text-base">
                                    <thead className="bg-white">
                                        <tr>
                                            {Object.keys(reportData[0] || {}).map((k, i) => (
                                                <th key={k} className={`px-4 py-2 font-semibold text-xs text-gray-500 border-b-2 border-gray-100 ${i === 0 ? 'text-left' : 'text-right'}`}>{k}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white">
                                        {reportData.map((row, i) => (
                                            <tr key={i} className="border-t border-gray-50 hover:bg-blue-50 cursor-pointer" onClick={() => handleReportRowClick(row)}>
                                                {Object.entries(row).map(([k, v], j) => (
                                                    <td key={j} className={`px-4 py-3 whitespace-nowrap ${j === 0 ? 'text-left font-medium text-gray-700' : 'text-right font-mono text-gray-800'}`}>
                                                        {isNumericColumn(k) ? formatNumericValue(v) : String(v)}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-full text-gray-500 mt-8">데이터가 없습니다.</div>
                        )
                    )}
                </div>

                <ActionModal
                    isOpen={isDetailModalOpen}
                    onClose={() => setDetailModalOpen(false)}
                    title={detailTitle}
                    disableBodyScroll
                >
                     <div className="flex-grow overflow-y-auto p-3 bg-gray-50 min-h-full">
                        {detailStatus === 'loading' && (
                            <div className="flex flex-col items-center justify-center h-64">
                                <SpinnerIcon className="w-8 h-8 text-blue-500 animate-spin" />
                                <p className="mt-3 text-gray-500 font-medium">상세 내역 조회 중...</p>
                            </div>
                        )}
                        {detailStatus === 'error' && (
                            <div className="bg-red-50 border border-red-200 text-red-600 p-4 rounded-xl text-center">
                                <p className="font-bold mb-1">오류 발생</p>
                                <p className="text-sm whitespace-pre-wrap">{detailError}</p>
                            </div>
                        )}
                        {detailStatus === 'success' && detailResult?.recordset && (
                            detailResult.recordset.length > 0 ? (
                                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full text-sm text-left">
                                            <thead className="bg-gray-100 text-gray-700 font-bold border-b border-gray-200">
                                                <tr>
                                                    {Object.keys(detailResult.recordset[0] || {}).map(k => (
                                                        <th key={k} className={`px-4 py-3 whitespace-nowrap ${isNumericColumn(k) ? 'text-right' : ''}`}>{k}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {detailResult.recordset.map((row, i) => (
                                                    <tr key={i} className="hover:bg-blue-50 transition-colors">
                                                        {Object.entries(row).map(([k, v], j) => (
                                                            <td key={j} className={`px-4 py-3 whitespace-nowrap ${isNumericColumn(k) ? 'text-right font-mono text-gray-600' : 'text-gray-800'}`}>
                                                                {isNumericColumn(k) ? formatNumericValue(v) : String(v)}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                                    <p>데이터가 없습니다.</p>
                                </div>
                            )
                        )}
                    </div>
                </ActionModal>
            </div>
        );
    }
    
    return (
        <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
            {/* Top Bar: Quick Run Queries */}
            <div className="flex-shrink-0 bg-white border-b border-gray-100 p-2 overflow-x-auto whitespace-nowrap scrollbar-hide h-12 flex items-center">
                {quickRunQueries.length > 0 ? (
                    <div className="flex gap-2">
                        {quickRunQueries.map(q => (
                            <button 
                                key={q.id} 
                                onClick={() => runQueryWithVariableCheck(q)} 
                                className="px-3 py-1.5 bg-blue-50 border border-blue-100 rounded-full text-xs font-bold text-blue-700 shadow-sm hover:bg-blue-100 active:scale-95 transition-transform flex items-center gap-1"
                            >
                                <PlayCircleIcon className="w-3 h-3" />
                                {q.name}
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="w-full text-center text-xs text-gray-400">
                        빠른 실행 쿼리를 추가해보세요.
                    </div>
                )}
            </div>

            {/* Main Content Area (Scrollable) */}
            <div className="flex-grow p-3 min-h-0 overflow-y-auto bg-gray-50 pb-4">
                {status === 'success' && result ? (
                    <div className="space-y-4">
                        {result.answer ? (
                            <div className="bg-white p-5 rounded-2xl shadow-sm border border-purple-100">
                                <div className="flex items-start gap-3">
                                    <SparklesIcon className="w-6 h-6 text-purple-600 mt-1 flex-shrink-0" />
                                    <div className="prose prose-sm max-w-none text-gray-800 whitespace-pre-wrap leading-relaxed select-text">{result.answer}</div>
                                </div>
                                <div className="mt-4 flex justify-end">
                                    <button onClick={handleCopyResults} className="text-xs text-gray-500 flex items-center gap-1 hover:text-gray-800 transition-colors"><ClipboardIcon className="w-3.5 h-3.5" /> 답변 복사</button>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
                                <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex justify-between items-center text-xs text-gray-500 font-medium">
                                    <span>결과: {result.recordset?.length || 0}행 / {result.rowsAffected || 0}건 변경</span>
                                    <div className="flex gap-3">
                                        {generatedSql && <button onClick={() => setShowGeneratedSql(!showGeneratedSql)} className="hover:text-blue-600 transition-colors">SQL 보기</button>}
                                        {lastSuccessfulQuery && /select/i.test(lastSuccessfulQuery) && <button onClick={() => openSaveQueryModal(lastSuccessfulQuery, 'sql')} className="hover:text-blue-600 transition-colors flex items-center gap-1"><BookmarkSquareIcon className="w-3 h-3" /> 쿼리 저장</button>}
                                        <button onClick={handleCopyResults} className="hover:text-blue-600 transition-colors flex items-center gap-1"><ClipboardIcon className="w-3 h-3" /> 결과 복사</button>
                                        <button onClick={handleClearResults} className="hover:text-red-600 transition-colors">지우기</button>
                                    </div>
                                </div>
                                {showGeneratedSql && generatedSql && (
                                    <div className="bg-slate-800 text-slate-200 p-3 text-xs font-mono overflow-x-auto select-text border-b border-gray-200">
                                        {generatedSql}
                                    </div>
                                )}
                                <div className="overflow-auto max-h-[50vh]">
                                    <table className="min-w-full text-sm text-left border-collapse">
                                        <thead className="bg-gray-100 text-gray-700 font-bold sticky top-0 z-10 shadow-sm">
                                            <tr>{Object.keys(result.recordset?.[0] || {}).map(k => <th key={k} className={`px-4 py-3 whitespace-nowrap ${isNumericColumn(k) ? 'text-right' : ''}`}>{k}</th>)}</tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {result.recordset?.slice(0, visibleResultCount).map((row, i) => (
                                                <tr key={i} className="hover:bg-blue-50 transition-colors">
                                                    {Object.entries(row).map(([k, v], j) => (
                                                        <td key={j} className={`px-4 py-2.5 whitespace-nowrap select-text ${isNumericColumn(k) ? 'text-right font-mono text-gray-600' : 'text-gray-800'}`}>
                                                            {isNumericColumn(k) ? formatNumericValue(v) : String(v)}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 pb-20">
                        {status === 'loading' ? (
                            <div className="text-center">
                                <SpinnerIcon className="w-12 h-12 text-blue-500 mx-auto mb-4 animate-spin" />
                                <p className="text-blue-600 font-bold">실행 중...</p>
                            </div>
                        ) : error ? (
                            <div className="bg-red-50 border border-red-200 text-red-600 p-6 rounded-2xl flex flex-col items-center text-center gap-3 shadow-sm max-w-sm mx-auto select-text">
                                <span className="font-bold text-2xl">⚠️</span>
                                <span className="whitespace-pre-wrap text-sm font-medium">{error}</span>
                            </div>
                        ) : (
                            <div className="text-center space-y-4 opacity-60">
                                <SparklesIcon className="w-16 h-16 text-gray-300 mx-auto" />
                                <div>
                                    <p className="font-bold text-xl text-gray-400">무엇을 도와드릴까요?</p>
                                    <p className="text-sm text-gray-400 mt-2">하단 입력창에 SQL을 입력하거나<br/>자연어로 질문해보세요.</p>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Bottom Fixed Area */}
            <div className="flex-shrink-0 bg-white border-t border-gray-200 p-3 pb-safe z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                <div className="max-w-2xl mx-auto space-y-2">
                    {/* Row 1: Input and AI Toggle */}
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={sqlQueryInput}
                            onChange={(e) => setSqlQueryInput(e.target.value)}
                            onKeyDown={handleInputKeyDown}
                            onMouseDown={handleInputStart}
                            onTouchStart={handleInputStart}
                            onMouseUp={handleInputEnd}
                            onTouchEnd={handleInputEnd}
                            placeholder="SQL 또는 자연어 입력... (길게 눌러 확장)"
                            className="flex-grow h-11 px-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 text-base shadow-sm transition-all"
                        />
                        <button
                            onClick={() => setIsAiMode(!isAiMode)}
                            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all shadow-sm active:scale-95 border ${
                                isAiMode ? 'bg-purple-100 border-purple-300 text-purple-600' : 'bg-gray-100 border-gray-200 text-gray-500'
                            }`}
                            title="AI 모드 전환"
                        >
                            <SparklesIcon className="w-6 h-6" />
                        </button>
                    </div>

                    {/* Row 2: Execute and Menus */}
                    <div className="flex gap-2 h-12">
                        <button
                            onMouseDown={handleExecuteButtonDown}
                            onMouseUp={handleExecuteButtonUp}
                            onClick={handleExecuteButtonClick}
                            className={`flex-grow rounded-xl flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 font-bold text-lg ${
                                status === 'loading' 
                                ? 'bg-red-500 text-white' 
                                : 'bg-blue-600 hover:bg-blue-700 text-white'
                            }`}
                        >
                            {status === 'loading' ? <StopCircleIcon className="w-6 h-6 animate-pulse" /> : <PlayCircleIcon className="w-6 h-6" />}
                            <span>실행</span>
                        </button>
                        
                        <button 
                            onClick={() => setUserQueriesModalOpen(true)}
                            className="w-16 flex flex-col items-center justify-center bg-white border border-gray-300 rounded-xl shadow-sm text-gray-700 active:scale-95 active:bg-gray-50"
                        >
                            <BookmarkSquareIcon className="w-5 h-5 mb-0.5" />
                            <span className="text-[10px] font-bold leading-none">사용자<br/>쿼리</span>
                        </button>
                        
                        <button 
                            onClick={() => setAiModalOpen(true)}
                            className="w-16 flex flex-col items-center justify-center bg-white border border-gray-300 rounded-xl shadow-sm text-gray-700 active:scale-95 active:bg-gray-50"
                        >
                            <SparklesIcon className="w-5 h-5 mb-0.5" />
                            <span className="text-[10px] font-bold leading-none">AI<br/>학습</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* --- Modals --- */}
            
            {/* User Queries Modal */}
            <ActionModal
                isOpen={isUserQueriesModalOpen}
                onClose={() => setUserQueriesModalOpen(false)}
                title="사용자 쿼리 목록"
                headerActions={
                    <button onClick={handleAddNewQuery} className="text-blue-600 font-bold text-sm px-2 py-1 rounded hover:bg-blue-50">
                        + 추가
                    </button>
                }
            >
                <div className="bg-gray-50 min-h-full p-2">
                    {userQueries.length === 0 ? (
                        <div className="text-center text-gray-500 mt-10">저장된 쿼리가 없습니다.</div>
                    ) : (
                        <div className="space-y-2">
                            {userQueries.map((q, index) => (
                                <div 
                                    key={q.id}
                                    draggable
                                    onDragStart={(e) => handleUserQueriesDragStart(e, index)}
                                    onDragEnter={(e) => handleUserQueriesDragEnter(e, index)}
                                    onDragEnd={handleUserQueriesDragEnd}
                                    onDragOver={handleUserQueriesDragOver}
                                    onClick={() => runQueryWithVariableCheck(q)}
                                    className={`bg-white p-3 rounded-xl shadow-sm border border-gray-200 flex items-center justify-between active:scale-[0.98] transition-transform ${userQueriesDropIndex === index ? 'border-blue-500 border-2' : ''}`}
                                >
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <div className="cursor-grab text-gray-300 hover:text-gray-500" onClick={e => e.stopPropagation()}>
                                            <DragHandleIcon className="w-5 h-5" />
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="font-bold text-gray-800 truncate flex items-center gap-2">
                                                {q.name}
                                                {q.isImportant && (
                                                    <span className="flex-shrink-0 bg-red-100 text-red-600 text-[10px] font-bold px-1.5 py-0.5 rounded border border-red-200">
                                                        중요
                                                    </span>
                                                )}
                                            </h3>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                                        <button 
                                            onClick={() => {
                                                const updated = { ...q, isQuickRun: !q.isQuickRun };
                                                updateUserQuery(q.id, { isQuickRun: updated.isQuickRun }).then(() => {
                                                    // State updates automatically via subscription
                                                });
                                            }}
                                            className={`p-2 rounded-full transition-colors ${q.isQuickRun ? 'text-yellow-500 bg-yellow-50' : 'text-gray-300 hover:text-gray-500'}`}
                                        >
                                            <StarIcon className="w-5 h-5" />
                                        </button>
                                        <button onClick={() => { setEditingQuery(q); setUserQueriesModalOpen(false); }} className="p-2 text-gray-400 hover:text-blue-600 rounded-full hover:bg-blue-50 transition-colors">
                                            <PencilSquareIcon className="w-5 h-5" />
                                        </button>
                                        <button onClick={() => handleDeleteQuery(q)} className="p-2 text-gray-400 hover:text-red-600 rounded-full hover:bg-red-50 transition-colors">
                                            <TrashIcon className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </ActionModal>

            {/* Variable Input Modal */}
            <VariableInputModal
                state={variableInputState}
                onClose={() => {
                    setVariableInputState(null);
                    isProcessingVariableQuery.current = false;
                }}
                onExecute={async (finalQuery, values) => {
                    if (variableInputState?.query.type === 'sql') {
                       await executeQuery(finalQuery, undefined, undefined);
                    }
                    setVariableInputState(null);
                    isProcessingVariableQuery.current = false;
                    setUserQueriesModalOpen(false);
                }}
            />

            {/* Expanded Input Modal */}
            <ActionModal
                isOpen={isExpandedInputOpen}
                onClose={() => setIsExpandedInputOpen(false)}
                title="SQL/자연어 전체 편집"
                footer={
                    <div className="flex items-center gap-3">
                        <div className="flex-shrink-0">
                            <ToggleSwitch
                                id="ai-mode-switch-modal"
                                checked={isAiMode}
                                onChange={setIsAiMode}
                                label="AI 모드"
                                color="blue"
                            />
                        </div>
                        <button onClick={handleExecuteClickWrapped} className="flex-grow py-3 bg-blue-600 text-white font-bold rounded-xl shadow-md">
                            실행
                        </button>
                    </div>
                }
            >
                <textarea
                    value={sqlQueryInput}
                    onChange={(e) => setSqlQueryInput(e.target.value)}
                    className="w-full h-full p-4 resize-none border-none outline-none text-base font-mono bg-white"
                    placeholder={isAiMode ? "AI에게 질문하기 (예: 오늘 매출 얼마야?)" : "SQL 쿼리 입력 (@저장된이름)"}
                    autoFocus
                />
            </ActionModal>

            {/* Edit Query Modal */}
            <ActionModal
                isOpen={!!editingQuery}
                onClose={() => setEditingQuery(null)}
                title={editingQuery?.id === 'new' ? '사용자 쿼리 추가' : '사용자 쿼리 수정'}
                disableBodyScroll
                footer={
                    <div className="flex gap-2">
                        <button onClick={() => setEditingQuery(null)} className="flex-1 py-3 bg-gray-200 text-gray-700 font-bold rounded-xl">취소</button>
                        <button onClick={handleSaveEditingQuery} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-md">저장</button>
                    </div>
                }
            >
                {editingQuery && (
                    <div className="flex flex-col h-full">
                        <div className="p-4 space-y-4 border-b bg-white">
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">이름</label>
                                <input
                                    type="text"
                                    value={editingQuery.name}
                                    onChange={(e) => setEditingQuery({ ...editingQuery, name: e.target.value })}
                                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    placeholder="예: 일별 매출"
                                />
                            </div>
                            <div className="flex gap-2">
                                <div className="flex-1 flex items-center justify-between p-2 bg-gray-50 rounded-lg border border-gray-100">
                                    <span className="text-sm font-bold text-gray-700">빠른 실행</span>
                                    <ToggleSwitch
                                        id="quick-run-toggle"
                                        checked={!!editingQuery.isQuickRun}
                                        onChange={(checked) => setEditingQuery({ ...editingQuery, isQuickRun: checked })}
                                        label=""
                                    />
                                </div>
                                <div className="flex-1 flex items-center justify-between p-2 bg-gray-50 rounded-lg border border-gray-100">
                                    <span className="text-sm font-bold text-gray-700">중요</span>
                                    <ToggleSwitch
                                        id="important-toggle"
                                        checked={!!editingQuery.isImportant}
                                        onChange={(checked) => setEditingQuery({ ...editingQuery, isImportant: checked })}
                                        label=""
                                        color="red"
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="flex-grow flex flex-col min-h-0 bg-white">
                            <label className="block text-sm font-bold text-gray-700 px-4 pt-2">쿼리 내용</label>
                            <textarea
                                value={editingQuery.query}
                                onChange={(e) => setEditingQuery({ ...editingQuery, query: e.target.value })}
                                className="flex-grow w-full p-4 resize-none border-none outline-none font-mono text-sm"
                                placeholder="SELECT * FROM ..."
                            />
                        </div>
                    </div>
                )}
            </ActionModal>

            {/* Save Modal */}
            <CompactModal
                isOpen={!!saveModalState}
                onClose={() => setSaveModalState(null)}
                title="사용자 쿼리로 저장"
                containerRef={saveModalRef}
                footer={
                    <div className="flex gap-2">
                        <button onClick={() => setSaveModalState(null)} className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-bold">취소</button>
                        <button 
                            onClick={() => {
                                if (saveModalState) {
                                    addUserQuery({
                                        name: saveModalState.name,
                                        query: saveModalState.query,
                                        type: saveModalState.type,
                                        isQuickRun: false,
                                        isImportant: false,
                                        order: userQueries.length
                                    }).then(() => {
                                        showToast('쿼리가 저장되었습니다.', 'success');
                                        setSaveModalState(null);
                                    });
                                }
                            }}
                            disabled={saveModalState?.isGeneratingName || !saveModalState?.name}
                            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-bold disabled:bg-gray-400"
                        >
                            저장
                        </button>
                    </div>
                }
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">쿼리 이름</label>
                        <div className="relative">
                            <input
                                type="text"
                                value={saveModalState?.name || ''}
                                onChange={(e) => setSaveModalState(prev => prev ? { ...prev, name: e.target.value } : null)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 pr-10"
                                placeholder="이름을 입력하세요"
                                autoFocus
                            />
                            {saveModalState?.isGeneratingName && (
                                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                    <SpinnerIcon className="w-4 h-4 text-blue-500" />
                                </div>
                            )}
                        </div>
                        {saveModalState?.isGeneratingName && <p className="text-xs text-blue-500 mt-1 ml-1 animate-pulse">AI가 이름을 생성하고 있습니다...</p>}
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">쿼리 내용</label>
                        <div className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono text-gray-600 break-all max-h-32 overflow-y-auto select-text">
                            {saveModalState?.query}
                        </div>
                    </div>
                </div>
            </CompactModal>

             <ActionModal
                isOpen={isAiModalOpen}
                onClose={() => setAiModalOpen(false)}
                title="AI 학습 데이터 (규칙)"
                headerActions={
                    <button onClick={handleAddLearningItem} className="text-blue-600 font-bold text-sm px-2 py-1 rounded hover:bg-blue-50">
                        + 추가
                    </button>
                }
            >
                <div className="bg-gray-50 min-h-full p-2">
                    <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 mb-3 text-sm text-blue-800">
                        <p className="font-bold mb-1">💡 팁</p>
                        AI가 데이터베이스 구조나 비즈니스 로직을 더 잘 이해하도록 규칙을 추가하세요.
                    </div>
                    {learningItems.length === 0 ? (
                        <div className="text-center text-gray-500 mt-10">등록된 규칙이 없습니다.</div>
                    ) : (
                        <div className="space-y-2">
                            {learningItems.map((item, index) => (
                                <div 
                                    key={item.id}
                                    draggable
                                    onDragStart={(e) => handleLearningDragStart(e, index)}
                                    onDragEnter={(e) => handleLearningDragEnter(e, index)}
                                    onDragEnd={handleLearningDragEnd}
                                    onDragOver={handleLearningDragOver}
                                    onClick={() => { setEditingLearningItem(item); setAiModalOpen(false); }}
                                    className={`bg-white p-3 rounded-xl shadow-sm border border-gray-200 flex items-center justify-between active:scale-[0.98] transition-transform ${learningDropIndex === index ? 'border-blue-500 border-2' : ''}`}
                                >
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <div className="cursor-grab text-gray-300 hover:text-gray-500" onClick={e => e.stopPropagation()}>
                                            <DragHandleIcon className="w-5 h-5" />
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="font-bold text-gray-800 truncate">{item.title}</h3>
                                        </div>
                                    </div>
                                    <button onClick={(e) => handleDeleteLearningItem(e, item.id)} className="p-2 text-gray-400 hover:text-red-600 rounded-full hover:bg-red-50 transition-colors flex-shrink-0">
                                        <TrashIcon className="w-5 h-5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </ActionModal>

             <ActionModal
                isOpen={!!editLearningForm}
                onClose={() => { setEditLearningForm(null); setAiModalOpen(true); }}
                title="규칙 추가/수정"
                disableBodyScroll
                footer={
                    <div className="flex gap-2">
                        <button onClick={() => { setEditLearningForm(null); setAiModalOpen(true); }} className="flex-1 py-3 bg-gray-200 text-gray-700 font-bold rounded-xl">취소</button>
                        <button onClick={handleSaveLearningItem} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-md">저장</button>
                    </div>
                }
            >
                {editLearningForm && (
                     <div className="flex flex-col h-full bg-white p-4 gap-4">
                         <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">제목</label>
                            <input 
                                type="text"
                                value={editLearningForm.title}
                                onChange={e => setEditLearningForm({...editLearningForm, title: e.target.value})}
                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                placeholder="예: 상품 테이블 구조"
                                disabled={editLearningForm.title === '기본규칙'}
                            />
                        </div>
                        <div className="flex-grow flex flex-col">
                            <label className="block text-sm font-bold text-gray-700 mb-1">내용</label>
                            <textarea
                                value={editLearningForm.content}
                                onChange={e => setEditLearningForm({...editLearningForm, content: e.target.value})}
                                className="w-full flex-grow p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none"
                                placeholder="parts 테이블에는 상품 정보가 들어있습니다..."
                            />
                        </div>
                     </div>
                )}
            </ActionModal>
        </div>
    );
};
