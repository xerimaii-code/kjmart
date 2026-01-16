
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useDeviceSettings, useAlert } from '../context/AppContext';
import { XCircleIcon, BarcodeScannerIcon, SpinnerIcon, SparklesIcon, BoltIcon } from './Icons';
import './ScannerModal.css';

declare const BarcodeDetector: any;
declare const ZXing: any;

const LONG_PRESS_DURATION = 600; 
const SCAN_TIMEOUT_DURATION = 8000; // 8s to accommodate slower phases

const getGlobalAudioCtx = () => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!(window as any)._kjAudioCtx || (window as any)._kjAudioCtx.state === 'closed') {
        (window as any)._kjAudioCtx = new AudioContextClass();
    }
    return (window as any)._kjAudioCtx as AudioContext;
};

interface ScannerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onScanSuccess: (barcode: string) => void;
    continuous?: boolean; 
    isPaused?: boolean;
}

const ScannerModal: React.FC<ScannerModalProps> = ({ isOpen, onClose, onScanSuccess, continuous = false, isPaused = false }) => {
    const { scanSettings, selectedCameraId, selectedCameraLabel, setSelectedCameraId } = useDeviceSettings();
    const { showToast } = useAlert();
    
    const videoRef = useRef<HTMLVideoElement>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const guideRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
    
    const autoStopTimerRef = useRef<any>(null); 
    const countdownIntervalRef = useRef<any>(null);
    const longPressTimerRef = useRef<any>(null);
    
    // Dynamic interval refs
    const scanLoopTimeoutRef = useRef<any>(null);
    const scanSessionStartTimeRef = useRef<number>(0);
    
    const gpuDetectorRef = useRef<any>(null); 
    const zxingReaderRef = useRef<any>(null);
    
    const isHandlingResult = useRef(false); 
    const isMountedRef = useRef(false);
    const isLongPressRef = useRef(false);
    
    const [engineMode, setEngineMode] = useState<'gpu' | 'zxing' | 'checking'>('checking');
    const [isStreamReady, setIsStreamReady] = useState(false);
    const [scanState, setScanState] = useState<'idle' | 'scanning'>('idle');
    const scanStateRef = useRef<'idle' | 'scanning'>('idle');
    const [isProcessingSuccess, setIsProcessingSuccess] = useState(false);
    const [isRendered, setIsRendered] = useState(false);
    const [timeLeft, setTimeLeft] = useState(8);
    const [currentInterval, setCurrentInterval] = useState<number>(0); // Display current ms

    // Sync state to ref (Backup mechanism)
    useEffect(() => { scanStateRef.current = scanState; }, [scanState]);

    useEffect(() => {
        isMountedRef.current = true;
        const initEngines = async () => {
            if ('BarcodeDetector' in window) {
                try {
                    const formats = await (BarcodeDetector as any).getSupportedFormats();
                    if (formats.includes('ean_13')) {
                        gpuDetectorRef.current = new BarcodeDetector({ 
                            formats: ['ean_13', 'ean_8', 'qr_code', 'code_128', 'code_39'] 
                        });
                        setEngineMode('gpu');
                        return;
                    }
                } catch (e) {}
            }
            setEngineMode('zxing');
        };
        initEngines();
        return () => {
            isMountedRef.current = false;
            stopScanningLoop();
            stopCamera();
        };
    }, []);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => setIsRendered(true), 10);
            isHandlingResult.current = false;
            setScanState('idle'); 
            scanStateRef.current = 'idle'; 
            setIsProcessingSuccess(false);
            setCurrentInterval(0);
            startCamera();
        } else {
            setIsRendered(false);
            stopCamera();
            stopScanningLoop();
        }
    }, [isOpen]);

    useEffect(() => {
        if (isOpen && isStreamReady && !scanSettings.useScannerButton && scanState === 'idle' && !isPaused) {
            startScanningSession();
        }
    }, [isOpen, isStreamReady, scanSettings.useScannerButton, isPaused]);

    const playBeep = useCallback(() => {
        if (!scanSettings.soundOnScan) return;
        const ctx = getGlobalAudioCtx();
        if (!ctx) return;
        const doBeep = () => {
            try {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain); gain.connect(ctx.destination);
                osc.type = 'square';
                const playTime = ctx.currentTime + 0.05;
                osc.frequency.setValueAtTime(2400, playTime); 
                gain.gain.setValueAtTime(0, playTime);
                gain.gain.linearRampToValueAtTime(0.8, playTime + 0.002);
                gain.gain.setValueAtTime(0.8, playTime + 0.07);
                gain.gain.linearRampToValueAtTime(0, playTime + 0.1);
                osc.start(playTime); osc.stop(playTime + 0.12);
            } catch (e) {}
        };
        if (ctx.state !== 'running') ctx.resume().then(doBeep).catch(doBeep);
        else doBeep();
    }, [scanSettings.soundOnScan]);

    const stopCamera = () => {
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
        if (videoRef.current) videoRef.current.srcObject = null;
        setIsStreamReady(false);
    };

    const startCamera = async () => {
        if (!isMountedRef.current || !navigator.mediaDevices?.enumerateDevices) return;
        stopCamera();

        const res = scanSettings.scanResolution === '480p' ? { w: 854, h: 480 } : { w: 1280, h: 720 };
        const fpsConfig = scanSettings.scanFps === 'auto' ? { ideal: 30 } : { ideal: scanSettings.scanFps };
        
        const constraintsBase = {
            width: { ideal: res.w }, 
            height: { ideal: res.h }, 
            frameRate: fpsConfig
        };

        try {
            // Step 1: Enumerate devices to check for labels.
            let devices = await navigator.mediaDevices.enumerateDevices();
            let videoDevices = devices.filter(d => d.kind === 'videoinput');
            const hasLabels = videoDevices.some(d => d.label);

            // Step 2: If no labels, request permission to get them.
            if (!hasLabels && videoDevices.length > 0) {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                    stream.getTracks().forEach(track => track.stop());
                    devices = await navigator.mediaDevices.enumerateDevices();
                    videoDevices = devices.filter(d => d.kind === 'videoinput');
                } catch (permErr) {
                    // Ignore permission error here, will be caught later.
                }
            }

            // Step 3: Device ID recovery logic.
            let deviceIdToUse = selectedCameraId;
            const idExists = videoDevices.some(d => d.deviceId === deviceIdToUse);

            if (deviceIdToUse && !idExists && selectedCameraLabel) {
                const labelMatch = videoDevices.find(d => d.label === selectedCameraLabel);
                if (labelMatch) {
                    console.log(`Recovered camera via label: ${labelMatch.label}`);
                    deviceIdToUse = labelMatch.deviceId;
                    // Persist the new recovered ID for next time.
                    await setSelectedCameraId(labelMatch.deviceId, labelMatch.label);
                }
            }
            
            // Step 4: Get the final stream with the correct device ID.
            const stream = await navigator.mediaDevices.getUserMedia({
                video: deviceIdToUse
                    ? { ...constraintsBase, deviceId: { exact: deviceIdToUse } }
                    : { ...constraintsBase, facingMode: 'environment' }
            });

            if (!isMountedRef.current) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }

            mediaStreamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play().catch(() => {});
                setIsStreamReady(true);
            }

        } catch (err: any) { 
            console.error("Camera access failed", err); 
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                showToast("카메라 권한이 필요합니다.", "error");
            } else {
                showToast("카메라를 시작할 수 없습니다. 설정에서 다른 카메라를 선택해보세요.", "error");
            }
        }
    };

    const stopScanningLoop = () => {
        if (scanLoopTimeoutRef.current) { clearTimeout(scanLoopTimeoutRef.current); scanLoopTimeoutRef.current = null; }
        if (autoStopTimerRef.current) { clearTimeout(autoStopTimerRef.current); autoStopTimerRef.current = null; }
        if (countdownIntervalRef.current) { clearInterval(countdownIntervalRef.current); countdownIntervalRef.current = null; }
        
        setScanState('idle');
        scanStateRef.current = 'idle';
        setCurrentInterval(0); // Reset display
    };

    const handleScanResult = (barcode: string) => {
        if (isHandlingResult.current) return;
        isHandlingResult.current = true;
        stopScanningLoop();
        playBeep();
        setIsProcessingSuccess(true);
        onScanSuccess(barcode);
        
        if (!continuous) {
            setTimeout(() => { if (isMountedRef.current) onClose(); }, 150);
        } else {
            setTimeout(() => {
                if (isMountedRef.current) {
                    setIsProcessingSuccess(false);
                    setTimeout(() => { if (isMountedRef.current) isHandlingResult.current = false; }, 800); 
                    if (!scanSettings.useScannerButton) startScanningSession();
                }
            }, 100);
        }
    };

    // --- Adaptive Delay Logic (4-step phase) ---
    const getAdaptiveDelay = (elapsed: number, resolution: '480p' | '720p') => {
        if (resolution === '480p') {
            // [Power Saving Mode] 100ms ~ 200ms
            if (elapsed < 2000) return 100;  // 0~2s: 10fps
            if (elapsed < 4000) return 150;  // 2~4s: 6.6fps
            return 200;                      // 4s+: 5fps (Low Heat)
        } else {
            // [Quality Priority] 100ms ~ 250ms
            if (elapsed < 1500) return 100;  // 0~1.5s: 10fps
            if (elapsed < 3000) return 150;  // 1.5~3s: 6.6fps
            if (elapsed < 5000) return 200;  // 3~5s: 5fps
            return 250;                      // 5s+: 4fps
        }
    };

    const performScan = async () => {
        const video = videoRef.current;
        const guide = guideRef.current;
        
        if (!video || isPaused || isHandlingResult.current || scanStateRef.current !== 'scanning' || !guide) return;

        try {
            const videoWidth = video.videoWidth;
            const videoHeight = video.videoHeight;
            const vw = video.clientWidth;
            const vh = video.clientHeight;

            const scale = Math.max(vw / videoWidth, vh / videoHeight);
            const dW = videoWidth * scale;
            const dH = videoHeight * scale;
            const offsetX = (dW - vw) / 2;
            const offsetY = (dH - vh) / 2;

            const rect = guide.getBoundingClientRect();
            const containerRect = video.parentElement?.getBoundingClientRect() || { left: 0, top: 0 };
            
            const gX = rect.left - containerRect.left;
            const gY = rect.top - containerRect.top;
            const gW = rect.width;
            const gH = rect.height;

            const cropX = (gX + offsetX) / scale;
            const cropY = (gY + offsetY) / scale;
            const cropW = gW / scale;
            const cropH = gH / scale;

            const canvas = canvasRef.current;
            canvas.width = cropW;
            canvas.height = cropH;
            const ctx = canvas.getContext('2d', { alpha: false });
            if (ctx) {
                ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
                
                if (engineMode === 'gpu' && gpuDetectorRef.current) {
                    const barcodes = await gpuDetectorRef.current.detect(canvas);
                    if (barcodes.length > 0) {
                        handleScanResult(barcodes[0].rawValue);
                        return;
                    }
                } else if (zxingReaderRef.current) {
                    const result = await zxingReaderRef.current.decodeFromCanvas(canvas);
                    if (result) {
                        handleScanResult(result.text);
                        return;
                    }
                }
            }
        } catch (e) {}

        scheduleNextScan();
    };

    const scheduleNextScan = () => {
        if (scanStateRef.current !== 'scanning' || isHandlingResult.current) return;

        const now = Date.now();
        const elapsed = now - scanSessionStartTimeRef.current;
        const delay = getAdaptiveDelay(elapsed, scanSettings.scanResolution);
        
        // Only update state if delay changes to avoid re-renders
        if (delay !== currentInterval) {
            setCurrentInterval(delay);
        }

        scanLoopTimeoutRef.current = setTimeout(performScan, delay);
    };

    const startScanningSession = () => {
        if (!isStreamReady || isPaused) return;
        
        if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current); 
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        if (scanLoopTimeoutRef.current) clearTimeout(scanLoopTimeoutRef.current);

        setScanState('scanning');
        scanStateRef.current = 'scanning';
        
        setIsProcessingSuccess(false);
        isHandlingResult.current = false;
        setTimeLeft(8);
        scanSessionStartTimeRef.current = Date.now();
        
        // Initial delay set
        const initialDelay = getAdaptiveDelay(0, scanSettings.scanResolution);
        setCurrentInterval(initialDelay);

        if (scanSettings.useScannerButton) {
            autoStopTimerRef.current = setTimeout(() => {
                if (scanStateRef.current === 'scanning' && isMountedRef.current) {
                    stopScanningLoop();
                    showToast("바코드를 찾지 못했습니다.", "error");
                }
            }, SCAN_TIMEOUT_DURATION);

            countdownIntervalRef.current = setInterval(() => {
                setTimeLeft(prev => Math.max(0, prev - 1));
            }, 1000);
        }

        if (!zxingReaderRef.current && engineMode === 'zxing' && typeof ZXing !== 'undefined') {
            zxingReaderRef.current = new ZXing.BrowserMultiFormatReader();
        }

        scheduleNextScan();
    };

    // Use onPointerDown for instant manual scan response
    const handlePointerDown = (e: React.PointerEvent) => {
        if (!scanSettings.useScannerButton) return;
        e.preventDefault(); // Prevent accidental selection/scrolling
        e.stopPropagation();
        
        isLongPressRef.current = false;
        
        // Start scanning immediately on touch down
        startScanningSession();

        longPressTimerRef.current = setTimeout(() => {
            if (scanStateRef.current === 'scanning') {
                isLongPressRef.current = true;
                stopScanningLoop();
            }
        }, LONG_PRESS_DURATION);
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (!scanSettings.useScannerButton) return;
        if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
        // Do nothing on up, as scanning started on down.
    };

    if (!isOpen) return null;

    const isPowerSaving = scanSettings.scanResolution === '480p';

    return createPortal(
        <div className={`fixed inset-0 bg-black z-[130] transition-opacity duration-150 ${isRendered ? 'opacity-100' : 'opacity-0'}`}>
            <div className="absolute inset-0 w-full h-full overflow-hidden">
                <video ref={videoRef} className={`w-full h-full object-cover transition-opacity duration-500 ${isStreamReady ? 'opacity-100' : 'opacity-0'}`} playsInline muted />
            </div>
            
            <div className="absolute top-6 left-6 z-[2500] flex flex-col gap-2 items-start animate-fade-in-down">
                {engineMode === 'gpu' && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/80 rounded-full border border-emerald-400 shadow-lg">
                        <span className="text-[10px] font-black text-white uppercase tracking-wider">GPU 가속</span>
                    </div>
                )}
                {/* Mode Tip */}
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border shadow-lg ${isPowerSaving ? 'bg-indigo-500/80 border-indigo-400' : 'bg-blue-500/80 border-blue-400'}`}>
                    {isPowerSaving ? <BoltIcon className="w-3 h-3 text-white" /> : <SparklesIcon className="w-3 h-3 text-white" />}
                    <span className="text-[10px] font-black text-white uppercase tracking-wider">
                        {isPowerSaving ? '절전 모드 (발열↓)' : '고화질 (인식률↑)'}
                    </span>
                </div>
            </div>

            <button onClick={onClose} className="absolute top-4 right-4 p-4 bg-black/40 text-white rounded-full z-[2500] active:scale-95 touch-none">
                <XCircleIcon className="w-8 h-8" />
            </button>

            <div className="absolute inset-0 z-[2000] pointer-events-none flex flex-col items-center justify-center">
                <div className="w-[85%] max-w-[22rem] flex flex-col items-center relative">
                    
                    <div className="w-full flex flex-col items-center absolute bottom-full mb-[10px]">
                        {/* Current Interval Indicator */}
                        {scanState === 'scanning' && currentInterval > 0 && (
                            <div className="mb-1 text-[10px] font-mono text-white/70 bg-black/20 px-1.5 rounded">
                                {currentInterval}ms
                            </div>
                        )}
                        <p className={`text-[13px] font-black uppercase tracking-[0.25em] text-shadow transition-colors duration-300 mb-2.5 z-[2100] ${isProcessingSuccess ? 'text-green-400' : (scanState === 'scanning' ? 'text-green-400 animate-pulse' : 'text-white/80')}`}>
                            {isProcessingSuccess ? "RECOGNIZED" : (scanState === 'scanning' ? "SCANNING" : "READY")}
                        </p>
                        <div ref={guideRef} className={`scanner-guide-hole w-full transition-all duration-300 ${isProcessingSuccess ? 'success' : (scanState === 'scanning' ? 'scanning' : 'idle')}`} />
                    </div>

                    {scanSettings.useScannerButton && !isPaused && (
                        <div className="w-full h-[75px] pointer-events-auto z-[2100]">
                            <button 
                                onPointerDown={handlePointerDown}
                                onPointerUp={handlePointerUp}
                                disabled={!isStreamReady}
                                className={`w-full h-full rounded-2xl flex items-center justify-center shadow-2xl active:scale-[0.96] transition-all border-2 touch-none select-none ${!isStreamReady ? 'bg-black/60 border-gray-500 text-white' : scanState === 'scanning' ? 'bg-indigo-600/90 border-white/40 text-white' : 'bg-white/95 border-transparent text-slate-900'}`}
                            >
                                {!isStreamReady ? (
                                    <div className="flex items-center gap-2"><SpinnerIcon className="w-6 h-6 animate-spin text-white" /><span className="text-xs font-black uppercase tracking-widest">Loading...</span></div>
                                ) : scanState === 'scanning' ? (
                                    <div className="flex items-center gap-3">
                                        <span className="font-black text-2xl tracking-tighter uppercase italic">Scanning</span>
                                        <div className="bg-white/20 px-2.5 py-0.5 rounded-lg border border-white/20">
                                            <span className="text-xl font-black font-mono">{timeLeft}s</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-4">
                                        <BarcodeScannerIcon className="w-9 h-9 text-indigo-600" />
                                        <span className="font-black text-2xl tracking-tight uppercase">Touch to Scan</span>
                                    </div>
                                )}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ScannerModal;
