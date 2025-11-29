
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useScanner, useAlert } from '../context/AppContext';
import { loadScript } from '../services/dataService';
import { SpinnerIcon } from './Icons';
import './ScannerModal.css';

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
    const audioCtxRef = useRef<AudioContext | null>(null); // Use a ref for the context
    const { selectedCameraId, scanSettings } = useScanner();
    const { showAlert } = useAlert();
    const [isLibraryLoading, setIsLibraryLoading] = useState(true);
    const [isRendered, setIsRendered] = useState(false);

    // Lazy-initialize AudioContext
    const getAudioContext = useCallback((): AudioContext | null => {
        if (!audioCtxRef.current) {
            try {
                audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            } catch (e) {
                console.error("Web Audio API is not supported in this browser.");
                return null;
            }
        }
        return audioCtxRef.current;
    }, []);
    
    const playBeep = useCallback(async () => {
        const audioCtx = getAudioContext();
        if (!audioCtx) {
            console.warn("Cannot play beep. AudioContext not available.");
            return;
        }
    
        if (audioCtx.state === 'suspended') {
            try {
                await audioCtx.resume();
            } catch (err) {
                console.error("Failed to resume AudioContext:", err);
                return;
            }
        }
    
        try {
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            gainNode.gain.value = 0.5; 
            oscillator.frequency.value = 1200; 
            oscillator.type = 'square'; 
            
            const now = audioCtx.currentTime;
            oscillator.start(now);
            oscillator.stop(now + 0.08); 
        } catch (error) {
            console.error("Failed to play beep sound:", error);
        }
    }, [getAudioContext]);

    useEffect(() => {
        if (isOpen) {
            getAudioContext(); 
            const timer = setTimeout(() => setIsRendered(true), 10);

            setIsLibraryLoading(true);
            loadScript(ZXING_CDN)
                .then(() => setIsLibraryLoading(false))
                .catch(err => {
                    console.error(err);
                    showAlert('스캐너 라이브러리를 로드하는 데 실패했습니다.');
                    onClose();
                });
            
            return () => clearTimeout(timer);
        } else {
            setIsRendered(false);
        }
    }, [isOpen, onClose, showAlert, getAudioContext]);

    useEffect(() => {
        if (isOpen && !isLibraryLoading && videoRef.current) {
            const hints = new Map();
            const formats = [
                ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.CODE_128,
                ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E,
                ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.ITF,
            ];
            hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
            hints.set(ZXing.DecodeHintType.ASSUME_GS1, true);
            codeReaderRef.current = new ZXing.BrowserMultiFormatReader(hints);
            
            const isHandlingResult = { current: false };

            const tryStartScanning = async (deviceId: string | null) => {
                const baseVideoConstraints: MediaTrackConstraints = {
                    deviceId: deviceId ? { exact: deviceId } : undefined,
                };

                const advancedVideoSettings: MediaTrackConstraints = {
                    facingMode: 'environment',
                    focusMode: 'continuous',
                    exposureMode: 'continuous',
                    whiteBalanceMode: 'continuous',
                } as any;
                
                const constraintsToTry: MediaStreamConstraints[] = [
                    { audio: false, video: { ...baseVideoConstraints, ...advancedVideoSettings, width: { ideal: 1920 }, height: { ideal: 1080 } } as any },
                    { audio: false, video: { ...baseVideoConstraints, ...advancedVideoSettings, width: { ideal: 1280 }, height: { ideal: 720 } } as any },
                    { audio: false, video: { ...baseVideoConstraints, ...advancedVideoSettings } as any },
                    { audio: false, video: { ...baseVideoConstraints, facingMode: 'environment' } },
                    { audio: false, video: { ...baseVideoConstraints } },
                ];

                let lastError: unknown = null;
                for (const constraints of constraintsToTry) {
                    try {
                        const codeReader = codeReaderRef.current;
                        await codeReader.decodeFromConstraints(constraints, videoRef.current, (result: any, err: any) => {
                            if (result && !isHandlingResult.current) {
                                isHandlingResult.current = true;
                                
                                if (scanSettings.soundOnScan) playBeep();

                                codeReader.reset();

                                if (scanSettings.vibrateOnScan && navigator.vibrate) navigator.vibrate(100);
                                
                                const barcode = result.getText();                             
                                onScanSuccess(barcode);
                                onClose();
                            }
                            if (err && !(err instanceof ZXing.NotFoundException)) {
                                console.error('Scan Error:', err);
                            }
                        });
                        return;
                    } catch (e) {
                        console.warn(`Failed to start camera with constraints: ${JSON.stringify(constraints)}`, e);
                        lastError = e;
                    }
                }
                
                throw lastError;
            };

            const initializeCamera = async () => {
                try {
                    await tryStartScanning(selectedCameraId);
                } catch (e) {
                    if (e instanceof DOMException && e.name === 'NotFoundError' && selectedCameraId) {
                        showAlert("저장된 카메라를 찾을 수 없습니다. 기본 카메라로 다시 시도합니다.");
                        // This would require an action from context to update the setting, which might be complex here.
                        // For now, we just try again with the default. A better UX would be to inform the user to change settings.
                        try {
                           await tryStartScanning(null);
                        } catch {
                            showAlert('기본 카메라도 시작할 수 없습니다. 권한을 확인해주세요.');
                            onClose();
                        }
                    } else {
                        showAlert('카메라를 시작할 수 없습니다. 권한을 확인해 주세요.');
                        onClose();
                    }
                }
            };
            
            initializeCamera();
        }

        return () => {
            if (codeReaderRef.current) {
                codeReaderRef.current.reset();
            }
        };
    }, [isOpen, isLibraryLoading, selectedCameraId, onScanSuccess, onClose, showAlert, playBeep, scanSettings]);

    if (!isOpen) return null;

    if (isLibraryLoading) {
        return createPortal(
            <div className={`fixed inset-0 bg-black z-[70] flex flex-col items-center justify-center transition-opacity duration-150 ease-out ${isRendered ? 'opacity-100' : 'opacity-0'}`}>
                <SpinnerIcon className="w-10 h-10 text-white" />
                <p className="text-white mt-4 font-semibold">스캐너 준비 중...</p>
                <button
                    onClick={onClose}
                    className="absolute bottom-10 bg-white text-gray-900 px-8 py-3 rounded-full text-lg font-bold shadow-lg"
                >
                    취소
                </button>
            </div>,
            document.body
        );
    }

    return createPortal(
        <div className={`fixed inset-0 bg-black z-[70] flex flex-col items-center justify-center transition-opacity duration-150 ease-out ${isRendered ? 'opacity-100' : 'opacity-0'}`}>
            <video ref={videoRef} className="absolute top-0 left-0 w-full h-full object-cover" playsInline />
            
            <div className="absolute inset-0 bg-black/40"></div>

            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <div className="w-[90%] max-w-md">
                    <div className="relative aspect-[4/1.5] shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] rounded-2xl">
                        <div className="scanner-corner top-left"></div>
                        <div className="scanner-corner top-right"></div>
                        <div className="scanner-corner bottom-left"></div>
                        <div className="scanner-corner bottom-right"></div>
                        <div className="scanner-line"></div>
                    </div>
                    <p className="text-white text-center mt-6 text-lg font-semibold tracking-wide">바코드를 영역 안에 맞춰주세요</p>
                </div>
            </div>

            <button
                onClick={onClose}
                className="absolute bottom-10 bg-white/95 text-gray-900 px-8 py-3 rounded-full text-lg font-bold shadow-lg z-20 transition-transform active:scale-95"
            >
                스캔 종료
            </button>
        </div>,
        document.body
    );
};

export default ScannerModal;
