import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useDataState, useScanner, useDeviceSettings, useMiscUI } from '../context/AppContext';
import { Product } from '../types';
import { SearchIcon, SpinnerIcon, BarcodeScannerIcon } from '../components/Icons';
import { isSaleActive } from '../hooks/useOrderManager';
import { searchProductsOnline } from '../services/sqlService';
import { useDebounce } from '../hooks/useDebounce';

const MAX_RESULTS_TO_DISPLAY = 100;

const mapSqlResultToProduct = (r: any): Product => ({
    barcode: String(r.바코드 || ''),
    name: String(r.상품명 || ''),
    costPrice: parseFloat(String(r.매입가 || 0)),
    sellingPrice: parseFloat(String(r.판매가 || 0)),
    eventCostPrice: r.행사매입가 ? parseFloat(String(r.행사매입가)) : undefined,
    salePrice: r.행사판매가 ? parseFloat(String(r.행사판매가)) : undefined,
    saleStartDate: r.행사시작일 || undefined,
    saleEndDate: r.행사종료일 || undefined,
    supplierName: r.거래처명 || undefined,
    lastModified: r.upday1 || undefined,
});

const ProductCard: React.FC<{ product: Product, index: number }> = ({ product, index }) => {
    const saleIsActive = isSaleActive(product.saleStartDate, product.saleEndDate);
    const hasSalePrice = product.salePrice !== undefined && product.salePrice !== null;

    return (
        <div
            className="relative overflow-hidden p-3 flex flex-col items-start gap-y-1 animate-card-enter"
            style={{ animationDelay: `${Math.min(index * 50, 500)}ms` }}
        >
            {saleIsActive && hasSalePrice && (
                <div className="sale-ribbon">SALE</div>
            )}
            <div className="flex items-center gap-2 flex-wrap w-full">
                <p className="font-semibold text-gray-800 text-base whitespace-pre-wrap">{product.name}</p>
            </div>
            
            <p className="text-sm text-gray-500">{product.barcode}</p>

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
                        {product.salePrice?.toLocaleString()}원
                    </span>
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
    const { products } = useDataState();
    const { openScanner } = useScanner();
    const { dataSourceSettings } = useDeviceSettings();
    const { sqlStatus } = useMiscUI();
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    
    const [onlineResults, setOnlineResults] = useState<Product[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [searchSource, setSearchSource] = useState<'offline' | 'online' | 'none'>('none');
    
    useEffect(() => {
        if (!isActive) return;

        const performSearch = async () => {
            if (!debouncedSearchTerm) {
                setOnlineResults([]);
                setSearchSource('none');
                setIsSearching(false);
                return;
            }

            const preferredSource = dataSourceSettings.productInquiry;
            const canGoOnline = sqlStatus === 'connected';
            const useOnline = (preferredSource === 'online' && canGoOnline);
            
            setIsSearching(true);
            if (useOnline) {
                setSearchSource('online');
                try {
                    const results = await searchProductsOnline(debouncedSearchTerm);
                    setOnlineResults(results.map(mapSqlResultToProduct));
                } catch (e) {
                    console.error("Online search failed:", e);
                    if (dataSourceSettings.autoSwitch) {
                        setSearchSource('offline');
                    } else {
                        setOnlineResults([]); // Clear results on error if not auto-switching
                    }
                } finally {
                    setIsSearching(false);
                }
            } else {
                setSearchSource('offline');
                setOnlineResults([]);
                setIsSearching(false);
            }
        };

        performSearch();
    }, [debouncedSearchTerm, isActive, dataSourceSettings, sqlStatus]);

    const handleScan = useCallback(() => {
        openScanner(
            'product-inquiry',
            (barcode) => setSearchTerm(barcode),
            false
        );
    }, [openScanner]);

    const { displayedProducts, totalFound } = useMemo(() => {
        if (searchSource === 'online') {
            return {
                displayedProducts: onlineResults.slice(0, MAX_RESULTS_TO_DISPLAY),
                totalFound: onlineResults.length,
            };
        }
        if (searchSource === 'offline') {
            const lowercasedFilter = debouncedSearchTerm.toLowerCase();
            if (!lowercasedFilter) return { displayedProducts: [], totalFound: 0 };
            
            const filtered = products.filter(product =>
                product.name.toLowerCase().includes(lowercasedFilter) ||
                product.barcode.includes(lowercasedFilter)
            );
            return {
                displayedProducts: filtered.slice(0, MAX_RESULTS_TO_DISPLAY),
                totalFound: filtered.length
            };
        }
        return { displayedProducts: [], totalFound: 0 };
    }, [searchSource, debouncedSearchTerm, products, onlineResults]);
    
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
        
        if (searchSource === 'none') {
             return null;
        }

        if (displayedProducts.length === 0) {
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
                <form onSubmit={(e) => e.preventDefault()} className="relative w-full max-w-2xl mx-auto">
                    <div className="absolute top-1/2 left-4 -translate-y-1/2 text-gray-400 pointer-events-none">
                        {isSearching ? <SpinnerIcon className="w-5 h-5 text-blue-500" /> : <SearchIcon className="w-5 h-5" />}
                    </div>
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="상품명 또는 바코드 검색"
                        className="w-full h-12 p-3 pl-12 pr-14 border border-gray-300 bg-white rounded-xl focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder:text-gray-400 transition text-base"
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