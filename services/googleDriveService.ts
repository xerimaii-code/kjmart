import { API_KEY, CLIENT_ID, SCOPES } from '../googleApiConfig';

// Make gapi and google types available
// FIX: The `declare global` block was causing a "Duplicate identifier" error.
// Declaring gapi and google as `any` at the module level is a safer way to
// inform TypeScript about these globally available variables from external scripts,
// and it overrides any potentially incorrect ambient type definitions.
declare var gapi: any;
declare var google: any;

let gapiClientInited = false;
let gisClientInited = false;
let tokenClient: any;

// A promise that resolves when the GAPI script and client are ready
const gapiReadyPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.defer = true;
    script.onload = () => {
        gapi.load('client:picker', async () => {
            try {
                await gapi.client.init({
                    apiKey: API_KEY,
                    discoveryDocs: [
                        "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest",
                        "https://sheets.googleapis.com/$discovery/rest?version=v4"
                    ],
                });
                gapiClientInited = true;
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    };
    script.onerror = () => reject(new Error('Failed to load GAPI script.'));
    document.head.appendChild(script);
});

// A promise that resolves when the Google Identity Services script and client are ready
const gisReadyPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
        try {
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: SCOPES,
                callback: '', // Will be handled by the promise in signIn
            });
            gisClientInited = true;
            resolve();
        } catch (error) {
            reject(error);
        }
    };
    script.onerror = () => reject(new Error('Failed to load Google Identity Services script.'));
    document.head.appendChild(script);
});

export async function initClient(): Promise<void> {
    if (API_KEY.startsWith('YOUR_') || CLIENT_ID.startsWith('YOUR_')) {
        console.warn("Google API Key or Client ID is not configured in googleApiConfig.ts. Drive Sync will be disabled.");
        throw new Error("Google API credentials are not configured.");
    }
    await Promise.all([gapiReadyPromise, gisReadyPromise]);
}

export function signIn(): Promise<any> {
    return new Promise(async (resolve, reject) => {
        await initClient();
        
        tokenClient.callback = (resp: any) => {
            if (resp.error) {
                return reject(resp);
            }
            gapi.client.setToken({ access_token: resp.access_token });
            resolve(gapi.client.getToken());
        };
        
        if (gapi.client.getToken() === null) {
            tokenClient.requestAccessToken({ prompt: 'consent' });
        } else {
            tokenClient.requestAccessToken({ prompt: '' });
        }
    });
}

export function signOut() {
    const token = gapi.client.getToken();
    if (token) {
        google.accounts.oauth2.revoke(token.access_token, () => {
            gapi.client.setToken(null);
        });
    }
}

export function showPicker(callback: (file: any) => void): Promise<void> {
    return new Promise(async (resolve, reject) => {
        await initClient();
        const token = gapi.client.getToken();
        if (!token) {
            return reject(new Error("Not signed in"));
        }

        const view = new google.picker.View(google.picker.ViewId.SPREADSHEETS);
        const picker = new google.picker.PickerBuilder()
            .setAppId(CLIENT_ID.split('-')[0])
            .setOAuthToken(token.access_token)
            .addView(view)
            .setDeveloperKey(API_KEY)
            .setCallback((data: any) => {
                if (data.action === google.picker.Action.PICKED) {
                    const file = data.docs[0];
                    callback({ id: file.id, name: file.name });
                    resolve();
                } else if (data.action === google.picker.Action.CANCEL) {
                    resolve();
                }
            })
            .build();
        picker.setVisible(true);
    });
}

export async function getSheetData(spreadsheetId: string): Promise<any[]> {
    await initClient();
    const token = gapi.client.getToken();
    if (!token) {
        throw new Error("Not signed in");
    }

    try {
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: 'A:C', // Assume Barcode, Name, Price are in the first 3 columns
        });
        // Remove header row if it exists
        const values = response.result.values || [];
        return values.length > 0 ? values.slice(1) : [];
    } catch (err: any) {
        if (err.status === 401) {
             signOut();
             throw new Error("Authorization expired. Please sign in again.");
        }
        console.error("Error fetching sheet data:", err);
        throw new Error(`Failed to fetch data from Google Sheet. Error: ${err.result?.error?.message || 'Unknown'}`);
    }
}
