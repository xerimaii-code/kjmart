
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Customer } from '../types';
import { useLocalStorage } from './useLocalStorage';

interface CustomerUsageMap {
    [comcode: string]: number;
}

export function useSortedCustomers(customers: Customer[]) {
    const [usageMap, setUsageMap] = useLocalStorage<CustomerUsageMap>('customer_usage_frequency', {});

    const recordUsage = useCallback((comcode: string) => {
        setUsageMap(prev => {
            const current = prev || {};
            return {
                ...current,
                [comcode]: (current[comcode] || 0) + 1
            };
        });
    }, [setUsageMap]);

    const sortedCustomers = useMemo(() => {
        if (!customers) return [];
        
        // Create a shallow copy to sort
        return [...customers].sort((a, b) => {
            const usageA = usageMap?.[a.comcode] || 0;
            const usageB = usageMap?.[b.comcode] || 0;

            // 1. Sort by usage frequency (Descending)
            if (usageA !== usageB) {
                return usageB - usageA;
            }

            // 2. Sort by name (Ascending) - Standard Korean sorting
            return a.name.localeCompare(b.name);
        });
    }, [customers, usageMap]);

    return { sortedCustomers, recordUsage };
}
