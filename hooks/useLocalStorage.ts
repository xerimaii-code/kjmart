import { useState, useCallback } from 'react';

/**
 * A custom hook to manage state with localStorage, enabling persistent state across sessions.
 * @param key The key to use in localStorage.
 * @param initialValue The initial value to use if no value is found in localStorage.
 * @returns A stateful value, and a function to update it.
 */
export function useLocalStorage<T>(key: string, initialValue: T | null): [T | null, (value: T | null) => void] {
    const [storedValue, setStoredValue] = useState<T | null>(() => {
        if (typeof window === 'undefined') {
            return initialValue;
        }
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error) {
            console.error(`Error reading localStorage key “${key}”:`, error);
            return initialValue;
        }
    });

    const setValue = useCallback((value: T | null) => {
        if (typeof window === 'undefined') {
            console.warn(`Tried to set localStorage key “${key}” even though no window was found`);
            return;
        }

        try {
            if (value === null) {
                window.localStorage.removeItem(key);
            } else {
                window.localStorage.setItem(key, JSON.stringify(value));
            }
            setStoredValue(value);
        } catch (error) {
            console.error(`Error setting localStorage key “${key}”:`, error);
        }
    }, [key]);

    return [storedValue, setValue];
}
