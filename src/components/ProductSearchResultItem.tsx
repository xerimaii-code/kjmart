import React from 'react';
import { Product } from '../types';
import { isSaleActive } from '../hooks/useOrderManager';

interface ProductSearchResultItemProps {
    product: Product;
    onClick: (product: Product) => void;
}

const ProductSearchResultItem: React.FC<ProductSearchResultItemProps> = ({ product, onClick }) => {
    const saleIsActive = isSaleActive(product.saleEndDate);
    const hasSalePrice = !!product.salePrice;

    return (
        <div onClick={() => onClick(product)} className="relative overflow-hidden p-3 hover:bg-gray-100 cursor-pointer text-gray-700 border-b border-gray-100 last:border-b-0">
            {saleIsActive && hasSalePrice && (
                <div className="sale-ribbon">SALE</div>
            )}
            <div className="flex flex-col items-start w-full gap-y-1">
                <div className="flex items-center gap-2 flex-wrap w-full">
                    <p className="font-semibold text-gray-800 whitespace-pre-wrap">{product.name}</p>
                </div>

                <p className="text-sm text-gray-500">{product.barcode}</p>

                <div className="text-sm text-gray-700 font-medium flex items-baseline gap-x-2 flex-wrap">
                    <span className="text-gray-500">매입:</span>
                    <span className="font-bold">{product.costPrice?.toLocaleString()}원</span>
                    <span className="text-gray-400">/</span>
                    <span className="text-gray-500">판매:</span>
                    <span className={`${saleIsActive && hasSalePrice ? 'line-through text-gray-400' : 'font-bold'}`}>
                        {product.sellingPrice?.toLocaleString()}원
                    </span>
                    {hasSalePrice && (
                        <span 
                            className={`${saleIsActive ? 'text-red-600 font-bold' : 'text-gray-500'}`}
                        >
                            {product.salePrice}원
                        </span>
                    )}
                </div>

                {(product.saleEndDate || product.supplierName) && (
                    <div className="text-xs text-gray-500">
                        <div className="flex items-center gap-x-3">
                            {product.saleEndDate && (
                                <span className={saleIsActive ? 'font-bold text-blue-600' : 'text-gray-400'}>
                                    행사: ~{product.saleEndDate}
                                </span>
                            )}
                            {product.supplierName && (
                                <span>({product.supplierName})</span>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProductSearchResultItem;
