import React, { useState, useMemo, useCallback } from 'react';
import { useDataState, useUIActions } from '../context/AppContext';
import { Product } from '../types';
import { SearchIcon, SpinnerIcon, BarcodeScannerIcon } from '../components/Icons';
import { isSaleActive } from '../hooks/useOrderManager';

const ProductCard: React.FC<{ product: Product, index: number }> = ({ product, index }) => {
    const saleIsActive = isSaleActive(product.saleEndDate);
    const hasSalePrice = !!product.salePrice;

    return (
        <div 
            className="bg-white p-4 rounded-xl border border-gray-200/80 shadow-md transition-shadow hover:shadow-lg animate-card-enter"
            style={{ animationDelay: `${Math.min(index * 50, 500)}ms` }}
        >
            <div className="flex justify-between items-start gap-3">
                <div className="flex-grow min-w-0">
                    <p className="font-bold text-gray-800 text-base break-words">{product.name}</p>
                    <p className="text-sm text-gray-500 mt-1">{product.barcode}</p>
                </div>
                {product.supplierName && (
                    <span className="flex-shrink-0 text-xs font-semibold text-white bg-gray-500 rounded-full px-2.5 py-1">{product.supplierName}</span>
                )}
            </div>

            <div className="mt-4 pt-3 border-t border-gray-200/80 space-y-2 text-sm">
                <div className="flex justify-between items-center">
                    <span className="text-gray-600 font-medium">단가(매입):</span>
                    <span className="font-bold text-gray-800">{product.costPrice?.toLocaleString()} 원</span>
                </div>
                 <div className="flex justify-between items-center">
                    <span className="text-gray-600 font-medium">판가:</span>
                    <span className={`font-bold ${saleIsActive && hasSalePrice ? 'text-gray-500 line-through' : 'text-gray-800'}`}>
                        {product.sellingPrice?.toLocaleString()} 원
                    </span>
                </div>
                {hasSalePrice && (
                    <div className={`p-2 rounded-lg transition-colors ${saleIsActive ? 'bg-red-50' : 'bg-gray-100'}`}>
                        <div className="flex justify-between items-center">
                             <span className={`font-bold ${saleIsActive ? 'text-red-600' : 'text-gray-600'}`}>행사가:</span>
                             <span className={`font-bold ${saleIsActive ? 'text-red-600' : 'text-gray-600'}`}>
                                {product.salePrice}
                            </span>
                        </div>
                        {product.saleEndDate && (
                            <p className={`text-sm text-right mt-1 font-semibold ${saleIsActive ? 'text-blue-600' : 'text-gray-500'}`}>
                                ~ {product.saleEndDate}
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

const ProductInquiryPage: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const { products } = useDataState();
    const { openScanner } = useUIActions();
    const [searchTerm, setSearchTerm] = useState('');
    const [activeSearchTerm, setActiveSearchTerm] = useState('');

    const handleSearch = (e?: React.FormEvent) => {
        e?.preventDefault();
        setActiveSearchTerm(searchTerm);
    };

    const handleScan = useCallback(() => {
        openScanner(
            'product-inquiry',
            (barcode) => {
                setSearchTerm(barcode);
                setActiveSearchTerm(barcode);
            },
            false // Single scan
        );
    }, [openScanner]);

    const filteredProducts = useMemo(() => {
        if (!activeSearchTerm) {
            return [];
        }
        const lowercasedFilter = activeSearchTerm.toLowerCase();
        return products.filter(product =>
            product.name.toLowerCase().includes(lowercasedFilter) ||
            product.barcode.includes(lowercasedFilter)
        );
    }, [activeSearchTerm, products]);
    
    const renderContent = () => {
        if (products.length === 0) {
            return (
                <div className="flex items-center justify-center h-full text-center text-gray-500">
                    <div>
                        <SpinnerIcon className="w-10 h-10 mx-auto text-blue-500" />
                        <p className="mt-2 font-semibold">상품 데이터 로딩 중...</p>
                    </div>
                </div>
            );
        }

        if (!activeSearchTerm) {
            return (
                <div className="flex items-center justify-center h-full text-center text-gray-500">
                    <div>
                        <SearchIcon className="w-12 h-12 mx-auto" />
                        <p className="mt-2 font-semibold">상품명 또는 바코드로 검색하세요.</p>
                    </div>
                </div>
            );
        }

        if (filteredProducts.length === 0) {
            return (
                 <div className="flex items-center justify-center h-full text-center text-gray-500">
                     <div>
                        <SearchIcon className="w-12 h-12 mx-auto" />
                        <p className="mt-2 font-semibold">검색 결과가 없습니다.</p>
                     </div>
                 </div>
            );
        }

        return (
            <div className="space-y-3">
                {filteredProducts.map((product, index) => (
                    <ProductCard key={product.barcode} product={product} index={index} />
                ))}
            </div>
        );
    };
    
    return (
        <div className="h-full flex flex-col bg-transparent">
            <div className="fixed-filter p-3 bg-white/60 backdrop-blur-lg border-b border-gray-200/80 z-10">
                <form onSubmit={handleSearch} className="relative w-full">
                    <div className="absolute top-1/2 left-4 -translate-y-1/2 text-gray-400 pointer-events-none">
                        <SearchIcon className="w-5 h-5" />
                    </div>
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="상품명 또는 바코드 검색"
                        className="w-full h-14 p-3 pl-12 pr-36 border-2 border-gray-300 bg-white rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-blue-500 placeholder:text-gray-400 transition text-base"
                    />
                    <div className="absolute top-1/2 right-3 -translate-y-1/2 flex items-center gap-2">
                         <button
                            type="button"
                            onClick={handleScan}
                            className="h-10 w-10 bg-gray-100 text-gray-600 rounded-lg flex items-center justify-center font-bold hover:bg-gray-200 transition active:scale-95"
                            aria-label="바코드 스캔"
                        >
                            <BarcodeScannerIcon className="w-6 h-6" />
                        </button>
                        <button
                            type="submit"
                            className="h-10 px-5 rounded-lg flex items-center justify-center font-semibold transition bg-blue-600 text-white hover:bg-blue-700 active:scale-95"
                            aria-label="검색"
                        >
                            검색
                        </button>
                    </div>
                </form>
            </div>
            <div className="scrollable-content p-3">
                {renderContent()}
            </div>
        </div>
    );
};

export default ProductInquiryPage;