import React, { useState, useMemo, useCallback, useDeferredValue } from 'react';
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
            className="relative overflow-hidden p-3 flex flex-col items-start gap-y-1 animate-card-enter"
            style={{ animationDelay: `${Math.min(index * 50, 500)}ms` }}
        >
            {saleIsActive && hasSalePrice && (
                <div className="sale-ribbon">SALE</div>
            )}
            {/* Line 1: Product Name, Sale Badge */}
            <div className="flex items-center gap-2 flex-wrap w-full">
                <p className="font-semibold text-gray-800 text-base whitespace-pre-wrap">{product.name}</p>
            </div>
            
            {/* Line 2: Barcode */}
            <p className="text-sm text-gray-500">{product.barcode}</p>

            {/* Line 3: Price Info */}
            <div className="text-base flex items-baseline gap-x-1.5 flex-wrap">
                <span className="text-gray-600 font-semibold">{product.costPrice?.toLocaleString()}원</span>
                <span className="text-gray-400">/</span>
                <span className={`font-semibold ${saleIsActive && hasSalePrice ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                    {product.sellingPrice?.toLocaleString()}원
                </span>
                {hasSalePrice && (
                    <span 
                        className={`${saleIsActive ? 'text-red-600 font-bold' : 'text-gray-500'}`}
                        style={!saleIsActive ? { fontSize: '80%' } : {}}
                    >
                        {product.salePrice}원
                    </span>
                )}
            </div>
            
            {/* Line 4: Sale End Date and Supplier Line */}
            {(product.saleEndDate || product.supplierName) && (
                <div className="text-xs text-gray-500 pt-1">
                    <div className="flex items-center gap-x-3">
                        {product.saleEndDate && (
                            <span className={saleIsActive ? 'font-semibold text-blue-600' : 'text-gray-400'}>
                                ~{product.saleEndDate}
                            </span>
                        )}
                        {product.supplierName && (
                            <span>{product.supplierName}</span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const ProductInquiryPage: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const { products } = useDataState();
    const { openScanner } = useScanner();
    const [searchTerm, setSearchTerm] = useState('');
    const [activeSearchTerm, setActiveSearchTerm] = useState('');
    const deferredActiveSearchTerm = useDeferredValue(activeSearchTerm);
    const isStale = activeSearchTerm !== deferredActiveSearchTerm;

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
        const lowercasedFilter = deferredActiveSearchTerm.toLowerCase();
        if (!lowercasedFilter) {
            return { displayedProducts: [], totalFound: 0 };
        }
        
        const filtered = products.filter(product =>
            product.name.toLowerCase().includes(lowercasedFilter) ||
            product.barcode.includes(lowercasedFilter)
        );
        return {
            displayedProducts: filtered.slice(0, MAX_RESULTS_TO_DISPLAY),
            totalFound: filtered.length
        };
    }, [deferredActiveSearchTerm, products]);
    
    const renderContent = () => {
        // State 1: Data is loading for the first time
        if (products.length === 0) {
            return (
                <div className="flex items-center justify-center h-full text-center text-gray-500 pt-16">
                    <div>
                        <SpinnerIcon className="w-10 h-10 mx-auto text-blue-500" />
                        <p className="mt-2 font-semibold">상품 데이터 로딩 중...</p>
                    </div>
                </div>
            );
        }

        // State 2: Data loaded, but user hasn't searched yet
        if (!activeSearchTerm) {
             return null;
        }

        // State 3: User has searched, but no results were found
        if (displayedProducts.length === 0 && !isStale) {
            return (
                <div className="p-3 flex flex-col items-center justify-center h-full text-gray-400 pt-16 text-center">
                    <SearchIcon className="w-16 h-16 text-gray-300 mb-4" />
                    <p className="text-lg font-semibold">검색 결과가 없습니다</p>
                    <p className="text-sm mt-1">다른 검색어를 입력해보세요.</p>
                </div>
            );
        }

        // State 4: Results are found and displayed
        return (
            <div className={`space-y-3 transition-opacity duration-200 ${isStale ? 'opacity-50' : 'opacity-100'}`}>
                <div className="divide-y divide-gray-200">
                    {displayedProducts.map((product, index) => (
                        <ProductCard key={product.barcode} product={product} index={index} />
                    ))}
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
        <div className="h-full flex flex-col bg-white">
            <div className="fixed-filter w-full p-3 bg-white border-b border-gray-200 z-10">
                <form onSubmit={handleSearch} className="relative w-full max-w-2xl mx-auto">
                    <div className="absolute top-1/2 left-4 -translate-y-1/2 text-gray-400 pointer-events-none">
                        <SearchIcon className="w-5 h-5" />
                    </div>
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="상품명 또는 바코드 검색"
                        className="w-full h-12 p-3 pl-12 pr-32 border border-gray-300 bg-white rounded-xl focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder:text-gray-400 transition text-base"
                    />
                    <div className="absolute top-1/2 right-2 -translate-y-1/2 flex items-center gap-1.5">
                         <button
                            type="button"
                            onClick={handleScan}
                            className="h-9 w-9 bg-gray-100 text-gray-600 rounded-lg flex items-center justify-center font-bold hover:bg-gray-200 transition active:scale-95"
                            aria-label="바코드 스캔"
                        >
                            <BarcodeScannerIcon className="w-6 h-6" />
                        </button>
                        <button
                            type="submit"
                            className="h-9 px-4 rounded-lg flex items-center justify-center font-semibold transition bg-blue-600 text-white hover:bg-blue-700 active:scale-95"
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