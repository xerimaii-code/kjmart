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
 * 카메라 스캔 시 빛 반사/흔들림으로 인해 잘못 읽힌(오인식) 바코드인지 판별합니다.
 * - 제어문자/특수기호 포함 또는 4자리 미만의 깨진 조각
 * - 8자리/12자리/13자리 표준 숫자 바코드인데 Modulo-10 체크섬이 틀린 경우 (카메라 오인식의 90% 이상 차지)
 */
function checkScannedBarcodeValidity(raw: string): { valid: boolean; reason?: string } {
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
    
    const scanLoopTimeoutRef = useRef<any>(null);
    const scanSessionStartTimeRef = useRef<number>(0);
    
    const gpuDetectorRef = useRef<any>(null); 
    const zxingReaderRef = useRef<any>(null);
    
    const isHandlingResult = useRef(false); 
    const isMountedRef = useRef(false);
    const isLongPressRef = useRef(false);
    // ZXing(소프트웨어 디코더) 사용 시 흔들림에 의한 1프레임 오인식을 막기 위한 이전 프레임 후보 기록
    const lastCandidateRef = useRef<{ code: string; time: number } | null>(null);
    
    const [engineMode, setEngineMode] = useState<'gpu' | 'zxing' | 'checking'>('checking');
    const [isStreamReady, setIsStreamReady] = useState(false);
    const [scanState, setScanState] = useState<'idle' | 'scanning'>('idle');
    const scanStateRef = useRef<'idle' | 'scanning'>('idle');
    const [isProcessingSuccess, setIsProcessingSuccess] = useState(false);
    const [isRendered, setIsRendered] = useState(false);
    const [timeLeft, setTimeLeft] = useState(8);
    const [currentInterval, setCurrentInterval] = useState<number>(0);

    // 카메라 오인식/형식 오류 발생 시 스캐너와 충돌하지 않는 전용 미니 확인창 상태
    const [invalidScanAlert, setInvalidScanAlert] = useState<{
        isOpen: boolean;
        barcode: string;
        reason: string;
    }>({ isOpen: false, barcode: '', reason: '' });

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
            stopScanningLoop();
            stopCamera();
        };
    }, []);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => setIsRendered(true), 10);
            isHandlingResult.current = false;
            setInvalidScanAlert({ isOpen: false, barcode: '', reason: '' });
            setScanState('idle'); 
            scanStateRef.current = 'idle'; 
            setIsProcessingSuccess(false);
            setCurrentInterval(0);
            startCamera();
        } else {
            setIsRendered(false);
            setInvalidScanAlert({ isOpen: false, barcode: '', reason: '' });
            stopCamera();
            stopScanningLoop();
        }
    }, [isOpen]);

    useEffect(() => {
        if (isOpen && isStreamReady && !scanSettings.useScannerButton && scanState === 'idle' && !isPaused && !invalidScanAlert.isOpen) {
            startScanningSession();
        }
    }, [isOpen, isStreamReady, scanSettings.useScannerButton, isPaused, invalidScanAlert.isOpen]);

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
        
        // 연속 자동 초점(continuous autofocus) 힌트 추가로 근접 바코드 스캔 정확도 향상
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

            // 하드웨어 연속 초점(continuous) 및 노출 보정 지원 시 트랙에 직접 적용
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
        setIsProcessingSuccess(true);
        onScanSuccess(barcode);
        
        if (!continuous) {
            setTimeout(() => { if (isMountedRef.current) onClose(); }, 150);
        } else {
            setTimeout(() => {
                if (isMountedRef.current) {
                    setIsProcessingSuccess(false);
                    setTimeout(() => { if (isMountedRef.current) isHandlingResult.current = false; }, 650); 
                    if (!scanSettings.useScannerButton && !invalidScanAlert.isOpen) startScanningSession();
                }
            }, 100);
        }
    };

    const handleScanResult = (rawBarcode: string) => {
        if (isHandlingResult.current || invalidScanAlert.isOpen) return;
        const barcode = (rawBarcode || '').trim();
        if (!barcode) return;

        const validity = checkScannedBarcodeValidity(barcode);

        // 만약 체크섬 불일치이거나 비표준 짧은 코드인데 1프레임만 튀어서 읽힌 경우,
        // 400ms 이내에 동일 코드가 2번 연속 읽혔는지 확인하여 순간적인 초점 흔들림 오인식을 1차 차단합니다.
        if (!validity.valid || (engineMode === 'zxing' && barcode.length !== 13 && barcode.length !== 8)) {
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
            // 형식에 어긋나거나 체크섬이 깨진 오인식 바코드일 때 작은 미니 알림창([재스캔] / [계속] / [취소]) 표시
            playBeep(true);
            setInvalidScanAlert({
                isOpen: true,
                barcode,
                reason: validity.reason || '바코드 형식이 올바르지 않습니다.'
            });
            return;
        }

        playBeep(false);
        acceptValidBarcode(barcode);
    };

    // 미니 알림창에서 [재스캔] 클릭 시: 카메라 스트림을 끄지 않고 즉시 스캔 재개
    const handleRescanFromAlert = () => {
        setInvalidScanAlert({ isOpen: false, barcode: '', reason: '' });
        isHandlingResult.current = false;
        setTimeout(() => {
            if (isMountedRef.current) {
                startScanningSession();
            }
        }, 80);
    };

    // 미니 알림창에서 [계속(그대로 사용)] 클릭 시: 비표준 자체 코드 등으로 간주하고 작업 계속 진행
    const handleContinueWithInvalidBarcode = () => {
        const codeToUse = invalidScanAlert.barcode;
        setInvalidScanAlert({ isOpen: false, barcode: '', reason: '' });
        acceptValidBarcode(codeToUse);
    };

    // 미니 알림창에서 [취소] 클릭 시: 알림창을 닫고 대기 상태(또는 스캐너 종료)로 복귀
    const handleCancelFromAlert = () => {
        setInvalidScanAlert({ isOpen: false, barcode: '', reason: '' });
        isHandlingResult.current = false;
        if (!continuous) {
            onClose();
        }
    };

    // 스캐너 하단 중앙 [저장 & 종료] 버튼 클릭 핸들러
    const handleSaveAndExitClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        stopScanningLoop();
        stopCamera();
        onClose();
        if (onSaveAndExit) {
            setTimeout(() => {
                onSaveAndExit();
            }, 120);
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
        
        if (!video || isPaused || invalidScanAlert.isOpen || isHandlingResult.current || scanStateRef.current !== 'scanning' || !guide) return;

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

                const canvas = canvasRef.current;
                canvas.width = cropW;
                canvas.height = cropH;
                const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
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
            }
        } catch (e) {}

        scheduleNextScan();
    };

    const scheduleNextScan = () => {
        if (scanStateRef.current !== 'scanning' || isHandlingResult.current || invalidScanAlert.isOpen) return;

        const now = Date.now();
        const elapsed = now - scanSessionStartTimeRef.current;
        const delay = getAdaptiveDelay(elapsed, scanSettings.scanResolution);
        
        if (delay !== currentInterval) {
            setCurrentInterval(delay);
        }

        scanLoopTimeoutRef.current = setTimeout(performScan, delay);
    };

    const startScanningSession = () => {
        if (!isStreamReady || isPaused || invalidScanAlert.isOpen) return;
        
        if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current); 
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        if (scanLoopTimeoutRef.current) clearTimeout(scanLoopTimeoutRef.current);

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
        if (!scanSettings.useScannerButton || invalidScanAlert.isOpen) return;
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
                        <p className={`text-[13px] font-black uppercase tracking-[0.25em] text-shadow transition-colors duration-300 mb-2.5 z-[2100] ${isProcessingSuccess ? 'text-green-400' : (scanState === 'scanning' ? 'text-green-400 animate-pulse' : 'text-white/80')}`}>
                            {isProcessingSuccess ? "RECOGNIZED" : (scanState === 'scanning' ? "SCANNING" : "READY")}
                        </p>
                        <div ref={guideRef} className={`scanner-guide-hole w-full transition-all duration-300 ${isProcessingSuccess ? 'success' : (scanState === 'scanning' ? 'scanning' : 'idle')}`} />
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

            {/* 화면 하단 중앙: 발주/입고 스캔 작업 중 바로 전표를 저장하고 목록으로 돌아가는 [저장 & 종료] 버튼 */}
            {onSaveAndExit && !isPaused && !invalidScanAlert.isOpen && (
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[2400] w-[85%] max-w-[20rem] pointer-events-auto safe-area-pb">
                    <button
                        type="button"
                        onClick={handleSaveAndExitClick}
                        disabled={saveAndExitCount <= 0}
                        className={`w-full h-13 py-3.5 px-5 rounded-2xl font-extrabold text-base flex items-center justify-center gap-2 shadow-2xl transition-all active:scale-95 border ${
                            saveAndExitCount > 0
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-400/50'
                                : 'bg-black/50 text-white/40 border-white/10 cursor-not-allowed'
                        }`}
                    >
                        <SaveIcon className="w-5 h-5" />
                        <span>저장 & 종료 {saveAndExitCount > 0 ? `(${saveAndExitCount}건)` : ''}</span>
                    </button>
                </div>
            )}

            {/* 카메라 오인식 / 바코드 형식 오류 시 표시되는 소형 확인창 (카메라와 충돌 없이 재스캔/계속/취소 제어) */}
            {invalidScanAlert.isOpen && (
                <div
                    className="fixed inset-0 bg-black/70 z-[2600] flex items-center justify-center p-4 animate-fade-in-down pointer-events-auto"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden border border-slate-100 p-4 space-y-3">
                        <div className="flex items-center gap-2 text-amber-600 justify-center">
                            <WarningIcon className="w-5 h-5 flex-shrink-0" />
                            <h4 className="font-extrabold text-slate-800 text-sm">바코드 인식 확인</h4>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-200 text-center">
                            <p className="font-mono font-black text-base text-rose-600 tracking-wider break-all">
                                {invalidScanAlert.barcode}
                            </p>
                            <p className="text-[11px] font-semibold text-slate-500 mt-1 leading-snug">
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
                                <span>재스캔</span>
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
                                    계속 작업
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
