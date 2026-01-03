// src/config.ts

/**
 * Known hostnames for the development environment.
 * The app will activate "Developer Mode" (minimal data sync) if the
 * current hostname matches one of these.
 */
const DEVELOPMENT_HOSTNAMES = [
    'localhost',
    '127.0.0.1',
    'aistudio.google.com',
];

/**
 * Checks if the current environment is a development environment.
 * It checks against a list of known hostnames and also looks for patterns
 * typical of hosted development environments like AI Studio.
 * This is now more robust by checking ancestor origins for iframes.
 *
 * @returns {boolean} True if the app is running in a development environment.
 */
function detectDeveloperMode(): boolean {
    if (typeof window === 'undefined') {
        // Assume non-browser (e.g., server-side rendering, testing) is not dev mode by default.
        return false;
    }

    const hostname = window.location.hostname;

    // 1. Check for standard local development hostnames.
    if (DEVELOPMENT_HOSTNAMES.includes(hostname)) {
        return true;
    }
    
    // 2. Check for patterns common in Google's hosted environments (like AI Studio's preview frames).
    if (hostname.includes('googleusercontent.com') || hostname.includes('usercontent.goog')) {
        return true;
    }

    // 3. Check if the app is embedded in an iframe on a known development domain.
    // This is a more reliable way to detect environments like AI Studio where the
    // app's own hostname might be generic or sandboxed.
    try {
        if (window.location.ancestorOrigins && window.location.ancestorOrigins.length > 0) {
            for (let i = 0; i < window.location.ancestorOrigins.length; i++) {
                const ancestorHostname = new URL(window.location.ancestorOrigins[i]).hostname;
                if (DEVELOPMENT_HOSTNAMES.includes(ancestorHostname)) {
                    return true;
                }
            }
        }
    } catch (e) {
        // Security errors can occur if origins don't match; we can safely ignore them.
        console.warn("Could not check ancestorOrigins due to security policy:", e);
    }

    // Default to production mode.
    return false;
}

/**
 * A constant that is true if the application is running in a development
 * environment (e.g., locally or in AI Studio), and false otherwise (e.g., deployed).
 * This is used to enable developer-specific features, such as minimal data sync
 * to reduce Firebase costs during development.
 */
export const IS_DEVELOPER_MODE = detectDeveloperMode();

/**
 * A version string for the local data structure (e.g., in IndexedDB).
 * Incrementing this version will trigger a local data reset and full re-sync
 * on app startup, ensuring data consistency after schema changes.
 */
export const DATA_SCHEMA_VERSION = 'v4';

/**
 * The version of the Service Worker/App Shell.
 * Displayed in the Settings page for debugging.
 */
export const SW_VERSION = 'v1.36';