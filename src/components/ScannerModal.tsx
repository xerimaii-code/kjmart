
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAlert, useDeviceSettings } from '../context/AppContext';
import { loadScript } from '../services/dataService';
import { SpinnerIcon, BarcodeScannerIcon, XCircleIcon, ReturnBoxIcon, SearchIcon } from './Icons';
import './ScannerModal.css';

declare const ZXing: any;
declare const BarcodeDetector: any;

const ZXING_CDN = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.0/umd/index.min.js";
const SCAN_DURATION_MS = 5000; // 5초 스캔 제한
const ANALYSIS_INTERVAL_MS = 100; // 0.1초 간격 분석

let sharedAudioCtx: AudioContext | null = null;
const getAudioContext = () => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
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
    const timeoutRef = useRef<any>(null); 
    const longPressTimerRef = useRef<any>(null); 

    const detectorRef = useRef<any>(null); 
    const isHandlingResult = useRef(false);
    const isMountedRef = useRef(false);
    
    // selectedCameraLabel 추가 가져오기
    const { selectedCameraId, selectedCameraLabel, scanSettings } = useDeviceSettings();
    const { showToast } = useAlert();
    
    const [isLibraryLoading, setIsLibraryLoading] = useState(true);
    const [isNativeSupported, setIsNativeSupported] = useState(false);
    const [isStreamReady, setIsStreamReady] = useState(false);
    
    // 상태 관리: 'idle'(대기) | 'scanning'(분석중)
    const [scanState, setScanState] = useState<'idle' | 'scanning'>('idle');
    const scanStateRef = useRef<'idle' | 'scanning'>('idle');
    
    // 시각적 피드백용 성공 상태
    const [isProcessingSuccess, setIsProcessingSuccess] = useState(false);

    const [cameraError, setCameraError] = useState<string | null>(null);
    const [isRefocusing, setIsRefocusing] = useState(false);
    const [isRendered, setIsRendered] = useState(false);

    useEffect(() => { scanStateRef.current = scanState; }, [scanState]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.hidden) {
                stopCamera();
                stopScanningLoop();
            } else {
                if (isOpen && !isPaused) {
                    setTimeout(() => {
                        unlockAudio();
                        startCamera();
                    }, 300);
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [isOpen, isPaused]);

    useEffect(() => {
        isMountedRef.current = true;
        const initLibrary = async () => {
            if ('BarcodeDetector' in window) {
                try {
                    const formats = await BarcodeDetector.getSupportedFormats();
                    if (formats.includes('ean_13')) {
                        detectorRef.current = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'qr_code', 'code_128', 'code_39'] });
                        setIsNativeSupported(true);
                        setIsLibraryLoading(false);
                        return;
                    }
                } catch (e) { console.warn("Native BarcodeDetector failed", e); }
            }
            loadScript(ZXING_CDN).then(() => {
                if (isMountedRef.current) {
                    try {
                        if (!detectorRef.current) detectorRef.current = new ZXing.BrowserMultiFormatReader();
                        setIsLibraryLoading(false);
                    } catch (e) { setCameraError("스캐너 엔진 로드 실패"); }
                }
            });
        };
        initLibrary();
        return () => { isMountedRef.current = false; stopCamera(); stopScanningLoop(); };
    }, []);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => setIsRendered(true), 10);
            isHandlingResult.current = false;
            setScanState('idle'); 
            setIsProcessingSuccess(false);
            unlockAudio();
            startCamera();
        } else {
            setIsRendered(false);
            stopCamera();
            stopScanningLoop();
        }
    }, [isOpen]);

    useEffect(() => {
        if (isPaused) {
            stopScanningLoop(); 
            setScanState('idle'); 
            setIsProcessingSuccess(false);
        } else if (isOpen && isStreamReady && !document.hidden) {
            setScanState('idle'); 
            setIsProcessingSuccess(false);
        }
    }, [isPaused, isOpen, isStreamReady]);

    const unlockAudio = useCallback(() => {
        const ctx = getAudioContext();
        if (ctx && (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted')) {
            ctx.resume().catch(() => {});
        }
    }, []);

    const playBeep = useCallback(() => {
        if (!scanSettings.soundOnScan) return;
        const ctx = getAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') ctx.resume().catch(() => {});
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
        if (videoRef.current) { videoRef.current.pause(); videoRef.current.srcObject = null; }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => { try { track.stop(); } catch(e){} });
            mediaStreamRef.current = null;
        }
        setIsStreamReady(false);
    };

    const triggerRefocus = async () => {
        if (!mediaStreamRef.current) return;
        try {
            const track = mediaStreamRef.current.getVideoTracks()[0];
            if (!track) return;
            
            setIsRefocusing(true);
            setTimeout(() => isMountedRef.current && setIsRefocusing(false), 500);

            const capabilities = (track.getCapabilities ? track.getCapabilities() : {}) as any;
            if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
                await track.applyConstraints({ advanced: [{ focusMode: 'auto' }] } as any);
                setTimeout(async () => {
                    if (isMountedRef.current) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as any);
                }, 200);
            }
        } catch (e) { } 
    };

    const startCamera = async (retryCount = 0) => {
        if (!isMountedRef.current) return;
        stopCamera();
        setCameraError(null);
        if (retryCount > 0) await new Promise(r => setTimeout(r, 300));
        try {
            // 1. 카메라 해상도 설정
            const res = scanSettings.scanResolution || '720p';
            const widthIdeal = res === '720p' ? 1280 : 640;
            const heightIdeal = res === '720p' ? 720 : 480;
            const baseConstraints: MediaTrackConstraints = {
                width: { ideal: widthIdeal },
                height: { ideal: heightIdeal },
                facingMode: 'environment',
                advanced: [{ focusMode: 'continuous' } as any]
            };

            // 2. 스마트 카메라 ID 복구 로직 (재시작 시 ID 변경 대응)
            let finalCameraId = selectedCameraId;

            // 저장된 카메라 ID가 있을 때, 실제 유효한지 확인하고 없으면 라벨로 찾음
            if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
                try {
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    const videoDevices = devices.filter(d => d.kind === 'videoinput');
                    
                    // 선택된 카메라가 있는데, 목록에 없다면 이름으로 찾기 시도
                    if (selectedCameraId && videoDevices.length > 0) {
                        const exactMatch = videoDevices.find(d => d.deviceId === selectedCameraId);
                        
                        if (!exactMatch && selectedCameraLabel) {
                            // ID가 바뀌었지만 이름(Label)이 같은 카메라를 찾음
                            const labelMatch = videoDevices.find(d => d.label === selectedCameraLabel);
                            if (labelMatch) {
                                console.log(`Camera ID mismatch detected. Restoring by label: ${selectedCameraLabel}`);
                                finalCameraId = labelMatch.deviceId;
                            }
                        }
                    }
                } catch (e) {
                    console.warn("Failed to enumerate devices for ID check", e);
                }
            }

            let constraints = { video: baseConstraints };
            // 찾은 ID가 있다면 그걸 사용
            if (finalCameraId) { constraints.video = { ...baseConstraints, deviceId: { exact: finalCameraId } }; }
            
            let stream = null;
            try { 
                stream = await navigator.mediaDevices.getUserMedia(constraints); 
            } catch(e) {
                // 특정 ID로 실패 시 기본 카메라로 재시도
                if (finalCameraId) {
                    console.warn("Failed to get specific camera, falling back to default.");
                    stream = await navigator.mediaDevices.getUserMedia({ video: baseConstraints });
                }
                else throw e;
            }

            if (!isMountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
            mediaStreamRef.current = stream;
            
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.onloadedmetadata = async () => {
                    try {
                        await videoRef.current?.play();
                        setIsStreamReady(true);
                        triggerRefocus();
                    } catch(e) { console.error(e); }
                };
            }
        } catch (err: any) {
            if (err.name === 'NotAllowedError') setCameraError("카메라 권한이 거부되었습니다.");
            else if (retryCount < 1) startCamera(retryCount + 1);
            else setCameraError("카메라를 실행할 수 없습니다.");
        }
    };

    const stopScanningLoop = () => {
        if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null; }
        if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    };

    const handleSuccess = (barcode: string) => {
        if (isHandlingResult.current) return;
        isHandlingResult.current = true;
        
        playBeep();
        
        // [시각 효과] 성공 시 즉시 'Success' 상태로 변경 (배경 95% 암전)
        setIsProcessingSuccess(true);
        stopScanningLoop();
        
        // 잠시 후 실제 처리 및 닫기
        setTimeout(() => {
            setScanState('idle'); 
            setIsProcessingSuccess(false);

            if (continuous) {
                onScanSuccess(barcode);
                setTimeout(() => { if (isMountedRef.current && !isPaused) isHandlingResult.current = false; }, 800);
            } else {
                onScanSuccess(barcode);
                onClose();
            }
        }, 150); // 짧은 딜레이로 암전 효과 인지시킴
    };

    const enhanceImage = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
        try {
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            const factor = 1.8; 
            for (let i = 0; i < data.length; i += 4) {
                const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
                let val = (gray - 128) * factor + 128;
                val = val > 128 ? 255 : 0; 
                data[i] = val; data[i+1] = val; data[i+2] = val;
            }
            ctx.putImageData(imageData, 0, 0);
        } catch (e) { }
    };

    const startScanningSession = () => {
        if (!isStreamReady || isPaused || document.hidden) return;
        
        stopScanningLoop(); 
        setScanState('scanning');
        setIsProcessingSuccess(false);
        isHandlingResult.current = false;
        unlockAudio();
        triggerRefocus(); 

        timeoutRef.current = setTimeout(() => {
            if (scanStateRef.current === 'scanning') {
                stopScanningLoop();
                setScanState('idle');
                showToast("바코드를 찾지 못했습니다.", "error");
            }
        }, SCAN_DURATION_MS);

        scanIntervalRef.current = setInterval(async () => {
            if (!videoRef.current || !guideBoxRef.current || !canvasRef.current || isPaused || !isMountedRef.current) return;
            if (scanStateRef.current !== 'scanning') return;

            try {
                const video = videoRef.current;
                const guide = guideBoxRef.current;
                const canvas = canvasRef.current;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                
                if (!ctx || video.videoWidth === 0) return;

                const vw = video.videoWidth;
                const vh = video.videoHeight;
                const cw = video.clientWidth;
                const ch = video.clientHeight;

                const scale = Math.max(cw / vw, ch / vh);
                const renderedW = vw * scale;
                const renderedH = vh * scale;
                const offsetX = (renderedW - cw) / 2; 
                const offsetY = (renderedH - ch) / 2; 

                const guideRect = guide.getBoundingClientRect();
                const videoRect = video.getBoundingClientRect();

                const guideX_dom = guideRect.left - videoRect.left;
                const guideY_dom = guideRect.top - videoRect.top;
                const guideW_dom = guideRect.width;
                const guideH_dom = guideRect.height;

                const sx = (guideX_dom + offsetX) / scale;
                const sy = (guideY_dom + offsetY) / scale;
                const sWidth = guideW_dom / scale;
                const sHeight = guideH_dom / scale;

                canvas.width = sWidth;
                canvas.height = sHeight;

                ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
                
                if (!isNativeSupported) enhanceImage(ctx, sWidth, sHeight);

                if (isNativeSupported && detectorRef.current) {
                    const barcodes = await detectorRef.current.detect(canvas);
                    if (barcodes.length > 0) handleSuccess(barcodes[0].rawValue);
                } else if (detectorRef.current) {
                    try {
                        const result = await detectorRef.current.decodeFromCanvas(canvas);
                        if (result) handleSuccess(result.getText());
                    } catch(e) {}
                }
            } catch (e) {}
        }, ANALYSIS_INTERVAL_MS);
    };

    const handleButtonDown = (e: React.PointerEvent) => {
        e.preventDefault(); e.stopPropagation();
        
        longPressTimerRef.current = setTimeout(() => {
            stopScanningLoop();
            setScanState('idle');
            showToast("스캔 취소", "error");
            longPressTimerRef.current = null;
        }, 600);
    };

    const handleButtonUp = (e: React.PointerEvent) => {
        e.preventDefault(); e.stopPropagation();

        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;

            if (scanState === 'idle') {
                startScanningSession();
            } else {
                triggerRefocus();
                if (timeoutRef.current) clearTimeout(timeoutRef.current);
                timeoutRef.current = setTimeout(() => {
                    if (scanStateRef.current === 'scanning') {
                        stopScanningLoop();
                        setScanState('idle');
                        showToast("시간 초과", "error");
                    }
                }, SCAN_DURATION_MS);
                showToast("초점 재설정", "success");
            }
        }
    };

    const handleButtonLeave = () => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

    if (!isOpen) return null;
    const res = scanSettings.scanResolution || '480p';
    
    // 상태에 따른 가이드 박스 클래스 결정
    // isProcessingSuccess(성공 95%) > scanning(활성 85%) > idle(대기 75%)
    let guideBoxClass = 'idle';
    if (isProcessingSuccess) guideBoxClass = 'success';
    else if (scanState === 'scanning') guideBoxClass = 'scanning';

    return createPortal(
        <div className={`fixed inset-0 bg-black z-[130] flex flex-col items-center justify-center transition-opacity duration-150 ${isRendered ? 'opacity-100' : 'opacity-0'}`}>
            {/* 비디오 영역 */}
            <div className="absolute inset-0 w-full h-full overflow-hidden">
                <video ref={videoRef} className={`w-full h-full object-cover transition-opacity duration-300 ${isStreamReady ? 'opacity-100' : 'opacity-0'}`} playsInline muted />
            </div>
            
            <button onClick={(e) => { e.stopPropagation(); onClose(); }} className={`absolute top-4 right-4 p-4 bg-black/40 text-white rounded-full backdrop-blur-md border border-white/10 z-[400] active:scale-95 ${isPaused ? 'opacity-0 pointer-events-none' : 'opacity-100'}`} style={{ top: 'max(1rem, env(safe-area-inset-top) + 1rem)' }}>
                <XCircleIcon className="w-8 h-8" />
            </button>

            <div className="absolute inset-0 z-10 pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[85%] max-w-[22rem] h-0 flex flex-col items-center">
                    
                    <div className="absolute bottom-[60px] w-full flex flex-col items-center">
                        {/* 텍스트와 가이드 박스 사이 간격을 mb-1로 줄임 */}
                        <div className={`text-center px-4 transition-opacity duration-300 z-[500] mb-1 ${isPaused || cameraError ? 'opacity-0' : 'opacity-100'}`}>
                            <p className="text-white/60 text-[10px] font-black tracking-widest mb-0.5 uppercase text-shadow">
                                {res.toUpperCase()} / PRECISE-ROI / {scanState === 'scanning' ? "SCANNING" : "STANDBY"}
                            </p>
                            <p className={`text-[12px] font-black uppercase tracking-widest text-shadow transition-colors ${scanState === 'scanning' ? 'text-green-400' : 'text-slate-400'}`}>
                                {isProcessingSuccess ? "스캔 성공!" : (scanState === 'scanning' ? "박스 안에 바코드를 맞추세요" : "버튼을 눌러 스캔하세요")}
                            </p>
                        </div>
                        {/* 상태 기반 클래스 적용 */}
                        <div ref={guideBoxRef} className={`scanner-guide-hole w-full transition-all duration-300 ${guideBoxClass}`} />
                    </div>

                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[84px] pointer-events-auto z-[300]">
                        {!isPaused && isStreamReady && (
                            <button 
                                onPointerDown={handleButtonDown}
                                onPointerUp={handleButtonUp}
                                onPointerLeave={handleButtonLeave}
                                className={`w-full h-full rounded-2xl flex items-center justify-center backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] active:scale-[0.97] transition-all border-2 ${
                                    scanState === 'scanning' 
                                        ? 'bg-indigo-600/90 border-white/50 text-white' 
                                        : 'bg-white/90 border-transparent text-slate-900'
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    {scanState === 'scanning' ? (
                                        <div className="flex flex-col items-center">
                                            <div className="flex items-center gap-3">
                                                {isRefocusing ? <SpinnerIcon className="w-6 h-6 animate-spin text-white" /> : <SearchIcon className="w-6 h-6 animate-pulse" />}
                                                <span className="font-black text-2xl tracking-tighter uppercase italic">Scanning...</span>
                                            </div>
                                            <span className="text-[9px] font-medium opacity-80 mt-1">탭: 초점 / 길게: 중지</span>
                                        </div>
                                    ) : (
                                        <>
                                            <BarcodeScannerIcon className="w-10 h-10" />
                                            <span className="font-black text-2xl tracking-tighter uppercase">Touch to Scan</span>
                                        </>
                                    )}
                                </div>
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {cameraError && (
                <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center p-6 text-center z-[160]">
                    <ReturnBoxIcon className="w-16 h-16 text-rose-500 mb-6" />
                    <h4 className="text-white font-black text-xl mb-2">카메라 오류</h4>
                    <p className="text-slate-400 text-sm mb-8">{cameraError}</p>
                    <button onClick={() => startCamera(0)} className="px-10 py-4 bg-white text-slate-900 rounded-2xl font-black text-lg active:scale-95 transition-all">다시 시도</button>
                </div>
            )}
            {((isLibraryLoading && !isNativeSupported) || (!isStreamReady && !cameraError)) && (
                <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center z-[170]">
                    <SpinnerIcon className="w-12 h-12 text-white mb-4" />
                    <p className="text-white font-black tracking-widest uppercase text-xs opacity-60">Initializing Scanner...</p>
                </div>
            )}
        </div>,
        document.body
    );
};

export default ScannerModal;
