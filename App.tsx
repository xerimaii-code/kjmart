import React, { useState, useEffect, useContext, createContext, useMemo, useCallback, useRef } from 'react';
import { Customer, Product, OrderItem, Order, Page, AlertState, AppContextType } from './types';

// --- From types.ts --- (Types are now imported from types.ts)

// --- From hooks/useLocalStorage.ts ---
function useLocalStorage<T,>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [storedValue, setStoredValue] = useState<T>(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error) {
            console.error(error);
            return initialValue;
        }
    });

    const setValue: React.Dispatch<React.SetStateAction<T>> = (value) => {
        try {
            const valueToStore = value instanceof Function ? value(storedValue) : value;
            setStoredValue(valueToStore);
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch (error) {
            console.error(error);
        }
    };

    useEffect(() => {
        try {
            const item = window.localStorage.getItem(key);
            if (item) {
                setStoredValue(JSON.parse(item));
            }
        } catch (error) {
            console.log(error);
        }
    }, [key]);

    return [storedValue, setValue];
}

// --- From services/dataService.ts ---
declare const XLSX: any;
declare const docx: any;

const parseExcelFile = (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                if (!e.target?.result) {
                    throw new Error("File could not be read.");
                }
                const data = new Uint8Array(e.target.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                if (json.length < 2) {
                    return resolve([]);
                }
                resolve(json.slice(1)); // Return rows, excluding header
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
};

const processCustomerData = (rows: any[]): Customer[] => {
    return rows.map(row => ({
        comcode: String(row[0] || ''),
        name: String(row[1] || ''),
    })).filter(c => c.comcode && c.name);
};

const processProductData = (rows: any[]): Product[] => {
    return rows.map(row => ({
        barcode: String(row[0] || ''),
        name: String(row[1] || ''),
        price: parseFloat(String(row[2])) || 0,
    })).filter(p => p.barcode && p.name);
};

const exportToSMS = (order: Order) => {
    const title = "경진마트발주";
    const body = order.items.map(item => `${item.name}/${item.quantity}${item.unit}`).join('\n');
    const smsLink = `sms:?body=${encodeURIComponent(title + '\n' + body)}`;
    window.location.href = smsLink;
};

const exportToXLS = (order: Order) => {
    const data = order.items.map(item => ({
        '바코드': item.barcode,
        '품명': item.name,
        '단가': item.price,
        '발주수량': item.quantity,
        '단위': item.unit,
        '금액': item.price * item.quantity
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "발주내역");
    XLSX.writeFile(workbook, `발주서_${order.customer.name}_${new Date().toISOString().slice(0,10)}.xlsx`);
};

const exportToDOCX = async (order: Order, isParcelDelivery: boolean) => {
    if (typeof docx === 'undefined') {
        alert("DOCX 라이브러리를 불러오는 데 실패했습니다. 잠시 후 다시 시도해주세요.");
        console.error("DOCX library (from CDN) is not available.");
        return;
    }

    const { Document, Packer, Paragraph, TextRun, AlignmentType, SectionType } = docx;

    const titleChildren = [
        new Paragraph({
            style: "titleStyle",
            text: "경진마트 발주서",
        }),
    ];

    if (isParcelDelivery) {
        titleChildren.push(new Paragraph({
            style: "parcelStyle",
            text: "택배로 배송해주세요",
        }));
    } else {
        titleChildren.push(new Paragraph({ text: "" }));
    }

    const itemParagraphs = order.items.map(item =>
        new Paragraph({
            style: "itemStyle",
            children: [
                new TextRun(`${item.name} `),
                new TextRun({
                    text: String(item.quantity),
                    bold: true,
                }),
                new TextRun(item.unit),
            ],
        })
    );

    const doc = new Document({
        styles: {
            paragraphStyles: [
                {
                    id: "titleStyle",
                    name: "Title Style",
                    basedOn: "Normal",
                    next: "Normal",
                    run: { size: 50, bold: true },
                    paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 240 } },
                },
                {
                    id: "parcelStyle",
                    name: "Parcel Style",
                    basedOn: "Normal",
                    next: "Normal",
                    run: { size: 40 },
                    paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 480 } },
                },
                {
                    id: "itemStyle",
                    name: "Item Style",
                    basedOn: "Normal",
                    next: "Normal",
                    run: { size: 20 },
                    paragraph: { spacing: { line: 360 } },
                },
            ],
        },
        sections: [
            { children: titleChildren },
            {
                properties: {
                    type: SectionType.CONTINUOUS,
                    column: { count: 2, space: 720, separator: true },
                },
                children: itemParagraphs,
            }
        ],
    });

    try {
        const blob = await Packer.toBlob(doc);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const today = new Date().toISOString().slice(0, 10);
        link.download = `발주서_${order.customer.name}_${today}.docx`;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error("DOCX Export Error:", error);
        alert("DOCX 파일 생성에 실패했습니다.");
    }
};

// --- From components/Icons.tsx ---
const NewOrderIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
);
const HistoryIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
);
const SettingsIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0 3.35a1.724 1.724 0 001.066 2.573c-.94-1.543.826 3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
);
const AddIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
);
const RemoveIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
);
const ScanIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12" /></svg>
);


