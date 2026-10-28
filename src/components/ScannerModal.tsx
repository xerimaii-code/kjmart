import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useDeviceSettings, useAlert } from '../context/AppContext';
import { XCircleIcon, BarcodeScannerIcon, SpinnerIcon, SparklesIcon, BoltIcon, SaveIcon, WarningIcon } from './Icons';
import { analyzeBarcodeChecksum } from '../pages/ProductEditPage';
import './ScannerModal.css';

declare const BarcodeDetector: any;
declare const ZXing: any;

const LONG_PRESS_DURATION = 600; 
const SCAN_TIMEOUT_DURATION = 8000;

const getGlobalAudioCtx = () => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!(window as any)._kjAudioCtx || (window as any)._kjAudioCtx.state === 'closed') {
        (window as any)._kjAudioCtx = new AudioContextClass();
    }
    return (window as any)._kjAudioCtx as AudioContext;
};

/**
 * 카메라 스캔 시 바코드 유효성 및 정식 코드(EAN-13, EAN-8, UPC-A) 규칙 여부를 판별합니다.
 * - 정식 코드 규칙(8/12/13자리 숫자 + 체크섬 일치)을 벗어나면 자체코드 또는 카메라 오인식 확인창을 띄웁니다.
 */
function checkScannedBarcodeValidity(raw: string): { valid: boolean; reason?: string; isNonStandard?: boolean } {
    const code = (raw || '').trim();
    if (!code || code.length < 4) {
        return { valid: false, reason: '바코드 길이가 너무 짧습니다 (카메라 오인식 의심)' };
    }
    if (!/^[0-9A-Za-z-_]+$/.test(code)) {
        return { valid: false, reason: '유효하지 않은 문자가 포함되어 있습니다' };
    }
    const analysis = analyzeBarcodeChecksum(code);
    if (analysis.status === 'checksum_mismatch') {
        return {
            valid: false,
            reason: `표준(${analysis.standardType}) 체크섬이 일치하지 않습니다 (카메라 오인식 의심)`
        };
    }
    if (analysis.status === 'non_standard') {
        return {
            valid: false,
            isNonStandard: true,
            reason: `정식 바코드 규격(8/12/13자리)이 아닌 코드(${code.length}자리)입니다.\n자체코드로 계속 진행하거나 다시 스캔하시겠습니까?`
        };
    }
    return { valid: true };
}

interface ScannerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onScanSuccess: (barcode: string) => void;
    continuous?: boolean; 
    isPaused?: boolean;
    onSaveAndExit?: () => void;
    saveAndExitCount?: number;
}

