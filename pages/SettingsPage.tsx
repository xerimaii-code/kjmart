
import React, { useContext, useState, useEffect } from 'react';
import { AppContext } from '../context/AppContext';
import { parseExcelFile, processCustomerData, processProductData } from '../services/dataService';
import { Customer, Product, Order } from '../types';

const SettingsPage: React.FC = () => {
    const { 
        customers, 
        setCustomers, 
        products, 
        setProducts, 
        orders,
        setOrders,
        showAlert,
        selectedCameraId,
        setSelectedCameraId,
    } = useContext(AppContext);

    const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);

    useEffect(() => {
        const getVideoDevices = async () => {
            try {
                if (!navigator.mediaDevices?.enumerateDevices) {
                    console.warn("enumerateDevices() not supported.");
                    return;
                }
                const devices = await navigator.mediaDevices.enumerateDevices();
                const videoDevices = devices.filter(device => device.kind === 'videoinput');
                setCameras(videoDevices);
                if (!selectedCameraId && videoDevices.length > 0) {
                    setSelectedCameraId(videoDevices[0].deviceId);
                }
            } catch (error) {
                console.error("Error enumerating video devices:", error);
                showAlert("카메라 장치 목록을 불러오는 데 실패했습니다.");
            }
        };
        getVideoDevices();
    }, [selectedCameraId, setSelectedCameraId, showAlert]);
    
    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, type: 'customer' | 'product') => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const rows = await parseExcelFile(file);
            if (type === 'customer') {
                const customerData = processCustomerData(rows);
                setCustomers(customerData);
                showAlert(`거래처 자료 ${customerData.length}개가 등록되었습니다.`);
            } else {
                const productData = processProductData(rows);
                setProducts(productData);
                showAlert(`상품 자료 ${productData.length}개가 등록되었습니다.`);
            }
        } catch (error) {
            console.error(error);
            showAlert("엑셀 파일 처리 중 오류 발생. 형식을 확인하세요.");
        } finally {
            event.target.value = ''; // Reset file input
        }
    };
    
    const handleBackup = () => {
        try {
            const backupData = {
                customers,
                products,
                orders,
                // Also backup the selected camera
                selectedCameraId,
            };
            const jsonString = JSON.stringify(backupData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const today = new Date().toISOString().slice(0, 10);
            link.download = `발주내역_백업_${today}.json`;
            link.href = url;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            showAlert("백업 파일이 다운로드되었습니다.");
        } catch (error) {
            console.error("Backup failed:", error);
            showAlert("백업 파일 생성에 실패했습니다.");
        }
    };

    const handleRestore = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target?.result;
                if (typeof text !== 'string') throw new Error("파일을 읽을 수 없습니다.");
                
                const data: { customers: Customer[], products: Product[], orders: Order[], selectedCameraId?: string } = JSON.parse(text);

                if (!Array.isArray(data.customers) || !Array.isArray(data.products) || !Array.isArray(data.orders)) {
                    throw new Error("유효하지 않은 백업 파일 형식입니다.");
                }

                showAlert(
                    '백업 파일로 복원하시겠습니까? 현재 모든 데이터는 덮어씌워집니다.',
                    () => {
                        setCustomers(data.customers);
                        setProducts(data.products);
                        setOrders(data.orders);
                        if (data.selectedCameraId) {
                            setSelectedCameraId(data.selectedCameraId);
                        }
                        showAlert("데이터가 성공적으로 복원되었습니다.");
                    },
                    '복원',
                    'bg-amber-500 hover:bg-amber-600 focus:ring-amber-500'
                );

            } catch (error) {
                console.error("Restore Error:", error);
                const message = error instanceof Error ? error.message : "파일 처리 중 오류가 발생했습니다.";
                showAlert(message);
            } finally {
                event.target.value = '';
            }
        };
        reader.readAsText(file);
    };

    return (
        <div className="h-full flex-col p-4 space-y-6 overflow-y-auto bg-slate-50">
            <div className="bg-white p-4 rounded-lg shadow-sm">
                <h2 className="text-xl font-bold mb-3 text-slate-800">스캐너 설정</h2>
                <div>
                    <label htmlFor="camera-select" className="block text-base font-medium text-slate-700">기본 카메라</label>
                    <p className="text-sm text-slate-500 mb-2">바코드 스캔에 사용할 카메라를 선택하세요.</p>
                    <select
                        id="camera-select"
                        value={selectedCameraId || ''}
                        onChange={(e) => setSelectedCameraId(e.target.value)}
                        className="mt-1 block w-full p-2.5 border border-slate-300 rounded-md focus:ring-2 focus:ring-sky-500 transition"
                        disabled={cameras.length === 0}
                    >
                        {cameras.length === 0 ? (
                            <option>카메라를 찾을 수 없습니다.</option>
                        ) : (
                            cameras.map((camera, index) => (
                                <option key={camera.deviceId} value={camera.deviceId}>
                                    {camera.label || `카메라 ${index + 1}`}
                                </option>
                            ))
                        )}
                    </select>
                </div>
            </div>

            <div className="bg-white p-4 rounded-lg shadow-sm">
                <h2 className="text-xl font-bold mb-3 text-slate-800">기초 자료 등록</h2>
                <div className="space-y-4">
                    <div>
                        <label htmlFor="customer-file" className="block text-base font-medium text-slate-700">거래처 자료</label>
                        <p className="text-sm text-slate-500 mb-2">(필수 컬럼: comcode, 거래처명)</p>
                        <input 
                            type="file" 
                            id="customer-file" 
                            accept=".xls,.xlsx" 
                            onChange={(e) => handleFileUpload(e, 'customer')}
                            className="mt-1 block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100 transition"
                        />
                        <p className="text-sm text-slate-600 mt-2">등록된 거래처: <span className="font-semibold">{customers.length}</span>개</p>
                    </div>
                     <div className="border-t border-slate-200 my-4"></div>
                     <div>
                        <label htmlFor="product-file" className="block text-base font-medium text-slate-700">상품 자료</label>
                        <p className="text-sm text-slate-500 mb-2">(필수 컬럼: 바코드, 품명, 단가)</p>
                        <input 
                            type="file" 
                            id="product-file" 
                            accept=".xls,.xlsx"
                            onChange={(e) => handleFileUpload(e, 'product')} 
                            className="mt-1 block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 transition"
                        />
                         <p className="text-sm text-slate-600 mt-2">등록된 상품: <span className="font-semibold">{products.length}</span>개</p>
                    </div>
                </div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm">
                <h2 className="text-xl font-bold mb-3 text-slate-800">데이터 관리</h2>
                <div className="space-y-4">
                    <div>
                        <label className="block text-base font-medium text-slate-700">발주내역 백업하기</label>
                        <p className="text-sm text-slate-500 mb-2">모든 거래처, 상품, 발주 내역을 하나의 파일로 저장합니다.</p>
                        <button
                            onClick={handleBackup}
                            className="w-full bg-sky-500 text-white p-2.5 rounded-md font-bold hover:bg-sky-600 transition shadow-sm"
                        >
                            백업 파일 다운로드
                        </button>
                    </div>
                     <div className="border-t border-slate-200 my-4"></div>
                     <div>
                        <label htmlFor="restore-file" className="block text-base font-medium text-slate-700">백업 파일로 복원하기</label>
                        <p className="text-sm text-slate-500 mb-2">.json 백업 파일로 모든 데이터를 복원합니다. (주의: 현재 데이터는 덮어씌워집니다)</p>
                        <input 
                            type="file" 
                            id="restore-file" 
                            accept=".json" 
                            onChange={handleRestore}
                            className="mt-1 block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-slate-50 file:text-slate-700 hover:file:bg-slate-100 transition"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsPage;