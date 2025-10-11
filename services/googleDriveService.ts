

import { GOOGLE_API_CONFIG } from '../googleApiConfig';

// --- Type Definitions for Google APIs ---
// These are simplified types for what we get back from the APIs.
interface Gapi {
  client: {
    init: (config: object) => Promise<void>;
    request: (args: { path: string }) => Promise<{ result: { files: any[] }, body: string }>;
    getToken: () => { access_token: string } | null;
    setToken: (token: { access_token: string } | null) => void;
  };
  load: (apiName: string, callback: () => void) => void;
  picker: any; // picker is a complex object
}

interface GsiClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
  revoke: (accessToken: string, done: () => void) => void;
}

// FIX: Expanded TokenResponse to better match the actual API response.
interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
  error_description?: string;
  error_uri?: string;
}

interface PickerCallback {
  docs: { id: string, name: string }[];
  action: 'picked' | 'cancel' | 'error';
}

// --- Module-level variables to hold the client instances ---
declare const gapi: Gapi;
declare const google: { accounts: {oauth2: { initTokenClient: (config: object) => GsiClient }}};

// Implement a promise resolver pattern to bridge the callback-based GSI API with promises.
let signInPromiseResolve: ((token: TokenResponse) => void) | null = null;
let signInPromiseReject: ((reason?: any) => void) | null = null;

let tokenClient: GsiClient;
let isInitialized = false;

// Helper to load a script and return a promise
const loadScript = (src: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        const existingScript = document.querySelector(`script[src="${src}"]`);
        if (existingScript) {
            return resolve();
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.body.appendChild(script);
    });
};

/**
 * Initializes the Google API client (gapi) and Google Identity Services client (gsi).
 * This must be called before any other functions in this module.
 */
export const initGoogleClient = async () => {
    if (isInitialized) return;

    // Wait for GSI to be available (loaded from index.html)
    const gsiPromise = new Promise<void>((resolve) => {
        const checkGsi = setInterval(() => {
            if (typeof google !== 'undefined' && google.accounts) {
                clearInterval(checkGsi);
                resolve();
            }
        }, 100);
    });

    await Promise.all([
        loadScript('https://apis.google.com/js/api.js'),
        gsiPromise,
    ]);

    await new Promise<void>(resolve => gapi.load('client:picker', resolve));

    await gapi.client.init({
        apiKey: GOOGLE_API_CONFIG.API_KEY,
        discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
    });

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_API_CONFIG.CLIENT_ID,
        scope: GOOGLE_API_CONFIG.SCOPES,
        callback: (tokenResponse: TokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                // Set the token on the gapi client for any subsequent gapi calls.
                gapi.client.setToken({ access_token: tokenResponse.access_token });
                if (signInPromiseResolve) signInPromiseResolve(tokenResponse);
            } else {
                if (signInPromiseReject) signInPromiseReject(new Error("Sign-in failed or was cancelled."));
            }
            signInPromiseResolve = null;
            signInPromiseReject = null;
        },
    });

    isInitialized = true;
};


/**
 * Initiates the Google Sign-In flow.
 * @returns A promise that resolves with the access token.
 */
export const signIn = (): Promise<TokenResponse> => {
    return new Promise((resolve, reject) => {
        if (!tokenClient) {
            return reject(new Error("Google client not initialized."));
        }
        
        signInPromiseResolve = resolve;
        signInPromiseReject = reject;

        // By explicitly setting `prompt: ''`, we ask Google not to show a consent screen
        // if the user has already granted permissions. This is more explicit than relying
        // on the default behavior and can help resolve 'invalid_request' errors in
        // stricter environments like PWAs or embedded webviews.
        tokenClient.requestAccessToken({ prompt: '' });
    });
};

/**
 * Signs the user out by revoking the current access token.
 * @param accessToken The access token to revoke.
 * @returns A promise that resolves when sign-out is complete.
 */
export const signOut = (accessToken: string): Promise<void> => {
    return new Promise((resolve) => {
        if (!tokenClient) return resolve();
        // Also clear the token from the GAPI client for clean state management.
        gapi.client.setToken(null);
        tokenClient.revoke(accessToken, () => {
             console.log('Google access token revoked.');
             resolve();
        });
    });
};

/**
 * Displays the Google Picker UI for selecting a spreadsheet file.
 * @param accessToken The user's current OAuth2 access token.
 * @returns A promise that resolves with the selected file's ID and name.
 */
export const showPicker = (accessToken: string): Promise<{id: string, name: string}> => {
    return new Promise((resolve, reject) => {
        const view = new gapi.picker.View(gapi.picker.ViewId.SPREADSHEETS);
        view.setMimeTypes("application/vnd.google-apps.spreadsheet,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/x-vnd.ms-excel");
        
        const picker = new gapi.picker.PickerBuilder()
            .addView(view)
            .setOAuthToken(accessToken)
            .setDeveloperKey(GOOGLE_API_CONFIG.API_KEY)
            .setCallback((data: PickerCallback) => {
                if (data.action === 'picked' && data.docs && data.docs.length > 0) {
                    resolve({ id: data.docs[0].id, name: data.docs[0].name });
                } else if (data.action === 'cancel') {
                    reject(new Error("Picker was cancelled."));
                } else {
                    reject(new Error("Error picking file."));
                }
            })
            .build();
        picker.setVisible(true);
    });
};

/**
 * Downloads the content of a Google Drive file as an ArrayBuffer.
 * This is designed for XLS files by exporting them as .xlsx format.
 * @param fileId The ID of the file to download.
 * @param accessToken The user's current OAuth2 access token.
 * @returns A promise that resolves with the file content as an ArrayBuffer.
 */
export const getFileContent = async (fileId: string, accessToken: string): Promise<ArrayBuffer> => {
    if (!accessToken) {
        throw new Error("Google authentication token not found. Please sign in again.");
    }
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application%2Fvnd.openxmlformats-officedocument.spreadsheetml.sheet`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Failed to download file: ${error.error?.message || response.statusText}`);
    }

    return response.arrayBuffer();
};