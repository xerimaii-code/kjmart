
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAlert, useDeviceSettings } from '../context/AppContext';
import { loadScript } from '../services/dataService';
import { SpinnerIcon, BarcodeScannerIcon, XCircleIcon, ReturnBoxIcon, WarningIcon } from './Icons';
import './ScannerModal.css';

declare const ZXing: any;
declare const BarcodeDetector: any;

const ZXING_CDN = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.0/umd/index.min.js";
const SCAN_TIMEOUT_MS = 30000; 
const ANALYSIS_INTERVAL_MS = 250;

// --- Web Worker: Advanced Image Processing Engine ---
const workerCode = `
    let detector = null;

    // [이미지 강화 엔진]
    function enhanceImage(imageData) {
        const data = imageData.data;
        const len = data.length;
        for (let i = 0; i < len; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            // 표준 루마 공식 사용
            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            
            // Eco Mode(저해상도)에서는 대비를 더 강하게 줌
            let val = luma;
            if (luma < 80) val = 0;        // 어두운 부분 더 어둡게
            else if (luma > 170) val = 255; // 밝은 부분 더 밝게
            else val = (luma - 80) * 2.8;   // 중간 톤 대비 증가
            
            if (val < 0) val = 0; 
            if (val > 255) val = 255;
            
            data[i] = val;
            data[i+1] = val;
            data[i+2] = val;
        }
        return imageData;
    }

    self.onmessage = async (e) => {
        const { type, imageData, formats, useEnhancement } = e.data;
        if (type === 'init') {
            if ('BarcodeDetector' in self) {
                detector = new BarcodeDetector({ formats });
            }
            return;
        }
        if (type === 'decode' && detector) {
            try {
                if (useEnhancement) {
                    enhanceImage(imageData);
                }
                const barcodes = await detector.detect(imageData);
                if (barcodes.length > 0) {
                    self.postMessage({ success: true, barcode: barcodes[0].rawValue });
                } else {
                    self.postMessage({ success: false });
                }
            } catch (err) { 
                self.postMessage({ success: false }); 
            }
        }
    };
`;

