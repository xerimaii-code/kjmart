
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAlert, useDeviceSettings, useDataState } from '../context/AppContext';
import { SpinnerIcon, TrashIcon, PencilSquareIcon, PlayCircleIcon, BookmarkSquareIcon, SparklesIcon, StarIcon, DocumentIcon, XMarkIcon } from '../components/Icons';
import { querySql, naturalLanguageToSql, aiChat, QuerySqlResponse } from '../services/sqlService';
import { addUserQuery, deleteUserQuery, updateUserQuery, listenToLearningItems, addLearningItem, updateLearningItem, deleteLearningItem } from '../services/dbService';
import { getCachedSchema } from '../services/schemaService';
import { getLearningContext } from '../services/learningService';
import ActionModal from '../components/ActionModal';
import { UserQuery, LearningItem } from '../types';
import ToggleSwitch from '../components/ToggleSwitch';

type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

interface VariableInputState {
    query: UserQuery;
    variables: string[];
}

const INITIAL_VISIBLE_ROWS = 100;

// 템플릿 삭제 요청에 따라 빈 배열로 변경
const QUERY_TEMPLATES: { name: string; description: string; sql: string }[] = [];

const isNumericColumn = (colName: string): boolean => {
    const numericKeywords = ['금액', '수량', '단가', '합계', '매출', '포인트', '가격', '금'];
    return numericKeywords.some(keyword => colName.includes(keyword));
};

const formatNumericValue = (v: any) => typeof v === 'number' ? v.toLocaleString() : String(v || '');

const CompactModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    size?: 'default' | 'large';
}> = ({ isOpen, onClose, title, children, footer, size = 'default' }) => {
    const [isRendered, setIsRendered] = useState(false);
    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => setIsRendered(true), 10);
            return () => clearTimeout(timer);
        } else setIsRendered(false);
    }, [isOpen]);
    if (!isOpen) return null;

    const maxWidthClass = size === 'large' ? 'max-w-4xl h-[90vh]' : 'max-w-xl max-h-[90vh]';

    return createPortal(
        <div className={`fixed inset-0 bg-black z-[300] flex items-center justify-center p-4 transition-opacity duration-300 ${isRendered ? 'bg-opacity-50' : 'bg-opacity-0'}`} onClick={onClose} role="dialog" aria-modal="true">
            <div className={`bg-white rounded-xl shadow-lg w-full ${maxWidthClass} flex flex-col transition-[opacity,transform] duration-300 will-change-[opacity,transform] ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`} onClick={e => e.stopPropagation()}>
                <header className="relative px-3 py-2 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                    <h2 className="text-xs font-bold text-gray-500 uppercase tracking-tight">{title}</h2>
                    <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><XMarkIcon className="w-5 h-5"/></button>
                </header>
                <main className="flex-grow p-0 min-h-0 overflow-hidden">{children}</main>
                {footer && <footer className="p-2 bg-gray-50 rounded-b-xl border-t flex-shrink-0">{footer}</footer>}
            </div>
        </div>,
        document.body
    );
};

