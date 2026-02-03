/**
 * Generates and retrieves a unique, persistent identifier for the current device/browser.
 * It attempts to use localStorage for persistence across sessions.
 * @returns A unique device identifier string (UUID v4).
 */
export const getDeviceId = (): string => {
    const DEVICE_ID_KEY = 'app-device-id';
    try {
        let storedId = localStorage.getItem(DEVICE_ID_KEY);
        if (!storedId) {
            // Simple UUID v4 generator
            storedId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                var r = (Math.random() * 16) | 0,
                    v = c === 'x' ? r : (r & 0x3) | 0x8;
                return v.toString(16);
            });
            localStorage.setItem(DEVICE_ID_KEY, storedId);
        }
        return storedId;
    } catch (error) {
        console.error("Failed to access localStorage for device ID:", error);
        // Fallback for environments where localStorage is not available (e.g., private browsing on some browsers)
        // This will not be persistent across sessions, but will be consistent for the current session.
        if (!(window as any)._sessionDeviceId) {
             (window as any)._sessionDeviceId = 'session-' + Date.now() + '-' + Math.random().toString(36).substring(2, 15);
        }
        return (window as any)._sessionDeviceId;
    }
};