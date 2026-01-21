
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

/**
 * Converts a Blob object to a Base64 encoded string.
 * @param blob The Blob to convert.
 * @returns A promise that resolves with the Base64 string.
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        // The result includes the data URL prefix (e.g., "data:application/pdf;base64,"),
        // which needs to be removed for the Capacitor Filesystem plugin.
        const base64String = reader.result.split(',')[1];
        resolve(base64String);
      } else {
        reject(new Error('Failed to read blob as Base64 string.'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Saves a file natively on the device using the Capacitor Filesystem API.
 * This is intended for use in native mobile environments (iOS/Android).
 * @param blob The file content as a Blob.
 * @param fileName The desired name of the file.
 * @returns A promise that resolves when the file is successfully written.
 */
export const saveFileNatively = async (blob: Blob, fileName: string): Promise<void> => {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('This function is only for native platforms.');
  }

  try {
    const base64Data = await blobToBase64(blob);

    // Revert to Directory.Documents as requested (default location).
    // Directory.Downloads often causes permission issues on newer Android versions.
    await Filesystem.writeFile({
      path: fileName,
      data: base64Data,
      directory: Directory.Documents,
      // The data is a Base64 string, but we tell the filesystem to treat it as a UTF8 string
      // because the plugin handles the Base64 decoding internally.
      encoding: Encoding.UTF8, 
    });
  } catch (error) {
    console.error('Native file saving error:', error);
    // Provide a more user-friendly error message
    throw new Error(`파일 저장 실패: 기기의 '문서(Documents)' 폴더 권한을 확인해주세요.`);
  }
};
