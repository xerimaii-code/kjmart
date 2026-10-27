// src/config.ts

const DEVELOPMENT_HOSTNAMES = [
    'localhost',
    '127.0.0.1',
    'aistudio.google.com',
];

function detectDeveloperMode(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }

    const hostname = window.location.hostname;

    if (DEVELOPMENT_HOSTNAMES.includes(hostname)) {
        return true;
    }
    
    if (hostname.includes('googleusercontent.com') || hostname.includes('usercontent.goog')) {
        return true;
    }

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
        console.warn("Could not check ancestorOrigins due to security policy:", e);
    }

    return false;
}

export const IS_DEVELOPER_MODE = detectDeveloperMode();

export const DATA_SCHEMA_VERSION = 'v5';

export const SW_VERSION = 'v1.40';