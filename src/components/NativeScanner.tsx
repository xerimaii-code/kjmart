
import React, { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDeviceSettings } from '../context/AppContext';
import { XCircleIcon, BarcodeScannerIcon, SpinnerIcon } from './Icons';
import './ScannerModal.css';

// @ts-ignore
import { BarcodeScanner, LensFacing } from '@capacitor-mlkit/barcode-scanning';

// Audio Context Singleton for Native Scanner Beep
let sharedAudioCtx: AudioContext | null = null;
const getAudioContext = () => {
    if (!sharedAudioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) sharedAudioCtx = new AudioContextClass();
    }
    return sharedAudioCtx;
};

interface NativeScannerProps {
    isOpen: boolean;
    onClose: () => void;
    onScanSuccess: (barcode: string) => void;
    continuous?: boolean;
    isPaused?: boolean;
}

const NativeScanner: React.FC<NativeScannerProps> = ({ isOpen, onClose, onScanSuccess, continuous = false, isPaused = false }) => {
    const { scanSettings, selectedCameraLabel } = useDeviceSettings();
    const [isAnalyzing, setIsAnalyzing] = useState(false); 
    const [cameraStatus, setCameraStatus] = useState<'preparing' | 'active' | 'error'>('preparing');
    const [timerCount, setTimerCount] = useState<number | null>(null);
    
    // Refs to track state/props without triggering effect re-runs
    const isPausedRef = useRef(isPaused);
    const isAnalyzingRef = useRef(false); 
    const scanListener = useRef<any>(null);
    const isMountedRef = useRef(false);
    const isInitializingRef = useRef(false);
    
    // Callbacks refs to prevent camera restart on prop change
    const onScanSuccessRef = useRef(onScanSuccess);
    const onCloseRef = useRef(onClose);
    const continuousRef = useRef(continuous);
    const scanSettingsRef = useRef(scanSettings);
    
    const scanTimerRef = useRef<any>(null);
    const timerIntervalRef = useRef<any>(null);
    const longPressTimerRef = useRef<any>(null);
    const touchStartTimeRef = useRef<number>(0);

    // Sync refs with props
    useEffect(() => {
        onScanSuccessRef.current = onScanSuccess;
        onCloseRef.current = onClose;
        continuousRef.current = continuous;
        scanSettingsRef.current = scanSettings;
        isPausedRef.current = isPaused;

        // If paused (modal open), we stop visual analysis indicator but KEEP CAMERA running
        if (isPaused) {
            setIsAnalyzing(false);
            isAnalyzingRef.current = false;
            clearTimers();
        }
    }, [onScanSuccess, onClose, continuous, scanSettings, isPaused]);

    useLayoutEffect(() => {
        isMountedRef.current = true;
        if (isOpen) {
            document.documentElement.classList.add('barcode-scanner-active');
            document.body.classList.add('barcode-scanner-active');
            // Init Audio
            const ctx = getAudioContext();
            if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
        }
        return () => {
            isMountedRef.current = false;
            document.documentElement.classList.remove('barcode-scanner-active');
            document.body.classList.remove('barcode-scanner-active');
            clearTimers();
        };
    }, [isOpen]);

    const playBeep = useCallback(() => {
        if (!scanSettingsRef.current.soundOnScan) return;
        const ctx = getAudioContext();
        if (!ctx) return;
        
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});

        try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = 'square';
            osc.frequency.setValueAtTime(2400, ctx.currentTime);
            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.15);
        } catch (e) {
            console.warn("Beep failed:", e);
        }
    }, []);

    const clearTimers = () => {
        if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };

    const stopCamera = useCallback(async () => {
        try {
            if (scanListener.current) {
                await scanListener.current.remove();
                scanListener.current = null;
            }
            await BarcodeScanner.stopScan();
        } catch (e) { }
    }, []);

    // [중요] startCamera는 하드웨어 설정(해상도/카메라선택)이 바뀔 때만 재생성됨.
    // onScanSuccess, onClose 등이 바뀔 때는 재생성되지 않도록 Refs 사용.
    const startCamera = useCallback(async () => {
        if (isInitializingRef.current || !isMountedRef.current) return;
        
        isInitializingRef.current = true;
        
        try {
            setCameraStatus('preparing');
            
            await BarcodeScanner.removeAllListeners();
            // Force stop to apply new settings cleanly
            try { await BarcodeScanner.stopScan(); } catch (e) {}

            const permissions = await BarcodeScanner.checkPermissions();
            if (permissions.camera !== 'granted') {
                const request = await BarcodeScanner.requestPermissions();
                if (request.camera !== 'granted') throw new Error('카메라 권한 거부됨');
            }

            scanListener.current = await BarcodeScanner.addListener('barcodeScanned', (result: any) => {
                // 1. 모달이 떠있으면(입력 중이면) 결과 무시
                if (isPausedRef.current) return;
                
                // 2. 분석 중이 아니면(스캔 버튼 안 누름) 결과 무시 -> 프리뷰는 유지
                if (!isAnalyzingRef.current || !isMountedRef.current) return;
                
                if (result.barcode.rawValue) {
                    playBeep(); 
                    
                    // 최신 콜백 실행
                    if (onScanSuccessRef.current) {
                        onScanSuccessRef.current(result.barcode.rawValue);
                    }
                    
                    if (!continuousRef.current) {
                        if (onCloseRef.current) onCloseRef.current();
                    } else {
                        handleStopScan(); // Stop analyzing visual, keep camera
                    }
                }
            });

            const formats = ['EAN_13', 'EAN_8', 'CODE_128'].map(f => String(f));
            const lensFacing = selectedCameraLabel?.toLowerCase().includes('front') ? LensFacing.Front : LensFacing.Back;
            
            // Use current settings from ref or direct prop (since this function depends on them)
            const settings = scanSettings; 
            const fpsValue = settings.scanFps === 'auto' ? 30 : (Number(settings.scanFps) || 30);

            await BarcodeScanner.startScan({ 
                formats, 
                lensFacing,
                // @ts-ignore
                resolution: settings.scanResolution || '720p',
                // @ts-ignore
                fps: fpsValue,
                detectionArea: {
                    x: 0.05, 
                    y: 0.4,  
                    width: 0.9, 
                    height: 0.15 
                }
            });
            
            if (isMountedRef.current) {
                setCameraStatus('active');
                setIsAnalyzing(false);
                isAnalyzingRef.current = false;
                
                if (settings.nativeZoomLevel) {
                    try { await BarcodeScanner.setZoomRatio({ zoomRatio: settings.nativeZoomLevel }); } catch (e) {}
                }
            }
        } catch (e: any) {
            if (isMountedRef.current) {
                setCameraStatus('error');
                if (onCloseRef.current) onCloseRef.current();
            }
        } finally {
            isInitializingRef.current = false;
        }
    }, [selectedCameraLabel, scanSettings.scanResolution, scanSettings.scanFps, playBeep]); // Reduced dependencies

    // Apply Zoom settings when they change in real-time without restarting camera
    useEffect(() => {
        if (cameraStatus === 'active' && scanSettings.nativeZoomLevel) {
            BarcodeScanner.setZoomRatio({ zoomRatio: scanSettings.nativeZoomLevel }).catch(() => {});
        }
    }, [scanSettings.nativeZoomLevel, cameraStatus]);

    // [핵심] isOpen 상태가 바뀔 때만 카메라를 시작/종료.
    // 콜백이나 기타 상태 변화는 startCamera 내부의 ref를 통해 처리되므로 이 effect는 재실행되지 않음.
    useEffect(() => {
        if (isOpen) startCamera();
        else stopCamera();
        
        return () => { stopCamera(); };
    }, [isOpen, startCamera, stopCamera]);

    const handleStartScan = useCallback(() => {
        if (isPausedRef.current) return;
        clearTimers();
        
        setIsAnalyzing(true);
        isAnalyzingRef.current = true;
        setTimerCount(5);

        scanTimerRef.current = setTimeout(() => {
            if (isMountedRef.current) {
                handleStopScan();
            }
        }, 5000);

        let count = 5;
        timerIntervalRef.current = setInterval(() => {
            count--;
            if (count <= 0) {
                clearInterval(timerIntervalRef.current);
                setTimerCount(null);
            } else {
                setTimerCount(count);
            }
        }, 1000);
    }, []);

    const handleStopScan = () => {
        clearTimers();
        setIsAnalyzing(false);
        isAnalyzingRef.current = false;
        setTimerCount(null);
    };

    const handleRefocus = useCallback(async () => {
        if (isAnalyzing) {
            handleStartScan(); 
        }
        try {
            const currentZoom = scanSettingsRef.current.nativeZoomLevel || 1.0;
            await BarcodeScanner.setZoomRatio({ zoomRatio: currentZoom + 0.1 });
            setTimeout(() => BarcodeScanner.setZoomRatio({ zoomRatio: currentZoom }), 150);
        } catch (e) {}
    }, [isAnalyzing, handleStartScan]);

    const onPointerDown = (e: React.PointerEvent) => {
        touchStartTimeRef.current = Date.now();
        longPressTimerRef.current = setTimeout(() => {
            if (isAnalyzing) handleStopScan();
            longPressTimerRef.current = null;
        }, 600);
    };

    const onPointerUp = (e: React.PointerEvent) => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
            
            const duration = Date.now() - touchStartTimeRef.current;
            if (duration < 600) {
                if (!isAnalyzing) handleStartScan();
                else handleRefocus();
            }
        }
    };

    if (!isOpen) return null;

    if (isPaused) {
        return createPortal(
            <div className="barcode-scanner-ui-layer hidden" />,
            document.body
        );
    }

    return createPortal(
        <div className="barcode-scanner-ui-layer overflow-hidden">
            <button 
                onClick={onClose} 
                className={`absolute top-4 right-4 p-4 bg-black/50 text-white rounded-full backdrop-blur-md border border-white/20 z-[150] pointer-events-auto active:scale-90 transition-all`}
                style={{ top: 'max(1rem, env(safe-area-inset-top) + 1rem)' }}
            >
                <XCircleIcon className="w-8 h-8" />
            </button>

            {cameraStatus === 'preparing' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 z-[49]">
                    <SpinnerIcon className="w-12 h-12 text-white/80 animate-spin mb-4" />
                    <p className="text-white font-bold animate-pulse text-shadow">시스템 엔진 로딩 중...</p>
                </div>
            )}

            <div className={`scanner-info-text px-6 pointer-events-none`}>
                <p className="text-white text-sm font-black tracking-tight text-shadow uppercase italic">
                    {isAnalyzing ? `SCANNING... (${timerCount}s)` : "READY TO SCAN"}
                </p>
                <p className="text-white/60 text-[10px] font-bold mt-1 text-shadow">
                    {isAnalyzing ? "Tap to refocus & reset timer" : "Tap button to start scan"}
                </p>
            </div>

            <div className={`scanner-guide-hole ${isAnalyzing ? 'active' : ''}`} />

            {cameraStatus === 'active' && (
                <>
                    <div 
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[85%] max-w-[22rem] h-24 pointer-events-auto z-[150]"
                        onPointerDown={onPointerDown}
                        onPointerUp={onPointerUp}
                    >
                        <button 
                            className={`w-full h-full rounded-2xl flex flex-col items-center justify-center shadow-[0_20px_60px_rgba(0,0,0,0.6)] transition-all active:scale-[0.96] border-2 ${isAnalyzing ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-white/95 text-slate-900 border-transparent'}`}
                        >
                            <div className="flex items-center gap-3">
                                <BarcodeScannerIcon className={`w-9 h-9 ${isAnalyzing ? 'animate-pulse' : ''}`} />
                                <span className="font-black text-2xl uppercase tracking-tighter">
                                    {isAnalyzing ? "SCANNING" : "TAP TO SCAN"}
                                </span>
                            </div>
                            {isAnalyzing && (
                                <div className="mt-1 w-24 h-1 bg-white/20 rounded-full overflow-hidden">
                                    <div className="h-full bg-white transition-all duration-1000" style={{ width: `${(timerCount || 0) * 20}%` }} />
                                </div>
                            )}
                        </button>
                    </div>
                    
                    <div className="scanner-cancel-text pointer-events-none">
                        <p className="text-white/40 text-[9px] font-black uppercase tracking-widest text-shadow">
                            {isAnalyzing ? "Hold button to stop scanning" : "ROI Restricted Mode"}
                        </p>
                    </div>
                </>
            )}
        </div>,
        document.body
    );
};

export default NativeScanner;