// --- From context/AppContext.tsx ---
const AppContext = createContext<AppContextType>({} as AppContextType);
const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [customers, setCustomers] = useLocalStorage<Customer[]>('customers', []);
    const [products, setProducts] = useLocalStorage<Product[]>('products', []);
    const [orders, setOrders] = useLocalStorage<Order[]>('orders', []);
    const [alert, setAlert] = useState<AlertState>({ isOpen: false, message: '' });
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [selectedCameraId, setSelectedCameraId] = useLocalStorage<string | null>('selectedCameraId', null);

    const showAlert = useCallback((message: string, onConfirm?: () => void, confirmText?: string, confirmButtonClass?: string) => {
        setAlert({ isOpen: true, message, onConfirm, confirmText, confirmButtonClass });
    }, []);
    const hideAlert = useCallback(() => {
        setAlert({ isOpen: false, message: '' });
    }, []);
    const addOrder = useCallback((order: Omit<Order, 'id' | 'date'>) => {
        const newOrder: Order = { ...order, id: Date.now(), date: new Date().toISOString() };
        setOrders(prevOrders => [...prevOrders, newOrder]);
    }, [setOrders]);
    const updateOrder = useCallback((updatedOrder: Order) => {
        setOrders(prevOrders => prevOrders.map(o => o.id === updatedOrder.id ? updatedOrder : o));
    }, [setOrders]);
    const deleteOrder = useCallback((orderId: number) => {
        setOrders(prevOrders => prevOrders.filter(o => o.id !== orderId));
    }, [setOrders]);
    const openDetailModal = useCallback((orderId: number) => {
        setEditingOrderId(orderId);
        setIsDetailModalOpen(true);
    }, []);
    const closeDetailModal = useCallback(() => {
        setIsDetailModalOpen(false);
        setEditingOrderId(null);
    }, []);

    return (
        <AppContext.Provider value={{
            customers, setCustomers, products, setProducts, orders, setOrders, addOrder,
            updateOrder, deleteOrder, alert, showAlert, hideAlert, isDetailModalOpen,
            editingOrderId, openDetailModal, closeDetailModal, hasUnsavedChanges,
            setHasUnsavedChanges, selectedCameraId, setSelectedCameraId,
        }}>
            {children}
        </AppContext.Provider>
    );
};


// --- From components/Header.tsx ---
const Header: React.FC = () => {
    const [currentDateTime, setCurrentDateTime] = useState(new Date());
    useEffect(() => {
        const timer = setInterval(() => setCurrentDateTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);
    const formatDate = (date: Date) => date.toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    const formatTime = (date: Date) => date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
    return (
        <header className="bg-white border-b border-slate-200 p-4 flex justify-between items-center h-20 flex-shrink-0">
            <h1 className="text-xl font-bold text-slate-800">발주 관리</h1>
            <div className="text-right">
                <p className="text-sm font-medium text-slate-700">{formatDate(currentDateTime)}</p>
                <p className="text-lg font-bold text-sky-600 tabular-nums">{formatTime(currentDateTime)}</p>
            </div>
        </header>
    );
};


// --- From components/BottomNav.tsx ---
const NavButton: React.FC<{ page: Page; label: string; Icon: React.FC; isActive: boolean; onClick: (page: Page) => void; }> = ({ page, label, Icon, isActive, onClick }) => (
    <button
        onClick={() => onClick(page)}
        className={`nav-btn flex flex-col items-center justify-center w-full h-full transition-colors duration-200 ${isActive ? 'text-sky-500' : 'text-slate-400 hover:text-sky-500'}`}
        aria-current={isActive ? 'page' : undefined}
    >
        <Icon />
        <span className="text-xs font-medium mt-1">{label}</span>
    </button>
);
const BottomNav: React.FC<{ activePage: Page; setActivePage: (page: Page) => void; }> = ({ activePage, setActivePage }) => (
    <nav className="w-full bg-white border-t border-slate-200 flex justify-around h-16 items-center flex-shrink-0 shadow-t-md">
        <NavButton page="new-order" label="신규발주" Icon={NewOrderIcon} isActive={activePage === 'new-order'} onClick={setActivePage} />
        <NavButton page="history" label="발주내역" Icon={HistoryIcon} isActive={activePage === 'history'} onClick={setActivePage} />
        <NavButton page="settings" label="설정" Icon={SettingsIcon} isActive={activePage === 'settings'} onClick={setActivePage} />
    </nav>
);


// --- From components/AlertModal.tsx ---
const AlertModal: React.FC<{ isOpen: boolean; message: string; onClose: () => void; onConfirm?: () => void; confirmText?: string; confirmButtonClass?: string; }> = ({ isOpen, message, onClose, onConfirm, confirmText, confirmButtonClass }) => {
    if (!isOpen) return null;
    const handleConfirm = () => {
        if (onConfirm) onConfirm();
        onClose();
    };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="alert-dialog-title">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden">
                <div className="p-6 text-center"><p id="alert-dialog-title" className="text-lg text-slate-700">{message}</p></div>
                <div className={`bg-slate-50 p-3 ${onConfirm ? 'flex justify-around items-center' : 'text-center'}`}>
                    {onConfirm ? (
                        <>
                            <button onClick={onClose} className="px-6 py-2 rounded-md font-semibold text-slate-600 bg-slate-200 hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-opacity-50 transition">취소</button>
                            <button onClick={handleConfirm} className={`text-white px-6 py-2 rounded-md font-semibold focus:outline-none focus:ring-2 focus:ring-opacity-50 transition ${confirmButtonClass || 'bg-sky-500 hover:bg-sky-600 focus:ring-sky-500'}`}>{confirmText || '확인'}</button>
                        </>
                    ) : (
                        <button onClick={onClose} className="bg-sky-500 text-white px-6 py-2 rounded-md font-semibold hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-opacity-50 transition">확인</button>
                    )}
                </div>
            </div>
        </div>
    );
};


// --- From components/ScannerModal.tsx ---
declare const ZXing: any;
const ScannerModal: React.FC<{ isOpen: boolean; onClose: () => void; onScanSuccess: (barcode: string) => void; }> = ({ isOpen, onClose, onScanSuccess }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const codeReaderRef = useRef<any>(null);
    const { selectedCameraId, showAlert } = useContext(AppContext);
    useEffect(() => {
        if (isOpen && videoRef.current) {
            const hints = new Map();
            const formats = [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E, ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.ITF];
            hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
            hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
            hints.set(ZXing.DecodeHintType.ASSUME_GS1, true);
            codeReaderRef.current = new ZXing.BrowserMultiFormatReader(hints);
            
            const startScanning = async () => {
                const baseVideoConstraints: MediaTrackConstraints = { deviceId: selectedCameraId ? { exact: selectedCameraId } : undefined };
                const constraintsToTry: MediaStreamConstraints[] = [
                    { audio: false, video: { ...baseVideoConstraints, facingMode: 'environment', focusMode: 'continuous', width: { ideal: 1280 }, height: { ideal: 720 } } as any },
                    { audio: false, video: { ...baseVideoConstraints, facingMode: 'environment', focusMode: 'continuous', width: { ideal: 1920 }, height: { ideal: 1080 } } as any },
                    { audio: false, video: { ...baseVideoConstraints, facingMode: 'environment', focusMode: 'continuous' } as any },
                    { audio: false, video: { ...baseVideoConstraints, facingMode: 'environment' } },
                    { audio: false, video: { ...baseVideoConstraints } },
                ];
                for (const constraints of constraintsToTry) {
                    try {
                        await codeReaderRef.current.decodeFromConstraints(constraints, videoRef.current, (result: any, err: any) => {
                            if (result) {
                                if (navigator.vibrate) navigator.vibrate(100);
                                onScanSuccess(result.getText());
                                onClose();
                            }
                            if (err && !(err instanceof ZXing.NotFoundException)) console.error('Scan Error:', err);
                        });
                        return;
                    } catch (e) {
                        console.warn(`Failed to start camera with constraints: ${JSON.stringify(constraints)}`, e);
                    }
                }
                showAlert('카메라를 시작할 수 없습니다. 권한을 확인해 주세요.');
                onClose();
            };
            startScanning();
        }
        return () => {
            if (codeReaderRef.current) codeReaderRef.current.reset();
        };
    }, [isOpen, selectedCameraId, onClose, onScanSuccess, showAlert]);
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center">
            <video ref={videoRef} className="absolute top-0 left-0 w-full h-full object-cover" playsInline></video>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-[90%] max-w-xl h-24 relative shadow-[0_0_0_9999px_rgba(0,0,0,0.7)] rounded-lg">
                    <div className="absolute inset-0 border-2 border-white/75 rounded-lg"></div>
                </div>
            </div>
            <button onClick={onClose} className="absolute bottom-10 bg-white text-gray-800 px-8 py-3 rounded-full text-lg font-bold shadow-lg">스캔 종료</button>
        </div>
    );
};


