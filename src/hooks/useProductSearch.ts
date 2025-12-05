
import { useState, useCallback } from 'react';
import { Product } from '../types';
import { useDataState, useDeviceSettings, useMiscUI } from '../context/AppContext';
import { searchProductsOnline, executeUserQuery } from '../services/sqlService';
import { mapSqlResultToProduct } from '../utils/mapper';

interface UseProductSearchReturn {
    searchTerm: string;
    setSearchTerm: (term: string) => void;
    results: Product[];
    isSearching: boolean;
    searchSource: 'offline' | 'online' | 'none';
    search: (term?: string) => Promise<void>;
    clear: () => void;
}

// Helper to extract params (same as in ProductEditPage to keep consistent behavior)
const extractParamsForQuery = (queryText: string, sourceParams: Record<string, any>) => {
    const matches = Array.from(queryText.matchAll(/@([a-zA-Z0-9_가-힣]+)/g), m => m[1]);
    const uniqueVars = [...new Set(matches)];
    const lookup: Record<string, any> = {};
    Object.keys(sourceParams).forEach(k => {
        lookup[k.toLowerCase()] = sourceParams[k];
    });
    const finalParams: Record<string, any> = {};
    uniqueVars.forEach(v => {
        const lowerV = v.toLowerCase();
        if (lookup[lowerV] !== undefined) {
            finalParams[v] = lookup[lowerV];
        }
    });
    return finalParams;
};

export function useProductSearch(sourceSettingKey: 'newOrder' | 'productInquiry', maxResults: number = 50): UseProductSearchReturn {
    const { products, userQueries } = useDataState();
    const { dataSourceSettings } = useDeviceSettings();
    const { sqlStatus } = useMiscUI();
    
    const [searchTerm, setSearchTerm] = useState('');
    const [results, setResults] = useState<Product[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [searchSource, setSearchSource] = useState<'offline' | 'online' | 'none'>('none');

    const search = useCallback(async (manualTerm?: string) => {
        const term = (manualTerm !== undefined ? manualTerm : searchTerm).trim();
        
        if (!term || term.length < 2) {
            setResults([]);
            setSearchSource('none');
            setIsSearching(false);
            return;
        }

        const preferredSource = dataSourceSettings[sourceSettingKey];
        const canGoOnline = sqlStatus === 'connected';
        const useOnline = preferredSource === 'online' && canGoOnline;

        setIsSearching(true);
        setSearchSource(useOnline ? 'online' : 'offline');

        if (useOnline) {
            try {
                // Check if user defined query '상품조회' exists
                const userSearchQuery = userQueries.find(q => q.name === '상품조회');
                let onlineData: any[] = [];

                if (userSearchQuery) {
                    // Use dynamic param extraction with comprehensive aliases for compatibility
                    const contextParams = {
                        kw: term, keyword: term, search: term, 
                        
                        barcode: term, 
                        name: term, 
                        Descr: term, // Explicitly requested capitalized alias
                        descr: term,
                        spec: term,
                        
                        상품명: term, 바코드: term, 검색어: term, 규격: term
                    };
                    const dynamicParams = extractParamsForQuery(userSearchQuery.query, contextParams);
                    
                    onlineData = await executeUserQuery('상품조회', dynamicParams, userSearchQuery.query);
                } else {
                    // Fallback to default system query if user query not found
                    onlineData = await searchProductsOnline(term, maxResults);
                }
                
                setResults(onlineData.map(mapSqlResultToProduct));
            } catch (e) {
                console.error("Online search failed:", e);
                // Fallback to offline if autoSwitch is enabled
                if (dataSourceSettings.autoSwitch) {
                    setSearchSource('offline');
                    const lowercasedFilter = term.toLowerCase();
                    const filtered = products.filter(p => 
                        p.name.toLowerCase().includes(lowercasedFilter) || 
                        p.barcode.includes(lowercasedFilter) ||
                        (p.spec && p.spec.toLowerCase().includes(lowercasedFilter))
                    );
                    
                    // Sort to match online behavior: Exact barcode match first
                    filtered.sort((a, b) => {
                        const aExact = a.barcode === term;
                        const bExact = b.barcode === term;
                        if (aExact && !bExact) return -1;
                        if (!aExact && bExact) return 1;
                        return a.name.localeCompare(b.name);
                    });

                    setResults(filtered.slice(0, maxResults));
                } else {
                    setResults([]);
                }
            } finally {
                setIsSearching(false);
            }
        } else {
            const lowercasedFilter = term.toLowerCase();
            const filtered = products.filter(p => 
                p.name.toLowerCase().includes(lowercasedFilter) || 
                p.barcode.includes(lowercasedFilter) ||
                (p.spec && p.spec.toLowerCase().includes(lowercasedFilter))
            );

            // Sort to match online behavior: Exact barcode match first, then alphabetical
            filtered.sort((a, b) => {
                const aExact = a.barcode === term;
                const bExact = b.barcode === term;
                if (aExact && !bExact) return -1;
                if (!aExact && bExact) return 1;
                return a.name.localeCompare(b.name);
            });

            setResults(filtered.slice(0, maxResults));
            setIsSearching(false);
        }
    }, [searchTerm, products, dataSourceSettings, sourceSettingKey, sqlStatus, maxResults, userQueries]);

    const clear = useCallback(() => {
        setSearchTerm('');
        setResults([]);
        setSearchSource('none');
    }, []);

    return { searchTerm, setSearchTerm, results, isSearching, searchSource, search, clear };
}
