import React, { useContext, useState, useEffect, useRef } from 'react';
import { AppContext } from '../context/AppContext';
import { Customer, Product } from '../types';
import { parseExcelFile } from '../services/dataService';

const SettingsPage: React.FC = () => {
  const { 
    customers, setCustomers, 
    products, setProducts,
    orders, setOrders,
    cameraSettings, setCameraSettings,
    showAlert
  } = useContext(AppContext);

  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState(cameraSettings.deviceId || '');
  const customerFileRef = useRef<HTMLInputElement>(null);
  const productFileRef = useRef<HTMLInputElement>(null);
  const restoreFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const getCameras = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        setAvailableCameras(videoDevices);
        if (!cameraSettings.deviceId && videoDevices.length > 0) {
            setSelectedCameraId(videoDevices[0].deviceId);
        }
      } catch (err) {
        console.error("Error enumerating devices:", err);
      }
    };
    getCameras();
  }, [cameraSettings.deviceId]);
  
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'customer' | 'product') => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const data = await parseExcelFile(file);
      if (type === 'customer') {
        const newCustomers: Customer[] = data.map(row => ({
          comcode: String(row.comcode),
          name: String(row['거래처명']),
        })).filter(c => c.comcode && c.name);
        setCustomers(newCustomers);
        showAlert(`거래처 ${newCustomers.length}건이 등록되었습니다.`);
      } else {
        const newProducts: Product[] = data.map(row => ({
          barcode: String(row['바코드']),
          name: String(row['품명']),
          price: Number(row['단가']),
        })).filter(p => p.barcode && p.name && !isNaN(p.price));
        setProducts(newProducts);
        showAlert(`상품 ${newProducts.length}건이 등록되었습니다.`);
      }
    } catch (error) {
      showAlert('파일 처리 중 오류가 발생했습니다.');
      console.error(error);
    }
    // Reset file input
    e.target.value = '';
  };

  const handleSaveCamera = () => {
    setCameraSettings({ deviceId: selectedCameraId });
    showAlert('카메라 설정이 저장되었습니다.');
  };

  const handleBackup = () => {
    const dataToBackup = {
      customers,
      products,
      orders,
      cameraSettings
    };
    const blob = new Blob([JSON.stringify(dataToBackup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kjmart_backup_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    showAlert('백업 파일로 복원하면 현재 데이터가 모두 사라집니다. 계속하시겠습니까?', true, () => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const restoredData = JSON.parse(event.target?.result as string);
          if (restoredData.customers && restoredData.products && restoredData.orders && restoredData.cameraSettings) {
            setCustomers(restoredData.customers);
            setProducts(restoredData.products);
            setOrders(restoredData.orders);
            setCameraSettings(restoredData.cameraSettings);
            showAlert('데이터가 성공적으로 복원되었습니다. 앱을 다시 시작합니다.');
            setTimeout(() => window.location.reload(), 1500);
          } else {
            showAlert('유효하지 않은 백업 파일입니다.');
          }
        } catch (error) {
          showAlert('백업 파일 처리 중 오류가 발생했습니다.');
        }
      };
      reader.readAsText(file);
    });
    e.target.value = '';
  };
  
  const SettingCard: React.FC<{title: string; children: React.ReactNode}> = ({ title, children }) => (
    <div className="bg-white p-4 rounded-lg shadow mb-6">
        <h3 className="text-xl font-bold border-b pb-2 mb-4">{title}</h3>
        {children}
    </div>
  );

  return (
    <div className="p-4">
      <SettingCard title="기초 자료 등록">
        <div className="space-y-4">
            <div>
                <button onClick={() => customerFileRef.current?.click()} className="w-full bg-indigo-500 text-white p-3 rounded-lg hover:bg-indigo-600">거래처 자료 등록 (.xls, .xlsx)</button>
                <input type="file" ref={customerFileRef} onChange={(e) => handleFileUpload(e, 'customer')} accept=".xls,.xlsx" className="hidden" />
                <p className="text-sm text-gray-600 mt-1 text-center">현재 등록된 거래처: {customers.length}개</p>
            </div>
            <div>
                <button onClick={() => productFileRef.current?.click()} className="w-full bg-green-500 text-white p-3 rounded-lg hover:bg-green-600">상품 자료 등록 (.xls, .xlsx)</button>
                <input type="file" ref={productFileRef} onChange={(e) => handleFileUpload(e, 'product')} accept=".xls,.xlsx" className="hidden" />
                <p className="text-sm text-gray-600 mt-1 text-center">현재 등록된 상품: {products.length}개</p>
            </div>
        </div>
      </SettingCard>

      <SettingCard title="바코드 스캔 설정">
        <div className="flex flex-col space-y-3">
            <select value={selectedCameraId} onChange={e => setSelectedCameraId(e.target.value)} className="w-full p-2 border rounded-md">
                {availableCameras.map(camera => (
                <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `카메라 ${availableCameras.indexOf(camera) + 1}`}</option>
                ))}
            </select>
            <button onClick={handleSaveCamera} className="bg-blue-500 text-white p-2 rounded-md hover:bg-blue-600">선택 카메라로 저장</button>
        </div>
      </SettingCard>

      <SettingCard title="데이터 관리">
        <div className="space-y-4">
            <button onClick={handleBackup} className="w-full bg-gray-700 text-white p-3 rounded-lg hover:bg-gray-800">백업 파일 다운로드 (.json)</button>
            <div>
              <button onClick={() => restoreFileRef.current?.click()} className="w-full bg-red-500 text-white p-3 rounded-lg hover:bg-red-600">백업 파일로 복원하기</button>
              <input type="file" ref={restoreFileRef} onChange={handleRestore} accept=".json" className="hidden" />
            </div>
        </div>
      </SettingCard>
    </div>
  );
};

export default SettingsPage;