const VariableInputModal: React.FC<{
    state: VariableInputState | null;
    onClose: () => void;
    onExecute: (finalQuery: string) => Promise<void>;
}> = ({ state, onClose, onExecute }) => {
    const [values, setValues] = useState<Record<string, string>>({});
    useEffect(() => { if (state) setValues(state.variables.reduce((acc, v) => ({ ...acc, [v]: '' }), {})); }, [state]);
    if (!state) return null;
    const handleSubmit = () => {
        let sql = state.query.query;
        state.variables.forEach(v => {
            const val = values[v] || '';
            sql = sql.replace(new RegExp(`@${v}\\b`, 'g'), `'${val.replace(/'/g, "''")}'`);
        });
        onExecute(sql);
    };
    return (
        <CompactModal isOpen={!!state} onClose={onClose} title={`변수 입력: ${state.query.name}`} footer={<div className="grid grid-cols-2 gap-2"><button onClick={onClose} className="h-9 bg-gray-100 text-gray-700 font-bold rounded-xl text-sm">취소</button><button onClick={handleSubmit} className="h-9 bg-indigo-600 text-white font-bold rounded-xl text-sm">실행</button></div>}>
            <div className="space-y-4 p-4 overflow-y-auto">
                {state.variables.map(v => (
                    <div key={v}>
                        <label className="block text-[10px] font-black text-gray-400 mb-1 uppercase tracking-wider">{v}</label>
                        <input type="text" value={values[v] || ''} onChange={e => setValues(p => ({ ...p, [v]: e.target.value }))} className="w-full h-10 px-3 border border-slate-200 rounded-xl font-bold focus:ring-2 focus:ring-indigo-500 text-sm" placeholder={`${v} 입력...`} />
                    </div>
                ))}
            </div>
        </CompactModal>
    );
};

const QueryEditModal: React.FC<{
    query: UserQuery | (Omit<UserQuery, 'id'> & { id: 'new' }) | null;
    onClose: () => void;
    onSave: (id: string, updates: Partial<UserQuery>) => void;
}> = ({ query, onClose, onSave }) => {
    const [name, setName] = useState('');
    const [queryText, setQueryText] = useState('');
    const [type, setType] = useState<'sql' | 'natural'>('sql');
    const [isQuickRun, setIsQuickRun] = useState(false);
    const [isImportant, setIsImportant] = useState(false);

    useEffect(() => {
        if (query) {
            setName(query.name || '');
            setQueryText(query.query || '');
            setType(query.type || 'sql');
            setIsQuickRun(!!query.isQuickRun);
            setIsImportant(!!query.isImportant);
        }
    }, [query]);

    if (!query) return null;
    const handleSave = () => onSave(query.id, { name, query: queryText, type, isQuickRun, isImportant });

    return (
        <CompactModal size="large" isOpen={!!query} onClose={onClose} title={query.id === 'new' ? "새 쿼리 추가" : "쿼리 편집"} footer={<div className="grid grid-cols-2 gap-2"><button onClick={onClose} className="h-9 bg-gray-100 text-gray-700 font-bold rounded-xl text-sm">취소</button><button onClick={handleSave} className="h-9 bg-indigo-600 text-white font-bold rounded-xl text-sm">저장</button></div>}>
            <div className="flex flex-col h-full overflow-hidden bg-white">
                <div className="p-3 grid grid-cols-2 gap-4 border-b flex-shrink-0">
                    <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">쿼리 이름</label>
                        <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full h-8 px-2 border border-gray-200 rounded-lg text-sm font-semibold focus:ring-1 focus:ring-indigo-500" placeholder="이름 입력" />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">쿼리 타입</label>
                        <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg">
                            <button onClick={() => setType('sql')} className={`flex-1 py-1 rounded-md text-[10px] font-bold transition-all ${type==='sql' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400'}`}>SQL</button>
                            <button onClick={() => setType('natural')} className={`flex-1 py-1 rounded-md text-[10px] font-bold transition-all ${type==='natural' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400'}`}>자연어</button>
                        </div>
                    </div>
                    <div className="col-span-2 flex gap-4 pt-1">
                        <ToggleSwitch id="isQuickRunEdit" checked={isQuickRun} onChange={setIsQuickRun} label="빠른 실행" color="blue" className="scale-75 origin-left" />
                        <ToggleSwitch id="isImportantEdit" checked={isImportant} onChange={setIsImportant} label="중요 쿼리" color="blue" className="scale-75 origin-left" />
                    </div>
                </div>
                <div className="flex-grow flex flex-col min-h-0 relative">
                    <textarea 
                        value={queryText} 
                        onChange={e => setQueryText(e.target.value)} 
                        className="w-full h-full p-4 outline-none font-mono text-xs text-indigo-600 bg-white resize-none" 
                        placeholder="SQL 명령어를 여기에 입력하세요..." 
                        autoFocus
                    />
                </div>
            </div>
        </CompactModal>
    );
};

