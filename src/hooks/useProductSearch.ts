
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
    searchByBarcode: (barcode: string) => Promise<Product | null>;
    clear: () => void;
}

export const extractParamsForQuery = (queryText: string, sourceParams: Record<string, any>) => {
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


export function useProductSearch(
    sourceSettingKey: 'newOrder' | 'productInquiry', 
    maxResults: number = 50,
    specificQueryName?: string // Optional: Force a specific user query
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
                if (specificQueryName) {
                    const userSearchQuery = userQueries.find(q => q.name === specificQueryName);
                    
                    if (userSearchQuery) {
                        const params = { kw: term, keyword: term, search: term, limit: maxResults, barcode: term };
                        const dynamicParams = extractParamsForQuery(userSearchQuery.query, params);
                        const onlineData = await executeUserQuery(userSearchQuery.name, dynamicParams, userSearchQuery.query);
                        setResults(onlineData.map(mapSqlResultToProduct));
                    } else {
                        // The required user query was not found. FALLBACK to default search instead of aborting.
                        console.warn(`User query '${specificQueryName}' not found for '${sourceSettingKey}'. Falling back to default online search.`);
                        const onlineData = await searchProductsOnline(term, maxResults);
                        setResults(onlineData.map(mapSqlResultToProduct));
                    }
                } else {
                    // Original logic for pages that don't specify a query name.
                    const targetQueryName = '상품조회';
                    const userSearchQuery = userQueries.find(q => q.name === targetQueryName);
                    
                    let onlineData;
                    if (userSearchQuery) {
                        const params = { kw: term, keyword: term, search: term, limit: maxResults, barcode: term };
                        const dynamicParams = extractParamsForQuery(userSearchQuery.query, params);
                        onlineData = await executeUserQuery(userSearchQuery.name, dynamicParams, userSearchQuery.query);
                    } else {
                        onlineData = await searchProductsOnline(term, maxResults);
                    }
                    setResults(onlineData.map(mapSqlResultToProduct));
                }
            } catch (e) {
                console.error("Online search failed:", e);
                if (dataSourceSettings.autoSwitch) {
                    setSearchSource('offline');
                    const lowercasedFilter = term.toLowerCase();
                    const filtered = products.filter(p => 
                        (p.name && p.name.toLowerCase().includes(lowercasedFilter)) || 
                        (p.barcode && p.barcode.includes(lowercasedFilter)) ||
                        (p.spec && p.spec.toLowerCase().includes(lowercasedFilter))
                    );
                    setResults(filtered.slice(0, maxResults));
                } else {
                    setResults([]);
                }
            } finally {
                setIsSearching(false);
            }
        } else {
            // Offline Mode Logic
            const lowercasedFilter = term.toLowerCase();
            const filtered = products.filter(p => 
                (p.name && p.name.toLowerCase().includes(lowercasedFilter)) || 
                (p.barcode && p.barcode.includes(lowercasedFilter)) ||
                (p.spec && p.spec.toLowerCase().includes(lowercasedFilter))
            );
            setResults(filtered.slice(0, maxResults));
            setIsSearching(false);
        }
    }, [searchTerm, products, userQueries, dataSourceSettings, sourceSettingKey, sqlStatus, maxResults, specificQueryName]);

    const searchByBarcode = useCallback(async (barcode: string): Promise<Product | null> => {
        if (!sqlStatus || sqlStatus !== 'connected') return null;
        
        try {
            if (specificQueryName) {
                const userSearchQuery = userQueries.find(q => q.name === specificQueryName);
                if (userSearchQuery) {
                    const params = { kw: barcode, keyword: barcode, search: barcode, limit: 1, barcode: barcode };
                    const dynamicParams = extractParamsForQuery(userSearchQuery.query, params);
                    const onlineData = await executeUserQuery(userSearchQuery.name, dynamicParams, userSearchQuery.query);

                    if (onlineData && onlineData.length > 0) {
                        const exactMatch = onlineData.find(p => String(p.바코드 || p.barcode) === barcode);
                        return exactMatch ? mapSqlResultToProduct(exactMatch) : mapSqlResultToProduct(onlineData[0]);
                    }
                    return null;
                } else {
                    console.warn(`Barcode search needs user query '${specificQueryName}', not found. Falling back to default search.`);
                    const onlineData = await searchProductsOnline(barcode, 1);
                    if (onlineData && onlineData.length > 0) {
                        const exactMatch = onlineData.find(p => String(p.바코드 || p.barcode) === barcode);
                        return exactMatch ? mapSqlResultToProduct(exactMatch) : mapSqlResultToProduct(onlineData[0]);
                    }
                    return null;
                }
            } else {
                // Original logic for pages without a specific query.
                let targetQueryName = '상품조회';
                const userSearchQuery = userQueries.find(q => q.name === targetQueryName);
                
                let onlineData: any[] = [];

                if (userSearchQuery) {
                    const params = { kw: barcode, keyword: barcode, search: barcode, limit: 1, barcode: barcode };
                    const dynamicParams = extractParamsForQuery(userSearchQuery.query, params);
                    onlineData = await executeUserQuery(userSearchQuery.name, dynamicParams, userSearchQuery.query);
                } else {
                    onlineData = await searchProductsOnline(barcode, 1);
                }

                if (onlineData && onlineData.length > 0) {
                    const exactMatch = onlineData.find(p => String(p.바코드 || p.barcode) === barcode);
                    return exactMatch ? mapSqlResultToProduct(exactMatch) : mapSqlResultToProduct(onlineData[0]);
                }
                return null;
            }
        } catch (e) {
            console.error("Online barcode search failed:", e);
            return null;
        }
    }, [userQueries, sqlStatus, specificQueryName, sourceSettingKey]);

    const clear = useCallback(() => {
        setSearchTerm('');
        setResults([]);
        setSearchSource('none');
    }, []);

    return { searchTerm, setSearchTerm, results, isSearching, searchSource, search, searchByBarcode, clear };
}