let sharedAudioCtx: AudioContext | null = null;
const getAudioContext = () => {
    if (!sharedAudioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) sharedAudioCtx = new AudioContextClass();
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
    const mediaStreamRef = useRef<MediaStream | null>(null);
    
    const scanIntervalRef = useRef<any>(null); 
    const detectorRef = useRef<any>(null); 
    const workerRef = useRef<Worker | null>(null);
    const isHandlingResult = useRef(false);
    const isMountedRef = useRef(false);
    const lastActionTimeRef = useRef<number>(Date.now());
    
    const longPressTimer = useRef<any>(null);
    const isLongPressTriggered = useRef(false);

    const { selectedCameraId, selectedCameraLabel, scanSettings, setSelectedCameraId } = useDeviceSettings();
    const { showToast } = useAlert();
    
    const [isLibraryLoading, setIsLibraryLoading] = useState(true);
    const [isNativeSupported, setIsNativeSupported] = useState(false);
    const [isStreamReady, setIsStreamReady] = useState(false);
    const [isScanningActive, setIsScanningActive] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [isAutoSleeping, setIsAutoSleeping] = useState(false);
    const [isRefocusing, setIsRefocusing] = useState(false);
    const [isRendered, setIsRendered] = useState(false);

    useEffect(() => {
        isMountedRef.current = true;
        if (typeof Worker !== 'undefined') {
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            const worker = new Worker(URL.createObjectURL(blob));
            worker.onmessage = (e) => { if (e.data.success) handleSuccess(e.data.barcode); };
            workerRef.current = worker;
        }

        const initLibrary = async () => {
            if ('BarcodeDetector' in window) {
                try {
                    const formats = await BarcodeDetector.getSupportedFormats();
                    const valid = ['ean_13', 'ean_8', 'qr_code', 'code_128', 'code_39'].filter((f: string) => formats.includes(f));
                    if (valid.length > 0) {
                        setIsNativeSupported(true);
                        setIsLibraryLoading(false);
                        workerRef.current?.postMessage({ type: 'init', formats: valid });
                        return;
                    }
                } catch (e) {}
            }
            loadScript(ZXING_CDN).then(() => {
                if (isMountedRef.current) {
                    setIsLibraryLoading(false);
                    if (!detectorRef.current) detectorRef.current = new ZXing.BrowserMultiFormatReader();
                }
            });
        };
        initLibrary();

        return () => {
            isMountedRef.current = false;
            workerRef.current?.terminate();
            stopCamera();
            stopDetection();
        };
    }, []);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => setIsRendered(true), 10);
            isHandlingResult.current = false;
            lastActionTimeRef.current = Date.now();
            unlockAudio();
            startCamera();
        } else {
            setIsRendered(false);
            stopCamera();
            stopDetection();
        }
    }, [isOpen]);

    const unlockAudio = useCallback(() => {
        const ctx = getAudioContext();
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    }, []);

    const playBeep = useCallback(() => {
        if (!scanSettings.soundOnScan) return;
        const ctx = getAudioContext();
        if (!ctx) return;
        
        // Critical: Try to resume if suspended before playing
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});

        try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = 'square';
            osc.frequency.setValueAtTime(3000, ctx.currentTime); 
            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(1.0, ctx.currentTime + 0.002);
            gain.gain.setValueAtTime(1.0, ctx.currentTime + 0.08);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
            osc.start(); osc.stop(ctx.currentTime + 0.15);
        } catch (e) {}
    }, [scanSettings.soundOnScan]);

    const stopCamera = () => {
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.srcObject = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
        setIsStreamReady(false);
    };

    const triggerRefocus = async () => {
        if (!mediaStreamRef.current) return;
        const track = mediaStreamRef.current.getVideoTracks()[0];
        if (!track) return;
        const capabilities = (track.getCapabilities ? track.getCapabilities() : {}) as any;
        if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
            setIsRefocusing(true);
            try {
                await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as any);
            } catch (e) {
            } finally {
                setTimeout(() => isMountedRef.current && setIsRefocusing(false), 300);
            }
        }
    };

    const startCamera = async (retryCount = 0) => {
        if (!isMountedRef.current) return;
        stopCamera();
        setCameraError(null);
        setIsAutoSleeping(false);
        if (retryCount > 0) await new Promise(r => setTimeout(r, 300));

        try {
            const res = scanSettings.scanResolution || '480p';
            const fpsSetting = scanSettings.scanFps;
            
            let frameRateConstraint: MediaTrackConstraints['frameRate'];
            if (fpsSetting === 'auto') {
                frameRateConstraint = { ideal: 30, max: 30 }; 
            } else {
                const fps = typeof fpsSetting === 'number' ? fpsSetting : 30;
                frameRateConstraint = { ideal: fps, max: fps };
            }

            const baseConstraints: MediaTrackConstraints = {
                width: { ideal: res === '720p' ? 1280 : 640 },
                height: { ideal: res === '720p' ? 720 : 480 },
                frameRate: frameRateConstraint,
                advanced: [{ focusMode: 'continuous' } as any]
            };

            let stream: MediaStream | null = null;

            // Strategy 1: Try exact ID if available
            if (selectedCameraId) {
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: { ...baseConstraints, deviceId: { exact: selectedCameraId } }
                    });
                } catch (e) {
                    console.warn("Saved Camera ID failed (ID might have changed). Strategy 2...");
                }
            }

            // Strategy 2: Try by Label (if ID failed or missing)
            if (!stream && selectedCameraLabel) {
                try {
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    const match = devices.find(d => d.label === selectedCameraLabel && d.kind === 'videoinput');
                    if (match) {
                        stream = await navigator.mediaDevices.getUserMedia({
                            video: { ...baseConstraints, deviceId: { exact: match.deviceId } }
                        });
                        setSelectedCameraId(match.deviceId, match.label);
                    }
                } catch (e) {
                    console.warn("Label lookup failed. Strategy 3...");
                }
            }

            // Strategy 3: Fallback to Environment (Rear)
            if (!stream) {
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: { ...baseConstraints, facingMode: 'environment' }
                    });
                } catch (e) {
                    console.warn("Environment camera failed. Strategy 4...");
                }
            }

            // Strategy 4: Ultimate Fallback - Any Video Camera
            if (!stream) {
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: baseConstraints
                    });
                } catch (e) {
                    throw new Error("카메라를 실행할 수 없습니다.");
                }
            }

            if (!isMountedRef.current) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }

            mediaStreamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
                triggerRefocus();
                setIsStreamReady(true);
                lastActionTimeRef.current = Date.now();

                // Auto-Recovery: Update Camera ID if needed
                if (selectedCameraLabel && !selectedCameraId) {
                    try {
                        const devices = await navigator.mediaDevices.enumerateDevices();
                        const match = devices.find(d => d.label === selectedCameraLabel && d.kind === 'videoinput');
                        if (match) setSelectedCameraId(match.deviceId, match.label);
                    } catch (e) {}
                }
            }
        } catch (err: any) {
            console.error("Camera Start Fatal:", err);
            if (retryCount < 1) startCamera(retryCount + 1);
            else setCameraError("카메라 권한을 허용해주세요. (설정 > 권한)");
        }
    };

    const stopDetection = () => {
        if (scanIntervalRef.current) {
            clearInterval(scanIntervalRef.current);
            scanIntervalRef.current = null;
        }
    };

    const handleSuccess = (barcode: string) => {
        if (isHandlingResult.current) return;
        isHandlingResult.current = true;
        lastActionTimeRef.current = Date.now(); 
        stopDetection(); 
        setIsScanningActive(false); 
        playBeep();
        if (continuous) {
            onScanSuccess(barcode);
            setTimeout(() => {
                if (isMountedRef.current && !isPaused) {
                    isHandlingResult.current = false;
                    if (!scanSettings.useScannerButton) setIsScanningActive(true);
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
    };

    const startDetection = () => {
        stopDetection();
        if (!isStreamReady || isPaused || isAutoSleeping) return;
        if (scanSettings.useScannerButton && !isScanningActive) return;

        scanIntervalRef.current = setInterval(async () => {
            if (!videoRef.current || !guideBoxRef.current || isPaused || !isMountedRef.current || isAutoSleeping) return;
            if (Date.now() - lastActionTimeRef.current > SCAN_TIMEOUT_MS) {
                setIsScanningActive(false);
                setIsAutoSleeping(true);
                stopCamera();
                return;
            }
            try {
                const imageData = cropGuidelineFrame(videoRef.current, guideBoxRef.current, canvasRef.current);
                if (!imageData) return;
                if (workerRef.current && isNativeSupported) {
                    workerRef.current.postMessage({ type: 'decode', imageData, useEnhancement: true }, [imageData.data.buffer]);
                } else if (isNativeSupported && 'BarcodeDetector' in window) {
                    if (!detectorRef.current) detectorRef.current = new BarcodeDetector({ formats: ['ean_13', 'qr_code'] });
                    const barcodes = await detectorRef.current.detect(imageData);
                    if (barcodes.length > 0) handleSuccess(barcodes[0].rawValue);
                } else if (detectorRef.current) {
                    const result = await detectorRef.current.decodeFromImage(undefined, canvasRef.current.toDataURL('image/jpeg', 0.8));
                    if (result) handleSuccess(result.getText());
                }
            } catch (e) {}
        }, ANALYSIS_INTERVAL_MS);
    };

    const cropGuidelineFrame = (video: HTMLVideoElement, guide: HTMLElement, canvas: HTMLCanvasElement) => {
        if (!video || !guide || !canvas || video.videoWidth === 0) return null;
        try {
            const vRect = video.getBoundingClientRect();
            const gRect = guide.getBoundingClientRect();
            
            // Calculate scale between video element and actual video stream
            const scaleX = video.videoWidth / vRect.width;
            const scaleY = video.videoHeight / vRect.height;
            const scale = Math.max(scaleX, scaleY); 
            
            const renderWidth = video.videoWidth / scale;
            const renderHeight = video.videoHeight / scale;
            const offsetX = (vRect.width - renderWidth) / 2;
            const offsetY = (vRect.height - renderHeight) / 2;
            
            // [STRICT SCAN] Increase padding to ensure we ONLY capture inside the box
            // 20px inner padding to strictly exclude outer edges
            const STRICT_PADDING = 20; 
            const safeWidth = Math.max(0, gRect.width - STRICT_PADDING * 2);
            const safeHeight = Math.max(0, gRect.height - STRICT_PADDING * 2);

            const rawWidth = Math.floor(safeWidth * scale);
            const rawHeight = Math.floor(safeHeight * scale);
            
            // Calculate start coordinates (Source X, Source Y)
            // Offset calculations adjust for "object-fit: cover" centering
            const sx = Math.floor((gRect.left - vRect.left - offsetX + STRICT_PADDING) * scale);
            const sy = Math.floor((gRect.top - vRect.top - offsetY + STRICT_PADDING) * scale);
            
            // Boundary checks to prevent crop outside video source
            if (sx < 0 || sy < 0 || sx + rawWidth > video.videoWidth || sy + rawHeight > video.videoHeight) {
                return null; 
            }

            let destWidth = rawWidth;
            let destHeight = rawHeight;
            
            // Eco Mode Downscaling - but maintain aspect ratio strictly
            if (scanSettings.enableDownscaling) {
                const MAX_ANALYSIS_WIDTH = 640; // Lower resolution for speed
                if (destWidth > MAX_ANALYSIS_WIDTH) {
                    const ratio = MAX_ANALYSIS_WIDTH / destWidth;
                    destWidth = MAX_ANALYSIS_WIDTH;
                    destHeight = Math.floor(rawHeight * ratio);
                }
            }
            
            canvas.width = destWidth;
            canvas.height = destHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
                // Ensure high quality smoothing is off for sharper pixel reading if needed, 
                // but usually standard is fine.
                ctx.drawImage(video, sx, sy, rawWidth, rawHeight, 0, 0, destWidth, destHeight);
                return ctx.getImageData(0, 0, destWidth, destHeight);
            }
        } catch (e) {}
        return null;
    };

    useEffect(() => {
        if (isStreamReady && !isHandlingResult.current && !isLibraryLoading && !isAutoSleeping) {
            if (!scanSettings.useScannerButton) { if (!isScanningActive) setIsScanningActive(true); }
            startDetection();
        } else stopDetection();
    }, [isStreamReady, isScanningActive, isPaused, isAutoSleeping, isLibraryLoading, scanSettings.useScannerButton]);

    const handleScanButtonTouchStart = (e: React.SyntheticEvent) => {
        e.preventDefault(); e.stopPropagation(); 
        unlockAudio();
        triggerRefocus(); 
        if (isAutoSleeping) { startCamera(); return; }
        lastActionTimeRef.current = Date.now();
        isLongPressTriggered.current = false;
        longPressTimer.current = setTimeout(() => {
            isLongPressTriggered.current = true;
            setIsScanningActive(false);
            showToast("스캔 일시정지", "success");
        }, 600);
    };

    const handleScanButtonTouchEnd = (e: React.SyntheticEvent) => {
        e.preventDefault(); e.stopPropagation();
        if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
        if (isLongPressTriggered.current || isAutoSleeping) return;
        if (isScanningActive) lastActionTimeRef.current = Date.now(); 
        else setIsScanningActive(true);
    };

    if (!isOpen) return null;
    const res = scanSettings.scanResolution || '480p';
    const fps = scanSettings.scanFps;
    
    let fpsText = '';
    if (fps === 'auto') fpsText = 'MAX 30'; 
    else if (fps === 24) fpsText = 'ECO';
    else fpsText = `${fps}FPS`;

    return createPortal(
        <div className={`fixed inset-0 bg-black z-[130] flex flex-col items-center justify-center transition-opacity duration-150 ${isRendered ? 'opacity-100' : 'opacity-0'}`}>
            <video ref={videoRef} className={`absolute top-0 left-0 w-full h-full object-cover transition-opacity duration-300 ${isStreamReady ? 'opacity-100' : 'opacity-0'}`} playsInline muted />
            
            <button onClick={(e) => { e.stopPropagation(); onClose(); }} className={`absolute top-4 right-4 p-4 bg-black/40 text-white rounded-full backdrop-blur-md border border-white/10 z-[400] active:scale-95 ${isPaused ? 'opacity-0 pointer-events-none' : 'opacity-100'}`} style={{ top: 'max(1rem, env(safe-area-inset-top) + 1rem)' }}>
                <XCircleIcon className="w-8 h-8" />
            </button>

            {/* Main Center Container for Alignment */}
            <div className="absolute inset-0 z-10 pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[85%] max-w-[22rem] h-0 flex flex-col items-center">
                    
                    {/* Elements ABOVE the button (Hole + Top Text) */}
                    <div className="absolute bottom-[60px] w-full flex flex-col items-center">
                        <div className={`text-center px-4 transition-opacity duration-300 z-[500] mb-4 ${isPaused || cameraError ? 'opacity-0' : 'opacity-100'}`}>
                            <p className="text-white/40 text-[10px] font-black tracking-widest mb-1 uppercase text-shadow">
                            {res.toUpperCase()} / {fpsText} {scanSettings.enableDownscaling ? '/ SMART' : ''} / STRICT
                            </p>
                            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest text-shadow">
                                {isAutoSleeping ? "절전 모드 활성화됨" : (isScanningActive ? "박스 영역에 바코드를 맞추세요" : "대기 중 (터치하여 스캔 시작)")}
                            </p>
                        </div>
                        
                        <div ref={guideBoxRef} className={`scanner-guide-hole w-full ${(isScanningActive || isPaused) ? 'active' : ''} ${isPaused ? 'paused-overlay' : ''} ${isAutoSleeping ? 'opacity-20' : ''}`} />
                    </div>

                    {/* Elements CENTERED (Button) */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[84px] pointer-events-auto z-[300]">
                        {!isPaused && (isStreamReady || isAutoSleeping) && (
                            <button onPointerDown={handleScanButtonTouchStart} onPointerUp={handleScanButtonTouchEnd} onPointerLeave={handleScanButtonTouchEnd} onContextMenu={(e) => e.preventDefault()} className={`w-full h-full rounded-2xl flex items-center justify-center backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] active:scale-[0.97] transition-all border-2 ${isAutoSleeping ? 'bg-amber-600 border-white/30 text-white' : (isScanningActive ? 'bg-indigo-600 border-white/50 text-white' : 'bg-white/95 border-transparent text-slate-900')}`}>
                                <div className="flex items-center gap-3">
                                    {isAutoSleeping ? (
                                        <><BarcodeScannerIcon className="w-10 h-10" /><span className="font-black text-2xl tracking-tighter uppercase">Resume Scan</span></>
                                    ) : isScanningActive ? (
                                        <div className="flex flex-col items-center">
                                            <div className="flex items-center gap-3">
                                                {isRefocusing ? 
                                                    (<div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>) : 
                                                    (<div className="w-6 h-6 bg-rose-500 rounded-md animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.6)]"></div>)
                                                }
                                                <span className="font-black text-2xl tracking-tighter uppercase italic">{isRefocusing ? 'Focusing...' : 'Scanning...'}</span>
                                            </div>
                                            <span className="text-[10px] font-black text-white/50 uppercase mt-1 tracking-tighter">Tap to Refocus</span>
                                        </div>
                                    ) : (
                                        <><BarcodeScannerIcon className="w-10 h-10" /><span className="font-black text-2xl tracking-tighter uppercase">Touch to Scan</span></>
                                    )}
                                </div>
                            </button>
                        )}
                    </div>

                    {/* Elements BELOW the button (Bottom Text) */}
                    <div className="absolute top-[48px] w-full flex flex-col items-center pt-2">
                        <div className={`mt-2 flex flex-col items-center gap-1 transition-opacity duration-300 z-[500] ${isPaused || cameraError ? 'opacity-0' : 'opacity-100'}`}>
                            <p className="text-slate-400 text-[9px] font-bold uppercase tracking-widest flex items-center gap-1.5 text-shadow">
                                {isAutoSleeping ? (<><WarningIcon className="w-3 h-3 text-amber-500" /> 배터리 보호를 위해 카메라를 종료했습니다</>) : (<><span className={`w-1.5 h-1.5 rounded-full ${isScanningActive ? 'bg-indigo-400 animate-ping' : 'bg-slate-600'}`}></span>
                                    {isScanningActive ? "실시간 이미지 강화 엔진 가동 중" : "절전 모드: 프로세스 대기"}</>)}
                            </p>
                        </div>
                    </div>

                </div>
            </div>

            {cameraError && !isAutoSleeping && (
                <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center p-6 text-center z-[160]">
                    <ReturnBoxIcon className="w-16 h-16 text-rose-500 mb-6" />
                    <h4 className="text-white font-black text-xl mb-2">카메라 오류</h4>
                    <p className="text-slate-400 text-sm mb-8">{cameraError}</p>
                    <button onClick={() => startCamera(0)} className="px-10 py-4 bg-white text-slate-900 rounded-2xl font-black text-lg active:scale-95 transition-all">다시 시도</button>
                </div>
            )}
            {((isLibraryLoading && !isNativeSupported) || (!isStreamReady && !cameraError && !isAutoSleeping)) && (
                <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center z-[170]">
                    <SpinnerIcon className="w-12 h-12 text-white mb-4" />
                    <p className="text-white font-black tracking-widest uppercase text-xs opacity-60">
                        {isLibraryLoading ? "Loading Vision Engine..." : "Warming up Camera..."}
                    </p>
                </div>
            )}
        </div>,
        document.body
    );
};

export default ScannerModal;
