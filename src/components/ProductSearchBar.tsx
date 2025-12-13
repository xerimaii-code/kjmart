
import React, { useRef } from 'react';
import { SearchIcon, SpinnerIcon, BarcodeScannerIcon } from './Icons';
import ToggleSwitch from './ToggleSwitch';
import SearchDropdown from './SearchDropdown';
import ProductSearchResultItem from '../context/ProductSearchResultItem';
import { Product } from '../types';

interface ProductSearchBarProps {
    searchTerm: string;
    onSearchTermChange: (term: string) => void;
    isSearching: boolean;
    results: Product[];
    onSelectProduct: (product: Product) => void;
    onScan: () => void;
    isBoxUnit: boolean;
    onBoxUnitChange: (checked: boolean) => void;
    placeholder?: string;
    showBoxToggle?: boolean;
    autoFocus?: boolean;
}

const ProductSearchBar: React.FC<ProductSearchBarProps> = ({
    searchTerm,
    onSearchTermChange,
    isSearching,
    results,
    onSelectProduct,
    onScan,
    isBoxUnit,
    onBoxUnitChange,
    placeholder = "품목명 또는 바코드 검색",
    showBoxToggle = true,
    autoFocus = false
}) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const blurTimeoutRef = useRef<number | null>(null);
    const [showDropdown, setShowDropdown] = React.useState(false);

    const handleSelect = (product: Product) => {
        onSelectProduct(product);
        setShowDropdown(false);
        inputRef.current?.blur();
    };

    return (
        <div className="flex items-stretch gap-2 w-full max-w-2xl mx-auto">
            <div className="relative flex-grow">
                <input
                    ref={inputRef}
                    type="text"
                    value={searchTerm}
                    onChange={(e) => onSearchTermChange(e.target.value)}
                    onFocus={() => {
                        if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
                        setShowDropdown(true);
                    }}
                    onBlur={() => {
                        blurTimeoutRef.current = window.setTimeout(() => setShowDropdown(false), 200);
                    }}
                    placeholder={placeholder}
                    className="w-full px-3 h-11 border border-gray-300 bg-white rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder:text-gray-400 transition-colors duration-200 text-base pr-28"
                    autoComplete="off"
                    autoFocus={autoFocus}
                />
                
                <div className="absolute top-1/2 right-2 -translate-y-1/2 flex items-center">
                    {isSearching && <SpinnerIcon className="w-5 h-5 text-blue-500 mr-2" />}
                    {showBoxToggle && (
                        <ToggleSwitch 
                            id="search-bar-box-unit" 
                            label="박스" 
                            checked={isBoxUnit} 
                            onChange={onBoxUnitChange} 
                            color="blue" 
                        />
                    )}
                </div>

                <SearchDropdown<Product>
                    items={results}
                    renderItem={(p) => <ProductSearchResultItem product={p} onClick={handleSelect} />}
                    show={showDropdown && results.length > 0}
                />
            </div>
            
            <button 
                onClick={onScan} 
                className="w-11 h-11 bg-blue-600 text-white rounded-lg flex items-center justify-center font-bold hover:bg-blue-700 transition active:scale-95 shadow shadow-blue-500/30 flex-shrink-0"
                aria-label="스캔"
            >
                <BarcodeScannerIcon className="w-6 h-6" />
            </button>
        </div>
    );
};

export default ProductSearchBar;
