
import React, { useMemo, useCallback } from 'react';
import { useScanner, useDeviceSettings, useMiscUI } from '../context/AppContext';
import { Product } from '../types';
import { SearchIcon, SpinnerIcon, BarcodeScannerIcon } from '../components/Icons';
import { isSaleActive } from '../hooks/useOrderManager';
import { useProductSearch } from '../hooks/useProductSearch';

const MAX_RESULTS_TO_DISPLAY = 100;

const ProductCard: React.FC<{ product: Product, index: number }> = ({ product, index }) => {
    const saleIsActive = isSaleActive(product.saleStartDate, product.saleEndDate);
    const hasEventCostPrice = product.eventCostPrice !== undefined && product.eventCostPrice !== null && product.eventCostPrice > 0;
    const hasSalePrice = product.salePrice !== undefined && product.salePrice !== null && product.salePrice > 0;
    const hasAnySalePrice = hasEventCostPrice || hasSalePrice;

    return (
        <div
            className="relative overflow-hidden p-3 flex flex-col items-start gap-y-1 animate-card-enter"
            style={{ animationDelay: `${Math.min(index * 50, 500)}ms` }}
        >
            {saleIsActive && hasAnySalePrice && (
                <div className="sale-ribbon">SALE</div>
            )}
            <div className="flex items-center gap-2 flex-wrap w-full">
                <p className="font-semibold text-gray-800 text-base whitespace-pre-wrap">{product.name}</p>
            </div>
            
            <div className="flex items-baseline gap-x-4">
                <p className="text-sm text-gray-500">{product.barcode}</p>
                {product.stockQuantity !== undefined && (
                    <p className="text-sm font-bold text-teal-600">재고: {product.stockQuantity.toLocaleString()}</p>
                )}
            </div>

            <div className="space-y-1">
                {/* Normal Price */}
                <div className="text-base flex items-baseline gap-x-1.5 flex-wrap">
                    <span className={`font-semibold ${saleIsActive && hasAnySalePrice ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                        {product.costPrice?.toLocaleString()}원
                    </span>
                    <span className={`text-gray-400 ${saleIsActive && hasAnySalePrice ? 'line-through' : ''}`}>/</span>
                    <span className={`font-semibold ${saleIsActive && hasAnySalePrice ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                        {product.sellingPrice?.toLocaleString()}원
                    </span>
                </div>
                
                {/* Sale Price */}
                {hasAnySalePrice && (
                    <div className={`flex items-baseline gap-x-1.5 flex-wrap ${saleIsActive ? 'text-red-600 font-bold' : 'text-gray-500'}`} style={!saleIsActive ? { fontSize: '0.9rem' } : {}}>
                        {hasEventCostPrice && (
                            <span>
                                {product.eventCostPrice?.toLocaleString()}원
                            </span>
                        )}
                        {(hasEventCostPrice && hasSalePrice) && <span className="text-gray-400">/</span>}
                        {hasSalePrice && (
                             <span>
                                {product.salePrice?.toLocaleString()}원
                            </span>
                        )}
                    </div>
                )}
            </div>
            
            {(product.saleStartDate || product.saleEndDate || product.supplierName) && (
                <div className="text-xs text-gray-500 pt-1">
                    <div className="flex items-center gap-x-3">
                        {(product.saleStartDate || product.saleEndDate) && (
                            <span className={saleIsActive ? 'font-semibold text-blue-600' : 'text-gray-400'}>
                                {product.saleStartDate ? `${product.saleStartDate}~` : `~`}{product.saleEndDate}
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
    const { openScanner } = useScanner();
    const { sqlStatus } = useMiscUI();
    
    // Use custom hook for product search
    const { searchTerm, setSearchTerm, results, isSearching, searchSource } = useProductSearch('productInquiry', MAX_RESULTS_TO_DISPLAY);
    
    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // Hook automatically handles debounced search, but this prevents form default submit behavior
    };

    const handleScan = useCallback(() => {
        openScanner(
            'product-inquiry',
            (barcode) => {
                setSearchTerm(barcode);
            },
            false
        );
    }, [openScanner, setSearchTerm]);

    const { displayedProducts, totalFound } = useMemo(() => {
        return {
            displayedProducts: results,
            totalFound: results.length
        };
    }, [results]);
    
    const renderContent = () => {
        if (isSearching) {
            return (
                <div className="flex items-center justify-center h-full text-center text-gray-500 pt-16">
                    <div>
                        <SpinnerIcon className="w-10 h-10 mx-auto text-blue-500" />
                        <p className="mt-2 font-semibold">
                            {searchSource === 'online' ? '온라인에서 검색 중...' : '검색 중...'}
                        </p>
                    </div>
                </div>
            );
        }
        
        if (searchSource === 'none' && !searchTerm) {
             return null;
        }

        if (!isSearching && displayedProducts.length === 0 && searchTerm) {
            return (
                <div className="p-3 flex flex-col items-center justify-center h-full text-gray-400 pt-16 text-center">
                    <SearchIcon className="w-16 h-16 text-gray-300 mb-4" />
                    <p className="text-lg font-semibold">검색 결과가 없습니다</p>
                    <p className="text-sm mt-1">
                        {searchSource === 'online' && sqlStatus !== 'connected' 
                            ? '온라인 서버에 연결할 수 없습니다.' 
                            : '다른 검색어를 입력해보세요.'
                        }
                    </p>
                </div>
            );
        }

        return (
            <div className="space-y-3">
                <div className="divide-y divide-gray-200">
                    {displayedProducts.map((product, index) => (
                        <ProductCard key={product.barcode} product={product} index={index} />
                    ))}
                </div>
                {totalFound >= MAX_RESULTS_TO_DISPLAY && (
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
                <form onSubmit={handleSearchSubmit} className="flex items-stretch gap-2 w-full max-w-2xl mx-auto">
                    <div className="relative flex-grow">
                        <div className="absolute top-1/2 left-4 -translate-y-1/2 text-gray-400 pointer-events-none">
                            {isSearching ? <SpinnerIcon className="w-5 h-5 text-blue-500" /> : <SearchIcon className="w-5 h-5" />}
                        </div>
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="상품명 또는 바코드 검색"
                            className="w-full h-12 p-3 pl-12 border border-gray-300 bg-white rounded-xl focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder:text-gray-400 transition text-base"
                        />
                    </div>
                     <button
                        type="submit"
                        className="h-12 w-20 bg-blue-600 text-white rounded-xl flex flex-col items-center justify-center gap-1 font-bold hover:bg-blue-700 transition active:scale-95 shadow shadow-blue-500/30"
                        disabled={isSearching}
                    >
                        <SearchIcon className="w-6 h-6" />
                        <span className="text-xs">검색</span>
                    </button>
                    <button
                        type="button"
                        onClick={handleScan}
                        className="h-12 w-20 bg-gray-200 text-gray-700 rounded-xl flex flex-col items-center justify-center gap-1 font-semibold hover:bg-gray-300 transition active:scale-95"
                        aria-label="바코드 스캔"
                    >
                        <BarcodeScannerIcon className="w-6 h-6" />
                        <span className="text-xs">스캔</span>
                    </button>
                </form>
            </div>
            <div className="scrollable-content p-3">
                <div className="max-w-2xl mx-auto w-full h-full">{renderContent()}</div>
            </div>
        </div>
    );
};

export default ProductInquiryPage;
