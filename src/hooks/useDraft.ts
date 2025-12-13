
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
    
    // Refs to keep track of latest data and dirty state without triggering re-renders
    const latestDataRef = useRef<T | null>(null);
    const isDirtyRef = useRef(false);
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Load draft on mount
    useEffect(() => {
        let isMounted = true;
        setStatus('loading');
        getDraft<T>(key).then(loadedDraft => {
            if (isMounted) {
                if (loadedDraft) {
                    setDraft(loadedDraft);
                    latestDataRef.current = loadedDraft; // Initialize ref
                }
                setStatus('idle');
            }
        }).catch(err => {
            console.error(`Failed to load draft for key ${key}:`, err);
            if (isMounted) setStatus('idle');
        });
        return () => { isMounted = false; };
    }, [key]);

    // Internal save function
    const performSave = useCallback(async (data: T) => {
        try {
            await saveDraft(key, data);
            setStatus('saved');
            isDirtyRef.current = false;
        } catch (err) {
            console.warn(`Could not save draft ${key}:`, err);
            setStatus('idle');
        }
    }, [key]);

    const save = useCallback((data: T) => {
        if (!shouldSave) return;
        
        // Deep compare roughly (JSON stringify is cheap enough for this app's data size)
        if (JSON.stringify(data) === JSON.stringify(latestDataRef.current)) return;

        latestDataRef.current = data;
        isDirtyRef.current = true;
        setStatus('saving');

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        // Debounce save by 1000ms
        saveTimeoutRef.current = setTimeout(() => {
            performSave(data);
        }, 1000);
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
                // Fire and forget save on unmount
                saveDraft(key, latestDataRef.current).catch(e => console.error("Unmount save failed", e));
            }
        };
    }, [key]);

    return { draft, isLoading: status === 'loading', status, save, remove };
}
