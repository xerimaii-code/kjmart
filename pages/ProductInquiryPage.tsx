import React, { useState, useMemo, useCallback } from 'react';
import { useDataState, useScanner } from '../context/AppContext';
import { Product } from '../types';
import { SearchIcon, SpinnerIcon, BarcodeScannerIcon } from '../components/Icons';
import { isSaleActive } from '../hooks/useOrderManager';

const MAX_RESULTS_TO_DISPLAY = 100;

const ProductCard: React.FC<{ product: Product, index: number }> = ({ product, index }) => {
    const saleIsActive = isSaleActive(product.saleEndDate);
    const hasSalePrice = !!product.salePrice;

    return (
        <div 
            className="p-4 flex justify-between items-start gap-4 animate-card-enter"
            style={{ animationDelay: `${Math.min(index * 50, 500)}ms` }}
        >
            {/* Left side: Product Name, Sale Badge, and Barcode */}
            <div className="flex-grow min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="font-bold text-gray-800 text-base whitespace-pre-wrap">{product.name}</p>
                    {saleIsActive && hasSalePrice && (
                        <span className="text-xs font-bold text-white bg-red-500 rounded-full px-2 py-0.5 leading-none">SALE</span>
                    )}
                </div>
                <p className="text-sm text-gray-500">{product.barcode}</p>
            </div>

            {/* Right side: Price and Sale Info */}
            <div className="flex-shrink-0 text-right space-y-1">
                {/* Price Line */}
                <div className="text-base font-medium text-gray-800">
                    {saleIsActive && hasSalePrice ? (
                        <>
                            <span>{product.costPrice?.toLocaleString()}</span>
                            <span className="text-gray-400 mx-0.5">/</span>
                            <span className="line-through text-gray-400">{product.sellingPrice?.toLocaleString()}</span>
                            <span className="text-red-600 font-bold ml-1.5">{product.salePrice}</span>
                        </>
                    ) : (
                        <>
                            <span>{product.costPrice?.toLocaleString()}</span>
                            <span className="text-gray-400 mx-0.5">/</span>
                            <span>{product.sellingPrice?.toLocaleString()}</span>
                        </>
                    )}
                </div>
                
                {/* Sale End Date and Supplier Line */}
                {(product.saleEndDate || product.supplierName) && (
                    <div className="text-xs text-gray-500">
                        {product.saleEndDate && (
                            <span className={saleIsActive ? 'font-bold text-blue-600' : ''}>
                                행사종료: {product.saleEndDate}
                            </span>
                        )}
                        {product.saleEndDate && product.supplierName && <span className="mx-1">|</span>}
                        {product.supplierName && (
                            <span>거래처: {product.supplierName}</span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

const ProductInquiryPage: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const { products } = useDataState();
    const { openScanner } = useScanner();
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

    const { displayedProducts, totalFound } = useMemo(() => {
        if (!activeSearchTerm) {
            return { displayedProducts: [], totalFound: 0 };
        }
        const lowercasedFilter = activeSearchTerm.toLowerCase();
        const filtered = products.filter(product =>
            product.name.toLowerCase().includes(lowercasedFilter) ||
            product.barcode.includes(lowercasedFilter)
        );
        return {
            displayedProducts: filtered.slice(0, MAX_RESULTS_TO_DISPLAY),
            totalFound: filtered.length
        };
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

        if (displayedProducts.length === 0) {
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
                <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200/60 overflow-hidden">
                    <div className="divide-y divide-gray-200/80">
                        {displayedProducts.map((product, index) => (
                            <ProductCard key={product.barcode} product={product} index={index} />
                        ))}
                    </div>
                </div>
                {totalFound > MAX_RESULTS_TO_DISPLAY && (
                    <div className="text-center text-sm font-semibold text-gray-600 bg-gray-100 p-3 rounded-lg">
                        {totalFound.toLocaleString()}개의 검색 결과 중 첫 {MAX_RESULTS_TO_DISPLAY}개만 표시합니다.
                    </div>
                )}
            </div>
        );
    };
    
    return (
        <div className="h-full flex flex-col bg-transparent">
            <div className="fixed-filter w-full p-3 bg-white/60 backdrop-blur-lg border-b border-gray-200/80 z-10">
                <form onSubmit={handleSearch} className="relative w-full max-w-2xl mx-auto">
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
                <div className="max-w-2xl mx-auto w-full h-full">{renderContent()}</div>
            </div>
        </div>
    );
};

export default ProductInquiryPage;