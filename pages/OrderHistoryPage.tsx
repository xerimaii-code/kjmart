
import React, { useState, useMemo, useContext, useEffect } from 'react';
import { AppContext } from '../context/AppContext.tsx';
import { Order } from '../types.ts';

const OrderHistoryPage: React.FC = () => {
    const { orders, openDetailModal } = useContext(AppContext);

    // This function correctly gets the 'YYYY-MM-DD' string for the user's LOCAL timezone.
    const getLocalDateString = (date: Date): string => {
        const offset = date.getTimezoneOffset();
        const adjustedDate = new Date(date.getTime() - (offset * 60 * 1000));
        return adjustedDate.toISOString().split('T')[0];
    };

    const [startDate, setStartDate] = useState(() => getLocalDateString(new Date()));
    const [endDate, setEndDate] = useState(() => getLocalDateString(new Date()));

    // This effect ensures that whenever the user navigates to this page,
    // the date filters are reliably reset to the current local date.
    useEffect(() => {
        const today = getLocalDateString(new Date());
        setStartDate(today);
        setEndDate(today);
    }, []);

    const { filteredOrders, grandTotal } = useMemo(() => {
        if (!startDate || !endDate) return { filteredOrders: [], grandTotal: 0 };

        // Create date objects that represent the start and end of the day in the user's LOCAL timezone.
        const startOfDay = new Date(startDate);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        
        const filtered = orders.filter(order => {
            // order.date is a UTC ISO string, e.g., "2023-10-27T05:12:34.567Z"
            const orderDate = new Date(order.date); 
            // The comparison will correctly place the UTC time within the local time range.
            return orderDate.getTime() >= startOfDay.getTime() && orderDate.getTime() <= endOfDay.getTime();
        }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        const grandTotal = Math.floor(filtered.reduce((sum, order) => sum + order.total, 0));

        return { filteredOrders: filtered, grandTotal };
    }, [orders, startDate, endDate]);

    const groupedByDate = useMemo(() => {
        return filteredOrders.reduce((acc, order) => {
            const dateStr = new Date(order.date).toLocaleDateString('ko-KR');
            if (!acc[dateStr]) {
                acc[dateStr] = [];
            }
            acc[dateStr].push(order);
            return acc;
        }, {} as Record<string, Order[]>);
    }, [filteredOrders]);
    
    const sortedDates = Object.keys(groupedByDate);
    
    return (
        <div className="h-full flex flex-col bg-slate-50">
            <div className="fixed-filter p-4 bg-white border-b border-slate-200 shadow-md">
                <div className="flex items-center space-x-3">
                    <label htmlFor="start-date" className="text-sm font-medium text-slate-600">시작일</label>
                    <input id="start-date" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="flex-grow p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-sky-500" />
                    <label htmlFor="end-date" className="text-sm font-medium text-slate-600">종료일</label>
                    <input id="end-date" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="flex-grow p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-sky-500" />
                </div>
            </div>
            <div className="scrollable-content p-4">
                {filteredOrders.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                        <p className="text-center text-slate-500 text-lg">해당 기간의 발주 내역이 없습니다.</p>
                    </div>
                ) : (
                    <>
                        {sortedDates.map(dateStr => (
                            <div key={dateStr} className="mb-6">
                                <h3 className="font-bold text-lg mb-3 p-2 bg-slate-100 rounded-md text-slate-700 sticky top-0">{dateStr}</h3>
                                <div className="space-y-2">
                                    {groupedByDate[dateStr].map(order => (
                                        <div
                                            key={order.id}
                                            onClick={() => openDetailModal(order.id)}
                                            className="flex justify-between items-center p-4 bg-white rounded-lg shadow-sm cursor-pointer border border-transparent hover:shadow-md hover:border-sky-500 transition-all"
                                            role="button"
                                            tabIndex={0}
                                            onKeyDown={(e) => e.key === 'Enter' && openDetailModal(order.id)}
                                        >
                                            <span className="font-semibold text-slate-800">{order.customer.name}</span>
                                            <span className="font-bold text-slate-900">{order.total.toLocaleString()} 원</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </>
                )}
            </div>
            {filteredOrders.length > 0 && (
                <div className="p-4 bg-slate-100 border-t border-slate-200 text-right font-bold text-xl flex-shrink-0">
                    <span className="text-slate-600">전체 합계: </span>
                    <span id="grand-total-sum" className="text-slate-800">{grandTotal.toLocaleString()} 원</span>
                </div>
            )}
        </div>
    );
};

export default OrderHistoryPage;