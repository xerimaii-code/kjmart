
import React, { lazy, Suspense } from 'react';
import WebScanner from './WebScanner';

// Lazy load NativeScanner to avoid import errors on web if plugin packages are missing/mocked
const NativeScanner = lazy(() => import('./NativeScanner'));

interface ScannerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onScanSuccess: (barcode: string) => void;
    continuous?: boolean; 
    isPaused?: boolean;
}

const ScannerModal: React.FC<ScannerModalProps> = (props) => {
    // Check if running on a native platform (Capacitor)
    const isNative = window.hasOwnProperty('Capacitor') && (window as any).Capacitor.isNativePlatform();

    if (!props.isOpen) return null;

    if (isNative) {
        return (
            // [중요] Fallback을 투명하게 설정하여 로딩/모드 전환 중 카메라가 가려지지 않도록 함
            <Suspense fallback={<div className="fixed inset-0 bg-transparent" />}>
                <NativeScanner {...props} />
            </Suspense>
        );
    }

    return <WebScanner {...props} />;
};

export default ScannerModal;
