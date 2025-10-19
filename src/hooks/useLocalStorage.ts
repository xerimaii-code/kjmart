import { useState, useCallback } from 'react';
import { getDeviceId } from '../services/deviceService';

/**
 * A custom hook to manage state with localStorage, enabling persistent state across sessions.
 * @param key The key to use in localStorage.
 * @param initialValue The initial value to use if no value is found in localStorage.
 * @param options An optional object. Set `deviceSpecific: true` to prefix the key with a unique device ID.
 * @returns A stateful value, and a function to update it.
 */
export function useLocalStorage<T>(key: string, initialValue: T | null, options?: { deviceSpecific?: boolean }): [T | null, (value: T | null) => void] {
    
    const getFinalKey = useCallback(() => {
        return options?.deviceSpecific ? `${getDeviceId()}:${key}` : key;
    }, [key, options]);
    
    const [storedValue, setStoredValue] = useState<T | null>(() => {
        if (typeof window === 'undefined') {
            return initialValue;
        }
        try {
            const finalKey = getFinalKey();
            const item = window.localStorage.getItem(finalKey);
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
            const finalKey = getFinalKey();
            if (value === null) {
                window.localStorage.removeItem(finalKey);
            } else {
                window.localStorage.setItem(finalKey, JSON.stringify(value));
            }
            setStoredValue(value);
        } catch (error) {
            console.error(`Error setting localStorage key “${key}”:`, error);
        }
    }, [key, getFinalKey]);

    return [storedValue, setValue];
}