const LearningItemEditModal: React.FC<{
    item: (Omit<LearningItem, 'id'> & { id?: string }) | null;
    onClose: () => void;
    onSave: (itemData: Omit<LearningItem, 'id'>) => void;
}> = ({ item, onClose, onSave }) => {
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');

    useEffect(() => { if(item) { setTitle(item.title); setContent(item.content); } }, [item]);
    if (!item) return null;
    const handleSave = () => onSave({ title, content });

    return (
        <CompactModal size="large" isOpen={!!item} onClose={onClose} title={item.id ? "지식 수정" : "새 지식 추가"} footer={<div className="grid grid-cols-2 gap-2"><button onClick={onClose} className="h-9 bg-gray-100 font-bold rounded-xl text-sm">취소</button><button onClick={handleSave} className="h-9 bg-indigo-600 text-white font-bold rounded-xl text-sm">저장</button></div>}>
            <div className="flex flex-col h-full overflow-hidden bg-white">
                <div className="p-3 border-b flex-shrink-0">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">지식 제목 (간략히)</label>
                    <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 매출조회 변수 규칙" className="w-full h-8 px-2 border border-gray-200 rounded-lg text-sm font-semibold focus:ring-1 focus:ring-indigo-500"/>
                </div>
                <div className="flex-grow flex flex-col min-h-0">
                    <textarea 
                        value={content} 
                        onChange={e => setContent(e.target.value)} 
                        placeholder="AI에게 학습시킬 세부 내용을 입력하세요. 예외 규칙이나 필드 설명 등..." 
                        className="w-full h-full p-4 outline-none text-xs leading-relaxed text-slate-700 bg-white resize-none" 
                        autoFocus
                    />
                </div>
            </div>
        </CompactModal>
    );
};

