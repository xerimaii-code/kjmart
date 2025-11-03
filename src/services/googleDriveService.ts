import { GOOGLE_API_KEY, GOOGLE_CLIENT_ID } from '../googleApiConfig';

const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';

let gapiReady = false;
let gisReady = false;
let pickerApiLoaded = false;
let tokenClient: any;
let initPromise: Promise<void> | null = null;

// TypeScript declarations for gapi and google.picker
declare const gapi: any;
declare const google: any;

// Function to load a script dynamically and only once
function loadScript(src: string): Promise<void> {
    // Check if the script is already on the page
    if (document.querySelector(`script[src="${src}"]`)) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.body.appendChild(script);
    });
}

// Main initialization function
export const initGoogleApi = (): Promise<void> => {
    if (initPromise) {
        return initPromise;
    }

    initPromise = new Promise(async (resolve, reject) => {
        if (gapiReady && gisReady) {
            return resolve();
        }
        if (GOOGLE_API_KEY.startsWith('YOUR_') || GOOGLE_CLIENT_ID.startsWith('YOUR_')) {
            const errorMsg = "Google API Key/Client ID is not set. Google Drive feature will be disabled. Please update googleApiConfig.ts";
            console.warn(errorMsg);
            return resolve();
        }
        
        try {
            await Promise.all([
                loadScript('https://apis.google.com/js/api.js'),
                loadScript('https://accounts.google.com/gsi/client')
            ]);

            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: GOOGLE_CLIENT_ID,
                scope: SCOPES,
                callback: '',
            });
            gisReady = true;
            
            gapi.load('client:picker', () => {
                gapi.client.init({
                    apiKey: GOOGLE_API_KEY,
                    discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
                }).then(() => {
                    gapiReady = true;
                    pickerApiLoaded = true;
                    resolve();
                }).catch((err: any) => {
                    initPromise = null; // Allow retry on failure
                    reject(err);
                });
            });
        } catch (scriptLoadError) {
            initPromise = null; // Allow retry on failure
            reject(scriptLoadError);
        }
    });
    return initPromise;
};

// Helper function to get an access token, triggering a user popup if necessary.
const getAccessToken = (): Promise<string> => {
    return new Promise((resolve, reject) => {
        if (!tokenClient) {
            return reject(new Error("GIS Client not initialized."));
        }
        
        tokenClient.callback = (response: any) => {
            if (response.error) {
                return reject(response);
            }
            resolve(response.access_token);
        };
        
        // requestAccessToken will use a cached token if available and valid.
        // If not, it will trigger the sign-in and consent flow.
        tokenClient.requestAccessToken({ prompt: '' });
    });
};


// Function to show the picker and return a file ID
export const showPicker = (): Promise<string> => {
    return new Promise(async (resolve, reject) => {
        if (!gapiReady || !gisReady || !pickerApiLoaded) {
            return reject(new Error("Google API가 초기화되지 않았습니다."));
        }
        
        try {
            const oauthToken = await getAccessToken();

            const spreadsheetView = new google.picker.View(google.picker.ViewId.SPREADSHEETS);
            spreadsheetView.setMimeTypes([
                "application/vnd.google-apps.spreadsheet",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.ms-excel",
                "application/x-vnd.oasis.opendocument.spreadsheet"
            ].join(','));

            // View for navigating folders
            const folderView = new google.picker.View(google.picker.ViewId.DOCS);
            
            // View for recently picked/viewed files
            const recentView = new google.picker.View(google.picker.ViewId.RECENTLY_PICKED);

            const picker = new google.picker.PickerBuilder()
                .setTitle("Google Drive에서 파일 선택")
                .addView(recentView) // Add Recent view as the first tab
                .addView(folderView) // Add Folder navigation view
                .addView(spreadsheetView) // Add specific spreadsheet view
                .setOAuthToken(oauthToken)
                .setDeveloperKey(GOOGLE_API_KEY)
                .setCallback((data: any) => {
                    if (data.action === google.picker.Action.PICKED) {
                        const fileId = data.docs[0].id;
                        resolve(fileId);
                    } else if (data.action === google.picker.Action.CANCEL) {
                        reject(new Error("Picker was cancelled."));
                    }
                })
                .build();
            picker.setVisible(true);

        } catch(err: any) {
            console.error("Picker or Auth error:", err);
            
            // Check for GSI token client errors which come as objects with an `error` property
            if (err && err.error) {
                if (err.error === 'popup_closed_by_user' || err.error === 'access_denied') {
                    // These are user actions, not system errors. Reject with a specific message for silent handling.
                    return reject(new Error("Picker was cancelled by user."));
                }
            }
            
            // Check for picker cancellation which comes as an Error object
            if (err instanceof Error && err.message.includes("cancelled")) {
                 return reject(new Error("Picker was cancelled by user."));
            }
            
            // For all other errors, reject with a generic failure message to be shown to the user.
            reject(new Error("Google 로그인 또는 파일 선택에 실패했습니다."));
        }
    });
};

// Function to get file metadata (name, modifiedTime, mimeType)
export const getFileMetadata = async (fileId: string): Promise<{ name: string; modifiedTime: string; mimeType: string; }> => {
    const oauthToken = await getAccessToken();
    gapi.client.setToken({ access_token: oauthToken });

    try {
        const response = await gapi.client.request({
            path: `https://www.googleapis.com/drive/v3/files/${fileId}`,
            method: 'GET',
            params: {
                fields: 'id, name, modifiedTime, mimeType'
            },
            headers: {
                'Cache-Control': 'no-cache'
            }
        });
        
        if (response.status !== 200 || !response.result) {
            throw new Error("Failed to fetch file metadata from Google Drive.");
        }
        
        return response.result;
    } catch (error: any) {
        // Handle common 404 Not Found error gracefully
        if (error.status === 404) {
            throw new Error("File not found in Google Drive.");
        }
        throw error; // Re-throw other errors
    }
};


// Function to get file content as a Blob
export const getFileContent = async (fileId: string, fileMimeType: string): Promise<Blob> => {
    const oauthToken = await getAccessToken();
    gapi.client.setToken({ access_token: oauthToken });

    // If it's a native Google Sheet, we must export it to a standard format.
    if (fileMimeType === 'application/vnd.google-apps.spreadsheet') {
        const response = await gapi.client.request({
            path: `https://www.googleapis.com/drive/v3/files/${fileId}/export`,
            method: 'GET',
            params: {
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            },
            headers: {
                'Cache-Control': 'no-cache'
            }
        });
        
        if (response.status !== 200 || !response.body) {
            throw new Error("Google Drive에서 파일을 다운로드하는 데 실패했습니다.");
        }
        
        // The response body is a string of bytes. We need to convert it to a Blob.
        const binaryString = response.body;
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    } else {
        // For other file types (like uploaded .xls, .xlsx), download them directly.
        const response = await gapi.client.request({
            path: `https://www.googleapis.com/drive/v3/files/${fileId}`,
            method: 'GET',
            params: {
                alt: 'media'
            },
            headers: {
                'Cache-Control': 'no-cache'
            }
        });

        if (response.status !== 200 || !response.body) {
            throw new Error("Google Drive에서 파일을 다운로드하는 데 실패했습니다.");
        }
        
        const binaryString = response.body;
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        return new Blob([bytes], { type: fileMimeType });
    }
};