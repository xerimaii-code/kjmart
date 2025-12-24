
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

// --- Global Audio Context Singleton ---
let sharedAudioCtx: AudioContext | null = null;

const getAudioContext = () => {
    if (!sharedAudioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
            sharedAudioCtx = new AudioContextClass();
        }
    }
    return sharedAudioCtx;
};

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
    const longPressTimer = useRef<any>(null);

    const { selectedCameraId, scanSettings } = useScanner();
    const { showAlert, showToast } = useAlert();
    
    // State
    const [isLibraryLoading, setIsLibraryLoading] = useState(true);
    const [isRendered, setIsRendered] = useState(false);
    const [isNativeSupported, setIsNativeSupported] = useState(false);
    const [isStreamReady, setIsStreamReady] = useState(false);
    const [isScanningActive, setIsScanningActive] = useState(false); 

    const unlockAudio = useCallback(() => {
        const ctx = getAudioContext();
        if (ctx && ctx.state === 'suspended') {
            ctx.resume().catch((e) => console.warn("Audio resume failed", e));
        }
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        unlockAudio();
        const handleInteraction = () => unlockAudio();
        window.addEventListener('touchstart', handleInteraction, { passive: true });
        window.addEventListener('click', handleInteraction);
        return () => {
            window.removeEventListener('touchstart', handleInteraction);
            window.removeEventListener('click', handleInteraction);
        };
    }, [isOpen, unlockAudio]);

    const playBeep = useCallback(() => {
        if (!scanSettings.soundOnScan) return;
        const ctx = getAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});

        try {
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);

            oscillator.type = 'square';
            const now = ctx.currentTime;
            oscillator.frequency.setValueAtTime(3000, now); 

            gainNode.gain.setValueAtTime(0, now);
            gainNode.gain.linearRampToValueAtTime(1.0, now + 0.002);
            gainNode.gain.setValueAtTime(1.0, now + 0.08);
            gainNode.gain.linearRampToValueAtTime(0, now + 0.12);

            oscillator.start(now);
            oscillator.stop(now + 0.15);
            oscillator.onended = () => {
                oscillator.disconnect();
                gainNode.disconnect();
            };
        } catch (e) { console.error("Beep failed:", e); }
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
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
        if (isMountedRef.current) setIsStreamReady(false);
    }, []);

    const startCamera = useCallback(async () => {
        if (!videoRef.current || isClosingRef.current) return;
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
            if (!isMountedRef.current || isClosingRef.current) { 
                stream.getTracks().forEach(t => t.stop()); 
                return; 
            }
            mediaStreamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.setAttribute('playsinline', 'true'); 
                videoRef.current.oncanplay = () => {
                    if (!isMountedRef.current || isClosingRef.current) return;
                    videoRef.current?.play().catch(e => console.warn("Play failed", e));
                    setIsStreamReady(true);
                };
            }
        } catch (err) {
            console.error("Camera start failed:", err);
            if (isMountedRef.current && !isClosingRef.current) { 
                showAlert("카메라를 실행할 수 없습니다."); 
                onClose(); 
            }
        }
    }, [selectedCameraId, stopCamera, showAlert, onClose]);

    useEffect(() => {
        const restartCameraIfNeeded = () => {
            if (isOpen && isMountedRef.current && !isClosingRef.current) {
                setTimeout(() => {
                    if (isMountedRef.current && !isClosingRef.current) {
                        startCamera();
                    }
                }, 200);
            }
        };
        
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                restartCameraIfNeeded();
            } else {
                stopDetection();
                stopCamera();
                if (isMountedRef.current) {
                    setIsScanningActive(false);
                }
            }
        };

        const handlePageShow = (event: PageTransitionEvent) => {
            if (event.persisted) {
                 restartCameraIfNeeded();
            }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("pageshow", handlePageShow);

        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("pageshow", handlePageShow);
        };
    }, [isOpen, startCamera, stopCamera, stopDetection]);


    const handleSuccess = useCallback((barcode: string) => {
        if (isHandlingResult.current) return;
        isHandlingResult.current = true;
        stopDetection();
        setIsScanningActive(false); 
        playBeep();
        
        if (continuous) {
            onScanSuccess(barcode);
            setTimeout(() => { 
                if (isMountedRef.current && !isPaused && !isClosingRef.current) {
                    isHandlingResult.current = false; 
                    if (!scanSettings.useScannerButton) {
                        setIsScanningActive(true);
                    }
                }
            }, 1200);
        } else {
            stopCamera();
            setTimeout(() => {
                if (isMountedRef.current) {
                    onScanSuccess(barcode);
                    onClose();
                }
            }, 100);
        }
    }, [playBeep, onScanSuccess, onClose, stopDetection, stopCamera, continuous, isPaused, scanSettings.useScannerButton]);

    const handleManualClose = (e?: React.SyntheticEvent | React.TouchEvent) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        if (isClosingRef.current) return;
        isClosingRef.current = true;
        setIsRendered(false); 
        stopDetection();
        setIsScanningActive(false);
        isHandlingResult.current = false;
        stopCamera();
        setTimeout(() => onClose(), 150); 
    };

    useEffect(() => {
        if (isPaused) {
            stopDetection();
            setIsScanningActive(false);
        } else {
            if (!isHandlingResult.current) {
                if (!scanSettings.useScannerButton && isStreamReady && !isLibraryLoading) {
                    setIsScanningActive(true);
                } else {
                    setIsScanningActive(false);
                }
            }
        }
    }, [isPaused, scanSettings.useScannerButton, isStreamReady, isLibraryLoading, stopDetection]);

    useEffect(() => {
        isMountedRef.current = true;
        if (isOpen) {
            isClosingRef.current = false;
            const timer = setTimeout(() => setIsRendered(true), 10);
            isHandlingResult.current = false;
            unlockAudio();

            if (scanSettings.useScannerButton) {
                setIsScanningActive(false);
            }

            if ('BarcodeDetector' in window) {
                BarcodeDetector.getSupportedFormats().then((supportedFormats: string[]) => {
                    if (!isMountedRef.current) return;
                    const desiredFormats = ['ean_13', 'ean_8', 'qr_code', 'code_128', 'code_39', 'itf'];
                    const validFormats = desiredFormats.filter(f => supportedFormats.includes(f));
                    if (validFormats.length > 0) {
                        setIsNativeSupported(true);
                        setIsLibraryLoading(false);
                        if (!detectorRef.current) detectorRef.current = new BarcodeDetector({ formats: validFormats });
                    } else loadZXing();
                }).catch(() => { if (isMountedRef.current) loadZXing(); });
            } else loadZXing();
            return () => clearTimeout(timer);
        } else {
            setIsRendered(false);
            setIsStreamReady(false);
            stopCamera();
            stopDetection();
        }
        return () => { isMountedRef.current = false; stopCamera(); stopDetection(); }
    }, [isOpen, stopDetection, unlockAudio, stopCamera, scanSettings.useScannerButton]);

    const loadZXing = () => {
        setIsLibraryLoading(true);
        loadScript(ZXING_CDN).then(() => {
            if (!isMountedRef.current) return;
            setIsLibraryLoading(false);
            if (!detectorRef.current) detectorRef.current = new ZXing.BrowserMultiFormatReader();
        }).catch(err => { if (isMountedRef.current) setIsLibraryLoading(false); });
    };

    useEffect(() => { if (isOpen) startCamera(); }, [isOpen, startCamera]);

    const cropVideoFrame = (video: HTMLVideoElement, guide: HTMLElement, canvas: HTMLCanvasElement) => {
        if (!video || !guide || !canvas || video.videoWidth === 0 || video.videoHeight === 0) return null;
        try {
            const videoRect = video.getBoundingClientRect();
            const guideRect = guide.getBoundingClientRect();
            if (videoRect.width === 0 || videoRect.height === 0) return null;
            const scaleX = video.videoWidth / videoRect.width;
            const scaleY = video.videoHeight / videoRect.height;
            const scale = Math.min(scaleX, scaleY);
            const sourceWidth = guideRect.width * scale;
            const sourceHeight = guideRect.height * scale;
            canvas.width = Math.floor(sourceWidth);
            canvas.height = Math.floor(sourceHeight);
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
                const offsetX = (videoRect.width * scale - video.videoWidth) / 2;
                const offsetY = (videoRect.height * scale - video.videoHeight) / 2;
                const sourceX = ((guideRect.left - videoRect.left) * scale) - offsetX;
                const sourceY = ((guideRect.top - videoRect.top) * scale) - offsetY;
                ctx.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
                return canvas;
            }
        } catch (e) { }
        return null;
    };

    useEffect(() => {
        if (isScanningActive && isStreamReady && !isHandlingResult.current && !isLibraryLoading && !isPaused) startDetection();
        else stopDetection();
        return () => stopDetection();
    }, [isScanningActive, isStreamReady, isNativeSupported, isLibraryLoading, stopDetection, isPaused]);

    const startDetection = async () => {
        stopDetection(); 
        if (!detectorRef.current) return;
        scanIntervalRef.current = setInterval(async () => {
            if (!videoRef.current || !guideBoxRef.current || !isScanningActive || !isMountedRef.current || isPaused) return;
            try {
                const croppedCanvas = cropVideoFrame(videoRef.current, guideBoxRef.current, canvasRef.current);
                if (!croppedCanvas) return;
                if (isNativeSupported) {
                    const barcodes = await detectorRef.current.detect(croppedCanvas);
                    if (barcodes.length > 0) handleSuccess(barcodes[0].rawValue);
                } else {
                    try {
                        const result = await detectorRef.current.decodeFromImage(undefined, croppedCanvas.toDataURL());
                        if (result) handleSuccess(result.getText());
                    } catch (e) { }
                }
            } catch (e) { }
        }, 200);
    };

    // 수동 스캔 버튼 제어 로직
    const handleScanButtonPress = (e: React.SyntheticEvent | React.PointerEvent) => {
        e.preventDefault(); e.stopPropagation(); unlockAudio();
        
        // 길게 누르기 타이머 시작
        longPressTimer.current = setTimeout(() => {
            if (isScanningActive) {
                setIsScanningActive(false);
                stopDetection();
                showToast("스캔 중지됨", "success");
            }
            longPressTimer.current = null;
        }, 600); // 0.6초 이상 누르면 중지

        if (isScanningActive) {
            // 이미 활성 상태인 경우: 인터벌 재설정 (초점 재조정 효과)
            stopDetection();
            setTimeout(() => {
                if (isMountedRef.current && !isPaused && !isHandlingResult.current) {
                    startDetection();
                }
            }, 50);
        } else {
            setIsScanningActive(true);
        }
    };

    const handleScanButtonRelease = (e: React.SyntheticEvent) => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className={`fixed inset-0 bg-black z-[130] flex flex-col items-center justify-center transition-opacity duration-150 ease-out ${isRendered ? 'opacity-100' : 'opacity-0'}`}>
            <video ref={videoRef} className="absolute top-0 left-0 w-full h-full object-cover" playsInline muted disablePictureInPicture />
            <div className={`absolute inset-0 pointer-events-none transition-all duration-300 ${isPaused ? 'scanner-overlay-paused' : ''}`}></div>
            <button onClick={handleManualClose} className={`absolute top-4 right-4 z-[100] p-4 bg-black/40 text-white/90 rounded-full backdrop-blur-md border border-white/10 transition-colors shadow-lg active:scale-95 touch-manipulation ${isPaused ? 'opacity-0 pointer-events-none' : 'opacity-100'}`} style={{ top: 'max(1rem, env(safe-area-inset-top) + 1rem)', right: '1rem' }} aria-label="닫기"><XCircleIcon className="w-8 h-8" /></button>
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
                {(isLibraryLoading && !isNativeSupported) && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 z-20"><SpinnerIcon className="w-10 h-10 text-white mb-3" /><p className="text-white font-bold text-shadow">스캐너 준비 중...</p></div>
                )}
                <div className={`mb-6 text-center px-4 transition-opacity duration-300 ${isPaused ? 'opacity-0' : 'opacity-100'}`}><p className="text-white text-sm font-bold text-shadow bg-black/20 px-3 py-1 rounded-full backdrop-blur-sm">{isScanningActive ? "가이드라인 안에 바코드를 맞추세요" : (scanSettings.useScannerButton ? "버튼을 눌러 스캔을 시작하세요" : "스캔 준비 중...")}</p></div>
                <div className="w-[80%] max-w-[24rem] flex flex-col items-center">
                    <div ref={guideBoxRef} className={`relative h-[45px] w-full rounded-t-xl transition-all duration-300 ${isPaused ? 'border-2 border-white/10' : (isScanningActive ? 'scanner-box-active' : 'scanner-box-idle')}`} />
                    {scanSettings.useScannerButton && !isPaused && (
                        <div className="w-full pointer-events-auto flex flex-col items-center">
                            <button 
                                onPointerDown={handleScanButtonPress}
                                onPointerUp={handleScanButtonRelease}
                                onPointerLeave={handleScanButtonRelease}
                                onContextMenu={(e) => e.preventDefault()}
                                className={`w-full h-[68px] mt-1 rounded-b-xl flex items-center justify-center backdrop-blur-md shadow-2xl active:scale-[0.98] transition-all border border-white/20 ${isScanningActive ? 'bg-indigo-600/90 text-white' : 'bg-white/90 text-gray-700'}`}
                            >
                                <div className="flex items-center gap-3">
                                    {isScanningActive ? (
                                        <>
                                            <div className="w-6 h-6 bg-red-500 rounded-md animate-pulse"></div>
                                            <span className="font-black text-xl tracking-tight uppercase">Scanning...</span>
                                        </>
                                    ) : (
                                        <>
                                            <BarcodeScannerIcon className="w-8 h-8" />
                                            <span className="font-black text-xl tracking-tight uppercase">Touch to Scan</span>
                                        </>
                                    )}
                                </div>
                            </button>
                            <div className="mt-4 flex flex-col items-center gap-1 opacity-60">
                                <p className="text-white text-[11px] font-bold text-shadow uppercase tracking-widest bg-black/30 px-3 py-1 rounded-full border border-white/10 flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-ping"></span>
                                    팁: 터치 시 초점 재조정 / 길게 누르면 중지
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ScannerModal;
