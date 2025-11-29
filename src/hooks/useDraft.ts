
import { useState, useEffect, useMemo } from 'react';
import { getDraft, saveDraft, deleteDraft, Draft } from '../services/draftDbService';
import { useDebounce } from './useDebounce';

interface UseDraftReturn<T> {
    draft: T | null;
    isLoading: boolean;
    isSaved: boolean;
    save: (data: T) => void;
    remove: () => void;
}

export function useDraft<T extends Draft>(key: string, shouldSave: boolean = true): UseDraftReturn<T> {
    const [draft, setDraft] = useState<T | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [dataToSave, setDataToSave] = useState<T | null>(null);
    const [isSaved, setIsSaved] = useState(false);

    // Load draft on mount
    useEffect(() => {
        let isMounted = true;
        getDraft<T>(key).then(loadedDraft => {
            if (isMounted) {
                if (loadedDraft) {
                    setDraft(loadedDraft);
                }
                setIsLoading(false);
            }
        }).catch(err => {
            console.error(`Failed to load draft for key ${key}:`, err);
            if (isMounted) setIsLoading(false);
        });

        return () => { isMounted = false; };
    }, [key]);

    // Debounce the data to be saved
    const debouncedData = useDebounce(dataToSave, 500);

    // Save or delete draft based on debounced data
    useEffect(() => {
        if (isLoading || !shouldSave) return;

        if (debouncedData) {
            saveDraft(key, debouncedData)
                .then(() => setIsSaved(true))
                .catch(err => console.warn(`Could not save draft ${key}:`, err));
        }
    }, [debouncedData, key, isLoading, shouldSave]);

    const save = (data: T) => {
        setDataToSave(data);
        setIsSaved(false);
    };

    const remove = () => {
        deleteDraft(key)
            .then(() => {
                setDraft(null);
                setDataToSave(null);
            })
            .catch(err => console.warn(`Could not delete draft ${key}:`, err));
    };

    return { draft, isLoading, isSaved, save, remove };
}
