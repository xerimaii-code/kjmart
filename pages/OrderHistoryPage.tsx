import React, { useState, useMemo, useContext } from 'react';
import { AppContext } from '../context/AppContext';
import { Order } from '../types';
import OrderDetailModal from '../components/OrderDetailModal';

const OrderHistoryPage: React.FC = () => {
  const { orders } = useContext(AppContext);
  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  
  const filteredOrders = useMemo(() => {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    return orders
      .filter(order => {
        const orderDate = new Date(order.date);
        return orderDate >= start && orderDate <= end;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [orders, startDate, endDate]);

  const groupedOrders = useMemo(() => {
    // FIX: The initial value for `reduce` must be explicitly typed. Without this,
    // TypeScript infers the result as a generic object, causing `ordersInGroup`
    // to be of type `unknown` later in the component.
    return filteredOrders.reduce((acc: Record<string, Order[]>, order) => {
      const date = new Date(order.date).toLocaleDateString('ko-KR');
      if (!acc[date]) {
        acc[date] = [];
      }
      acc[date].push(order);
      return acc;
    }, {} as Record<string, Order[]>);
  }, [filteredOrders]);

  const totalAmount = useMemo(() => {
    return filteredOrders.reduce((sum, order) => sum + order.total, 0);
  }, [filteredOrders]);

  return (
    <div className="flex flex-col h-full">
      {/* --- Top Fixed Area --- */}
      <div className="p-4 bg-white border-b sticky top-0 z-10">
        <h2 className="text-lg font-bold mb-2">조회 기간 설정</h2>
        <div className="flex gap-4 items-center">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full p-2 border rounded-md" />
          <span>~</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full p-2 border rounded-md" />
        </div>
      </div>
      
      {/* --- Center Scroll Area --- */}
      <div className="flex-1 overflow-y-auto p-4">
        {Object.keys(groupedOrders).length === 0 ? (
          <p className="text-center text-gray-500 mt-8">해당 기간에 발주 내역이 없습니다.</p>
        ) : (
          Object.entries(groupedOrders).map(([date, ordersInGroup]) => (
            <div key={date} className="mb-6">
              <h3 className="font-bold text-gray-600 bg-gray-100 p-2 rounded-t-md">{date}</h3>
              <div className="space-y-2">
                {ordersInGroup.map(order => (
                  <div key={order.id} onClick={() => setSelectedOrder(order)} className="bg-white p-4 rounded-b-md shadow cursor-pointer hover:bg-blue-50 transition">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-lg">{order.customer.name}</span>
                      <span className="text-gray-800 font-bold">{order.total.toLocaleString()}원</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* --- Bottom Fixed Area --- */}
      {filteredOrders.length > 0 && (
        <div className="p-4 bg-white border-t sticky bottom-0">
          <div className="flex justify-between items-center">
            <span className="text-lg font-bold">조회 기간 합계</span>
            <span className="text-xl font-bold text-blue-600">{totalAmount.toLocaleString()}원</span>
          </div>
        </div>
      )}
      
      {selectedOrder && <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />}
    </div>
  );
};

export default OrderHistoryPage;