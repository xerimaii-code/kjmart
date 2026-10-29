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
    specificQueryName?: string,
    options?: { forceOnline?: boolean; strictOnline?: boolean }
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
        
        if (!term || term.length < 1) {
            setResults([]);
            setSearchSource('none');
            setIsSearching(false);
            return;
        }

        const isStrictOnline = !!options?.strictOnline;
        const preferredSource = dataSourceSettings[sourceSettingKey];
        const canGoOnline = sqlStatus === 'connected';
        const isInquiryOrForced = sourceSettingKey === 'productInquiry' || !!options?.forceOnline || isStrictOnline;
        const useOnline = canGoOnline && (isInquiryOrForced || preferredSource === 'online');

        // [중요] 윈포스 조회 후 다시 윈포스에 영향을 주는 메뉴(재고실사, 행사등록/관리 등 strictOnline=true)는
        // 오프라인 상태에서 로컬 캐시 데이터를 절대 보여주지 않고 차단합니다.
        if (isStrictOnline && !canGoOnline) {
            setResults([]);
            setSearchSource('none');
            setIsSearching(false);
            return;
        }

        const lowercasedFilter = term.toLowerCase();
        const localResults = isStrictOnline ? [] : products.filter(p => 
            (p.name && p.name.toLowerCase().includes(lowercasedFilter)) || 
            (p.barcode && p.barcode.includes(lowercasedFilter)) ||
            (p.spec && p.spec.toLowerCase().includes(lowercasedFilter))
        );

        if (!useOnline) {
            setResults(localResults.slice(0, maxResults));
            setSearchSource('offline');
            setIsSearching(false);
            return;
        }

        // 온라인(서버) 검색 실행
        setIsSearching(true);
        if (!isStrictOnline) {
            setResults(localResults.slice(0, maxResults));
            setSearchSource('offline');
        }

        try {
            let onlineData;
            const userSearchQuery = specificQueryName
                ? (userQueries.find(q => q.name === specificQueryName) || userQueries.find(q => q.name === '상품조회'))
                : userQueries.find(q => q.name === '상품조회');

            if (userSearchQuery && userSearchQuery.query) {
                const params = { kw: term, keyword: term, search: term, limit: maxResults, barcode: term };
                const dynamicParams = extractParamsForQuery(userSearchQuery.query, params);
                onlineData = await executeUserQuery(userSearchQuery.name, dynamicParams, userSearchQuery.query);
            } else {
                onlineData = await searchProductsOnline(term, maxResults);
            }
            
            const mappedResults = onlineData.map(mapSqlResultToProduct);
            setResults(mappedResults);
            setSearchSource('online');
        } catch (e) {
            console.error("Online search failed:", e);
            if (isStrictOnline) {
                setResults([]);
                setSearchSource('none');
            }
        } finally {
            setIsSearching(false);
        }
    }, [searchTerm, products, userQueries, dataSourceSettings, sourceSettingKey, sqlStatus, maxResults, specificQueryName, options]);

    const searchByBarcode = useCallback(async (barcode: string): Promise<Product | null> => {
        const cleanBarcode = barcode.trim();
        const isStrictOnline = !!options?.strictOnline;
        const localMatch = isStrictOnline ? null : (products.find(p => p.barcode === cleanBarcode) || null);
        const preferredSource = dataSourceSettings[sourceSettingKey];
        const canGoOnline = sqlStatus === 'connected';
        const isInquiryOrForced = sourceSettingKey === 'productInquiry' || !!options?.forceOnline || isStrictOnline;

        // strictOnline 메뉴는 SQL 서버 미연결 시 무조건 null 반환 (로컬 데이터 사용 금지)
        if (isStrictOnline && !canGoOnline) {
            return null;
        }

        // 1. 발주/입고('newOrder')에서 '로컬'('offline')로 설정된 경우:
        if (!isInquiryOrForced && preferredSource === 'offline') {
            if (localMatch) {
                return localMatch;
            }
            if (!canGoOnline) {
                return null;
            }
        }

        // 2. SQL 서버가 꺼져 있는 경우:
        if (!canGoOnline) {
            return localMatch;
        }
        
        // 3. 온라인(서버) 바코드 조회
        try {
            const params = { barcode: cleanBarcode, kw: cleanBarcode };
            const scanQuery = userQueries.find(q => q.name === 'productScan' || q.name === '상품스캔');
            
            let onlineData;
            if (scanQuery && scanQuery.query) {
                const dynamicParams = extractParamsForQuery(scanQuery.query, params);
                onlineData = await executeUserQuery(scanQuery.name, dynamicParams, scanQuery.query);
            } else {
                onlineData = await searchProductsOnline(cleanBarcode, 5);
            }

            if (onlineData && onlineData.length > 0) {
                const exactMatch = onlineData.find(p => String(p.바코드 || p.barcode || '').trim() === cleanBarcode);
                if (exactMatch) return mapSqlResultToProduct(exactMatch);
                return mapSqlResultToProduct(onlineData[0]);
            }
            if (isStrictOnline) return null;
        } catch (e) {
            console.error("Online barcode search failed:", e);
            if (isStrictOnline) {
                throw e;
            }
        }

        return localMatch;
    }, [sqlStatus, products, userQueries, dataSourceSettings, sourceSettingKey, options]);

    const clear = useCallback(() => {
        setSearchTerm('');
        setResults([]);
        setSearchSource('none');
    }, []);

    return { searchTerm, setSearchTerm, results, isSearching, searchSource, search, searchByBarcode, clear };
}