// --- From pages/NewOrderPage.tsx ---
const SearchDropdown = <T,>({ items, renderItem, onSelect, show }: { items: T[]; renderItem: (item: T) => React.ReactNode; onSelect: (item: T) => void; show: boolean; }) => {
    if (!show || items.length === 0) return null;
    return (
        <div className="absolute z-10 w-full bg-white border border-slate-200 rounded-md mt-1 max-h-48 overflow-y-auto shadow-lg">
            {items.map((item, index) => (
                <div key={index} onMouseDown={() => onSelect(item)} className="p-3 hover:bg-slate-100 cursor-pointer">{renderItem(item)}</div>
            ))}
        </div>
    );
};
const NewOrderPage: React.FC = () => {
    const { customers, products, addOrder, showAlert, setHasUnsavedChanges } = useContext(AppContext);
    const [currentOrderItems, setCurrentOrderItems] = useState<OrderItem[]>([]);
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [customerSearch, setCustomerSearch] = useState('');
    const [productSearch, setProductSearch] = useState('');
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
    const [showProductDropdown, setShowProductDropdown] = useState(false);
    const [isCustomerLocked, setIsCustomerLocked] = useState(false);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
    const scrollableContainerRef = useRef<HTMLDivElement>(null);
    const lastItemCount = useRef(currentOrderItems.length);

    useEffect(() => {
        setHasUnsavedChanges(selectedCustomer !== null || currentOrderItems.length > 0);
    }, [selectedCustomer, currentOrderItems, setHasUnsavedChanges]);
    useEffect(() => () => setHasUnsavedChanges(false), [setHasUnsavedChanges]);

    const addProduct = useCallback((product: Product) => {
        if (currentOrderItems.find(item => item.barcode === product.barcode)) {
            showAlert('이미 추가된 상품입니다. 수량을 추가하시겠습니까?', () => {
                setTimeout(() => {
                    const itemElement = itemRefs.current.get(product.barcode);
                    itemElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    itemElement?.querySelector<HTMLInputElement>(`.new-order-item-qty-input`)?.focus();
                }, 100);
            }, '계속');
        } else {
            setCurrentOrderItems(prev => [...prev, { ...product, quantity: 1, unit: '개' }]);
            if (selectedCustomer) setIsCustomerLocked(true);
        }
    }, [currentOrderItems, showAlert, selectedCustomer]);

    const handleScanSuccess = useCallback((barcode: string) => {
        const product = products.find(p => p.barcode === barcode);
        if (product) addProduct(product);
        else showAlert(`바코드 '${barcode}'에 해당하는 상품을 찾을 수 없습니다.`);
    }, [products, addProduct, showAlert]);

    useEffect(() => {
        if (scrollableContainerRef.current && currentOrderItems.length > lastItemCount.current) {
            scrollableContainerRef.current.scrollTo({ top: scrollableContainerRef.current.scrollHeight, behavior: 'smooth' });
        }
        lastItemCount.current = currentOrderItems.length;
    }, [currentOrderItems]);

    const filteredCustomers = useMemo(() => customerSearch ? customers.filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase())) : [], [customers, customerSearch]);
    const filteredProducts = useMemo(() => productSearch ? products.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.barcode.includes(productSearch)) : [], [products, productSearch]);
    const handleProductSelect = (product: Product) => { addProduct(product); setProductSearch(''); setShowProductDropdown(false); };
    const updateItem = (barcode: string, newValues: Partial<OrderItem>) => setCurrentOrderItems(prev => prev.map(item => item.barcode === barcode ? {...item, ...newValues} : item));
    const removeItem = (barcode: string) => setCurrentOrderItems(prev => { const newItems = prev.filter(item => item.barcode !== barcode); if (newItems.length === 0) setIsCustomerLocked(false); return newItems; });
    const totalAmount = useMemo(() => currentOrderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0), [currentOrderItems]);
    const handleSaveOrder = () => {
        if (!selectedCustomer) { showAlert("거래처를 선택해주세요."); return; }
        if (currentOrderItems.length === 0) { showAlert("발주할 상품을 추가해주세요."); return; }
        addOrder({ customer: selectedCustomer, items: currentOrderItems, total: totalAmount });
        showAlert("발주가 저장되었습니다.");
        setSelectedCustomer(null); setCurrentOrderItems([]); setCustomerSearch(''); setIsCustomerLocked(false);
    };
    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);

    return (
        <div className="h-full flex flex-col bg-slate-50">
            <ScannerModal isOpen={isScannerOpen} onClose={() => setIsScannerOpen(false)} onScanSuccess={handleScanSuccess} />
            <div className="p-4 bg-white border-b border-slate-200 space-y-4 flex-shrink-0">
                <div className="flex items-center space-x-2">
                    <div className="relative flex-grow">
                        <input type="text" value={customerSearch} onChange={e => { setCustomerSearch(e.target.value); setSelectedCustomer(null); }} onFocus={e => { setShowCustomerDropdown(true); handleFocus(e); }} onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)} placeholder="거래처명 검색 또는 선택" disabled={isCustomerLocked} className={`w-full p-3 text-base border border-slate-300 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition ${isCustomerLocked ? 'bg-slate-100 cursor-not-allowed' : ''}`} />
                        <SearchDropdown items={filteredCustomers} renderItem={(c: Customer) => <span className="font-medium text-base">{c.name}</span>} onSelect={c => { setSelectedCustomer(c); setCustomerSearch(c.name); setShowCustomerDropdown(false); }} show={showCustomerDropdown && !selectedCustomer && !isCustomerLocked} />
                    </div>
                    {isCustomerLocked && (<button onClick={() => setIsCustomerLocked(false)} className="px-4 py-3 bg-slate-200 text-slate-700 text-sm font-semibold rounded-md hover:bg-slate-300 flex-shrink-0">변경</button>)}
                </div>
                <div className="flex items-center space-x-2">
                    <div className="relative flex-grow">
                        <input type="text" value={productSearch} onChange={e => setProductSearch(e.target.value)} onFocus={e => { setShowProductDropdown(true); handleFocus(e); }} onBlur={() => setTimeout(() => setShowProductDropdown(false), 200)} placeholder="품목 검색" className="w-full p-3 text-base border border-slate-300 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition" />
                        <SearchDropdown items={filteredProducts} renderItem={(p: Product) => (<><p className="font-semibold text-base">{p.name}</p><p className="text-sm text-slate-500">{p.barcode} / {p.price.toLocaleString()}원</p></>)} onSelect={handleProductSelect} show={showProductDropdown} />
                    </div>
                    <button onClick={() => setIsScannerOpen(true)} className="p-3 bg-slate-200 text-slate-700 rounded-md hover:bg-slate-300 flex-shrink-0" aria-label="Scan product barcode"><ScanIcon /></button>
                </div>
            </div>
            <div ref={scrollableContainerRef} className="p-4 flex-grow overflow-y-auto">
                {currentOrderItems.length === 0 ? (
                    <div className="flex items-center justify-center h-full"><p className="text-slate-500">검색 또는 스캔하여 상품을 추가하세요.</p></div>
                ) : (
                    <div className="space-y-3">
                        {currentOrderItems.map(item => (
                            <div key={item.barcode} ref={el => { itemRefs.current.set(item.barcode, el); }} className="flex items-center p-3 bg-white rounded-lg shadow-sm space-x-3">
                                <div className="flex-1 min-w-0"><p className="font-semibold text-slate-800">{item.name}</p></div>
                                <div className="flex items-center space-x-2 flex-shrink-0">
                                    <button onClick={() => updateItem(item.barcode, { quantity: Math.max(1, item.quantity - 1) })} className="bg-slate-200 w-8 h-8 rounded-full font-bold text-slate-600">-</button>
                                    <input type="number" value={item.quantity} onChange={e => updateItem(item.barcode, { quantity: parseInt(e.target.value, 10) || 1 })} onFocus={handleFocus} className="w-14 h-8 text-center border border-slate-300 rounded-md new-order-item-qty-input" />
                                    <button onClick={() => updateItem(item.barcode, { quantity: item.quantity + 1 })} className="bg-slate-200 w-8 h-8 rounded-full font-bold text-slate-600">+</button>
                                    <select value={item.unit} onChange={e => updateItem(item.barcode, { unit: e.target.value as '개' | '박스' })} className="p-1 h-8 border border-slate-300 rounded-md"><option value="개">개</option><option value="박스">박스</option></select>
                                    <button onClick={() => removeItem(item.barcode)} className="text-rose-500 hover:text-rose-600"><RemoveIcon /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <div className="p-4 bg-white border-t border-slate-200 mt-auto flex-shrink-0">
                <div className="flex justify-between items-center mb-3 font-bold"><span className="text-lg text-slate-600">총 합계:</span><span className="text-xl text-slate-800">{totalAmount.toLocaleString()} 원</span></div>
                <button onClick={handleSaveOrder} className="w-full bg-emerald-500 text-white p-3 rounded-md font-bold text-lg hover:bg-emerald-600 disabled:bg-slate-300 transition shadow-sm" disabled={currentOrderItems.length === 0 || !selectedCustomer}>발주 저장</button>
            </div>
        </div>
    );
};


// --- From pages/OrderHistoryPage.tsx ---
const OrderHistoryPage: React.FC = () => {
    const { orders, openDetailModal } = useContext(AppContext);
    const getLocalDateString = (date: Date) => { const offset = date.getTimezoneOffset(); return new Date(date.getTime() - (offset * 60 * 1000)).toISOString().split('T')[0]; };
    const [startDate, setStartDate] = useState(() => getLocalDateString(new Date()));
    const [endDate, setEndDate] = useState(() => getLocalDateString(new Date()));
    useEffect(() => { const today = getLocalDateString(new Date()); setStartDate(today); setEndDate(today); }, []);
    const { filteredOrders, grandTotal } = useMemo(() => {
        if (!startDate || !endDate) return { filteredOrders: [], grandTotal: 0 };
        const startOfDay = new Date(startDate); startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(endDate); endOfDay.setHours(23, 59, 59, 999);
        const filtered = orders.filter(order => { const d = new Date(order.date); return d >= startOfDay && d <= endOfDay; }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return { filteredOrders: filtered, grandTotal: filtered.reduce((sum, order) => sum + order.total, 0) };
    }, [orders, startDate, endDate]);
    const groupedByDate = useMemo(() => filteredOrders.reduce((acc, order) => { const d = new Date(order.date).toLocaleDateString('ko-KR'); if (!acc[d]) acc[d] = []; acc[d].push(order); return acc; }, {} as Record<string, Order[]>), [filteredOrders]);
    return (
        <div className="h-full flex flex-col bg-slate-50">
            <div className="p-4 bg-white border-b border-slate-200 flex-shrink-0"><div className="flex items-center space-x-3"><label htmlFor="start-date" className="text-sm font-medium text-slate-600">시작일</label><input id="start-date" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="flex-grow p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-sky-500" /><label htmlFor="end-date" className="text-sm font-medium text-slate-600">종료일</label><input id="end-date" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="flex-grow p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-sky-500" /></div></div>
            <div className="p-4 flex-grow overflow-y-auto">
                {filteredOrders.length === 0 ? (<div className="flex items-center justify-center h-full"><p className="text-center text-slate-500 text-lg">해당 기간의 발주 내역이 없습니다.</p></div>) : (Object.keys(groupedByDate).map(dateStr => (
                    <div key={dateStr} className="mb-6">
                        <h3 className="font-bold text-lg mb-3 p-2 bg-slate-100 rounded-md text-slate-700 sticky top-0">{dateStr}</h3>
                        <div className="space-y-2">{groupedByDate[dateStr].map(order => (
                            <div key={order.id} onClick={() => openDetailModal(order.id)} className="flex justify-between items-center p-4 bg-white rounded-lg shadow-sm cursor-pointer border border-transparent hover:shadow-md hover:border-sky-500 transition-all" role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && openDetailModal(order.id)}>
                                <span className="font-semibold text-slate-800">{order.customer.name}</span><span className="font-bold text-slate-900">{order.total.toLocaleString()} 원</span>
                            </div>
                        ))}</div>
                    </div>
                )))}
            </div>
            {filteredOrders.length > 0 && (<div className="p-4 bg-slate-100 border-t border-slate-200 text-right font-bold text-xl flex-shrink-0"><span className="text-slate-600">전체 합계: </span><span className="text-slate-800">{grandTotal.toLocaleString()} 원</span></div>)}
        </div>
    );
};


// --- From pages/SettingsPage.tsx ---
const SettingsPage: React.FC = () => {
    const { customers, setCustomers, products, setProducts, orders, setOrders, showAlert, selectedCameraId, setSelectedCameraId } = useContext(AppContext);
    const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
    useEffect(() => {
        const getVideoDevices = async () => {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const videoDevices = devices.filter(d => d.kind === 'videoinput');
                setCameras(videoDevices);
                if (!selectedCameraId && videoDevices.length > 0) setSelectedCameraId(videoDevices[0].deviceId);
            } catch (error) { showAlert("카메라 장치 목록을 불러오는 데 실패했습니다."); }
        };
        getVideoDevices();
    }, [selectedCameraId, setSelectedCameraId, showAlert]);
    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, type: 'customer' | 'product') => {
        const file = event.target.files?.[0]; if (!file) return;
        try {
            const rows = await parseExcelFile(file);
            if (type === 'customer') { const d = processCustomerData(rows); setCustomers(d); showAlert(`거래처 자료 ${d.length}개가 등록되었습니다.`); } 
            else { const d = processProductData(rows); setProducts(d); showAlert(`상품 자료 ${d.length}개가 등록되었습니다.`); }
        } catch (error) { showAlert("엑셀 파일 처리 중 오류 발생. 형식을 확인하세요."); } 
        finally { event.target.value = ''; }
    };
    const handleBackup = () => {
        try {
            const jsonString = JSON.stringify({ customers, products, orders, selectedCameraId }, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = `발주내역_백업_${new Date().toISOString().slice(0, 10)}.json`;
            link.href = url;
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
            URL.revokeObjectURL(url);
            showAlert("백업 파일이 다운로드되었습니다.");
        } catch (error) { showAlert("백업 파일 생성에 실패했습니다."); }
    };
    const handleRestore = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target?.result as string);
                if (!Array.isArray(data.customers) || !Array.isArray(data.products) || !Array.isArray(data.orders)) throw new Error("유효하지 않은 백업 파일 형식입니다.");
                showAlert('백업 파일로 복원하시겠습니까? 현재 모든 데이터는 덮어씌워집니다.', () => {
                    setCustomers(data.customers); setProducts(data.products); setOrders(data.orders);
                    if (data.selectedCameraId) setSelectedCameraId(data.selectedCameraId);
                    showAlert("데이터가 성공적으로 복원되었습니다.");
                }, '복원', 'bg-amber-500 hover:bg-amber-600 focus:ring-amber-500');
            } catch (error) { showAlert(error instanceof Error ? error.message : "파일 처리 중 오류가 발생했습니다."); } 
            finally { event.target.value = ''; }
        };
        reader.readAsText(file);
    };
    return (
        <div className="h-full flex flex-col p-4 space-y-6 overflow-y-auto bg-slate-50">
            <div className="bg-white p-4 rounded-lg shadow-sm">
                <h2 className="text-xl font-bold mb-3 text-slate-800">스캐너 설정</h2>
                <div>
                    <label htmlFor="camera-select" className="block text-base font-medium text-slate-700">기본 카메라</label>
                    <p className="text-sm text-slate-500 mb-2">바코드 스캔에 사용할 카메라를 선택하세요.</p>
                    <select id="camera-select" value={selectedCameraId || ''} onChange={e => setSelectedCameraId(e.target.value)} className="mt-1 block w-full p-2.5 border border-slate-300 rounded-md focus:ring-2 focus:ring-sky-500 transition" disabled={cameras.length === 0}>
                        {cameras.length === 0 ? (<option>카메라를 찾을 수 없습니다.</option>) : (cameras.map((camera, index) => (<option key={camera.deviceId} value={camera.deviceId}>{camera.label || `카메라 ${index + 1}`}</option>)))}
                    </select>
                </div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm">
                <h2 className="text-xl font-bold mb-3 text-slate-800">기초 자료 등록</h2>
                <div className="space-y-4">
                    <div>
                        <label htmlFor="customer-file" className="block text-base font-medium text-slate-700">거래처 자료</label>
                        <p className="text-sm text-slate-500 mb-2">(필수 컬럼: comcode, 거래처명)</p>
                        <input type="file" id="customer-file" accept=".xls,.xlsx" onChange={e => handleFileUpload(e, 'customer')} className="mt-1 block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100 transition" />
                        <p className="text-sm text-slate-600 mt-2">등록된 거래처: <span className="font-semibold">{customers.length}</span>개</p>
                    </div>
                    <div className="border-t border-slate-200 my-4"></div>
                    <div>
                        <label htmlFor="product-file" className="block text-base font-medium text-slate-700">상품 자료</label>
                        <p className="text-sm text-slate-500 mb-2">(필수 컬럼: 바코드, 품명, 단가)</p>
                        <input type="file" id="product-file" accept=".xls,.xlsx" onChange={e => handleFileUpload(e, 'product')} className="mt-1 block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 transition" />
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
                        <button onClick={handleBackup} className="w-full bg-sky-500 text-white p-2.5 rounded-md font-bold hover:bg-sky-600 transition shadow-sm">백업 파일 다운로드</button>
                    </div>
                    <div className="border-t border-slate-200 my-4"></div>
                    <div>
                        <label htmlFor="restore-file" className="block text-base font-medium text-slate-700">백업 파일로 복원하기</label>
                        <p className="text-sm text-slate-500 mb-2">.json 백업 파일로 모든 데이터를 복원합니다. (주의: 현재 데이터는 덮어씌워집니다)</p>
                        <input type="file" id="restore-file" accept=".json" onChange={handleRestore} className="mt-1 block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-slate-50 file:text-slate-700 hover:file:bg-slate-100 transition" />
                    </div>
                </div>
            </div>
        </div>
    );
};


