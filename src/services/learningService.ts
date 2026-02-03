import { getValue } from './dbService';
import { getSetting, setSetting } from './cacheDbService';

const LEARNING_CONTEXT_CACHE_KEY = 'learningContext';

interface LearningItem {
    id: string;
    title: string;
    content: string;
}

/**
 * Fetches the latest learning context from Firebase and caches it locally.
 * If Firebase is unavailable, it returns the cached version.
 * @returns {Promise<string>} A string containing the formatted learning context for the AI.
 */
export async function getLearningContext(): Promise<string> {
    try {
        // Try to fetch from Firebase first
        const data = await getValue<string | { [key: string]: Omit<LearningItem, 'id'> }>('learning/sqlContext', '');
        
        let contextString = '';
        if (typeof data === 'string') {
            contextString = data;
        } else if (typeof data === 'object' && data !== null) {
            contextString = Object.values(data)
                .map((item: any) => `Title: ${item.title}\nContent: ${item.content}`)
                .join('\n\n');
        }
        
        // If successful, update the cache
        await setSetting(LEARNING_CONTEXT_CACHE_KEY, contextString);
        return contextString;

    } catch (error) {
        console.warn("Could not fetch learning context from Firebase. Falling back to cache.", error);
        
        // If Firebase fails, try to get it from the local cache
        const cachedContext = await getSetting<string>(LEARNING_CONTEXT_CACHE_KEY);
        return cachedContext || 'No context available.';
    }
}
