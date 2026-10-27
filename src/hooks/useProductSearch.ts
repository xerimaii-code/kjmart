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
        
        if (!term || term.length < 1) {
            setResults([]);
            setSearchSource('none');
            setIsSearching(false);
            return;
        }

        const preferredSource = dataSourceSettings[sourceSettingKey];
        const canGoOnline = sqlStatus === 'connected';
        // 'productInquiry'(상품조회, 재고실사, 행사관리 등) 또는 forceOnline인 경우 SQL이 켜져 있으면 무조건 서버 접속
        // 'newOrder'(발주, 입고)인 경우 설정이 'online'(서버)이고 SQL이 켜져 있을 때만 서버 접속 ('offline'(로컬) 설정 시 로컬 데이터만 사용)
        const isInquiryOrForced = sourceSettingKey === 'productInquiry' || !!options?.forceOnline;
        const useOnline = canGoOnline && (isInquiryOrForced || preferredSource === 'online');

        // 1. 로컬 데이터 즉시 검색 (오프라인이거나, 온라인 응답 전 빠른 피드백용)
        const lowercasedFilter = term.toLowerCase();
        const localResults = products.filter(p => 
            (p.name && p.name.toLowerCase().includes(lowercasedFilter)) || 
            (p.barcode && p.barcode.includes(lowercasedFilter)) ||
            (p.spec && p.spec.toLowerCase().includes(lowercasedFilter))
        );

        if (!useOnline) {
            // 로컬 전용 모드이거나 SQL 서버가 꺼져 있는 경우: SQL 접속 없이 로컬 데이터로만 즉시 처리 완료
            setResults(localResults.slice(0, maxResults));
            setSearchSource('offline');
            setIsSearching(false);
            return;
        }

        // 2. 온라인(서버) 검색 실행
        setIsSearching(true);
        setResults(localResults.slice(0, maxResults));
        setSearchSource('offline');

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
            console.error("Online search failed, keeping local results:", e);
            // 서버 오류 시 이미 표시된 로컬 결과 유지
        } finally {
            setIsSearching(false);
        }
    }, [searchTerm, products, userQueries, dataSourceSettings, sourceSettingKey, sqlStatus, maxResults, specificQueryName, options]);

    const searchByBarcode = useCallback(async (barcode: string): Promise<Product | null> => {
        const cleanBarcode = barcode.trim();
        const localMatch = products.find(p => p.barcode === cleanBarcode) || null;
        const preferredSource = dataSourceSettings[sourceSettingKey];
        const canGoOnline = sqlStatus === 'connected';
        const isInquiryOrForced = sourceSettingKey === 'productInquiry' || !!options?.forceOnline;

        // 1. 발주/입고('newOrder')에서 '로컬'('offline')로 설정된 경우:
        //    - 로컬에 데이터가 있으면 SQL 접속 없이 즉시 로컬 데이터 반환
        //    - 로컬에 데이터가 없으면: 서버가 켜져 있을 때만(canGoOnline) 스캔 시 서버 접속, 서버가 꺼져 있으면 서버 접속 안 함
        if (!isInquiryOrForced && preferredSource === 'offline') {
            if (localMatch) {
                return localMatch;
            }
            if (!canGoOnline) {
                return null;
            }
            // 로컬에 없고 SQL 서버가 켜져 있는 경우에만 아래 온라인 스캔 조회로 진행
        }

        // 2. SQL 서버가 꺼져 있는 경우: 서버 접속 시도 없이 로컬 매칭 결과(또는 null) 즉시 반환
        if (!canGoOnline) {
            return localMatch;
        }
        
        // 3. 온라인(서버) 바코드 조회 (서버 모드이거나, 상품조회/재고실사 메뉴이거나, 로컬 모드에서 미등록 바코드를 스캔한 경우)
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
        } catch (e) {
            console.error("Online barcode search failed, falling back to local:", e);
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
