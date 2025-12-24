
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAlert, useDataState } from '../context/AppContext';
import { useProductSearch } from '../hooks/useProductSearch';
import { SpinnerIcon, XCircleIcon, CheckCircleIcon } from './Icons';
import { Product, AuditedItem } from '../types';

interface BatchAuditModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (items: AuditedItem[]) => void;
}

interface ParsedLine {
    raw: string;
    barcode: string;
    qty: number;
    product: Product | null;
    status: 'idle' | 'searching' | 'success' | 'fail';
    error?: string;
}

const BatchAuditModal: React.FC<BatchAuditModalProps> = ({ isOpen, onClose, onConfirm }) => {
    const { products: localProducts } = useDataState();
    const { searchByBarcode } = useProductSearch('productInquiry');
    const { showAlert, showToast } = useAlert();

    const [isRendered, setIsRendered] = useState(false);
    const [inputText, setInputText] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [parsedLines, setParsedLines] = useState<ParsedLine[]>([]);
    const [step, setStep] = useState<'input' | 'result'>('input');

    useEffect(() => {
        if (isOpen) {
            setIsRendered(true);
            setStep('input');
            setInputText('');
            setParsedLines([]);
        } else {
            setIsRendered(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleAnalyze = async () => {
        const lines = inputText.split('\n').filter(line => line.trim() !== '');
        if (lines.length === 0) {
            showAlert("분석할 내용이 없습니다.");
            return;
        }

        setIsAnalyzing(true);
        const tempLines: ParsedLine[] = lines.map(line => {
            // 공백, 탭, 쉼표로 분리
            const parts = line.trim().split(/[\s,\t]+/);
            const barcode = parts[0] || '';
            const qtyStr = parts[1] || '1';
            const qty = isNaN(Number(qtyStr)) ? 1 : Number(qtyStr);
            
            return {
                raw: line,
                barcode,
                qty,
                product: null,
                status: 'searching'
            };
        });

        setParsedLines(tempLines);
        setStep('result');

        const results: ParsedLine[] = [];
        for (const line of tempLines) {
            let foundProduct = localProducts.find(p => p.barcode === line.barcode);
            if (!foundProduct) {
                try {
                    foundProduct = (await searchByBarcode(line.barcode)) || null;
                } catch (e) {
                    foundProduct = null;
                }
            }

            results.push({
                ...line,
                product: foundProduct,
                status: foundProduct ? 'success' : 'fail',
                error: foundProduct ? undefined : '미등록 상품'
            });
            // 대량 처리 시 UI 업데이트를 위해 점진적으로 반영 (선택 사항)
            if (results.length % 5 === 0) setParsedLines([...results, ...tempLines.slice(results.length)]);
        }

        setParsedLines(results);
        setIsAnalyzing(false);
    };

    const handleFinalConfirm = () => {
        const successItems = parsedLines
            .filter(l => l.status === 'success' && l.product)
            .map(l => ({
                barcode: l.barcode,
                name: l.product!.name,
                spec: l.product!.spec,
                computerStock: l.product!.stockQuantity ?? 0,
                auditQty: l.qty,
                diff: l.qty - (l.product!.stockQuantity ?? 0),
                timestamp: Date.now()
            }));

        if (successItems.length === 0) {
            showAlert("등록 가능한 상품이 없습니다.");
            return;
        }

        onConfirm(successItems);
        showToast(`${successItems.length}건이 목록에 추가되었습니다.`, 'success');
        onClose();
    };

    return createPortal(
        <div className={`fixed inset-0 z-[200] flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-50' : 'bg-transparent'}`} onClick={onClose}>
            <div className={`bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col transition-all duration-300 ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`} onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh' }}>
                <header className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-2xl">
                    <h3 className="font-black text-gray-800">재고 실사 일괄 등록</h3>
                    <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><XCircleIcon className="w-6 h-6" /></button>
                </header>

                <main className="flex-grow overflow-y-auto p-4">
                    {step === 'input' ? (
                        <div className="space-y-4">
                            <div className="bg-blue-50 p-3 rounded-xl border border-blue-100">
                                <p className="text-xs text-blue-700 font-bold leading-relaxed">
                                    • 한 줄에 하나씩 [바코드 수량] 형태로 입력하세요.<br/>
                                    • 예시: 8801043014721 10<br/>
                                    • 엑셀에서 두 열을 복사해서 붙여넣어도 됩니다.
                                </p>
                            </div>
                            <textarea
                                value={inputText}
                                onChange={(e) => setInputText(e.target.value)}
                                placeholder="여기에 바코드와 수량을 붙여넣으세요..."
                                className="w-full h-64 p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                            />
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <div className="flex justify-between items-center mb-3">
                                <span className="text-sm font-bold text-gray-500">분석 결과: {parsedLines.length}건</span>
                                {isAnalyzing && <SpinnerIcon className="w-5 h-5 text-indigo-500 animate-spin" />}
                            </div>
                            <div className="divide-y border rounded-xl overflow-hidden bg-gray-50">
                                {parsedLines.map((line, idx) => (
                                    <div key={idx} className="p-3 flex items-center justify-between bg-white">
                                        <div className="min-w-0 flex-grow">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-xs font-bold text-gray-400">{line.barcode}</span>
                                                <span className="font-bold text-sm truncate">{line.product?.name || line.raw}</span>
                                            </div>
                                            {line.error && <p className="text-[10px] text-rose-500 font-bold mt-0.5">{line.error}</p>}
                                        </div>
                                        <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                                            <span className="font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded text-sm">{line.qty}</span>
                                            {line.status === 'success' ? <CheckCircleIcon className="w-5 h-5 text-emerald-500" /> : line.status === 'fail' ? <XCircleIcon className="w-5 h-5 text-rose-400" /> : <SpinnerIcon className="w-4 h-4 animate-spin text-gray-300" />}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </main>

                <footer className="p-4 border-t bg-gray-50 rounded-b-2xl flex gap-2">
                    {step === 'input' ? (
                        <>
                            <button onClick={onClose} className="flex-1 h-12 bg-white border border-gray-300 text-gray-600 rounded-xl font-bold active:scale-95 transition-all">취소</button>
                            <button onClick={handleAnalyze} disabled={!inputText.trim()} className="flex-[2] h-12 bg-indigo-600 text-white rounded-xl font-bold shadow-lg active:scale-95 disabled:bg-gray-300 transition-all">데이터 분석하기</button>
                        </>
                    ) : (
                        <>
                            <button onClick={() => setStep('input')} disabled={isAnalyzing} className="flex-1 h-12 bg-white border border-gray-300 text-gray-600 rounded-xl font-bold active:scale-95 transition-all">다시 입력</button>
                            <button onClick={handleFinalConfirm} disabled={isAnalyzing || parsedLines.filter(l => l.status === 'success').length === 0} className="flex-[2] h-12 bg-indigo-600 text-white rounded-xl font-bold shadow-lg active:scale-95 disabled:bg-gray-300 transition-all">목록에 추가하기</button>
                        </>
                    )}
                </footer>
            </div>
        </div>,
        document.body
    );
};

export default BatchAuditModal;
