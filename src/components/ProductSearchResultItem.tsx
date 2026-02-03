
import React from 'react';
import { Product } from '../types';
import { isSaleActive } from '../hooks/useOrderManager';

interface ProductSearchResultItemProps {
    product: Product;
    onClick: (product: Product) => void;
}

const ProductSearchResultItem: React.FC<ProductSearchResultItemProps> = ({ product, onClick }) => {
    // 현재 날짜 기준 유효성 체크
    const saleIsActive = isSaleActive(product.saleStartDate, product.saleEndDate);
    const hasEventCostPrice = product.eventCostPrice !== undefined && product.eventCostPrice !== null && product.eventCostPrice > 0;
    const hasSalePrice = product.salePrice !== undefined && product.salePrice !== null && product.salePrice > 0;
    
    // 유효한 행사이고 가격 정보가 있는 경우에만 표시
    const shouldShowSale = saleIsActive && (hasEventCostPrice || hasSalePrice);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault(); 
        onClick(product);
    };

    return (
        <div onMouseDown={handleMouseDown} className="relative overflow-hidden p-3 hover:bg-gray-100 cursor-pointer text-gray-700 border-b border-gray-100 last:border-b-0">
            <div className="flex flex-col items-start w-full gap-y-1">
                {/* Row 1: Name & Active Sale Badge */}
                <div className="flex items-start justify-between w-full gap-2">
                    <p className="font-semibold text-gray-800 whitespace-pre-wrap break-all">{product.name}</p>
                    {shouldShowSale && (
                        <span className="text-rose-500 text-[10px] font-black px-1.5 py-0.5 rounded border border-rose-200 bg-rose-50">행사중</span>
                    )}
                </div>
                
                {/* Row 2: Normal Price (취소선 제거) */}
                <div className="text-sm text-gray-700 font-medium flex items-center gap-x-2 w-full mt-0.5">
                    <span className="text-gray-400 text-[10px] font-bold uppercase">정상가</span>
                    <span className="font-bold text-gray-600">
                        {product.costPrice?.toLocaleString()}
                    </span>
                    <span className="text-gray-300">/</span>
                    <span className="font-bold text-gray-600">
                        {product.sellingPrice?.toLocaleString()}
                    </span>
                </div>

                {/* Row 3: Event Price Box (Only for Active Sales) */}
                {shouldShowSale && (
                    <div className="text-sm font-medium flex flex-col gap-1 w-full p-2 mt-1 rounded-lg border border-gray-200 border-dashed bg-gray-50 animate-fade-in-up">
                        <div className="flex items-center justify-between">
                            <span className="text-rose-500 font-black text-[10px] uppercase">행사가 적용</span>
                            <span className="text-[10px] text-gray-400 font-medium">{product.saleStartDate?.slice(5)}~{product.saleEndDate?.slice(5)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1 text-gray-800 font-black">
                                <span>{hasEventCostPrice ? product.eventCostPrice?.toLocaleString() : '-'}</span>
                                <span className="text-gray-300">/</span>
                                <span>{hasSalePrice ? product.salePrice?.toLocaleString() : '-'}</span>
                            </div>
                            <span className="text-[10px] text-gray-400 font-normal truncate flex-1 text-right">{product.saleName}</span>
                        </div>
                    </div>
                )}

                {/* Row 4: Stock & Barcode */}
                <div className="flex items-center gap-x-2 w-full text-sm mt-1">
                    {product.stockQuantity !== undefined && (
                        <div className="flex items-center gap-1">
                            <span className="text-gray-400 text-[10px] font-bold uppercase">재고</span>
                            <p className="font-black text-teal-600 tabular-nums">{product.stockQuantity.toLocaleString()}</p>
                        </div>
                    )}
                    {product.bomStatus === '묶음' && (
                        <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-black border border-purple-200">묶음</span>
                    )}
                    <p className="text-gray-300 font-mono text-[10px] ml-auto">{product.barcode}</p>
                </div>
            </div>
        </div>
    );
};

export default ProductSearchResultItem;
