
import { useState, useEffect, useCallback } from 'react';
import { Product } from '../types';
import { useDataState, useDeviceSettings, useMiscUI } from '../context/AppContext';
import { searchProductsOnline } from '../services/sqlService';
import { mapSqlResultToProduct } from '../utils/mapper';
import { useDebounce } from './useDebounce';

interface UseProductSearchReturn {
    searchTerm: string;
    setSearchTerm: (term: string) => void;
    results: Product[];
    isSearching: boolean;
    searchSource: 'offline' | 'online' | 'none';
}

export function useProductSearch(sourceSettingKey: 'newOrder' | 'productInquiry', maxResults: number = 50): UseProductSearchReturn {
    const { products } = useDataState();
    const { dataSourceSettings } = useDeviceSettings();
    const { sqlStatus } = useMiscUI();
    
    const [searchTerm, setSearchTerm] = useState('');
    const [results, setResults] = useState<Product[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [searchSource, setSearchSource] = useState<'offline' | 'online' | 'none'>('none');

    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    useEffect(() => {
        const term = debouncedSearchTerm.trim();
        if (!term || term.length < 2) {
            setResults([]);
            setSearchSource('none');
            setIsSearching(false);
            return;
        }

        const search = async () => {
            const preferredSource = dataSourceSettings[sourceSettingKey];
            const canGoOnline = sqlStatus === 'connected';
            const useOnline = preferredSource === 'online' && canGoOnline;

            setIsSearching(true);
            setSearchSource(useOnline ? 'online' : 'offline');

            if (useOnline) {
                try {
                    // Pass maxResults as limit to the API to optimize bandwidth and memory
                    const onlineData = await searchProductsOnline(term, maxResults);
                    setResults(onlineData.map(mapSqlResultToProduct));
                } catch (e) {
                    console.error("Online search failed:", e);
                    // Fallback to offline if autoSwitch is enabled
                    if (dataSourceSettings.autoSwitch) {
                        setSearchSource('offline');
                        const lowercasedFilter = term.toLowerCase();
                        const filtered = products.filter(p => 
                            p.name.toLowerCase().includes(lowercasedFilter) || 
                            p.barcode.includes(lowercasedFilter)
                        ).slice(0, maxResults);
                        setResults(filtered);
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
                    p.barcode.includes(lowercasedFilter)
                ).slice(0, maxResults);
                setResults(filtered);
                setIsSearching(false);
            }
        };

        search();
    }, [debouncedSearchTerm, products, dataSourceSettings, sourceSettingKey, sqlStatus, maxResults]);

    return { searchTerm, setSearchTerm, results, isSearching, searchSource };
}
