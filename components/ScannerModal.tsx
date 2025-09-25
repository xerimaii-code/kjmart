
import React, { useEffect, useRef, useContext } from 'react';
import { AppContext } from '../context/AppContext';

// Assuming ZXing is loaded from a CDN and available on the window object
declare const ZXing: any;

interface ScannerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onScanSuccess: (barcode: string) => void;
}

const ScannerModal: React.FC<ScannerModalProps> = ({ isOpen, onClose, onScanSuccess }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const codeReaderRef = useRef<any>(null);
    const { selectedCameraId, showAlert } = useContext(AppContext);

    useEffect(() => {
        if (isOpen && videoRef.current) {
            const hints = new Map();
            // Optimize for 1D barcodes to improve scanning speed and accuracy for industrial products.
            const formats = [
                ZXing.BarcodeFormat.EAN_13,
                ZXing.BarcodeFormat.CODE_128,
                ZXing.BarcodeFormat.UPC_A,
                ZXing.BarcodeFormat.UPC_E,
                ZXing.BarcodeFormat.CODE_39,
                ZXing.BarcodeFormat.ITF,
            ];
            hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
            hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
            // Assume GS1 format for common product barcodes to potentially speed up recognition
            hints.set(ZXing.DecodeHintType.ASSUME_GS1, true);
            codeReaderRef.current = new ZXing.BrowserMultiFormatReader(hints);
            
            const startScanning = async () => {
                const baseVideoConstraints: MediaTrackConstraints = {
                    deviceId: selectedCameraId ? { exact: selectedCameraId } : undefined,
                };
                
                // A list of constraints to try, from most desirable to least.
                // This provides graceful degradation on devices that don't support advanced features.
                // Prioritize HD (720p) for a balance of speed and quality. FullHD can be slow on some devices.
                const constraintsToTry: MediaStreamConstraints[] = [
                    // 1. Ideal: Rear camera, continuous autofocus, HD resolution. (Best balance)
                    { audio: false, video: { ...baseVideoConstraints, facingMode: 'environment', focusMode: 'continuous', width: { ideal: 1280 }, height: { ideal: 720 } } as any },
                    // 2. Ideal+: Rear camera, continuous autofocus, FullHD resolution for high-res scanning.
                    { audio: false, video: { ...baseVideoConstraints, facingMode: 'environment', focusMode: 'continuous', width: { ideal: 1920 }, height: { ideal: 1080 } } as any },
                    // 3. Fallback: No resolution hints.
                    { audio: false, video: { ...baseVideoConstraints, facingMode: 'environment', focusMode: 'continuous' } as any },
                    // 4. Fallback: No autofocus.
                    { audio: false, video: { ...baseVideoConstraints, facingMode: 'environment' } },
                    // 5. Last resort: Any video device, no special features.
                    { audio: false, video: { ...baseVideoConstraints } },
                ];

                for (const constraints of constraintsToTry) {
                    try {
                        // The promise resolves if the stream is acquired successfully.
                        await codeReaderRef.current.decodeFromConstraints(constraints, videoRef.current, (result: any, err: any) => {
                            if (result) {
                                if (navigator.vibrate) navigator.vibrate(100);
                                onScanSuccess(result.getText());
                                onClose();
                            }
                            if (err && !(err instanceof ZXing.NotFoundException)) {
                                console.error('Scan Error:', err);
                            }
                        });
                        console.log('Successfully started camera with constraints:', constraints);
                        return; // Success, exit the loop.
                    } catch (e) {
                        console.warn(`Failed to start camera with constraints: ${JSON.stringify(constraints)}`, e);
                        // Try next set of constraints.
                    }
                }
                
                // If all attempts fail.
                showAlert('카메라를 시작할 수 없습니다. 권한을 확인해 주세요.');
                onClose();
            };

            startScanning();
        }

        return () => {
            if (codeReaderRef.current) {
                codeReaderRef.current.reset();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, selectedCameraId]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center">
            <video ref={videoRef} className="absolute top-0 left-0 w-full h-full object-cover" playsInline></video>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-[90%] max-w-xl h-24 relative shadow-[0_0_0_9999px_rgba(0,0,0,0.7)] rounded-lg">
                    <div className="absolute inset-0 border-2 border-white/75 rounded-lg"></div>
                    <div className="absolute top-0 left-0 w-full h-full overflow-hidden rounded-lg">
                        <div className="scan-line-animation absolute top-0 w-full h-[2px] bg-red-500/90 shadow-[0_0_8px_theme(colors.red.400)]"></div>
                    </div>
                </div>
            </div>
            <button
                onClick={onClose}
                className="absolute bottom-10 bg-white text-gray-800 px-8 py-3 rounded-full text-lg font-bold shadow-lg"
            >
                스캔 종료
            </button>
        </div>
    );
};

export default ScannerModal;
