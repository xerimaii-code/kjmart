import React, { useState, useMemo, useContext, useEffect, useRef } from 'react';
import { AppContext } from '../context/AppContext';
import { Order, OrderItem, Product } from '../types';
import { generateXLS, formatSmsBody } from '../services/dataService';
import { BarcodeIcon } from './Icons';
import ScannerModal from './ScannerModal';
import QuantityModal from './QuantityModal';
import { useOrderItems } from '../hooks/useOrderItems';

interface OrderDetailModalProps {
  order: Order;
  onClose: () => void;
}

const OrderDetailModal: React.FC<OrderDetailModalProps> = ({ order, onClose }) => {
  const { products, updateOrder, deleteOrder, showAlert, setIsDirty } = useContext(AppContext);
  
  const { items, addProduct, updateItem, removeItem, total, isDirty } = useOrderItems(order.items);

  const [isScannerOpen, setScannerOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [options, setOptions] = useState({ isPromotion: false, unit: '개' as '개' | '박스' });
  const [quantityModalItem, setQuantityModalItem] = useState<OrderItem | null>(null);

  const listEndRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<number>();

  useEffect(() => {
    setIsDirty(isDirty);
  }, [isDirty, setIsDirty]);

   useEffect(() => {
    // 컴포넌트 언마운트 시 dirty 상태 정리
    return () => setIsDirty(false);
  }, [setIsDirty]);
  
  useEffect(() => {
      listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items.length]);

  const filteredProducts = useMemo(() => 
    productSearch ? products.filter(p => 
      p.name.toLowerCase().includes(productSearch.toLowerCase()) || 
      p.barcode.includes(productSearch)
    ) : [],
    [productSearch, products]
  );
  
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
  
  const handleSaveChanges = () => {
    if (items.length === 0) {
      showAlert('품목이 하나 이상 있어야 합니다. 내역을 삭제하려면 내역삭제 버튼을 사용하세요.');
      return;
    }
    const updatedOrder: Order = { ...order, items, total };
    updateOrder(updatedOrder);
    showAlert('발주 내역이 수정되었습니다.');
    onClose();
  };

  const handleDeleteOrder = () => {
    showAlert('정말 이 발주 내역을 삭제하시겠습니까?', true, () => {
      deleteOrder(order.id);
      // alert는 자동으로 닫히므로 여기서는 닫을 필요 없음
      onClose();
    });
  };

  const handleSms = () => {
    const body = formatSmsBody({ ...order, items, total });
    window.location.href = `sms:?body=${body}`;
  };

  const handleXls = () => {
    generateXLS({ ...order, items, total });
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex flex-col justify-end z-30" onClick={onClose}>
      <div className="bg-gray-100 h-[95vh] rounded-t-2xl flex flex-col modal-enter-active" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex justify-between items-center p-4 bg-white rounded-t-2xl border-b flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold">{order.customer.name}</h2>
            <p className="text-sm text-gray-500">{new Date(order.date).toLocaleString('ko-KR')}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </button>
        </div>

        {/* 품목 추가 섹션 */}
         <div className="p-4 bg-white border-b flex-shrink-0">
             <div className="flex items-stretch gap-2 mb-2">
                <button onClick={() => setScannerOpen(true)} className="p-2 bg-blue-500 text-white rounded-md flex-shrink-0">
                    <BarcodeIcon className="w-6 h-6" />
                </button>
                <div className="relative flex-grow">
                    <input
                        type="text"
                        placeholder="품명 또는 바코드 검색"
                        value={productSearch}
                        onChange={e => setProductSearch(e.target.value)}
                        className="w-full h-full p-2 border rounded-md"
                        aria-label="상품 검색"
                    />
                    {filteredProducts.length > 0 && productSearch && (
                        <ul className="absolute z-50 w-full bg-white border rounded-md mt-1 max-h-48 overflow-y-auto shadow-lg">
                        {filteredProducts.map(p => (
                            <li key={p.barcode} onClick={() => handleAddProduct(p)} className="p-2 hover:bg-gray-100 cursor-pointer">{p.name} ({p.barcode})</li>
                        ))}
                        </ul>
                    )}
                </div>
            </div>
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

        {/* 품목 목록 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {items.length === 0 ? (
            <p className="text-center text-gray-500 mt-8">발주 품목이 없습니다.</p>
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

        {/* 푸터 */}
        <div className="p-4 bg-white border-t flex-shrink-0">
          <div className="flex justify-between items-center mb-3">
            <span className="text-lg font-bold">총 합계</span>
            <span className="text-xl font-bold text-blue-600">{total.toLocaleString()}원</span>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <button onClick={handleSms} className="w-full bg-yellow-500 text-white p-3 rounded-lg font-bold hover:bg-yellow-600">SMS</button>
            <button onClick={handleXls} className="w-full bg-green-500 text-white p-3 rounded-lg font-bold hover:bg-green-600">XLS</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={handleDeleteOrder} className="w-full bg-red-600 text-white p-3 rounded-lg font-bold hover:bg-red-700">내역삭제</button>
            <button onClick={handleSaveChanges} disabled={!isDirty} className="w-full bg-blue-600 text-white p-3 rounded-lg font-bold hover:bg-blue-700 disabled:bg-gray-400">
              수정저장
            </button>
          </div>
        </div>
      </div>
      {isScannerOpen && <ScannerModal onScan={handleBarcodeScanned} onClose={() => setScannerOpen(false)} />}
       {quantityModalItem && <QuantityModal 
        initialQuantity={quantityModalItem.quantity}
        onSelect={handleSelectQuantity}
        onClose={() => setQuantityModalItem(null)}
      />}
    </div>
  );
};

export default OrderDetailModal;