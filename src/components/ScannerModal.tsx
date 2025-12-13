
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useScanner, useAlert } from '../context/AppContext';
import { loadScript } from '../services/dataService';
import { SpinnerIcon, BarcodeScannerIcon, XCircleIcon } from './Icons';
import './ScannerModal.css';

// Assuming ZXing is loaded from a CDN and available on the window object
declare const ZXing: any;
declare const BarcodeDetector: any; // Standard API definition

const ZXING_CDN = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.0/umd/index.min.js";

interface ScannerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onScanSuccess: (barcode: string) => void;
    continuous?: boolean; 
    isPaused?: boolean;
}

const ScannerModal: React.FC<ScannerModalProps> = ({ isOpen, onClose, onScanSuccess, continuous = false, isPaused = false }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas')); 
    const guideBoxRef = useRef<HTMLDivElement>(null); 
    
    // Logic Refs
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const scanIntervalRef = useRef<any>(null); 
    const isHandlingResult = useRef(false);
    const detectorRef = useRef<any>(null); 
    const isClosingRef = useRef(false); 
    const isMountedRef = useRef(false);

    const { selectedCameraId, scanSettings } = useScanner();
    const { showAlert } = useAlert();
    
    // State
    const [isLibraryLoading, setIsLibraryLoading] = useState(true);
    const [isRendered, setIsRendered] = useState(false);
    const [isNativeSupported, setIsNativeSupported] = useState(false);
    const [isStreamReady, setIsStreamReady] = useState(false);
    
    // Detection Active State: Controls the detection loop and UI feedback
    const [isScanningActive, setIsScanningActive] = useState(false); 
    
    // Audio Context
    const audioCtxRef = useRef<AudioContext | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);

    // Initialize AudioContext
    useEffect(() => {
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioContextClass) {
                const ctx = new AudioContextClass();
                const gainNode = ctx.createGain();
                gainNode.connect(ctx.destination);
                audioCtxRef.current = ctx;
                gainNodeRef.current = gainNode;
            }
        } catch (e) {
            console.error("AudioContext initialization failed", e);
        }

        return () => {
            if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
                audioCtxRef.current.close().catch(() => {});
            }
        };
    }, []);

    const unlockAudio = useCallback(() => {
        if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
            audioCtxRef.current.resume().catch((e) => console.warn("Audio resume failed", e));
        }
    }, []);

    const playBeep = useCallback(() => {
        if (!scanSettings.soundOnScan || !audioCtxRef.current || !gainNodeRef.current) return;
        try {
            const ctx = audioCtxRef.current;
            const gainNode = gainNodeRef.current;
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});

            const oscillator = ctx.createOscillator();
            oscillator.type = 'square';
            oscillator.frequency.setValueAtTime(880, ctx.currentTime);
            oscillator.connect(gainNode);
            
            gainNode.gain.cancelScheduledValues(ctx.currentTime);
            gainNode.gain.setValueAtTime(1.0, ctx.currentTime); // Volume Boosted to 1.0 (Max)
            gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

            oscillator.start(ctx.currentTime);
            oscillator.stop(ctx.currentTime + 0.15);
        } catch (e) { 
            console.error("Beep failed:", e); 
        }
    }, [scanSettings.soundOnScan]);

    const stopDetection = useCallback(() => {
        if (scanIntervalRef.current) {
            clearInterval(scanIntervalRef.current);
            scanIntervalRef.current = null;
        }
    }, []);

    const stopCamera = useCallback(() => {
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.srcObject = null;
            videoRef.current.load();
        }

        if (mediaStreamRef.current) {
            const tracks = mediaStreamRef.current.getTracks();
            tracks.forEach(track => {
                track.stop();
                track.enabled = false;
            });
            mediaStreamRef.current = null;
        }

        if (isMountedRef.current) {
            setIsStreamReady(false);
        }
    }, []);

    const handleSuccess = useCallback((barcode: string) => {
        if (isHandlingResult.current) return;
        isHandlingResult.current = true;
        
        // Stop detection loop immediately to prevent double scan
        stopDetection();
        setIsScanningActive(false); 
        
        playBeep();
        // Use scanSettings.vibrateOnScan for successful scan feedback
        if (scanSettings.vibrateOnScan && navigator.vibrate) navigator.vibrate(100);
        
        if (continuous) {
            // In continuous mode, keep camera open.
            onScanSuccess(barcode);
            
            // Note: We leave isScanningActive as FALSE.
            // If using Button Mode: User needs to press button again.
            // If using Auto Mode: The useEffect below will restart it when isPaused becomes false.
            
            // Allow next scan processing after a short delay
            setTimeout(() => {
                isHandlingResult.current = false;
            }, 1000);
        } else {
            stopCamera();
            setTimeout(() => {
                if (isMountedRef.current) {
                    onScanSuccess(barcode);
                    onClose();
                }
            }, 100);
        }
    }, [scanSettings, playBeep, onScanSuccess, onClose, stopDetection, stopCamera, continuous]);

    const handleManualClose = (e?: React.SyntheticEvent | React.TouchEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        if (isClosingRef.current) return;
        isClosingRef.current = true;
        
        setIsRendered(false); 
        stopDetection();
        setIsScanningActive(false);
        isHandlingResult.current = false;
        
        stopCamera();
        
        setTimeout(() => {
            onClose();
        }, 150); 
    };

    // --- Active/Pause State Logic ---
    useEffect(() => {
        if (isPaused) {
            // Paused (Overlay is open): Stop detection, keep camera.
            stopDetection();
            setIsScanningActive(false);
        } else {
            // Resumed (Overlay closed):
            // Reset handling flag to allow new scans
            isHandlingResult.current = false;

            if (scanSettings.useScannerButton) {
                // Button Mode: Do NOT auto-start. Wait for user press.
                setIsScanningActive(false);
            } else {
                // Auto Mode: Start scanning immediately
                if (isStreamReady && !isLibraryLoading) {
                    setIsScanningActive(true);
                }
            }
        }
    }, [isPaused, scanSettings.useScannerButton, isStreamReady, isLibraryLoading, stopDetection]);

    // --- Initialization & Library Loading ---
    useEffect(() => {
        isMountedRef.current = true;

        if (isOpen) {
            isClosingRef.current = false;
            const timer = setTimeout(() => setIsRendered(true), 10);
            
            isHandlingResult.current = false;
            unlockAudio();

            if ('BarcodeDetector' in window) {
                BarcodeDetector.getSupportedFormats()
                    .then((supportedFormats: string[]) => {
                        if (!isMountedRef.current) return;
                        const desiredFormats = ['ean_13', 'qr_code', 'code_128', 'code_39', 'itf'];
                        const validFormats = desiredFormats.filter(f => supportedFormats.includes(f));

                        if (validFormats.length > 0) {
                            setIsNativeSupported(true);
                            setIsLibraryLoading(false);
                            if (!detectorRef.current) {
                                try {
                                    detectorRef.current = new BarcodeDetector({ formats: validFormats });
                                } catch (e) { 
                                    setIsNativeSupported(false);
                                    loadZXing();
                                }
                            }
                        } else {
                            setIsNativeSupported(false);
                            loadZXing();
                        }
                    })
                    .catch(() => {
                        if (!isMountedRef.current) return;
                        setIsNativeSupported(false);
                        loadZXing();
                    });
            } else {
                setIsNativeSupported(false);
                loadZXing();
            }
            
            return () => clearTimeout(timer);
        } else {
            setIsRendered(false);
            setIsStreamReady(false);
            stopCamera();
            stopDetection();
            isHandlingResult.current = false;
        }
        
        return () => {
            isMountedRef.current = false;
            stopCamera();
            stopDetection();
        }
    }, [isOpen, stopDetection, unlockAudio, stopCamera]);

    const loadZXing = () => {
        setIsLibraryLoading(true);
        loadScript(ZXING_CDN)
            .then(() => {
                if (!isMountedRef.current) return;
                setIsLibraryLoading(false);
                if (!detectorRef.current) {
                    detectorRef.current = new ZXing.BrowserMultiFormatReader();
                }
            })
            .catch(err => {
                if (!isMountedRef.current) return;
                console.error(err);
                setIsLibraryLoading(false); 
            });
    };

    // --- Camera Stream Management ---
    useEffect(() => {
        if (isOpen) {
            startCamera();
        }
    }, [isOpen, selectedCameraId]);

    const startCamera = async () => {
        if (!videoRef.current) return;
        
        try {
            stopCamera(); 

            const constraints = {
                video: {
                    deviceId: selectedCameraId ? { exact: selectedCameraId } : undefined,
                    facingMode: 'environment',
                    width: { ideal: 1280 }, 
                    height: { ideal: 720 } 
                }
            };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            if (!isMountedRef.current) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }

            mediaStreamRef.current = stream;
            
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.setAttribute('playsinline', 'true'); 
                videoRef.current.oncanplay = () => {
                    if (!isMountedRef.current) return;
                    videoRef.current?.play().catch(e => console.warn("Play failed", e));
                    setIsStreamReady(true);
                };
            }
        } catch (err) {
            console.error("Camera start failed:", err);
            if (isMountedRef.current) {
                showAlert("카메라를 실행할 수 없습니다.");
                onClose();
            }
        }
    };

    const cropVideoFrame = (video: HTMLVideoElement, guide: HTMLElement, canvas: HTMLCanvasElement) => {
        if (!video || !guide || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
            return null;
        }

        try {
            const videoRect = video.getBoundingClientRect();
            const guideRect = guide.getBoundingClientRect();

            if (videoRect.width === 0 || videoRect.height === 0) return null;

            const scaleX = video.videoWidth / videoRect.width;
            const scaleY = video.videoHeight / videoRect.height;
            const scale = Math.min(scaleX, scaleY);

            const virtualVideoWidth = videoRect.width * scale;
            const virtualVideoHeight = videoRect.height * scale;
            
            const offsetX = (virtualVideoWidth - video.videoWidth) / 2;
            const offsetY = (virtualVideoHeight - video.videoHeight) / 2;

            const guideRelX = guideRect.left - videoRect.left;
            const guideRelY = guideRect.top - videoRect.top;

            const sourceX = (guideRelX * scale) - offsetX;
            const sourceY = (guideRelY * scale) - offsetY;
            const sourceWidth = guideRect.width * scale;
            const sourceHeight = guideRect.height * scale;

            canvas.width = Math.floor(sourceWidth);
            canvas.height = Math.floor(sourceHeight);

            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
                ctx.drawImage(
                    video, 
                    sourceX, sourceY, sourceWidth, sourceHeight, 
                    0, 0, canvas.width, canvas.height
                );
                return canvas;
            }
        } catch (e) { }
        return null;
    };

    // --- Detection Trigger ---
    useEffect(() => {
        // Only run detection if actively scanning, stream ready, not currently handling a result, not loading, AND not paused
        if (isScanningActive && isStreamReady && !isHandlingResult.current && !isLibraryLoading && !isPaused) {
            startDetection();
        } else {
            stopDetection();
        }
        return () => stopDetection();
    }, [isScanningActive, isStreamReady, isNativeSupported, isLibraryLoading, stopDetection, isPaused]);

    const startDetection = async () => {
        stopDetection(); 

        if (!detectorRef.current) return;

        const SCAN_INTERVAL_MS = 200; 

        scanIntervalRef.current = setInterval(async () => {
            if (!videoRef.current || !guideBoxRef.current || !isScanningActive || !isMountedRef.current || isPaused) return;
            if (videoRef.current.paused || videoRef.current.ended) return; 
            
            try {
                // Strictly use the cropped frame
                const croppedCanvas = cropVideoFrame(videoRef.current, guideBoxRef.current, canvasRef.current);
                if (!croppedCanvas) return;

                if (isNativeSupported) {
                    const barcodes = await detectorRef.current.detect(croppedCanvas);
                    if (barcodes.length > 0) {
                        handleSuccess(barcodes[0].rawValue);
                    }
                } else {
                    try {
                        const result = await detectorRef.current.decodeFromImage(undefined, croppedCanvas.toDataURL());
                        if (result) {
                            handleSuccess(result.getText());
                        }
                    } catch (e) { /* Not found */ }
                }
            } catch (e) { }
        }, SCAN_INTERVAL_MS);
    };

    const handleScanButtonClick = (e: React.SyntheticEvent) => {
        e.preventDefault();
        e.stopPropagation();
        unlockAudio();
        
        if (isScanningActive) {
            // [MODIFIED] If already active, restart (reset) scanning instead of stopping
            stopDetection();
            setIsScanningActive(false);
            
            // Re-activate after a very short delay to reset the detection loop
            setTimeout(() => {
                setIsScanningActive(true);
            }, 100);
        } else {
            // Start scanning
            setIsScanningActive(true);
        }
    };

    if (!isOpen) return null;

    // Dimmed overlay logic
    const showDimmedOverlay = isPaused;

    return createPortal(
        <div className={`fixed inset-0 bg-black z-[70] flex flex-col items-center justify-center transition-opacity duration-150 ease-out ${isRendered ? 'opacity-100' : 'opacity-0'}`}>
            <video 
                ref={videoRef} 
                className="absolute top-0 left-0 w-full h-full object-cover" 
                playsInline 
                muted 
                disablePictureInPicture
            />
            
            {/* Dimmed Overlay when Paused */}
            <div className={`absolute inset-0 pointer-events-none transition-all duration-300 ${showDimmedOverlay ? 'scanner-overlay-paused' : ''}`}></div>

            {/* Close Button: Always available unless covered by another modal (z-index handles that) */}
            <button 
                onClick={handleManualClose} 
                className={`absolute top-4 right-4 z-[100] p-4 bg-black/40 text-white/90 hover:bg-black/60 hover:text-white rounded-full backdrop-blur-md border border-white/10 transition-colors shadow-lg active:scale-95 touch-manipulation cursor-pointer ${isPaused ? 'opacity-0 pointer-events-none' : 'opacity-100'}`} 
                style={{ top: 'max(1rem, env(safe-area-inset-top) + 1rem)', right: '1rem' }}
                aria-label="닫기"
            >
                <XCircleIcon className="w-8 h-8" />
            </button>

            <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
                {(isLibraryLoading && !isNativeSupported) && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 backdrop-blur-[2px] z-20">
                        <SpinnerIcon className="w-10 h-10 text-white mb-3" />
                        <p className="text-white font-bold text-shadow">스캐너 준비 중...</p>
                    </div>
                )}

                <div className={`mb-6 text-center px-4 transition-opacity duration-300 ${isPaused ? 'opacity-0' : 'opacity-100'}`}>
                    <p className="text-white text-sm font-bold drop-shadow-md text-shadow bg-black/20 px-3 py-1 rounded-full backdrop-blur-sm">
                        {isScanningActive ? "가이드라인 안에 바코드를 맞추세요" : (scanSettings.useScannerButton ? "버튼을 눌러 스캔하세요" : "스캔 준비 중...")}
                    </p>
                </div>

                <div className="w-[85%] max-w-[24rem]">
                    <div ref={guideBoxRef} className={`relative h-[60px] w-full rounded-xl transition-all duration-300 ${isPaused ? 'border-2 border-white/10' : (isScanningActive ? 'scanner-box-active' : 'scanner-box-idle')}`}>
                        {!isPaused && (
                            <>
                                <div className="scanner-corner top-left"></div>
                                <div className="scanner-corner top-right"></div>
                                <div className="scanner-corner bottom-left"></div>
                                <div className="scanner-corner bottom-right"></div>
                                {isScanningActive && <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-red-500/50 transform -translate-x-1/2"></div>}
                            </>
                        )}
                    </div>
                </div>

                <div className={`w-[85%] max-w-[24rem] mt-8 flex flex-col items-center gap-4 pointer-events-auto transition-opacity duration-300 ${isPaused ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                    {scanSettings.useScannerButton && (
                        <button 
                            onMouseDown={handleScanButtonClick} 
                            onTouchStart={handleScanButtonClick} 
                            className={`w-full h-20 rounded-2xl flex items-center justify-center gap-3 shadow-xl border backdrop-blur-md transition-all active:scale-95 touch-manipulation ${isScanningActive ? 'bg-red-500/80 border-red-400 animate-pulse ring-4 ring-red-500/30' : 'bg-blue-600/80 border-white/20 hover:bg-blue-500/80'}`}
                        >
                            <BarcodeScannerIcon className="w-10 h-10 text-white" />
                            <span className="text-white font-extrabold text-2xl tracking-wider">{isScanningActive ? "재스캔" : "SCAN"}</span>
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ScannerModal;