// --- From components/OrderDetailModal.tsx ---
const OrderDetailModal: React.FC = () => {
    const { orders, editingOrderId, closeDetailModal, updateOrder, deleteOrder, products, showAlert } = useContext(AppContext);
    const order = useMemo(() => orders.find(o => o.id === editingOrderId), [orders, editingOrderId]);
    const [editedItems, setEditedItems] = useState<OrderItem[]>([]);
    const [productSearch, setProductSearch] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
    const [isParcelDelivery, setIsParcelDelivery] = useState(false);
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
    const scrollableContainerRef = useRef<HTMLDivElement>(null);
    const lastItemCount = useRef(0);

    useEffect(() => { if (order) { const i = JSON.parse(JSON.stringify(order.items)); setEditedItems(i); lastItemCount.current = i.length; setIsParcelDelivery(false); } }, [order]);
    
    const addProduct = useCallback((product: Product) => {
        if (editedItems.find(item => item.barcode === product.barcode)) {
            showAlert('이미 추가된 상품입니다.', () => { setTimeout(() => {
                const itemElement = itemRefs.current.get(product.barcode);
                itemElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                itemElement?.querySelector<HTMLInputElement>('.modal-item-qty-input')?.focus();
            }, 100); }, '계속');
        } else { setEditedItems(prev => [...prev, { ...product, quantity: 1, unit: '개' }]); }
    }, [editedItems, showAlert]);

    const handleScanSuccess = useCallback((barcode: string) => {
        const product = products.find(p => p.barcode === barcode);
        if (product) addProduct(product);
        else showAlert(`바코드 '${barcode}'에 해당하는 상품을 찾을 수 없습니다.`);
    }, [products, addProduct, showAlert]);

    useEffect(() => {
        if (scrollableContainerRef.current && editedItems.length > lastItemCount.current) {
            scrollableContainerRef.current.scrollTo({ top: scrollableContainerRef.current.scrollHeight, behavior: 'smooth' });
        }
        lastItemCount.current = editedItems.length;
    }, [editedItems]);

    const updateItem = (b: string, v: Partial<OrderItem>) => setEditedItems(p => p.map(i => i.barcode === b ? {...i, ...v} : i));
    const removeItem = (b: string) => setEditedItems(p => p.filter(i => i.barcode !== b));
    const performDelete = () => { if (!order) return; deleteOrder(order.id); showAlert("발주 내역이 삭제되었습니다."); closeDetailModal(); };
    const handleUpdateOrder = () => {
        if (!order) return;
        const finalItems = editedItems.filter(item => item.quantity > 0);
        if (finalItems.length === 0) {
            showAlert('모든 품목이 삭제되어 발주 내역이 삭제됩니다. 계속하시겠습니까?', performDelete, '삭제', 'bg-rose-500');
        } else {
            const newTotal = finalItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            updateOrder({ ...order, items: finalItems, total: newTotal });
            showAlert("발주 내역이 수정되었습니다.");
            closeDetailModal();
        }
    };
    const getUpdatedOrderForExport = (): Order => {
        if (!order) throw new Error("Order not found");
        const finalItems = editedItems.filter(item => item.quantity > 0);
        const newTotal = finalItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        return { ...order, items: finalItems, total: newTotal };
    };
    const handleDeleteOrder = () => showAlert('정말로 이 발주 내역을 삭제하시겠습니까?', performDelete, '삭제', 'bg-rose-500');
    const filteredProducts = useMemo(() => productSearch ? products.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.barcode.includes(productSearch)) : [], [products, productSearch]);
    if (!order) return null;
    const totalAmount = useMemo(() => editedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0), [editedItems]);

    return (
        <div className={`fixed inset-0 bg-black bg-opacity-60 z-40 flex justify-center p-4 transition-all duration-300 ${isKeyboardVisible ? 'items-start pt-8' : 'items-center'}`}>
            <ScannerModal isOpen={isScannerOpen} onClose={() => setIsScannerOpen(false)} onScanSuccess={handleScanSuccess} />
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg flex flex-col h-[90vh] overflow-hidden">
                <div className="flex justify-between items-center p-4 border-b border-slate-200 flex-shrink-0">
                    <div><h2 className="text-xl font-bold text-slate-800">{order.customer.name}</h2><p className="text-sm text-slate-500">{new Date(order.date).toLocaleString('ko-KR')}</p></div>
                    <button onClick={closeDetailModal} className="text-slate-400 hover:text-slate-600 text-3xl font-bold">&times;</button>
                </div>
                <div className="p-4 border-b border-slate-200 flex-shrink-0">
                    <div className="flex items-center space-x-2">
                        <div className="relative flex-grow">
                            <input type="text" value={productSearch} onChange={e => setProductSearch(e.target.value)} onFocus={() => { setShowDropdown(true); setIsKeyboardVisible(true); }} onBlur={() => { setTimeout(() => setShowDropdown(false), 200); setIsKeyboardVisible(false); }} placeholder="품목 추가 검색" className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-sky-500" />
                            {showDropdown && filteredProducts.length > 0 && (<div className="absolute z-20 w-full bg-white border border-slate-200 rounded-md mt-1 max-h-48 overflow-y-auto shadow-lg">{filteredProducts.map(p => (<div key={p.barcode} onMouseDown={() => { addProduct(p); setProductSearch(''); setShowDropdown(false); }} className="p-2 hover:bg-slate-100 cursor-pointer"><p className="font-semibold">{p.name}</p><p className="text-sm text-slate-500">{p.barcode}</p></div>))}</div>)}
                        </div>
                        <button onClick={() => setIsScannerOpen(true)} className="p-2 bg-slate-200 text-slate-700 rounded-md hover:bg-slate-300 flex-shrink-0" aria-label="Scan product barcode"><ScanIcon /></button>
                    </div>
                </div>
                <div ref={scrollableContainerRef} className="flex-grow p-4 overflow-y-auto bg-slate-50">
                    <div className="space-y-3">{editedItems.map(item => (
                        <div key={item.barcode} ref={el => { itemRefs.current.set(item.barcode, el); }} className="flex items-center p-3 bg-white rounded-lg shadow-sm space-x-3">
                            <div className="flex-1 min-w-0"><p className="font-semibold text-slate-800">{item.name}</p></div>
                            <div className="flex items-center space-x-2 flex-shrink-0">
                                <button onClick={() => updateItem(item.barcode, { quantity: Math.max(0, item.quantity - 1) })} className="bg-slate-200 w-8 h-8 rounded-full font-bold text-slate-600">-</button>
                                <input type="number" value={item.quantity} onChange={e => updateItem(item.barcode, { quantity: parseInt(e.target.value, 10) || 0 })} onFocus={() => setIsKeyboardVisible(true)} onBlur={() => setIsKeyboardVisible(false)} className="w-14 h-8 text-center border border-slate-300 rounded-md modal-item-qty-input" />
                                <button onClick={() => updateItem(item.barcode, { quantity: item.quantity + 1 })} className="bg-slate-200 w-8 h-8 rounded-full font-bold text-slate-600">+</button>
                                <select value={item.unit} onChange={e => updateItem(item.barcode, { unit: e.target.value as '개' | '박스' })} className="p-1 h-8 border border-slate-300 rounded-md"><option value="개">개</option><option value="박스">박스</option></select>
                                <button onClick={() => removeItem(item.barcode)} className="text-rose-500 hover:text-rose-600"><RemoveIcon /></button>
                            </div>
                        </div>
                    ))}</div>
                </div>
                <div className="p-4 border-t border-slate-200 bg-white flex-shrink-0">
                    <div className="flex justify-between items-center mb-3 font-bold"><span className="text-lg text-slate-600">총 합계:</span><span className="text-xl text-slate-800">{totalAmount.toLocaleString()} 원</span></div>
                    <div className="flex items-center justify-end mb-4">
                        <input type="checkbox" id="parcel-delivery-checkbox" checked={isParcelDelivery} onChange={e => setIsParcelDelivery(e.target.checked)} className="h-4 w-4 text-sky-600 border-slate-300 rounded focus:ring-sky-500" /><label htmlFor="parcel-delivery-checkbox" className="ml-2 block text-sm font-medium text-slate-700">택배배송</label>
                    </div>
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <button onClick={handleUpdateOrder} className="w-full bg-emerald-500 text-white p-3 rounded-md font-bold hover:bg-emerald-600 transition shadow-sm">수정 완료</button>
                            <button onClick={handleDeleteOrder} className="w-full bg-rose-500 text-white p-3 rounded-md font-bold hover:bg-rose-600 transition shadow-sm">삭제</button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <button onClick={() => exportToSMS(getUpdatedOrderForExport())} className="bg-slate-600 text-white p-2 rounded-md text-sm font-semibold hover:bg-slate-700 transition">SMS</button>
                            <button onClick={() => exportToXLS(getUpdatedOrderForExport())} className="bg-slate-600 text-white p-2 rounded-md text-sm font-semibold hover:bg-slate-700 transition">XLS</button>
                            <button onClick={() => exportToDOCX(getUpdatedOrderForExport(), isParcelDelivery)} className="bg-slate-600 text-white p-2 rounded-md text-sm font-semibold hover:bg-slate-700 transition">DOCX</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};