const ScannerModal: React.FC<ScannerModalProps> = ({
    isOpen,
    onClose,
    onScanSuccess,
    continuous = false,
    isPaused = false,
    onSaveAndExit,
    saveAndExitCount = 0
}) => {
    const { scanSettings, selectedCameraId, selectedCameraLabel, setSelectedCameraId } = useDeviceSettings();
    const { showToast } = useAlert();
    
    const videoRef = useRef<HTMLVideoElement>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const guideRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
    
    const autoStopTimerRef = useRef<any>(null); 
    const countdownIntervalRef = useRef<any>(null);
    const longPressTimerRef = useRef<any>(null);
    const resumeDelayTimerRef = useRef<any>(null);
    const postScanFallbackTimerRef = useRef<any>(null);
    
    const scanLoopTimeoutRef = useRef<any>(null);
    const scanSessionStartTimeRef = useRef<number>(0);
    
    const gpuDetectorRef = useRef<any>(null); 
    const zxingReaderRef = useRef<any>(null);
    
    const isHandlingResult = useRef(false); 
    const isMountedRef = useRef(false);
    const isLongPressRef = useRef(false);
    const isPausedRef = useRef(isPaused);
    isPausedRef.current = isPaused;

    const lastCandidateRef = useRef<{ code: string; time: number } | null>(null);
    
    const [engineMode, setEngineMode] = useState<'gpu' | 'zxing' | 'checking'>('checking');
    const [isStreamReady, setIsStreamReady] = useState(false);
    const [scanState, setScanState] = useState<'idle' | 'scanning'>('idle');
    const scanStateRef = useRef<'idle' | 'scanning'>('idle');
    const [isProcessingSuccess, setIsProcessingSuccess] = useState(false);
    const [timeLeft, setTimeLeft] = useState(8);
    const [currentInterval, setCurrentInterval] = useState<number>(0);
    const [liveCount, setLiveCount] = useState<number>(() => Number((window as any).__kjScannerItemCount) || 0);

    useEffect(() => {
        setLiveCount(saveAndExitCount);
        (window as any).__kjScannerItemCount = saveAndExitCount;
    }, [saveAndExitCount, isOpen]);

    useEffect(() => {
        const handleCountUpdate = () => {
            setLiveCount(Number((window as any).__kjScannerItemCount) || 0);
        };
        window.addEventListener('kjmart-scanner-count', handleCountUpdate);
        return () => window.removeEventListener('kjmart-scanner-count', handleCountUpdate);
    }, []);
    const effectiveSaveCount = Math.max(saveAndExitCount, liveCount);

    // 카메라 오인식 / 정식 규격 외(자체코드) 스캔 시 확인창 상태
    const [invalidScanAlert, setInvalidScanAlert] = useState<{
        isOpen: boolean;
        barcode: string;
        reason: string;
        isNonStandard?: boolean;
    }>({ isOpen: false, barcode: '', reason: '' });
    const invalidScanAlertOpenRef = useRef(false);
    invalidScanAlertOpenRef.current = invalidScanAlert.isOpen;

    useEffect(() => { scanStateRef.current = scanState; }, [scanState]);

    useEffect(() => {
        isMountedRef.current = true;
        const initEngines = async () => {
            if ('BarcodeDetector' in window) {
                try {
                    const formats = await (BarcodeDetector as any).getSupportedFormats();
                    if (formats.includes('ean_13')) {
                        gpuDetectorRef.current = new BarcodeDetector({ 
                            formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] 
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
            if (resumeDelayTimerRef.current) clearTimeout(resumeDelayTimerRef.current);
            if (postScanFallbackTimerRef.current) clearTimeout(postScanFallbackTimerRef.current);
            stopScanningLoop();
            stopCamera();
        };
    }, []);

    useEffect(() => {
        if (isOpen) {
            isHandlingResult.current = false;
            lastCandidateRef.current = null;
            setInvalidScanAlert({ isOpen: false, barcode: '', reason: '' });
            setScanState('idle'); 
            scanStateRef.current = 'idle'; 
            setIsProcessingSuccess(false);
            setCurrentInterval(0);
            startCamera();
        } else {
            if (resumeDelayTimerRef.current) clearTimeout(resumeDelayTimerRef.current);
            if (postScanFallbackTimerRef.current) clearTimeout(postScanFallbackTimerRef.current);
            setInvalidScanAlert({ isOpen: false, barcode: '', reason: '' });
            stopCamera();
            stopScanningLoop();
        }
    }, [isOpen]);

    const resumeCameraFeed = useCallback(() => {
        if (!isMountedRef.current || !isOpen || isPausedRef.current || invalidScanAlertOpenRef.current) return;
        if (postScanFallbackTimerRef.current) {
            clearTimeout(postScanFallbackTimerRef.current);
            postScanFallbackTimerRef.current = null;
        }
        canvasRef.current.width = 0;
        canvasRef.current.height = 0;
        lastCandidateRef.current = null;
        try {
            if (videoRef.current && videoRef.current.paused) {
                videoRef.current.play().catch(() => {});
            }
        } catch (e) {}

        if (resumeDelayTimerRef.current) {
            clearTimeout(resumeDelayTimerRef.current);
        }
        resumeDelayTimerRef.current = setTimeout(() => {
            if (!isMountedRef.current || isPausedRef.current || invalidScanAlertOpenRef.current) return;
            try {
                if (videoRef.current && videoRef.current.paused) {
                    videoRef.current.play().catch(() => {});
                }
            } catch (e) {}
            isHandlingResult.current = false;
            setIsProcessingSuccess(false);
            if (!scanSettings.useScannerButton && scanStateRef.current === 'idle') {
                startScanningSession();
            }
        }, 150);
    }, [isOpen, scanSettings.useScannerButton]);

    useEffect(() => {
        const handleResumeEvent = () => {
            resumeCameraFeed();
        };
        window.addEventListener('kjmart-scanner-resume', handleResumeEvent);
        return () => window.removeEventListener('kjmart-scanner-resume', handleResumeEvent);
    }, [resumeCameraFeed]);

    // 수량 입력창이 뜨면(isPaused=true) 비디오 프레임과 디코딩을 즉시 정지하여 뒤쪽 깜빡임을 원천 차단하고,
    // 수량 입력창이 닫히면(isPaused=false) 즉시 비디오 재생을 재개하여 바코드 조준 화면이 움직이도록 처리
    useEffect(() => {
        if (resumeDelayTimerRef.current) {
            clearTimeout(resumeDelayTimerRef.current);
            resumeDelayTimerRef.current = null;
        }
        if (postScanFallbackTimerRef.current) {
            clearTimeout(postScanFallbackTimerRef.current);
            postScanFallbackTimerRef.current = null;
        }

        if (isPaused) {
            isHandlingResult.current = true;
            stopScanningLoop();
            setIsProcessingSuccess(false);
            lastCandidateRef.current = null;
            canvasRef.current.width = 0;
            canvasRef.current.height = 0;
            try { videoRef.current?.pause(); } catch (e) {}
            return;
        }

        if (isOpen && isStreamReady && !invalidScanAlert.isOpen) {
            resumeCameraFeed();
        }
    }, [isOpen, isStreamReady, isPaused, invalidScanAlert.isOpen, scanSettings.useScannerButton, resumeCameraFeed]);

    const playBeep = useCallback((isError = false) => {
        if (!scanSettings.soundOnScan) return;
        const ctx = getGlobalAudioCtx();
        if (!ctx) return;
        const doBeep = () => {
            try {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain); gain.connect(ctx.destination);
                osc.type = isError ? 'sawtooth' : 'square';
                const playTime = ctx.currentTime + 0.02;
                osc.frequency.setValueAtTime(isError ? 440 : 2400, playTime); 
                gain.gain.setValueAtTime(0, playTime);
                gain.gain.linearRampToValueAtTime(0.8, playTime + 0.002);
                gain.gain.setValueAtTime(0.8, playTime + (isError ? 0.14 : 0.07));
                gain.gain.linearRampToValueAtTime(0, playTime + (isError ? 0.18 : 0.1));
                osc.start(playTime); osc.stop(playTime + (isError ? 0.2 : 0.12));
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
        
        const constraintsBase: any = {
            width: { ideal: res.w }, 
            height: { ideal: res.h }, 
            frameRate: fpsConfig,
            advanced: [{ focusMode: 'continuous' }]
        };

        try {
            let devices = await navigator.mediaDevices.enumerateDevices();
            let videoDevices = devices.filter(d => d.kind === 'videoinput');
            const hasLabels = videoDevices.some(d => d.label);

            if (videoDevices.length === 0 || !hasLabels) {
                try {
                    const tempStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                    tempStream.getTracks().forEach(track => track.stop());
                    await new Promise(r => setTimeout(r, 50));
                    devices = await navigator.mediaDevices.enumerateDevices();
                    videoDevices = devices.filter(d => d.kind === 'videoinput');
                } catch (permErr) {}
            }

            let deviceIdToUse = selectedCameraId;
            const idExists = deviceIdToUse ? videoDevices.some(d => d.deviceId === deviceIdToUse) : false;

            if (!idExists && selectedCameraLabel) {
                const labelMatch = videoDevices.find(d => d.label === selectedCameraLabel);
                if (labelMatch) {
                    deviceIdToUse = labelMatch.deviceId;
                    await setSelectedCameraId(labelMatch.deviceId, labelMatch.label);
                } else {
                    deviceIdToUse = null;
                }
            }
            
            let stream: MediaStream;
            if (deviceIdToUse) {
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: { ...constraintsBase, deviceId: { exact: deviceIdToUse } }
                    });
                } catch (ConstraintErr) {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: { ...constraintsBase, facingMode: 'environment' }
                    });
                }
            } else {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { ...constraintsBase, facingMode: 'environment' }
                });
            }

            if (!isMountedRef.current) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }

            try {
                const track = stream.getVideoTracks()[0];
                const caps = (track as any)?.getCapabilities?.();
                if (caps?.focusMode?.includes?.('continuous')) {
                    await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] });
                }
            } catch (e) {}

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
        setCurrentInterval(0);
    };

    const acceptValidBarcode = (barcode: string) => {
        isHandlingResult.current = true;
        stopScanningLoop();
        canvasRef.current.width = 0;
        canvasRef.current.height = 0;
        try { videoRef.current?.pause(); } catch (e) {}

        onScanSuccess(barcode);
        
        if (!continuous) {
            setTimeout(() => { if (isMountedRef.current) onClose(); }, 80);
        } else {
            // 만약 모달이 열리지 않는 경우(예: 토스트만 표시되거나 비동기 조회 후 취소)에도 카메라가 멈추지 않도록 안전 복구
            if (postScanFallbackTimerRef.current) clearTimeout(postScanFallbackTimerRef.current);
            postScanFallbackTimerRef.current = setTimeout(() => {
                if (isMountedRef.current && !isPausedRef.current && !invalidScanAlertOpenRef.current) {
                    resumeCameraFeed();
                }
            }, 600);
        }
    };

    const handleScanResult = (rawBarcode: string) => {
        if (isHandlingResult.current || isPausedRef.current || invalidScanAlertOpenRef.current) return;
        const barcode = (rawBarcode || '').trim();
        if (!barcode) return;

        const validity = checkScannedBarcodeValidity(barcode);

        if (!validity.valid) {
            const now = Date.now();
            if (!lastCandidateRef.current || lastCandidateRef.current.code !== barcode || now - lastCandidateRef.current.time > 450) {
                lastCandidateRef.current = { code: barcode, time: now };
                scheduleNextScan();
                return;
            }
        }
        lastCandidateRef.current = null;

        isHandlingResult.current = true;
        stopScanningLoop();

        if (!validity.valid) {
            playBeep(true);
            setInvalidScanAlert({
                isOpen: true,
                barcode,
                reason: validity.reason || '바코드 형식이 올바르지 않습니다.',
                isNonStandard: validity.isNonStandard
            });
            return;
        }

        playBeep(false);
        acceptValidBarcode(barcode);
    };

    const handleRescanFromAlert = () => {
        setInvalidScanAlert({ isOpen: false, barcode: '', reason: '' });
        isHandlingResult.current = false;
        try {
            if (videoRef.current && videoRef.current.paused) {
                videoRef.current.play().catch(() => {});
            }
        } catch (e) {}
        setTimeout(() => {
            if (isMountedRef.current && !isPausedRef.current) {
                startScanningSession();
            }
        }, 80);
    };

    const handleContinueWithInvalidBarcode = () => {
        const codeToUse = invalidScanAlert.barcode;
        setInvalidScanAlert({ isOpen: false, barcode: '', reason: '' });
        acceptValidBarcode(codeToUse);
    };

    const handleCancelFromAlert = () => {
        setInvalidScanAlert({ isOpen: false, barcode: '', reason: '' });
        isHandlingResult.current = false;
        if (!continuous) {
            onClose();
        } else {
            resumeCameraFeed();
        }
    };

    const handleSaveAndExitClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        stopScanningLoop();
        stopCamera();
        onClose();
        if (onSaveAndExit) {
            setTimeout(() => {
                onSaveAndExit();
            }, 80);
        }
    };

    const getAdaptiveDelay = (elapsed: number, resolution: '480p' | '720p') => {
        if (resolution === '480p') {
            if (elapsed < 2000) return 90;
            if (elapsed < 4000) return 140;
            return 190;
        } else {
            if (elapsed < 1800) return 80;
            if (elapsed < 3500) return 130;
            if (elapsed < 5500) return 180;
            return 230;
        }
    };

    const performScan = async () => {
        const video = videoRef.current;
        const guide = guideRef.current;
        
        if (!video || isPausedRef.current || invalidScanAlertOpenRef.current || isHandlingResult.current || scanStateRef.current !== 'scanning' || !guide) return;

        try {
            const videoWidth = video.videoWidth;
            const videoHeight = video.videoHeight;
            const vw = video.clientWidth;
            const vh = video.clientHeight;

            if (videoWidth > 0 && videoHeight > 0 && vw > 0 && vh > 0) {
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

                const cropX = Math.max(0, (gX + offsetX) / scale);
                const cropY = Math.max(0, (gY + offsetY) / scale);
                const cropW = Math.min(videoWidth - cropX, gW / scale);
                const cropH = Math.min(videoHeight - cropY, gH / scale);

                if (cropW > 10 && cropH > 10) {
                    const canvas = canvasRef.current;
                    canvas.width = cropW;
                    canvas.height = cropH;
                    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
                    if (ctx) {
                        ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
                        
                        if (engineMode === 'gpu' && gpuDetectorRef.current) {
                            const barcodes = await gpuDetectorRef.current.detect(canvas);
                            if (isPausedRef.current || isHandlingResult.current || scanStateRef.current !== 'scanning') return;
                            if (barcodes.length > 0) {
                                handleScanResult(barcodes[0].rawValue);
                                return;
                            }
                        } else if (zxingReaderRef.current) {
                            const result = await zxingReaderRef.current.decodeFromCanvas(canvas);
                            if (isPausedRef.current || isHandlingResult.current || scanStateRef.current !== 'scanning') return;
                            if (result) {
                                handleScanResult(result.text);
                                return;
                            }
                        }
                    }
                }
            }
        } catch (e) {}

        scheduleNextScan();
    };

    const scheduleNextScan = () => {
        if (scanStateRef.current !== 'scanning' || isPausedRef.current || isHandlingResult.current || invalidScanAlertOpenRef.current) return;

        const now = Date.now();
        const elapsed = now - scanSessionStartTimeRef.current;
        const delay = getAdaptiveDelay(elapsed, scanSettings.scanResolution);
        
        if (delay !== currentInterval) {
            setCurrentInterval(delay);
        }

        scanLoopTimeoutRef.current = setTimeout(performScan, delay);
    };

    const startScanningSession = () => {
        if (!isStreamReady || isPausedRef.current || invalidScanAlertOpenRef.current) return;
        
        if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current); 
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        if (scanLoopTimeoutRef.current) clearTimeout(scanLoopTimeoutRef.current);

        try {
            if (videoRef.current && videoRef.current.paused) {
                videoRef.current.play().catch(() => {});
            }
        } catch (e) {}

        setScanState('scanning');
        scanStateRef.current = 'scanning';
        
        setIsProcessingSuccess(false);
        isHandlingResult.current = false;
        setTimeLeft(8);
        scanSessionStartTimeRef.current = Date.now();
        
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

    const handlePointerDown = (e: React.PointerEvent) => {
        if (!scanSettings.useScannerButton || isPausedRef.current || invalidScanAlertOpenRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        
        isLongPressRef.current = false;
        startScanningSession();

        longPressTimerRef.current = setTimeout(() => {
            if (scanStateRef.current === 'scanning') {
                isLongPressRef.current = true;
                stopScanningLoop();
            }
        }, LONG_PRESS_DURATION);
    };

    const handlePointerUp = () => {
        if (!scanSettings.useScannerButton) return;
        if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    };

    if (!isOpen) return null;

    const isPowerSaving = scanSettings.scanResolution === '480p';

    return createPortal(
        <div className="fixed inset-0 bg-black z-[130]">
            <div className="absolute inset-0 w-full h-full overflow-hidden">
                <video ref={videoRef} className={`w-full h-full object-cover ${isStreamReady ? 'opacity-100' : 'opacity-0'}`} playsInline muted />
            </div>
            
            <div className="absolute top-6 left-6 z-[2500] flex flex-col gap-2 items-start">
                {engineMode === 'gpu' && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/80 rounded-full border border-emerald-400 shadow-lg">
                        <span className="text-[10px] font-black text-white uppercase tracking-wider">GPU 가속</span>
                    </div>
                )}
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
                        {scanState === 'scanning' && currentInterval > 0 && (
                            <div className="mb-1 text-[10px] font-mono text-white/70 bg-black/20 px-1.5 rounded">
                                {currentInterval}ms
                            </div>
                        )}
                        <p className={`text-[13px] font-black uppercase tracking-[0.25em] text-shadow mb-2.5 z-[2100] ${isProcessingSuccess ? 'text-green-400' : (scanState === 'scanning' ? 'text-green-400 animate-pulse' : 'text-white/80')}`}>
                            {isProcessingSuccess ? "RECOGNIZED" : (scanState === 'scanning' ? "SCANNING" : "READY")}
                        </p>
                        <div ref={guideRef} className={`scanner-guide-hole w-full ${isProcessingSuccess ? 'success' : (scanState === 'scanning' ? 'scanning' : 'idle')}`} />
                    </div>

                    {scanSettings.useScannerButton && !isPaused && !invalidScanAlert.isOpen && (
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

            {/* 카메라 스캔 모드에서만 하단 중앙에 표시되는 소형 [저장 & 종료] 버튼 */}
            {onSaveAndExit && !isPaused && !invalidScanAlert.isOpen && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[2400] pointer-events-auto safe-area-pb">
                    <button
                        type="button"
                        onClick={handleSaveAndExitClick}
                        disabled={effectiveSaveCount <= 0}
                        className={`h-10 px-4 py-2 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-lg transition-all active:scale-95 border whitespace-nowrap ${
                            effectiveSaveCount > 0
                                ? 'bg-emerald-600/95 hover:bg-emerald-700 text-white border-emerald-400/50'
                                : 'bg-black/50 text-white/40 border-white/10 cursor-not-allowed'
                        }`}
                    >
                        <SaveIcon className="w-4 h-4" />
                        <span>저장 & 종료{effectiveSaveCount > 0 ? ` (${effectiveSaveCount})` : ''}</span>
                    </button>
                </div>
            )}

            {/* 카메라 오인식 / 정식 규격 외(자체코드) 스캔 시 확인창 ([다시 스캔] / [계속 입력] / [취소]) */}
            {invalidScanAlert.isOpen && (
                <div
                    className="fixed inset-0 bg-black/75 z-[2600] flex items-center justify-center p-4 pointer-events-auto"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden border border-slate-100 p-4 space-y-3">
                        <div className="flex items-center gap-2 text-amber-600 justify-center">
                            <WarningIcon className="w-5 h-5 flex-shrink-0" />
                            <h4 className="font-extrabold text-slate-800 text-sm">
                                {invalidScanAlert.isNonStandard ? '비표준(자체) 바코드 확인' : '바코드 인식 확인'}
                            </h4>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-200 text-center">
                            <p className="text-[10px] font-bold text-slate-400 mb-0.5">인식된 바코드</p>
                            <p className="font-mono font-black text-base text-rose-600 tracking-wider break-all">
                                {invalidScanAlert.barcode}
                            </p>
                            <p className="text-[11px] font-semibold text-slate-600 mt-1.5 leading-snug whitespace-pre-line">
                                {invalidScanAlert.reason}
                            </p>
                        </div>
                        <div className="flex flex-col gap-1.5 pt-1">
                            <button
                                type="button"
                                onClick={handleRescanFromAlert}
                                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl shadow-sm active:scale-95 transition-transform flex items-center justify-center gap-1.5"
                            >
                                <BarcodeScannerIcon className="w-4 h-4" />
                                <span>다시 스캔</span>
                            </button>
                            <div className="grid grid-cols-2 gap-1.5">
                                <button
                                    type="button"
                                    onClick={handleCancelFromAlert}
                                    className="py-2 bg-gray-100 hover:bg-gray-200 text-slate-600 font-bold text-xs rounded-xl active:scale-95 transition-transform"
                                >
                                    취소
                                </button>
                                <button
                                    type="button"
                                    onClick={handleContinueWithInvalidBarcode}
                                    className="py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl active:scale-95 transition-transform"
                                >
                                    계속 입력(자체코드)
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>,
        document.body
    );
};

export default ScannerModal;
