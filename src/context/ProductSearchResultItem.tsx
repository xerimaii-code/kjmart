
import React from 'react';
import { Product } from '../types';
import { isSaleActive } from '../hooks/useOrderManager';

interface ProductSearchResultItemProps {
    product: Product;
    onClick: (product: Product) => void;
}

const ProductSearchResultItem: React.FC<ProductSearchResultItemProps> = ({ product, onClick }) => {
    const saleIsActive = isSaleActive(product.saleStartDate, product.saleEndDate);
    const hasEventCostPrice = product.eventCostPrice !== undefined && product.eventCostPrice !== null && product.eventCostPrice > 0;
    const hasSalePrice = product.salePrice !== undefined && product.salePrice !== null && product.salePrice > 0;
    const hasAnySalePrice = hasEventCostPrice || hasSalePrice;

    return (
        <div onClick={() => onClick(product)} className="relative overflow-hidden p-3 hover:bg-gray-100 cursor-pointer text-gray-700 border-b border-gray-100 last:border-b-0">
            <div className="flex flex-col items-start w-full gap-y-1">
                {/* Row 1: Name & Sale Badge */}
                <div className="flex items-start justify-between w-full gap-2">
                    <p className="font-semibold text-gray-800 whitespace-pre-wrap break-all">{product.name}</p>
                    {saleIsActive && hasAnySalePrice && (
                        <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-0.5 rounded flex-shrink-0 whitespace-nowrap mt-0.5">행사중</span>
                    )}
                </div>
                
                {/* Row 2: Normal Price (Moved Up) */}
                <div className="text-sm text-gray-700 font-medium flex items-center gap-x-2 w-full mt-0.5">
                    <span className="text-gray-500 text-xs">매입/판매:</span>
                    <span className={`font-bold ${saleIsActive && hasAnySalePrice ? 'text-gray-400 line-through decoration-gray-400' : 'text-gray-900'}`}>
                        {product.costPrice?.toLocaleString()}
                    </span>
                    <span className="text-gray-400">/</span>
                    <span className={`${saleIsActive && hasAnySalePrice ? 'text-gray-400 line-through decoration-gray-400' : 'font-bold'}`}>
                        {product.sellingPrice?.toLocaleString()}
                    </span>
                </div>

                {/* Row 3: Event Price (Moved Up) */}
                {hasAnySalePrice && (
                    <div className="text-sm font-medium flex items-center gap-x-2 w-full">
                        <span className="text-red-500 font-bold text-xs">행사:</span>
                        <div className="flex items-center gap-1 text-red-600 font-bold">
                            <span>
                                {hasEventCostPrice ? product.eventCostPrice?.toLocaleString() : '-'}
                            </span>
                            <span className="text-gray-300">/</span>
                            <span>
                                {hasSalePrice ? product.salePrice?.toLocaleString() : '-'}
                            </span>
                        </div>
                    </div>
                )}

                {/* Row 4: Sale Date (Moved Up) */}
                {(product.saleStartDate || product.saleEndDate) && (
                    <div className="text-xs w-full">
                         <span className={saleIsActive ? 'font-bold text-blue-600' : 'text-gray-400'}>
                            행사기간: {product.saleStartDate ? `${product.saleStartDate}~` : `~`}{product.saleEndDate}
                        </span>
                    </div>
                )}

                {/* Row 5: Stock, BOM, Barcode (Moved Down to match Inquiry Card) */}
                <div className="flex items-center gap-x-2 w-full text-sm mt-1">
                    {product.stockQuantity !== undefined && (
                        <div className="flex items-center gap-1">
                            <span className="text-gray-500 text-xs">재고:</span>
                            <p className="font-semibold text-teal-600">{product.stockQuantity.toLocaleString()}</p>
                        </div>
                    )}
                    {product.bomStatus === '묶음' && (
                        <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-xs font-bold">
                            묶음
                        </span>
                    )}
                    <p className="text-gray-400 font-mono text-xs ml-auto">{product.barcode}</p>
                </div>

                {/* Row 6: Supplier */}
                {product.supplierName && (
                    <div className="text-xs text-gray-500 w-full text-right">
                        {product.supplierName}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProductSearchResultItem;