// --- From App.tsx ---
const AppContent: React.FC = () => {
    const [isAppStarted, setIsAppStarted] = useState(false);
    const [activePage, setActivePage] = useState<Page>('new-order');
    const { alert, hideAlert, isDetailModalOpen, hasUnsavedChanges, showAlert } = useContext(AppContext);

    const handleStartApp = () => {
        const element = document.documentElement;
        if (element.requestFullscreen) {
            element.requestFullscreen().catch(err => console.warn(`Fullscreen error: ${err.message}`));
        }
        setIsAppStarted(true);
    };

    const handleNavigation = (targetPage: Page) => {
        if (activePage === 'new-order' && hasUnsavedChanges) {
            showAlert('작성중인 발주 내역이 있습니다. 정말로 이동하시겠습니까?', () => setActivePage(targetPage), '이동', 'bg-red-500');
        } else {
            setActivePage(targetPage);
        }
    };

    const renderPage = () => {
        switch (activePage) {
            case 'new-order': return <NewOrderPage />;
            case 'history': return <OrderHistoryPage />;
            case 'settings': return <SettingsPage />;
            default: return <NewOrderPage />;
        }
    };

    if (!isAppStarted) {
        return (
            <div className="h-full w-full flex flex-col items-center justify-center bg-white p-8 text-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 text-sky-500 mb-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
                <h1 className="text-4xl font-bold text-slate-800 mb-4">발주 관리 앱</h1>
                <p className="text-lg text-slate-600 mb-10">버튼을 눌러 전체 화면으로 시작하세요.</p>
                <button onClick={handleStartApp} className="bg-sky-500 text-white font-bold py-4 px-10 rounded-full shadow-lg text-xl hover:bg-sky-600 focus:outline-none focus:ring-4 focus:ring-sky-300 transition-all transform hover:scale-105">앱 시작하기</button>
            </div>
        );
    }

    return (
        <div className="h-full w-full flex flex-col">
            <Header />
            <main className="flex-grow relative overflow-hidden">{renderPage()}</main>
            <BottomNav activePage={activePage} setActivePage={handleNavigation} />
            <AlertModal isOpen={alert.isOpen} message={alert.message} onClose={hideAlert} onConfirm={alert.onConfirm} confirmText={alert.confirmText} confirmButtonClass={alert.confirmButtonClass} />
            {isDetailModalOpen && <OrderDetailModal />}
        </div>
    );
};
const App: React.FC = () => (
    <AppProvider>
        <AppContent />
    </AppProvider>
);

export default App;
