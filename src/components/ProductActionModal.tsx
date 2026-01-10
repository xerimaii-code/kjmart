
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Product } from '../types';
import { PencilSquareIcon } from './Icons';

interface ProductActionModalProps {
    isOpen: boolean;
    onClose: () => void;
    product: Product | null;
    onEdit: (product: Product) => void;
}

const ProductActionModal: React.FC<ProductActionModalProps> = ({ isOpen, onClose, product, onEdit }) => {
    const [isRendered, setIsRendered] = useState(false);

    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => setIsRendered(true), 10);
            return () => clearTimeout(timer);
        } else {
            setIsRendered(false);
        }
    }, [isOpen]);

    if (!isOpen || !product) return null;

    return createPortal(
        <div 
            className={`fixed inset-0 z-[95] flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-50' : 'bg-transparent'}`} 
            onClick={onClose} 
            role="dialog" 
            aria-modal="true"
        >
            <div 
                className={`bg-white rounded-xl shadow-lg w-full max-w-sm transition-[opacity,transform] duration-300 will-change-[opacity,transform] ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`} 
                onClick={e => e.stopPropagation()}
            >
                <div className="p-5">
                    <h3 className="text-xl font-bold text-gray-800 text-center truncate" title={product.name}>{product.name}</h3>
                    <p className="text-center text-sm text-gray-500 mt-1">{product.barcode}</p>
                </div>
                <div className="px-4 pb-4 space-y-3">
                    <button 
                        onClick={() => { onEdit(product); onClose(); }} 
                        className="w-full flex items-center gap-4 p-4 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
                    >
                        <PencilSquareIcon className="w-6 h-6 text-blue-600" />
                        <span className="font-bold text-gray-800 text-base">상품 정보 수정</span>
                    </button>
                </div>
                <div className="bg-gray-50 p-3 text-center rounded-b-xl border-t">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 rounded-lg font-bold text-gray-700 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition active:scale-95"
                    >
                        취소
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ProductActionModal;
