import { GOOGLE_API_KEY, GOOGLE_CLIENT_ID } from '../googleApiConfig';

const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';

let gapiReady = false;
let gisReady = false;
let pickerApiLoaded = false;
let tokenClient: any;

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
    return new Promise(async (resolve, reject) => {
        if (gapiReady && gisReady) {
            return resolve();
        }
        if (GOOGLE_API_KEY.startsWith('YOUR_') || GOOGLE_CLIENT_ID.startsWith('YOUR_')) {
            const errorMsg = "Google API Key/Client ID is not set. Google Drive feature will be disabled. Please update googleApiConfig.ts";
            console.warn(errorMsg);
            // Resolve without initializing so the app doesn't break, and the button remains disabled.
            return resolve();
        }
        
        try {
             // First, load both scripts in parallel
            await Promise.all([
                loadScript('https://apis.google.com/js/api.js'),
                loadScript('https://accounts.google.com/gsi/client')
            ]);

            // Now that scripts are loaded, initialize clients
            // 1. Initialize GIS token client (this is synchronous)
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: GOOGLE_CLIENT_ID,
                scope: SCOPES,
                callback: '', // Callback is handled by the promise wrapper in getAccessToken
            });
            gisReady = true;
            
            // 2. Initialize GAPI client for Drive and Picker (this is asynchronous)
            gapi.load('client:picker', () => {
                gapi.client.init({
                    apiKey: GOOGLE_API_KEY,
                    discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
                }).then(() => {
                    gapiReady = true;
                    pickerApiLoaded = true;
                    resolve(); // Resolve promise when both are ready
                }).catch(reject);
            });
        } catch (scriptLoadError) {
            reject(scriptLoadError);
        }
    });
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

        } catch(err) {
            console.error("Picker or Auth error:", err);
            // Don't show an error alert if the user simply closed the popup or cancelled the picker.
            // These are expected user actions, not application errors.
            const errorDetails = err as any;
            if (errorDetails.type !== 'popup_closed' && errorDetails.message !== "Picker was cancelled.") {
                 reject(new Error("Google 로그인 또는 파일 선택에 실패했습니다."));
            }
        }
    });
};

// Function to get file metadata (name, modifiedTime)
export const getFileMetadata = async (fileId: string): Promise<{ name: string; modifiedTime: string; }> => {
    const oauthToken = await getAccessToken();
    gapi.client.setToken({ access_token: oauthToken });

    try {
        const response = await gapi.client.drive.files.get({
            fileId: fileId,
            fields: 'id, name, modifiedTime'
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
export const getFileContent = async (fileId: string): Promise<Blob> => {
    // Set the access token for this API call. getAccessToken will provide a cached token.
    const oauthToken = await getAccessToken();
    gapi.client.setToken({ access_token: oauthToken });

    const response = await gapi.client.drive.files.export({
        fileId: fileId,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
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
};