export const SqlRunnerView: React.FC<{ 
    isActive: boolean;
}> = ({ isActive }) => {
    const { showAlert, showToast } = useAlert();
    const { allowDestructiveQueries } = useDeviceSettings();
    const { userQueries } = useDataState();

    const [sqlQueryInput, setSqlQueryInput] = useState('');
    const [generatedSql, setGeneratedSql] = useState<string | null>(null);
    const [showGeneratedSql, setShowGeneratedSql] = useState(false);
    const [result, setResult] = useState<QuerySqlResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<QueryStatus>('idle');
    const [isAiMode, setIsAiMode] = useState(false);
    
    const [isUserQueriesModalOpen, setUserQueriesModalOpen] = useState(false);
    const [isAiModalOpen, setAiModalOpen] = useState(false);
    const [isTemplateModalOpen, setTemplateModalOpen] = useState(false);
    const [variableInputState, setVariableInputState] = useState<VariableInputState | null>(null);

    const [editingQuery, setEditingQuery] = useState<UserQuery | null>(null);
    const [learningItems, setLearningItems] = useState<LearningItem[]>([]);
    const [editingLearningItem, setEditingLearningItem] = useState<(Omit<LearningItem, 'id'> & { id?: string }) | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);
    
    useEffect(() => {
        if (!isAiModalOpen) return;
        const unsubscribe = listenToLearningItems(setLearningItems);
        return () => unsubscribe();
    }, [isAiModalOpen]);

    const handleSaveLearningItem = async (itemData: Omit<LearningItem, 'id'>) => {
        try {
            if (editingLearningItem?.id) {
                await updateLearningItem(editingLearningItem.id, itemData);
                showToast('수정됨', 'success');
            } else {
                await addLearningItem(itemData);
                showToast('추가됨', 'success');
            }
            setEditingLearningItem(null);
        } catch (e: any) {
            showAlert(`저장 실패: ${e.message}`);
        }
    };

    const handleDeleteLearningItem = (item: LearningItem) => {
        showAlert(`삭제하시겠습니까?`, () => {
            deleteLearningItem(item.id).then(() => showToast('삭제됨', 'success')).catch(e => showAlert(e.message));
        }, '삭제', 'bg-rose-500');
    };

    const handleSaveQuery = async (id: string, updates: Partial<UserQuery>) => {
        try {
            if (id === 'new') {
                await addUserQuery(updates as any);
                showToast('추가됨', 'success');
            } else {
                await updateUserQuery(id, updates);
                showToast('수정됨', 'success');
            }
            setEditingQuery(null);
        } catch (e: any) {
            showAlert(`저장 실패: ${e.message}`);
        }
    };

    const executeQuery = useCallback(async (sql: string, originalPrompt?: string, confirmed?: boolean) => {
        setStatus('loading'); setError(null); setResult(null);
        if (abortControllerRef.current) abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();
        try {
            const data = await querySql(sql, abortControllerRef.current.signal, confirmed, allowDestructiveQueries);
            setResult(data); setStatus('success');
            if (data.rowsAffected && data.rowsAffected > 0) showToast(`${data.rowsAffected}건 처리됨`, 'success');
        } catch (err: any) {
            if (err.name !== 'AbortError') { setError(err.message); setStatus('error'); }
            else setStatus('idle');
        }
    }, [allowDestructiveQueries, showToast]);

    const processNaturalLanguageQuery = useCallback(async (prompt: string) => {
        setStatus('loading'); setError(null); setResult(null); setGeneratedSql(null);
        try {
            const schema = await getCachedSchema();
            const context = await getLearningContext();
            if (isAiMode) {
                const response = await aiChat(prompt, schema || {}, context);
                setResult({ answer: response.answer }); setStatus('success');
            } else {
                const { sql } = await naturalLanguageToSql(prompt, schema || {}, context);
                if (sql) { setGeneratedSql(sql); executeQuery(sql, prompt); }
                else throw new Error('AI가 쿼리를 생성하지 못했습니다.');
            }
        } catch (err: any) { setError(err.message); setStatus('error'); }
    }, [isAiMode, executeQuery]);

    const handleExecute = () => {
        const input = sqlQueryInput.trim();
        if (!input) return;
        if (input.startsWith('@')) {
            const qName = input.slice(1).split(/\s+/)[0];
            const q = userQueries.find(u => u.name.toLowerCase() === qName.toLowerCase());
            if (q) { runQueryWithVariableCheck(q); return; }
        }
        if (/^\s*(SELECT|UPDATE|DELETE|INSERT|DECLARE|WITH|EXEC|SET)\b/i.test(input) && !isAiMode) executeQuery(input);
        else processNaturalLanguageQuery(input);
    };

    const runQueryWithVariableCheck = (q: UserQuery) => {
        const detected = [...new Set(Array.from(q.query.matchAll(/@([a-zA-Z0-9_]+)/g), m => m[1]))];
        if (q.type === 'sql' && detected.length > 0) setVariableInputState({ query: q, variables: detected });
        else if (q.type === 'sql') executeQuery(q.query, `@${q.name}`);
        else processNaturalLanguageQuery(q.query);
    };

    return (
        <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
            <div className="flex-shrink-0 bg-white border-b p-2 overflow-x-auto flex gap-2 no-scrollbar z-20 shadow-sm">
                {userQueries.filter(q => q.isQuickRun).map(q => <button key={q.id} onClick={() => runQueryWithVariableCheck(q)} className="px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded-full text-xs font-bold text-indigo-700 flex items-center gap-1 active:scale-95"><PlayCircleIcon className="w-3 h-3" />{q.name}</button>)}
            </div>
            
            <div className="flex-grow p-3 overflow-y-auto relative">
                {status === 'loading' ? (
                    <div className="flex flex-col items-center justify-center h-full"><SpinnerIcon className="w-12 h-12 text-indigo-600 animate-spin" /><p className="mt-4 text-indigo-600 font-black">AI 엔진 가동 중...</p></div>
                ) : error ? (
                    <div className="p-5 bg-rose-50 text-rose-600 rounded-2xl border border-rose-200 text-sm font-bold shadow-sm animate-fade-in-up">⚠️ {error}</div>
                ) : result ? (
                    <div className="space-y-4">
                        {result.answer ? (
                            <div className="bg-white p-5 rounded-2xl shadow-sm border border-indigo-100 flex gap-3 animate-fade-in-up">
                                <SparklesIcon className="w-6 h-6 text-indigo-600 flex-shrink-0" />
                                <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed font-medium">{result.answer}</div>
                            </div>
                        ) : (
                            <div className="bg-white rounded-2xl shadow-md border border-gray-200 overflow-hidden animate-fade-in-up flex flex-col max-h-[75vh]">
                                <div className="bg-gray-50 px-4 py-2 border-b flex justify-between items-center text-[10px] font-bold text-gray-400">
                                    <span>{result.recordset?.length || 0} ROWS</span>
                                    <div className="flex gap-2">
                                        <button onClick={() => { const h = Object.keys(result.recordset![0]).join('\t'); const b = result.recordset!.map(r => Object.values(r).join('\t')).join('\n'); navigator.clipboard.writeText(h + '\n' + b).then(() => showToast('복사 완료', 'success')) }} className="hover:text-indigo-600">COPY</button>
                                        <button onClick={() => setResult(null)} className="hover:text-rose-600">CLEAR</button>
                                    </div>
                                </div>
                                <div className="overflow-auto">
                                    <table className="min-w-full text-xs">
                                        <thead className="bg-slate-50 sticky top-0 z-10">
                                            <tr>{Object.keys(result.recordset?.[0] || {}).map(k => <th key={k} className={`px-3 py-2 font-black text-gray-500 border-b ${isNumericColumn(k) ? 'text-right' : 'text-left'}`}>{k}</th>)}</tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {result.recordset?.slice(0, INITIAL_VISIBLE_ROWS).map((row, i) => (
                                                <tr key={i} className="hover:bg-indigo-50/30 transition-colors">
                                                    {Object.entries(row).map(([k, v], j) => <td key={j} className={`px-3 py-2 font-medium ${isNumericColumn(k) ? 'text-right font-mono text-indigo-600' : 'text-left text-gray-700'}`}>{isNumericColumn(k) ? formatNumericValue(v) : String(v ?? '')}</td>)}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {result.recordset && result.recordset.length > INITIAL_VISIBLE_ROWS && <div className="p-2 bg-gray-50 text-center text-[10px] text-gray-400 font-bold border-t">... {result.recordset.length - INITIAL_VISIBLE_ROWS}개 행 더 있음</div>}
                            </div>
                        )}
                        {generatedSql && (
                            <div className="p-3 bg-slate-800 text-slate-300 rounded-xl text-[11px] font-mono whitespace-pre-wrap overflow-x-auto border-l-4 border-indigo-500 shadow-inner">
                                <div className="flex justify-between mb-2 text-indigo-300 font-bold"><span>GENERATED SQL</span><button onClick={() => setShowGeneratedSql(!showGeneratedSql)}>{showGeneratedSql ? 'HIDE' : 'SHOW'}</button></div>
                                {showGeneratedSql && generatedSql}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-300 opacity-40 select-none">
                        <SparklesIcon className="w-20 h-20 mb-6 animate-pulse" />
                        <p className="font-black text-2xl tracking-tighter">어떤 데이터를 찾으시나요?</p>
                        <p className="text-sm font-bold mt-2">SQL 쿼리 또는 자연어로 질문하세요</p>
                    </div>
                )}
            </div>

            <div className="flex-shrink-0 bg-white border-t p-3 pb-safe-offset shadow-[0_-8px_30px_rgb(0,0,0,0.08)] z-30">
                <div className="max-w-3xl mx-auto flex flex-col gap-2">
                    <div className="flex gap-2 items-center">
                        <div className="relative flex-grow">
                            <input 
                                type="text" 
                                value={sqlQueryInput} 
                                onChange={e => setSqlQueryInput(e.target.value)} 
                                onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && handleExecute()}
                                placeholder={isAiMode ? "AI에게 질문하기..." : "SQL 입력 또는 @쿼리명..."} 
                                className={`w-full h-12 pl-4 pr-12 border rounded-2xl text-base font-bold shadow-sm transition-all focus:ring-2 ${isAiMode ? 'border-purple-300 focus:ring-purple-500' : 'border-slate-200 focus:ring-indigo-500'}`} 
                            />
                            <button onClick={() => setIsAiMode(!isAiMode)} className={`absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isAiMode ? 'bg-purple-600 text-white shadow-lg' : 'bg-slate-100 text-slate-400'}`}>
                                <SparklesIcon className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                    <div className="flex gap-2 h-14">
                        <button 
                            onClick={handleExecute} 
                            disabled={status === 'loading'}
                            className={`flex-grow rounded-2xl font-black text-xl flex items-center justify-center gap-3 active:scale-95 transition-all shadow-lg ${isAiMode ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-purple-200' : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200'}`}
                        >
                            {status === 'loading' ? <SpinnerIcon className="w-7 h-7" /> : <PlayCircleIcon className="w-7 h-7" />}
                            <span>{status === 'loading' ? '분석중' : '실행'}</span>
                        </button>
                        <button onClick={() => setUserQueriesModalOpen(true)} className="w-14 bg-white border border-slate-200 rounded-2xl flex flex-col items-center justify-center text-[10px] font-black text-slate-600 active:bg-slate-50"><BookmarkSquareIcon className="w-5 h-5 mb-0.5" />쿼리</button>
                        <button onClick={() => setTemplateModalOpen(true)} className="w-14 bg-white border border-slate-200 rounded-2xl flex flex-col items-center justify-center text-[10px] font-black text-slate-600 active:bg-slate-50"><DocumentIcon className="w-5 h-5 mb-0.5" />추천</button>
                        <button onClick={() => setAiModalOpen(true)} className="w-14 bg-white border border-slate-200 rounded-2xl flex flex-col items-center justify-center text-[10px] font-black text-slate-600 active:bg-slate-50"><SparklesIcon className="w-5 h-5 mb-0.5" />학습</button>
                    </div>
                </div>
            </div>

            <ActionModal isOpen={isUserQueriesModalOpen} onClose={() => setUserQueriesModalOpen(false)} title="사용자 쿼리" zIndexClass="z-[150]">
                <div className="flex flex-col h-full bg-slate-50">
                    <div className="p-3 border-b bg-white flex justify-between items-center">
                        <span className="text-[11px] font-bold text-gray-400">자주 쓰는 쿼리를 관리합니다.</span>
                        <button onClick={() => setEditingQuery({ id: 'new', name: '', query: '', type: 'sql', isQuickRun: false, isImportant: false })} className="text-xs font-bold text-indigo-600 px-3 py-1.5 bg-indigo-50 rounded-lg border border-indigo-100 active:scale-95 transition-all">+ 쿼리 추가</button>
                    </div>
                    <div className="p-3 space-y-2 overflow-y-auto flex-grow">
                        {userQueries.length === 0 ? <p className="text-center py-10 text-gray-400 font-bold">저장된 쿼리가 없습니다.</p> : (
                            userQueries.sort((a,b) => (a.order || 0) - (b.order || 0)).map(q => (
                                <div key={q.id} onClick={() => { runQueryWithVariableCheck(q); setUserQueriesModalOpen(false); }} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between cursor-pointer active:bg-slate-50">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-1.5 rounded-lg ${q.isQuickRun ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-50 text-slate-400'}`}><StarIcon className="w-3.5 h-3.5" /></div>
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold text-gray-800 text-sm">{q.name}</span>
                                                {q.isImportant && (
                                                    <span className="px-1.5 py-0.5 bg-rose-500 text-white text-[9px] font-black rounded uppercase tracking-tighter shadow-sm">중요</span>
                                                )}
                                            </div>
                                            {q.type === 'natural' && <span className="text-[10px] text-purple-500 font-bold mt-0.5">AI 자연어</span>}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button onClick={e => { e.stopPropagation(); setEditingQuery(q); }} className="p-2 text-slate-300 hover:text-blue-500"><PencilSquareIcon className="w-4 h-4"/></button>
                                        <button onClick={e => { e.stopPropagation(); showAlert('삭제하시겠습니까?', () => deleteUserQuery(q.id), '삭제', 'bg-rose-500'); }} className="p-2 text-slate-300 hover:text-rose-500"><TrashIcon className="w-4 h-4"/></button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </ActionModal>
            
            {editingQuery && <QueryEditModal query={editingQuery} onClose={() => setEditingQuery(null)} onSave={handleSaveQuery} />}

            <ActionModal isOpen={isTemplateModalOpen} onClose={() => setTemplateModalOpen(false)} title="쿼리 템플릿 추천" zIndexClass="z-[150]">
                <div className="p-3 space-y-3">
                    {QUERY_TEMPLATES.length === 0 ? <p className="text-center py-10 text-gray-400 font-bold">추천 템플릿이 없습니다.</p> : QUERY_TEMPLATES.map((t, i) => (
                        <button key={i} onClick={() => { setSqlQueryInput(t.sql); setTemplateModalOpen(false); showToast('템플릿이 로드되었습니다.', 'success'); }} className="w-full text-left bg-white p-4 rounded-2xl border border-slate-200 shadow-sm active:bg-slate-50 transition-colors">
                            <h4 className="font-bold text-gray-800 mb-1">{t.name}</h4>
                            <p className="text-xs text-gray-500 leading-relaxed">{t.description}</p>
                        </button>
                    ))}
                </div>
            </ActionModal>

            {variableInputState && (
                <VariableInputModal 
                    state={variableInputState} 
                    onClose={() => setVariableInputState(null)} 
                    onExecute={async (final) => { executeQuery(final); setVariableInputState(null); }} 
                />
            )}
            
            <ActionModal isOpen={isAiModalOpen} onClose={() => setAiModalOpen(false)} title="AI 학습 목록" zIndexClass="z-[150]">
                 <div className="p-0 flex flex-col h-full bg-slate-50">
                    <div className="p-3 bg-white border-b flex justify-between items-center">
                        <span className="text-[11px] font-bold text-gray-400">AI의 쿼리 생성 능력을 향상시킵니다.</span>
                        <button onClick={() => setEditingLearningItem({ title: '', content: ''})} className="text-xs font-bold text-indigo-600 px-3 py-1.5 bg-indigo-50 rounded-lg border border-indigo-100 active:scale-95 transition-all">+ 지식 추가</button>
                    </div>
                    <div className="p-3 space-y-3 flex-grow overflow-auto">
                        {learningItems.map(item => (
                            <div key={item.id} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                                <h4 className="font-bold text-slate-800 text-sm mb-2">{item.title}</h4>
                                <div className="flex justify-end gap-4 mt-2 pt-2 border-t border-slate-50">
                                    <button onClick={() => setEditingLearningItem(item)} className="text-xs font-bold text-blue-600">수정</button>
                                    <button onClick={() => handleDeleteLearningItem(item)} className="text-xs font-bold text-rose-500">삭제</button>
                                </div>
                            </div>
                        ))}
                        {learningItems.length === 0 && <p className="text-center py-10 text-gray-400 text-sm font-bold">등록된 지식이 없습니다.</p>}
                    </div>
                 </div>
            </ActionModal>
            
            {editingLearningItem && <LearningItemEditModal item={editingLearningItem} onClose={() => setEditingLearningItem(null)} onSave={handleSaveLearningItem} />}
        </div>
    );
};
