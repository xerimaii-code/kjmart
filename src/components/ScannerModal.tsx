
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAlert, useDeviceSettings } from '../context/AppContext';
import { loadScript } from '../services/dataService';
import { SpinnerIcon, BarcodeScannerIcon, XCircleIcon, ReturnBoxIcon } from './Icons';
import './ScannerModal.css';

declare const ZXing: any;
declare const BarcodeDetector: any;

const ZXING_CDN = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.0/umd/index.min.js";
const SCAN_TIMEOUT_MS = 30000; 
const ANALYSIS_INTERVAL_MS = 100; 

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
    const detectorRef = useRef<any>(null); 
    const isHandlingResult = useRef(false);
    const isMountedRef = useRef(false);
    const lastActionTimeRef = useRef<number>(Date.now());
    
    const { selectedCameraId, scanSettings } = useDeviceSettings();
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
        const handleVisibilityChange = () => {
            if (document.hidden) {
                stopCamera();
                stopDetection();
            } else {
                if (isOpen && !isPaused && !isAutoSleeping) {
                    setTimeout(() => {
                        unlockAudio();
                        startCamera();
                    }, 300);
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [isOpen, isPaused, isAutoSleeping]);

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
        return () => { isMountedRef.current = false; stopCamera(); stopDetection(); };
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

    useEffect(() => {
        if (isPaused) {
            stopDetection();
            setIsScanningActive(false); 
        } else if (isOpen && isStreamReady && !document.hidden) {
            startDetection(); 
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
            const capabilities = (track.getCapabilities ? track.getCapabilities() : {}) as any;
            if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
                setIsRefocusing(true);
                await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as any);
            }
        } catch (e) { } finally {
            setTimeout(() => isMountedRef.current && setIsRefocusing(false), 300);
        }
    };

    const startCamera = async (retryCount = 0) => {
        if (!isMountedRef.current) return;
        stopCamera();
        setCameraError(null);
        setIsAutoSleeping(false);
        if (retryCount > 0) await new Promise(r => setTimeout(r, 300));
        try {
            const res = scanSettings.scanResolution || '720p';
            const widthIdeal = res === '720p' ? 1280 : 640;
            const heightIdeal = res === '720p' ? 720 : 480;
            const baseConstraints: MediaTrackConstraints = {
                width: { ideal: widthIdeal },
                height: { ideal: heightIdeal },
                facingMode: 'environment',
                advanced: [{ focusMode: 'continuous' } as any]
            };
            let constraints = { video: baseConstraints };
            if (selectedCameraId) { constraints.video = { ...baseConstraints, deviceId: { exact: selectedCameraId } }; }
            let stream = null;
            try { stream = await navigator.mediaDevices.getUserMedia(constraints); } catch(e) {
                if (selectedCameraId) stream = await navigator.mediaDevices.getUserMedia({ video: baseConstraints });
                else throw e;
            }
            if (!isMountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
            mediaStreamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
                triggerRefocus();
                setIsStreamReady(true);
                lastActionTimeRef.current = Date.now();
            }
        } catch (err: any) {
            if (err.name === 'NotAllowedError') setCameraError("카메라 권한이 거부되었습니다.");
            else if (retryCount < 1) startCamera(retryCount + 1);
            else setCameraError("카메라를 실행할 수 없습니다.");
        }
    };

    const stopDetection = () => {
        if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null; }
    };

    const handleSuccess = (barcode: string) => {
        if (isHandlingResult.current) return;
        isHandlingResult.current = true;
        lastActionTimeRef.current = Date.now(); 
        playBeep();
        if (scanSettings.useScannerButton) setIsScanningActive(false);
        if (continuous) {
            onScanSuccess(barcode);
            setTimeout(() => { if (isMountedRef.current && !isPaused) isHandlingResult.current = false; }, 800);
        } else {
            stopDetection(); stopCamera(); onScanSuccess(barcode); onClose();
        }
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

    const startDetection = () => {
        stopDetection();
        if (!isStreamReady || isPaused || isAutoSleeping || document.hidden) return;
        scanIntervalRef.current = setInterval(async () => {
            if (!videoRef.current || !guideBoxRef.current || !canvasRef.current || isPaused || !isMountedRef.current || isAutoSleeping) return;
            if (scanSettings.useScannerButton && !isScanningActive) return;
            if (Date.now() - lastActionTimeRef.current > SCAN_TIMEOUT_MS) {
                setIsScanningActive(false); setIsAutoSleeping(true); stopCamera(); return;
            }
            
            try {
                const video = videoRef.current;
                const guide = guideBoxRef.current;
                const canvas = canvasRef.current;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                
                if (!ctx || video.videoWidth === 0) return;

                // 1. 실제 비디오 스트림 해상도
                const vw = video.videoWidth;
                const vh = video.videoHeight;

                // 2. 화면에 표시된 비디오 요소의 크기 (CSS 적용 후)
                const vRect = video.getBoundingClientRect();
                // 3. 화면에 표시된 가이드 박스의 크기와 위치
                const gRect = guide.getBoundingClientRect();

                // 4. 'object-fit: cover' 스케일 계산
                // 화면 요소 대비 비디오 원본의 비율을 구함
                // 가로 비율과 세로 비율 중 '더 작은' 쪽이 cover의 기준이 됨 (즉, 화면을 꽉 채우기 위해 더 많이 확대된 비율)
                // Math.max를 사용해야 함: 요소(vRect)에 맞추기 위해 비디오(vw, vh)가 얼마나 줄어들었는지 역산
                // scale = 비디오 원본 크기 / 화면 표시 크기 (이 값이 작을수록 비디오가 많이 축소된 것)
                // object-fit: cover는 가로/세로 중 비율이 '더 큰' 쪽을 기준으로 맞춤 (즉, 덜 축소되는 쪽)
                
                const ratioX = vw / vRect.width;
                const ratioY = vh / vRect.height;
                const scale = Math.min(ratioX, ratioY); // 원본 좌표로 변환하기 위한 스케일

                // 5. 비디오 내에서 보이는 영역(Visible Area)의 좌상단 좌표 계산
                // 화면 요소의 가로세로 비율과 비디오의 가로세로 비율 차이로 인해 잘려나간 부분 계산
                const visibleW = vRect.width * scale;
                const visibleH = vRect.height * scale;
                
                const startX = (vw - visibleW) / 2;
                const startY = (vh - visibleH) / 2;

                // 6. 가이드 박스의 상대 위치를 비디오 원본 좌표로 변환
                // (가이드박스 좌측 - 비디오요소 좌측) * 스케일 + 잘려나간 X길이
                const guideX = (gRect.left - vRect.left) * scale + startX;
                const guideY = (gRect.top - vRect.top) * scale + startY;
                const guideW = gRect.width * scale;
                const guideH = gRect.height * scale;

                // 7. [핵심] 분석 영역(ROI) 설정
                // 가이드 박스의 가로폭은 100% 사용하되, 높이는 중앙 25%만 사용하여 위아래 바코드 간섭 차단
                const cropH = guideH * 0.25;
                const cropY = guideY + (guideH - cropH) / 2;

                // 8. 캔버스 크기 설정 및 그리기
                canvas.width = guideW;
                canvas.height = cropH;

                ctx.drawImage(
                    video, 
                    guideX, cropY, guideW, cropH, // Source (Video)
                    0, 0, guideW, cropH           // Destination (Canvas)
                );
                
                if (!isNativeSupported) enhanceImage(ctx, guideW, cropH);

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

    useEffect(() => {
        if (isStreamReady && !isHandlingResult.current && !isLibraryLoading && !isAutoSleeping) {
            if (!scanSettings.useScannerButton && !isScanningActive) setIsScanningActive(true); 
            startDetection();
        } else stopDetection();
    }, [isStreamReady, isScanningActive, isPaused, isAutoSleeping, isLibraryLoading, scanSettings.useScannerButton]);

    const handleActivateScan = (e: React.SyntheticEvent) => {
        e.preventDefault(); e.stopPropagation(); 
        if (isAutoSleeping) { startCamera(); return; }
        unlockAudio(); triggerRefocus();
        lastActionTimeRef.current = Date.now();
        setIsScanningActive(true);
    };

    if (!isOpen) return null;
    const res = scanSettings.scanResolution || '480p';
    
    return createPortal(
        <div className={`fixed inset-0 bg-black z-[130] flex flex-col items-center justify-center transition-opacity duration-150 ${isRendered ? 'opacity-100' : 'opacity-0'}`}>
            <video ref={videoRef} className={`absolute top-0 left-0 w-full h-full object-cover transition-opacity duration-300 ${isStreamReady ? 'opacity-100' : 'opacity-0'}`} playsInline muted />
            
            <button onClick={(e) => { e.stopPropagation(); onClose(); }} className={`absolute top-4 right-4 p-4 bg-black/40 text-white rounded-full backdrop-blur-md border border-white/10 z-[400] active:scale-95 ${isPaused ? 'opacity-0 pointer-events-none' : 'opacity-100'}`} style={{ top: 'max(1rem, env(safe-area-inset-top) + 1rem)' }}>
                <XCircleIcon className="w-8 h-8" />
            </button>

            <div className="absolute inset-0 z-10 pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[85%] max-w-[22rem] h-0 flex flex-col items-center">
                    <div className="absolute bottom-[60px] w-full flex flex-col items-center">
                        <div className={`text-center px-4 transition-opacity duration-300 z-[500] mb-4 ${isPaused || cameraError ? 'opacity-0' : 'opacity-100'}`}>
                            <p className="text-white/40 text-[10px] font-black tracking-widest mb-1 uppercase text-shadow">
                                {res.toUpperCase()} / {isNativeSupported ? 'GPU' : 'CPU'} / HIGH-SENSITIVITY
                            </p>
                            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest text-shadow">
                                {isAutoSleeping ? "절전 모드" : (isScanningActive ? "중앙 가이드에 맞춰주세요" : "대기 중")}
                            </p>
                        </div>
                        <div ref={guideBoxRef} className={`scanner-guide-hole w-full ${(isScanningActive && !isPaused) ? 'active' : ''} ${isPaused ? 'paused-overlay' : ''} ${isAutoSleeping ? 'opacity-20' : ''}`} />
                    </div>

                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[84px] pointer-events-auto z-[300]">
                        {!isPaused && (isStreamReady || isAutoSleeping) && (
                            <button onPointerDown={handleActivateScan} className={`w-full h-full rounded-2xl flex items-center justify-center backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] active:scale-[0.97] transition-all border-2 ${isAutoSleeping ? 'bg-amber-600 border-white/30 text-white' : (isScanningActive ? 'bg-indigo-600 border-white/50 text-white' : 'bg-white/95 border-transparent text-slate-900')}`}>
                                <div className="flex items-center gap-3">
                                    {isAutoSleeping ? (
                                        <><BarcodeScannerIcon className="w-10 h-10" /><span className="font-black text-2xl tracking-tighter uppercase">Resume</span></>
                                    ) : isScanningActive ? (
                                        <div className="flex flex-col items-center">
                                            <div className="flex items-center gap-3">
                                                {isRefocusing ? <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <div className="w-6 h-6 bg-rose-500 rounded-md animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.6)]"></div>}
                                                <span className="font-black text-2xl tracking-tighter uppercase italic">Scanning...</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <><BarcodeScannerIcon className="w-10 h-10" /><span className="font-black text-2xl tracking-tighter uppercase">Touch to Scan</span></>
                                    )}
                                </div>
                            </button>
                        )}
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
                    <p className="text-white font-black tracking-widest uppercase text-xs opacity-60">Initializing Scanner...</p>
                </div>
            )}
        </div>,
        document.body
    );
};

export default ScannerModal;
