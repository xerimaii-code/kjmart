
import { useState, useCallback } from 'react';
import { Product } from '../types';
import { useDataState, useDeviceSettings, useMiscUI } from '../context/AppContext';
import { searchProductsOnline, executeUserQuery, extractParamsForQuery } from '../services/sqlService';
import { mapSqlResultToProduct } from '../utils/mapper';

interface UseProductSearchReturn {
    searchTerm: string;
    setSearchTerm: (term: string) => void;
    results: Product[];
    isSearching: boolean;
    searchSource: 'offline' | 'online' | 'none';
    search: (term?: string) => Promise<void>;
    searchByBarcode: (barcode: string) => Promise<Product | null>;
    clear: () => void;
}

export function useProductSearch(
    sourceSettingKey: 'newOrder' | 'productInquiry', 
    maxResults: number = 50,
    specificQueryName?: string, // Optional: Force a specific user query
    options?: { forceOnline?: boolean }
): UseProductSearchReturn {
    const { products, userQueries } = useDataState();
    const { dataSourceSettings } = useDeviceSettings();
    const { sqlStatus } = useMiscUI();
    
    const [searchTerm, setSearchTerm] = useState('');
    const [results, setResults] = useState<Product[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [searchSource, setSearchSource] = useState<'offline' | 'online' | 'none'>('none');

    const search = useCallback(async (manualTerm?: string) => {
        const term = (manualTerm !== undefined ? manualTerm : searchTerm).trim();
        
        if (!term || term.length < 1) { // Allow single character search for speed
            setResults([]);
            setSearchSource('none');
            setIsSearching(false);
            return;
        }

        setIsSearching(true);

        // 1. Perform local search first for instant results
        const lowercasedFilter = term.toLowerCase();
        const localResults = products.filter(p => 
            (p.name && p.name.toLowerCase().includes(lowercasedFilter)) || 
            (p.barcode && p.barcode.includes(lowercasedFilter)) ||
            (p.spec && p.spec.toLowerCase().includes(lowercasedFilter))
        );
        setResults(localResults.slice(0, maxResults));
        setSearchSource('offline'); // Initially, we are showing offline results

        // 2. Determine if an online search should follow
        const preferredSource = dataSourceSettings[sourceSettingKey];
        const canGoOnline = sqlStatus === 'connected';
        const isProductInquiry = sourceSettingKey === 'productInquiry';
        const useOnline = (isProductInquiry && canGoOnline) || (options?.forceOnline && canGoOnline) || (preferredSource === 'online' && canGoOnline);
        
        if (useOnline) {
            try {
                // 3. Perform online search in the background
                let onlineData;
                const userSearchQuery = specificQueryName ? userQueries.find(q => q.name === specificQueryName) : userQueries.find(q => q.name === '상품조회');

                if (userSearchQuery) {
                    const params = { kw: term, keyword: term, search: term, limit: maxResults, barcode: term };
                    const dynamicParams = extractParamsForQuery(userSearchQuery.query, params);
                    onlineData = await executeUserQuery(userSearchQuery.name, dynamicParams, userSearchQuery.query);
                } else {
                    if (specificQueryName) {
                        console.warn(`User query '${specificQueryName}' not found for '${sourceSettingKey}'. Falling back to default online search.`);
                    }
                    onlineData = await searchProductsOnline(term, maxResults);
                }
                
                // 4. Update results with fresh data from the server
                const mappedResults = onlineData.map(mapSqlResultToProduct);
                setResults(mappedResults);
                setSearchSource('online');

            } catch (e) {
                console.error("Online search fallback failed, showing local results:", e);
                // If online fails, the user still sees the local results. The source remains 'offline'.
            } finally {
                setIsSearching(false);
            }
        } else {
            // If not going online, the local search is all we do.
            setIsSearching(false);
        }
    }, [searchTerm, products, userQueries, dataSourceSettings, sourceSettingKey, sqlStatus, maxResults, specificQueryName, options]);

    const searchByBarcode = useCallback(async (barcode: string): Promise<Product | null> => {
        // Prioritize local search for immediate feedback in scan scenarios
        const localMatch = products.find(p => p.barcode === barcode);
        if(localMatch) return localMatch;

        if (sqlStatus !== 'connected') return null;
        
        try {
            const params = { barcode: barcode };
            const onlineData = await executeUserQuery('productScan', params);

            if (onlineData && onlineData.length > 0) {
                const exactMatch = onlineData.find(p => String(p.바코드 || p.barcode) === barcode);
                return exactMatch ? mapSqlResultToProduct(exactMatch) : mapSqlResultToProduct(onlineData[0]);
            }
            return null;
        } catch (e) {
            console.error("Online barcode search failed:", e);
            return null;
        }
    }, [sqlStatus, products]);

    const clear = useCallback(() => {
        setSearchTerm('');
        setResults([]);
        setSearchSource('none');
    }, []);

    return { searchTerm, setSearchTerm, results, isSearching, searchSource, search, searchByBarcode, clear };
}
