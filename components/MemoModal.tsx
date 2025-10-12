import React, { useState, useEffect, useRef } from 'react';

interface MemoModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (memo: string) => void;
    initialMemo: string;
}

const MemoModal: React.FC<MemoModalProps> = ({ isOpen, onClose, onSave, initialMemo }) => {
    const [memo, setMemo] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const modalContentRef = useRef<HTMLDivElement>(null);
    const MAX_CHARS = 200;

    useEffect(() => {
        if (isOpen) {
            setMemo(initialMemo);
            setTimeout(() => {
                textareaRef.current?.focus();
            }, 100);
        }
    }, [isOpen, initialMemo]);

    if (!isOpen) return null;

    const handleSave = () => {
        onSave(memo);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true">
            <div ref={modalContentRef} className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden transition-transform duration-200" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                    <h3 className="text-xl font-bold text-gray-800 text-center mb-4">메모 추가/수정</h3>
                    <div className="relative">
                        <textarea
                            ref={textareaRef}
                            value={memo}
                            onChange={(e) => setMemo(e.target.value)}
                            placeholder="내용을 입력하세요..."
                            maxLength={MAX_CHARS}
                            className="w-full h-32 p-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition resize-none"
                        />
                        <div className="absolute bottom-2 right-2 text-xs text-gray-400">
                            {memo.length} / {MAX_CHARS}
                        </div>
                    </div>
                </div>
                <div className="bg-gray-50 p-3 grid grid-cols-2 gap-3">
                    <button
                        onClick={onClose}
                        className="px-6 py-3 rounded-lg font-semibold text-gray-600 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleSave}
                        className="text-white px-6 py-3 rounded-lg font-bold bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                    >
                        저장
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MemoModal;