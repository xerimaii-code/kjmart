
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ProductSelectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    products: any[];
    onSelect: (product: any) => void;
}

const ProductSelectionModal: React.FC<ProductSelectionModalProps> = ({ isOpen, onClose, products, onSelect }) => {
    const [isRendered, setIsRendered] = useState(false);

    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => setIsRendered(true), 10);
            return () => clearTimeout(timer);
        } else {
            setIsRendered(false);
        }
    }, [isOpen]);

    // Helper to safely extract numbers
    const getNumber = (obj: any, keys: string[]) => {
        for (const key of keys) {
            const val = obj[key];
            if (val !== undefined && val !== null && val !== '') {
                const num = Number(val);
                if (!isNaN(num)) return num;
            }
        }
        return 0;
    };

    // Helper to safely extract strings
    const getString = (obj: any, keys: string[]) => {
        for (const key of keys) {
            if (obj[key] !== undefined && obj[key] !== null) {
                return String(obj[key]);
            }
        }
        return '';
    };

    if (!isOpen) return null;

    return createPortal(
        <div 
            className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-colors duration-300 ${isRendered ? 'bg-black bg-opacity-50' : 'bg-transparent'}`} 
            onClick={onClose} 
            role="dialog" 
            aria-modal="true"
        >
            <div 
                className={`bg-white rounded-xl shadow-lg w-full max-w-lg transition-[opacity,transform] duration-300 will-change-[opacity,transform] ${isRendered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`} 
                onClick={e => e.stopPropagation()}
            >
                <div className="p-5 border-b">
                    <h3 className="text-xl font-bold text-gray-800 text-center">여러 상품이 검색되었습니다</h3>
                    <p className="text-sm text-gray-500 text-center mt-1">수정할 상품을 선택하세요.</p>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                    <div className="divide-y divide-gray-100">
                        {products.map((product, index) => {
                            const barcode = getString(product, ['바코드', 'barcode', 'itemCode']);
                            const name = getString(product, ['상품명', '품명', 'descr', 'name']);
                            const spec = getString(product, ['규격', 'spec']);
                            
                            const cost = getNumber(product, ['매입가', 'money0vat', 'cost']);
                            const price = getNumber(product, ['판매가', 'money1', 'price']);
                            
                            const saleYn = getString(product, ['행사유무', '행사', 'isSale', 'saleYn']);
                            const hasSale = saleYn === 'Y' || saleYn === '1';
                            
                            const saleCost = getNumber(product, ['행사매입가', 'salemoney0', 'eventCost']);
                            const salePrice = getNumber(product, ['행사판매가', 'salemoney1', 'eventPrice']);
                            
                            const stock = getNumber(product, ['재고수량', '현재고', 'curjago', 'stock']);
                            const bomStatus = getString(product, ['BOM여부', 'ispack', 'bom']);
                            const isBundle = bomStatus === '묶음' || bomStatus === '1';

                            return (
                                <button 
                                    key={index}
                                    onClick={() => onSelect(product)}
                                    className="w-full text-left p-4 hover:bg-blue-50 transition-colors flex flex-col gap-1"
                                >
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <p className="font-bold text-lg text-gray-800 leading-tight">{name}</p>
                                            {spec && <p className="text-sm text-gray-500 mt-0.5 font-medium">{spec}</p>}
                                        </div>
                                        {hasSale && <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-0.5 rounded flex-shrink-0 ml-2 mt-1">행사중</span>}
                                    </div>
                                    
                                    <div className="flex text-sm mt-1 gap-3 text-gray-700">
                                        <div className="flex gap-1">
                                            <span className="text-gray-500">매입:</span>
                                            <span className="font-semibold">{cost.toLocaleString()}</span>
                                        </div>
                                        <div className="flex gap-1">
                                            <span className="text-gray-500">판매:</span>
                                            <span className="font-semibold">{price.toLocaleString()}</span>
                                        </div>
                                    </div>

                                    {hasSale && (
                                        <div className="flex text-sm gap-3 text-red-600 font-bold bg-red-50 p-1.5 rounded-lg border border-red-100 mt-1">
                                            <div className="flex gap-1">
                                                <span>행사매입:</span>
                                                <span>{saleCost.toLocaleString()}</span>
                                            </div>
                                            <div className="flex gap-1">
                                                <span>행사판매:</span>
                                                <span>{salePrice.toLocaleString()}</span>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex justify-between items-center mt-2 text-xs">
                                        <div className="flex items-center gap-2">
                                            <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">재고: {stock.toLocaleString()}</span>
                                            {isBundle && (
                                                <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-bold">묶음</span>
                                            )}
                                        </div>
                                        <div className="text-right text-gray-500 font-mono">
                                            {barcode}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div className="bg-gray-50 p-3 text-center rounded-b-xl border-t">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 rounded-lg font-bold text-gray-700 bg-gray-200 hover:bg-gray-300 focus:outline-none transition active:scale-95"
                    >
                        취소
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ProductSelectionModal;
