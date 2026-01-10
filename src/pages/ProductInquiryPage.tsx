
import React, { useMemo, useCallback, useState } from 'react';
import { useScanner, useDeviceSettings, useMiscUI, useModals, useAlert } from '../context/AppContext';
import { Product } from '../types';
import { SearchIcon, SpinnerIcon, BarcodeScannerIcon } from '../components/Icons';
import { isSaleActive } from '../hooks/useOrderManager';
import { useProductSearch } from '../hooks/useProductSearch';
import ProductEditPage from './ProductEditPage';
import ProductActionModal from '../components/ProductActionModal';

const MAX_RESULTS_TO_DISPLAY = 100;

const ProductCard: React.FC<{ product: Product, index: number, onClick: (product: Product) => void }> = ({ product, index, onClick }) => {
    const saleIsActive = isSaleActive(product.saleStartDate, product.saleEndDate);
    const hasEventCostPrice = product.eventCostPrice !== undefined && product.eventCostPrice !== null && product.eventCostPrice > 0;
    const hasSalePrice = product.salePrice !== undefined && product.salePrice !== null && product.salePrice > 0;
    const hasAnySalePrice = hasEventCostPrice || hasSalePrice;

    return (
        <div
            onClick={() => onClick(product)}
            className="relative overflow-hidden p-3 flex flex-col items-start gap-y-1 animate-card-enter border-b border-gray-100 last:border-b-0 cursor-pointer active:bg-gray-50 transition-colors"
            style={{ animationDelay: `${Math.min(index * 50, 500)}ms` }}
        >
            {/* Row 1: Product Name & Sale Badge */}
            <div className="flex items-start justify-between w-full gap-2">
                <p className="font-bold text-gray-800 text-lg whitespace-pre-wrap flex-grow leading-tight">{product.name}</p>
                {saleIsActive && hasAnySalePrice && (
                    <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-0.5 rounded flex-shrink-0 whitespace-nowrap mt-1">행사중</span>
                )}
            </div>
            
            {/* Row 1.5: Spec (Added) */}
            {product.spec && (
                <p className="text-sm text-gray-500 font-medium w-full">{product.spec}</p>
            )}
            
            {/* Row 2: Cost / Selling Price */}
            <div className="flex items-center gap-2 text-sm w-full mt-0.5">
                <span className="text-gray-500 font-medium">매입/판매:</span>
                <div className="flex items-center gap-1">
                    <span className={`font-semibold ${saleIsActive && hasAnySalePrice ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                        {product.costPrice?.toLocaleString()}
                    </span>
                    <span className="text-gray-400">/</span>
                    <span className={`font-semibold ${saleIsActive && hasAnySalePrice ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                        {product.sellingPrice?.toLocaleString()}
                    </span>
                </div>
            </div>

            {/* Row 3: Event Cost / Event Selling Price (Conditional) */}
            {hasAnySalePrice && (
                <div className="flex items-center gap-2 text-sm w-full">
                    <span className="text-red-500 font-bold">행사:</span>
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
            
            {/* Row 4: Event Date (Conditional) */}
            {(product.saleStartDate || product.saleEndDate) && (
                <div className="text-xs text-blue-600 font-medium w-full">
                    행사기간: {product.saleStartDate || ''} ~ {product.saleEndDate || ''}
                </div>
            )}

            {/* Row 5: Stock / BOM / Barcode */}
            <div className="flex items-center gap-3 mt-1 w-full text-sm">
                <div className="flex items-center gap-1">
                    <span className="text-gray-500">재고:</span>
                    <span className="font-bold text-teal-600">{product.stockQuantity?.toLocaleString() ?? '-'}</span>
                </div>
                {product.bomStatus === '묶음' && (
                    <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-xs font-bold">
                        묶음
                    </span>
                )}
                <span className="text-gray-400 text-xs ml-auto">{product.barcode}</span>
            </div>

            {/* Row 6: Supplier */}
            {product.supplierName && (
                <div className="text-xs text-gray-500 mt-0.5 w-full text-right">
                    {product.supplierName}
                </div>
            )}
        </div>
    );
};

const ProductInquiryPage: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const { openScanner } = useScanner();
    const { sqlStatus } = useMiscUI();
    const { showToast } = useAlert();
    
    // State for ProductEditPage modal
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [selectedBarcodeForEdit, setSelectedBarcodeForEdit] = useState<string>('');
    
    // State for new action modal
    const [actionModalOpen, setActionModalOpen] = useState(false);
    const [selectedProductForAction, setSelectedProductForAction] = useState<Product | null>(null);

    // Use manual search mode
    // We expose setResults from the hook implicitly via state update in search, but we need to override it for scan results
    const [scanResults, setScanResults] = useState<Product[] | null>(null);

    const { searchTerm, setSearchTerm, results, isSearching, searchSource, search, searchByBarcode } = useProductSearch('productInquiry', MAX_RESULTS_TO_DISPLAY);
    
    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setScanResults(null); // Clear previous scan results
        search();
    };

    const handleScan = useCallback(() => {
        openScanner(
            'product-inquiry',
            async (barcode) => {
                setSearchTerm(barcode);
                setScanResults(null); // Reset
                // Use dedicated scan query
                const product = await searchByBarcode(barcode);
                if (product) {
                    setScanResults([product]);
                } else {
                    // Fallback to regular search if specialized scan query returns nothing (though scan query is robust)
                    search(barcode);
                }
            },
            false
        );
    }, [openScanner, setSearchTerm, search, searchByBarcode]);

    const handleProductClick = useCallback((product: Product) => {
        setSelectedProductForAction(product);
        setActionModalOpen(true);
    }, []);

    const handleEditProduct = useCallback((product: Product) => {
        setSelectedBarcodeForEdit(product.barcode);
        setEditModalOpen(true);
    }, []);

    const { displayedProducts, totalFound } = useMemo(() => {
        // Prioritize scan results if available
        const currentResults = scanResults !== null ? scanResults : results;
        return {
            displayedProducts: currentResults,
            totalFound: currentResults.length
        };
    }, [results, scanResults]);
    
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
        
        if (searchSource === 'none' && !searchTerm && scanResults === null) {
             return null;
        }

        if (!isSearching && displayedProducts.length === 0 && (searchTerm || scanResults !== null)) {
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
                        <ProductCard key={product.barcode} product={product} index={index} onClick={handleProductClick} />
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
                        className="h-12 w-12 bg-blue-600 text-white rounded-xl flex items-center justify-center font-bold hover:bg-blue-700 transition active:scale-95 shadow shadow-blue-500/30 flex-shrink-0"
                        disabled={isSearching}
                        aria-label="검색"
                    >
                        <SearchIcon className="w-6 h-6" />
                    </button>
                    <button
                        type="button"
                        onClick={handleScan}
                        className="h-12 w-12 bg-gray-200 text-gray-700 rounded-xl flex items-center justify-center font-semibold hover:bg-gray-300 transition active:scale-95"
                        aria-label="바코드 스캔"
                    >
                        <BarcodeScannerIcon className="w-6 h-6" />
                    </button>
                </form>
            </div>
            <div className="scrollable-content p-3">
                <div className="max-w-2xl mx-auto w-full h-full">{renderContent()}</div>
            </div>

            <ProductActionModal
                isOpen={actionModalOpen}
                onClose={() => setActionModalOpen(false)}
                product={selectedProductForAction}
                onEdit={handleEditProduct}
            />

            {/* Nested Product Edit Modal */}
            <ProductEditPage 
                isOpen={editModalOpen}
                onClose={() => setEditModalOpen(false)}
                initialBarcode={selectedBarcodeForEdit}
            />
        </div>
    );
};

export default ProductInquiryPage;
