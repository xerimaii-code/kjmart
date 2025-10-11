import React, { useEffect, useRef, useState } from 'react';
import { useDataState, useUIActions } from '../context/AppContext';
import { loadScript } from '../services/dataService';
import { SpinnerIcon } from './Icons';

// Assuming ZXing is loaded from a CDN and available on the window object
declare const ZXing: any;
const ZXING_CDN = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.0/umd/index.min.js";

interface ScannerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onScanSuccess: (barcode: string) => void;
}

const ScannerModal: React.FC<ScannerModalProps> = ({ isOpen, onClose, onScanSuccess }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const codeReaderRef = useRef<any>(null);
    const { selectedCameraId } = useDataState();
    const { showAlert } = useUIActions();
    const [isLibraryLoading, setIsLibraryLoading] = useState(true);

    useEffect(() => {
        if (isOpen) {
            setIsLibraryLoading(true);
            loadScript(ZXING_CDN)
                .then(() => setIsLibraryLoading(false))
                .catch(err => {
                    console.error(err);
                    showAlert('스캐너 라이브러리를 로드하는 데 실패했습니다.');
                    onClose();
                });
        }
    }, [isOpen, onClose, showAlert]);

    useEffect(() => {
        if (isOpen && !isLibraryLoading && videoRef.current) {
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
            // Assume GS1 format for common product barcodes to potentially speed up recognition
            hints.set(ZXing.DecodeHintType.ASSUME_GS1, true);
            codeReaderRef.current = new ZXing.BrowserMultiFormatReader(hints);
            
            const startScanning = async () => {
                const baseVideoConstraints: MediaTrackConstraints = {
                    deviceId: selectedCameraId ? { exact: selectedCameraId } : undefined,
                };
                
                // A list of constraints to try, from most desirable to least.
                const constraintsToTry: MediaStreamConstraints[] = [
                    // Prioritize higher resolutions for better scanning quality as requested.
                    { audio: false, video: { ...baseVideoConstraints, facingMode: 'environment', focusMode: 'continuous', width: { ideal: 1920 }, height: { ideal: 1080 } } as any },
                    { audio: false, video: { ...baseVideoConstraints, facingMode: 'environment', focusMode: 'continuous', width: { ideal: 1280 }, height: { ideal: 720 } } as any },
                    // Fallback to a standard, lower resolution if high-res fails.
                    { audio: false, video: { ...baseVideoConstraints, facingMode: 'environment', focusMode: 'continuous', width: { ideal: 640 }, height: { ideal: 480 } } as any },
                    // Fallback to simpler constraints if specific resolutions fail.
                    { audio: false, video: { ...baseVideoConstraints, facingMode: 'environment', focusMode: 'continuous' } as any },
                    { audio: false, video: { ...baseVideoConstraints, facingMode: 'environment' } },
                    { audio: false, video: { ...baseVideoConstraints } },
                ];

                for (const constraints of constraintsToTry) {
                    try {
                        await codeReaderRef.current.decodeFromConstraints(constraints, videoRef.current, (result: any, err: any) => {
                            if (result) {
                                if (navigator.vibrate) navigator.vibrate(100);
                                const barcode = result.getText();                             
                                onScanSuccess(barcode);
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
                    }
                }
                
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
    }, [isOpen, isLibraryLoading, selectedCameraId, onScanSuccess, onClose, showAlert]);

    if (!isOpen) return null;

    if (isLibraryLoading) {
        return (
            <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center">
                <SpinnerIcon className="w-10 h-10 text-white" />
                <p className="text-white mt-4">스캐너 준비 중...</p>
                <button
                    onClick={onClose}
                    className="absolute bottom-10 bg-white text-gray-800 px-8 py-3 rounded-full text-lg font-bold shadow-lg"
                >
                    취소
                </button>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center">
            <video ref={videoRef} className="absolute top-0 left-0 w-full h-full object-cover" playsInline />
            
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-[90%] max-w-md">
                    <div className="relative aspect-[4/1.25] shadow-[0_0_0_9999px_rgba(0,0,0,0.7)] rounded-xl">
                        <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white/90 rounded-tl-xl" />
                        <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white/90 rounded-tr-xl" />
                        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white/90 rounded-bl-xl" />
                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white/90 rounded-br-xl" />
                    </div>
                    <p className="text-white text-center mt-4 text-lg font-medium">바코드를 영역 안에 맞춰주세요</p>
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