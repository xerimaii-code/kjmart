import React, { useState, useContext, useEffect, useRef, useMemo } from 'react';
import { AppContext } from '../context/AppContext';
import { Customer, Product, OrderItem } from '../types';
import ScannerModal from '../components/ScannerModal';
import QuantityModal from '../components/QuantityModal';
import { BarcodeIcon } from '../components/Icons';
import { useOrderItems } from '../hooks/useOrderItems';

const NewOrderPage: React.FC = () => {
  const { customers, products, addOrder, showAlert, setIsDirty } = useContext(AppContext);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isScannerOpen, setScannerOpen] = useState(false);
  const [options, setOptions] = useState({ isPromotion: false, unit: '개' as '개' | '박스' });
  
  const [customerSearch, setCustomerSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [quantityModalItem, setQuantityModalItem] = useState<OrderItem | null>(null);

  const { items, addProduct, updateItem, removeItem, total, isDirty, resetItems } = useOrderItems();

  const listEndRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<number>();

  useEffect(() => {
    setIsDirty(isDirty);
  }, [isDirty, setIsDirty]);

  useEffect(() => {
    if (items.length > 0) {
      listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [items.length]);

  const filteredCustomers = useMemo(() => 
    customerSearch ? customers.filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase())) : [],
    [customerSearch, customers]
  );

  const filteredProducts = useMemo(() => 
    productSearch ? products.filter(p => 
      p.name.toLowerCase().includes(productSearch.toLowerCase()) || 
      p.barcode.includes(productSearch)
    ) : [],
    [productSearch, products]
  );
  
  const handleSelectCustomer = (customer: Customer) => {
    setSelectedCustomer(customer);
    setCustomerSearch(customer.name);
  };

  const handleAddProduct = (product: Product) => {
    addProduct(product, options);
    setProductSearch('');
  }

  const handleBarcodeScanned = (barcode: string) => {
    const product = products.find(p => p.barcode === barcode);
    if (product) {
      addProduct(product, options);
    } else {
      showAlert(`바코드 '${barcode}'에 해당하는 상품이 없습니다.`);
    }
    setScannerOpen(false);
  };

  const handleSaveOrder = () => {
    if (!selectedCustomer || items.length === 0) {
      showAlert('거래처를 선택하고 품목을 하나 이상 추가해주세요.');
      return;
    }
    const newOrder = {
      id: Date.now(),
      date: new Date().toISOString(),
      customer: selectedCustomer,
      items,
      total,
    };
    addOrder(newOrder);
    showAlert('발주가 성공적으로 저장되었습니다.');
    // 상태 초기화
    setSelectedCustomer(null);
    setCustomerSearch('');
    resetItems();
    setOptions({ isPromotion: false, unit: '개' });
  };
  
  const handleQuantityLongPressStart = (item: OrderItem) => {
    longPressTimerRef.current = window.setTimeout(() => {
        setQuantityModalItem(item);
    }, 500);
  };

  const handlePressEnd = () => {
    clearTimeout(longPressTimerRef.current);
  };
  
  const handleSelectQuantity = (quantity: number) => {
    if (quantityModalItem) {
        updateItem(quantityModalItem.barcode, quantityModalItem.unit, quantityModalItem.isPromotion, i => ({...i, quantity: quantity}));
    }
  };

  const handleUnitLongPressStart = (item: OrderItem) => {
    longPressTimerRef.current = window.setTimeout(() => {
        updateItem(item.barcode, item.unit, item.isPromotion, i => ({ ...i, unit: i.unit === '개' ? '박스' : '개' }));
    }, 500);
  };

  return (
    <div className="flex flex-col h-full">
      {/* --- 상단 고정 영역 --- */}
      <div className="p-4 bg-white border-b sticky top-0 z-10">
        {/* 거래처 검색 */}
        <div className="relative mb-3">
          <input
            type="text"
            value={customerSearch}
            onChange={(e) => {
              setCustomerSearch(e.target.value)
              if (selectedCustomer) setSelectedCustomer(null);
            }}
            placeholder="거래처 검색"
            className="w-full p-2 border rounded-md"
            disabled={items.length > 0}
            aria-label="거래처 검색"
          />
          {filteredCustomers.length > 0 && customerSearch && !selectedCustomer && (
            <ul className="absolute z-20 w-full bg-white border rounded-md mt-1 max-h-40 overflow-y-auto shadow-lg">
              {filteredCustomers.map(c => (
                <li key={c.comcode} onClick={() => handleSelectCustomer(c)} className="p-2 hover:bg-gray-100 cursor-pointer">{c.name}</li>
              ))}
            </ul>
          )}
        </div>

        {/* 바코드 및 상품 검색 */}
        <div className="flex items-stretch gap-2 mb-2">
            <button onClick={() => setScannerOpen(true)} disabled={!selectedCustomer} className="p-2 bg-blue-500 text-white rounded-md disabled:bg-gray-300 flex-shrink-0">
                <BarcodeIcon className="w-6 h-6" />
            </button>
            <div className="relative flex-grow">
                <input
                    type="text"
                    placeholder="품명 또는 바코드 검색"
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                    disabled={!selectedCustomer}
                    className="w-full h-full p-2 border rounded-md disabled:bg-gray-100"
                    aria-label="상품 검색"
                />
                {filteredProducts.length > 0 && productSearch && (
                    <ul className="absolute z-20 w-full bg-white border rounded-md mt-1 max-h-48 overflow-y-auto shadow-lg">
                    {filteredProducts.map(p => (
                        <li key={p.barcode} onClick={() => handleAddProduct(p)} className="p-2 hover:bg-gray-100 cursor-pointer">{p.name} ({p.barcode})</li>
                    ))}
                    </ul>
                )}
            </div>
        </div>

        {/* 옵션 */}
        <div className="flex items-center gap-4">
          <label className="flex items-center">
            <input type="checkbox" checked={options.isPromotion} onChange={e => setOptions(prev => ({...prev, isPromotion: e.target.checked}))} className="h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500" />
            <span className="ml-2 text-gray-700">행사</span>
          </label>
          <label className="flex items-center">
            <input type="checkbox" checked={options.unit === '박스'} onChange={e => setOptions(prev => ({...prev, unit: e.target.checked ? '박스' : '개'}))} className="h-5 w-5 text-green-600 border-gray-300 rounded focus:ring-green-500" />
            <span className="ml-2 text-gray-700">박스</span>
          </label>
        </div>
      </div>

      {/* --- 중앙 스크롤 영역 --- */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {items.length === 0 ? (
          <p className="text-center text-gray-500 mt-8">발주할 품목을 추가해주세요.</p>
        ) : (
          items.map((item) => (
            <div key={`${item.barcode}-${item.unit}-${item.isPromotion}`} className="bg-white p-3 rounded-lg shadow flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">
                    {item.isPromotion && <span className="text-red-500 font-bold">(행사) </span>}
                    {item.name}
                </p>
                <p className="text-sm text-gray-600">{item.price.toLocaleString()}원</p>
              </div>
              
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => updateItem(item.barcode, item.unit, item.isPromotion, i => ({ ...i, quantity: Math.max(1, i.quantity - 1) }))} className="w-8 h-8 bg-gray-200 rounded-full font-bold text-lg select-none">-</button>
                <span
                    className="w-12 text-center font-bold tabular-nums cursor-pointer px-1"
                    onTouchStart={() => handleQuantityLongPressStart(item)}
                    onTouchEnd={handlePressEnd}
                    onMouseDown={() => handleQuantityLongPressStart(item)}
                    onMouseUp={handlePressEnd}
                    onMouseLeave={handlePressEnd}
                >
                    {item.quantity}
                </span>
                <button onClick={() => updateItem(item.barcode, item.unit, item.isPromotion, i => ({ ...i, quantity: i.quantity + 1 }))} className="w-8 h-8 bg-gray-200 rounded-full font-bold text-lg select-none">+</button>
              </div>

              <button 
                onTouchStart={() => handleUnitLongPressStart(item)}
                onTouchEnd={handlePressEnd}
                onMouseDown={() => handleUnitLongPressStart(item)}
                onMouseUp={handlePressEnd}
                onMouseLeave={handlePressEnd}
                className={`px-3 py-1 rounded-md text-white text-sm w-16 text-center select-none flex-shrink-0 ${item.unit === '개' ? 'bg-blue-500' : 'bg-green-500'}`}
              >
                {item.unit}
              </button>
              
              <button onClick={() => removeItem(item.barcode, item.unit, item.isPromotion)} className="text-red-500 hover:text-red-700 flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ))
        )}
        <div ref={listEndRef} />
      </div>

      {/* --- 하단 고정 영역 --- */}
      {items.length > 0 && (
        <div className="p-4 bg-white border-t sticky bottom-0">
          <div className="flex justify-between items-center mb-3">
            <span className="text-lg font-bold">총 합계</span>
            <span className="text-xl font-bold text-blue-600">{total.toLocaleString()}원</span>
          </div>
          <button onClick={handleSaveOrder} className="w-full bg-blue-600 text-white p-3 rounded-lg font-bold text-lg hover:bg-blue-700">
            발주 저장하기
          </button>
        </div>
      )}
      
      {isScannerOpen && <ScannerModal onScan={handleBarcodeScanned} onClose={() => setScannerOpen(false)} />}
      {quantityModalItem && <QuantityModal 
        initialQuantity={quantityModalItem.quantity}
        onSelect={handleSelectQuantity}
        onClose={() => setQuantityModalItem(null)}
      />}
    </div>
  );
};

export default NewOrderPage;