import { useState, useEffect, useRef, useCallback } from 'react';
import { getDraft, saveDraft, deleteDraft, Draft } from '../services/draftDbService';

export interface UseDraftReturn<T> {
    draft: T | null;
    isLoading: boolean;
    status: 'loading' | 'idle' | 'saving' | 'saved';
    save: (data: T) => void;
    remove: () => void;
}

export function useDraft<T extends Draft>(key: string, shouldSave: boolean = true): UseDraftReturn<T> {
    const [draft, setDraft] = useState<T | null>(null);
    const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved'>('loading');
    
    const latestDataRef = useRef<T | null>(null);
    const isDirtyRef = useRef(false);
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Load draft on mount
    useEffect(() => {
        let isMounted = true;
        setStatus('loading');
        
        const load = async () => {
            try {
                const loadedDraft = await getDraft<T>(key);
                if (isMounted) {
                    if (loadedDraft) {
                        setDraft(loadedDraft);
                        latestDataRef.current = loadedDraft;
                    }
                    setStatus('idle');
                }
            } catch (err) {
                console.error(`Failed to load draft for key ${key}:`, err);
                if (isMounted) setStatus('idle');
            }
        };
        
        load();
        return () => { isMounted = false; };
    }, [key]);

    const performSave = useCallback(async (data: T) => {
        try {
            await saveDraft(key, data);
            if (isDirtyRef.current && JSON.stringify(latestDataRef.current) === JSON.stringify(data)) {
                setStatus('saved');
                isDirtyRef.current = false;
            }
        } catch (err) {
            console.warn(`Could not save draft ${key}:`, err);
            setStatus('idle');
        }
    }, [key]);

    const save = useCallback((data: T) => {
        if (!shouldSave) return;
        
        // Deep compare (simple JSON)
        const dataStr = JSON.stringify(data);
        const latestStr = JSON.stringify(latestDataRef.current);
        
        if (dataStr === latestStr) return;

        latestDataRef.current = data;
        isDirtyRef.current = true;
        setStatus('saving');

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = setTimeout(() => {
            performSave(data);
        }, 800); // Reduced delay for faster saving
    }, [performSave, shouldSave]);

    const remove = useCallback(() => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        isDirtyRef.current = false;
        latestDataRef.current = null;
        
        deleteDraft(key)
            .then(() => {
                setDraft(null);
                setStatus('idle');
            })
            .catch(err => console.warn(`Could not delete draft ${key}:`, err));
    }, [key]);

    // Flush on unmount: If there are unsaved changes, save immediately.
    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
            if (isDirtyRef.current && latestDataRef.current) {
                saveDraft(key, latestDataRef.current).catch(e => console.error("Unmount save failed", e));
            }
        };
    }, [key]);

    return { draft, isLoading: status === 'loading', status, save, remove };
}