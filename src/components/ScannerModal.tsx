import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useScanner, useAlert } from '../context/AppContext';
import { SpinnerIcon, BarcodeScannerIcon, XMarkIcon } from './Icons';
import { Capacitor } from '@capacitor/core';
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import './ScannerModal.css';

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
    const guideBoxRef = useRef<HTMLDivElement>(null); 
    const isHandlingResult = useRef(false);
    const mlKitListener = useRef<any>(null);

    const { selectedCameraId, scanSettings } = useScanner();
    const { showToast } = useAlert();
    
    const [isScanningActive, setIsScanningActive] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);

    const isAppNative = Capacitor.isNativePlatform();

    const playBeep = useCallback(() => {
        if (!scanSettings.soundOnScan) return;
        const ctx = getAudioContext();
        if (!ctx) return;
        try {
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);
            oscillator.type = 'square';
            oscillator.frequency.setValueAtTime(3000, ctx.currentTime); 
            gainNode.gain.setValueAtTime(0, ctx.currentTime);
            gainNode.gain.linearRampToValueAtTime(1.0, ctx.currentTime + 0.002);
            gainNode.gain.setValueAtTime(1.0, ctx.currentTime + 0.08);
            gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
            oscillator.start(); oscillator.stop(ctx.currentTime + 0.15);
        } catch (e) {}
    }, [scanSettings.soundOnScan]);

    const stopDetection = useCallback(async () => {
        if (isAppNative) {
            try {
                if (mlKitListener.current) {
                    await mlKitListener.current.remove();
                    mlKitListener.current = null;
                }
                await BarcodeScanner.stopScan();
                document.body.classList.remove('scanner-active');
            } catch (e) {}
        }
    }, [isAppNative]);

    const stopCamera = useCallback(() => {
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.srcObject = null;
        }
    }, []);

    const startCamera = useCallback(async () => {
        if (isAppNative) {
            try {
                const status = await BarcodeScanner.requestPermissions();
                if (status.camera !== 'granted') {
                    setCameraError("카메라 권한이 필요합니다.");
                    return;
                }

                document.body.classList.add('scanner-active');
                await BarcodeScanner.startScan(); 
                
                if (mlKitListener.current) await mlKitListener.current.remove();
                mlKitListener.current = await BarcodeScanner.addListener('barcodeScanned', async (result) => {
                    // 수동 버튼 모드일 때, 버튼이 활성화된 상태가 아니면 무시
                    if (scanSettings.useScannerButton && !isScanningActive) return;
                    handleSuccess(result.barcode.rawValue);
                });
            } catch (err: any) {
                setCameraError("카메라 시작 실패: " + err.message);
                document.body.classList.remove('scanner-active');
            }
            return;
        }

        if (!videoRef.current) return;
        setCameraError(null);
        try {
            stopCamera();
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: selectedCameraId ? { exact: selectedCameraId } : undefined, facingMode: 'environment' }
            });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
        } catch (err) {
            setCameraError("카메라 권한을 확인해주세요.");
        }
    }, [selectedCameraId, stopCamera, isAppNative, scanSettings.useScannerButton, isScanningActive]);

    const handleSuccess = useCallback((barcode: string) => {
        if (isHandlingResult.current) return;
        isHandlingResult.current = true;
        playBeep();
        
        if (continuous) {
            onScanSuccess(barcode);
            setTimeout(() => { isHandlingResult.current = false; }, 1200);
        } else {
            stopDetection(); 
            stopCamera();
            onScanSuccess(barcode);
            onClose();
        }
    }, [playBeep, onScanSuccess, onClose, stopDetection, stopCamera, continuous]);

    const handleManualClose = () => {
        stopDetection(); 
        stopCamera();
        onClose();
    };

    const handleScanToggle = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsScanningActive(prev => !prev);
        if (!isScanningActive) {
            showToast("스캔 활성화", "success");
        }
    };

    useEffect(() => {
        if (isOpen) {
            startCamera();
        } else {
            stopDetection(); 
            stopCamera();
        }
    }, [isOpen, startCamera, stopDetection, stopCamera]);

    if (!isOpen) return null;

    return createPortal(
        <div className={`fixed inset-0 z-[200] flex flex-col items-center justify-center transition-opacity duration-150 ${isAppNative ? 'bg-transparent' : 'bg-black'}`}>
            {!isAppNative && <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />}
            
            <div className={`absolute inset-0 pointer-events-none transition-all duration-300 ${(isPaused || (scanSettings.useScannerButton && !isScanningActive)) ? 'scanner-overlay-paused' : ''}`}></div>
            
            <button onClick={handleManualClose} className="absolute top-10 right-5 z-[210] p-4 bg-black/40 text-white rounded-full backdrop-blur-md border border-white/10 active:scale-95">
                <XMarkIcon className="w-8 h-8" />
            </button>

            <div className="relative z-10 w-[85%] max-w-[26rem] flex flex-col items-center pointer-events-none">
                <div ref={guideBoxRef} className={`h-[55px] w-full rounded-2xl border-2 transition-all duration-300 ${isScanningActive || (isAppNative && !scanSettings.useScannerButton) ? 'scanner-box-active' : 'scanner-box-idle'}`}></div>
                
                <p className="text-white text-center mt-8 font-extrabold text-shadow bg-black/40 px-6 py-2.5 rounded-full backdrop-blur-sm border border-white/10">
                    {scanSettings.useScannerButton && !isScanningActive ? "하단 버튼을 눌러 스캔을 시작하세요" : "가이드라인 안에 바코드를 맞추세요"}
                </p>

                {scanSettings.useScannerButton && !isPaused && (
                    <div className="w-full mt-16 pointer-events-auto">
                        <button 
                            onClick={handleScanToggle}
                            className={`w-full h-20 rounded-2xl flex items-center justify-center gap-4 shadow-2xl active:scale-95 transition-all border-4 ${isScanningActive ? 'bg-red-600 border-red-400 text-white' : 'bg-white border-blue-600 text-blue-700'}`}
                        >
                            {isScanningActive ? (
                                <>
                                    <div className="w-4 h-4 bg-white rounded-full animate-ping"></div>
                                    <span className="font-black text-2xl">SCANNING...</span>
                                </>
                            ) : (
                                <>
                                    <BarcodeScannerIcon className="w-10 h-10" />
                                    <span className="font-black text-2xl">START SCAN</span>
                                </>
                            )}
                        </button>
                    </div>
                )}
            </div>

            {cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/95 z-[220] p-8 text-center pointer-events-auto">
                    <p className="text-white font-bold text-lg mb-6">{cameraError}</p>
                    <button onClick={startCamera} className="px-8 py-3 bg-blue-600 text-white rounded-xl font-black shadow-lg active:scale-95">다시 시도</button>
                </div>
            )}
        </div>,
        document.body
    );
};

export default ScannerModal;
