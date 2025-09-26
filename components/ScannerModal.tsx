import React, { useEffect, useRef, useContext } from 'react';
import { AppContext } from '../context/AppContext';

// CDN에서 전역으로 로드된 ZXing을 가정합니다.
declare const ZXing: any;

interface ScannerModalProps {
  onScan: (result: string) => void;
  onClose: () => void;
}

const ScannerModal: React.FC<ScannerModalProps> = ({ onScan, onClose }) => {
  const { cameraSettings, showAlert } = useContext(AppContext);
  const videoRef = useRef<HTMLVideoElement>(null);
  const codeReaderRef = useRef<any>(null);

  useEffect(() => {
    if (typeof ZXing === 'undefined') {
        console.error('ZXing library not loaded');
        showAlert('스캐너 라이브러리를 로드하는데 실패했습니다.');
        return;
    }

    codeReaderRef.current = new ZXing.BrowserMultiFormatReader();
    const codeReader = codeReaderRef.current;
    
    const startScanner = async () => {
      try {
        const videoInputDevices = await ZXing.BrowserCodeReader.listVideoInputDevices();
        if (videoInputDevices.length === 0) {
          showAlert('사용 가능한 카메라가 없습니다.');
          return;
        }

        const selectedDeviceId = cameraSettings.deviceId || videoInputDevices[0].deviceId;
        
        if (videoRef.current) {
          codeReader.decodeFromVideoDevice(selectedDeviceId, videoRef.current, (result: any, err: any) => {
            if (result) {
              navigator.vibrate(200); // 성공 시 진동
              onScan(result.getText());
            }
            if (err && !(err instanceof ZXing.NotFoundException)) {
              console.error(err);
            }
          });
        }
      } catch (err) {
        console.error('카메라 접근 오류:', err);
        showAlert('카메라에 접근할 수 없습니다. 권한을 확인해주세요.');
      }
    };

    startScanner();

    return () => {
      if (codeReaderRef.current) {
        codeReaderRef.current.reset();
      }
    };
  }, [cameraSettings.deviceId, onScan, showAlert]);

  return (
    <div className="fixed inset-0 bg-black z-40 flex flex-col items-center justify-center">
      <video ref={videoRef} className="w-full h-full object-cover" />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-3/4 max-w-md h-1/3 border-4 border-dashed border-green-400 rounded-lg shadow-lg"></div>
      </div>
       <div className="absolute top-4 text-white bg-black bg-opacity-50 px-4 py-2 rounded-lg">
        바코드를 사각형 안에 맞춰주세요.
      </div>
      <button
        onClick={onClose}
        className="absolute bottom-8 bg-white bg-opacity-80 text-black font-bold py-3 px-6 rounded-lg shadow-lg"
      >
        스캔 종료
      </button>
    </div>
  );
};

export default ScannerModal;
