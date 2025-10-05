import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useData, useUI } from '../context/AppContext';
import { Order } from '../types';
import { SmsIcon, XlsIcon, TrashIcon, ArchiveBoxIcon, UndoIcon, MoreVerticalIcon, ChatBubbleLeftIcon } from '../components/Icons';
import { exportToSMS, exportToXLS } from '../services/dataService';
import DeliveryTypeModal from '../components/DeliveryTypeModal';

interface ActionMenuItem {
    id: string;
    label: string;
    icon: React.ReactNode;
    className?: string;
    onClick: () => void;
}

const OrderHistoryPage: React.FC = () => {
    const { orders, deleteOrder, updateOrder } = useData();
    const { openDetailModal, showAlert } = useUI();

    // This function correctly gets the 'YYYY-MM-DD' string for the user's LOCAL timezone.
    const getLocalDateString = (date: Date): string => {
        const offset = date.getTimezoneOffset();
        const adjustedDate = new Date(date.getTime() - (offset * 60 * 1000));
        return adjustedDate.toISOString().split('T')[0];
    };

    const getInitialDateRange = () => {
        const today = new Date();
        const endDate = getLocalDateString(today);
        
        const weekAgo = new Date();
        weekAgo.setDate(today.getDate() - 6); // -6 to make it a 7-day period including today
        const startDate = getLocalDateString(weekAgo);

        return { startDate, endDate };
    };

    const [startDate, setStartDate] = useState(() => getInitialDateRange().startDate);
    const [endDate, setEndDate] = useState(() => getInitialDateRange().endDate);
    const [openMenuId, setOpenMenuId] = useState<number | null>(null);
    const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);
    const [orderToExport, setOrderToExport] = useState<Order | null>(null);

    const scrollableContainerRef = useRef<HTMLDivElement>(null);
    const filterContainerRef = useRef<HTMLDivElement>(null);

    // This effect ensures that whenever the user navigates to this page,
    // the date filters are reliably reset to the last 7 days.
    useEffect(() => {
        const { startDate, endDate } = getInitialDateRange();
        setStartDate(startDate);
        setEndDate(endDate);
    }, []);

    // This effect will handle closing the menu when interacting outside of it.
    useEffect(() => {
        const scrollableEl = scrollableContainerRef.current;
        const filterEl = filterContainerRef.current;

        const closeAnyOpenMenu = () => {
            setOpenMenuId(null);
        };

        if (scrollableEl) {
            scrollableEl.addEventListener('scroll', closeAnyOpenMenu, { passive: true });
        }
        if (filterEl) {
            filterEl.addEventListener('pointerdown', closeAnyOpenMenu);
        }

        return () => {
            if (scrollableEl) {
                scrollableEl.removeEventListener('scroll', closeAnyOpenMenu);
            }
            if (filterEl) {
                filterEl.removeEventListener('pointerdown', closeAnyOpenMenu);
            }
        };
    }, []);

    const { filteredOrders } = useMemo(() => {
        if (!startDate || !endDate) return { filteredOrders: [] };

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

        return { filteredOrders: filtered };
    }, [orders, startDate, endDate]);

    const groupedByDate = useMemo(() => {
        return filteredOrders.reduce((acc, order) => {
            const dateStr = new Date(order.date).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'});
            if (!acc[dateStr]) {
                acc[dateStr] = [];
            }
            acc[dateStr].push(order);
            return acc;
        }, {} as Record<string, Order[]>);
    }, [filteredOrders]);
    
    const sortedDates = Object.keys(groupedByDate);
    
    const handleDelete = (order: Order) => {
        showAlert(
            `'${order.customer.name}'의 발주 내역을 삭제하시겠습니까?`,
            () => {
                deleteOrder(order.id);
                setOpenMenuId(null);
                showAlert('발주 내역이 삭제되었습니다.');
            },
            '삭제',
            'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
        );
    };
    
    const handleBackgroundClick = () => {
        if (openMenuId !== null) {
            setOpenMenuId(null);
        }
    };
    
    const handleMenuToggle = (e: React.MouseEvent, orderId: number) => {
        e.stopPropagation();
        setOpenMenuId(prevId => (prevId === orderId ? null : orderId));
    };

    const getStatusIcon = (order: Order) => {
        const details = order.completionDetails;
        const timestamp = details?.timestamp || order.completedAt;
        const localeTimestamp = timestamp ? new Date(timestamp).toLocaleString() : '';

        if (details?.type === 'sms') {
            return <SmsIcon className="w-5 h-5 text-green-500 mr-2 flex-shrink-0" title={`SMS 완료: ${localeTimestamp}`} />;
        }
        if (details?.type === 'xls') {
            return <XlsIcon className="w-5 h-5 text-blue-500 mr-2 flex-shrink-0" title={`XLS 완료: ${localeTimestamp}`} />;
        }
        // Fallback for old data without completionDetails
        if (order.completedAt) {
             return <ArchiveBoxIcon className="w-5 h-5 text-gray-500 mr-2 flex-shrink-0" title={`완료: ${localeTimestamp}`} />;
        }
        return null;
    };

    return (
        <div className="h-full flex flex-col w-full max-w-3xl mx-auto">
            <div ref={filterContainerRef} className="fixed-filter p-4 bg-gray-50 shadow-md z-10">
                <div className="grid grid-cols-2 gap-4 items-center">
                    <div className="space-y-1">
                        <label htmlFor="start-date" className="text-sm font-medium text-gray-600 px-1">시작일</label>
                        <input id="start-date" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full p-2 border border-gray-300 bg-gray-100 shadow-inner shadow-gray-200/80 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-500 transition-colors" autoComplete="off" />
                    </div>
                    <div className="space-y-1">
                        <label htmlFor="end-date" className="text-sm font-medium text-gray-600 px-1">종료일</label>
                        <input id="end-date" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full p-2 border border-gray-300 bg-gray-100 shadow-inner shadow-gray-200/80 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-500 transition-colors" autoComplete="off" />
                    </div>
                </div>
            </div>
            <div ref={scrollableContainerRef} className="scrollable-content p-4 relative" onClick={handleBackgroundClick}>
                {filteredOrders.length === 0 ? (
                    <div className="relative flex flex-col items-center justify-center h-full text-gray-400">
                        <p className="text-center text-lg font-semibold">발주 내역이 없습니다</p>
                        <p className="text-sm">기간을 변경하거나 새로운 발주를 등록해주세요.</p>
                    </div>
                ) : (
                    <div className="relative pb-16 space-y-6">
                        {sortedDates.map(dateStr => {
                            const dailyOrders = groupedByDate[dateStr];
                            const dailyTotal = dailyOrders.reduce((sum, order) => sum + order.total, 0);
                            return (
                            <div key={dateStr} className="bg-white rounded-2xl shadow-lg shadow-slate-200/60 border border-slate-200/80">
                                <div className="p-4 border-b border-slate-200 bg-slate-50">
                                    <div className="flex justify-between items-baseline">
                                        <h3 className="text-lg font-bold text-slate-800 tracking-tight">{dateStr}</h3>
                                        <div className="text-sm font-semibold text-slate-600">
                                            일일 합계: <span className="text-base font-bold text-slate-800">{dailyTotal.toLocaleString()} 원</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="p-2 space-y-px">
                                    {dailyOrders.map(order => {
                                        const handleSmsExport = async (order: Order) => {
                                            const message = exportToSMS(order);
                                            let success = false;
                                
                                            if (navigator.share) {
                                                try {
                                                    await navigator.share({
                                                        title: `발주서: ${order.customer.name}`,
                                                        text: message,
                                                    });
                                                    success = true;
                                                } catch (error) {
                                                    if ((error as DOMException).name !== 'AbortError') {
                                                        console.error('Share error:', error);
                                                        showAlert('공유 기능을 사용할 수 없습니다.');
                                                    }
                                                    success = false; // User cancelled or error
                                                }
                                            } else {
                                                showAlert('문자 앱으로 연결합니다. 발주 내용이 긴 경우 일부가 잘릴 수 있습니다.');
                                                const smsLink = `sms:?body=${encodeURIComponent(message)}`;
                                                window.location.href = smsLink;
                                                success = true; // Assume success for sms link
                                            }
                                
                                            if (success) {
                                                const timestamp = new Date().toISOString();
                                                updateOrder({
                                                    ...order,
                                                    completedAt: timestamp,
                                                    completionDetails: { type: 'sms', timestamp }
                                                });
                                            }
                                            setOpenMenuId(null);
                                        };

                                        const handleXlsExport = (order: Order) => {
                                            setOrderToExport(order);
                                            setIsDeliveryModalOpen(true);
                                            setOpenMenuId(null);
                                        };

                                        const handleCancelCompletion = (order: Order) => {
                                            showAlert(
                                                '이 발주의 \'완료\' 상태를 취소하시겠습니까?',
                                                () => {
                                                    updateOrder({ ...order, completedAt: null, completionDetails: null });
                                                    setOpenMenuId(null);
                                                },
                                                '실행 취소'
                                            );
                                        };
                                        
                                        const isCompleted = !!order.completedAt || !!order.completionDetails;
                                        
                                        const actionMenuItems: ActionMenuItem[] = isCompleted ? [
                                            {
                                                id: 'cancel', label: '완료 취소',
                                                icon: <UndoIcon className="w-5 h-5 text-gray-500" />,
                                                onClick: () => handleCancelCompletion(order),
                                            },
                                            {
                                                id: 'delete', label: '삭제',
                                                icon: <TrashIcon className="w-5 h-5 text-red-500" />,
                                                className: 'text-red-500 font-medium',
                                                onClick: () => handleDelete(order),
                                            }
                                        ] : [
                                            {
                                                id: 'sms', label: 'SMS 내보내기',
                                                icon: <SmsIcon className="w-5 h-5 text-gray-500" />,
                                                onClick: () => handleSmsExport(order)
                                            },
                                            {
                                                id: 'xls', label: 'XLS 내보내기',
                                                icon: <XlsIcon className="w-5 h-5 text-gray-500" />,
                                                onClick: () => handleXlsExport(order)
                                            },
                                            {
                                                id: 'delete', label: '삭제',
                                                icon: <TrashIcon className="w-5 h-5 text-red-500" />,
                                                className: 'text-red-500 font-medium',
                                                onClick: () => handleDelete(order),
                                            }
                                        ];

                                        return (
                                            <div key={order.id} className={`relative ${openMenuId === order.id ? 'z-10' : ''}`}>
                                                <div className="flex items-center bg-white rounded-xl transition-colors hover:bg-slate-100">
                                                    <div
                                                        onClick={() => openDetailModal(order.id)}
                                                        className={`flex-grow p-3 cursor-pointer rounded-l-xl ${isCompleted ? 'opacity-60' : ''}`}
                                                        role="button"
                                                    >
                                                        <div className="flex justify-between items-center">
                                                            <p className="font-bold text-gray-800 text-lg flex items-center" title={order.customer.name}>
                                                                {getStatusIcon(order)}
                                                                <span className="truncate">{order.customer.name}</span>
                                                                {order.memo && order.memo.trim() && <ChatBubbleLeftIcon className="w-5 h-5 text-gray-400 ml-2 flex-shrink-0" title="메모 있음" />}
                                                            </p>
                                                            <p className="font-bold text-gray-700 text-lg tabular-nums">
                                                                {order.total.toLocaleString()} 원
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="flex-shrink-0 px-1">
                                                        <button onClick={(e) => handleMenuToggle(e, order.id)} className="p-2 rounded-full text-gray-500 hover:bg-gray-200/80 transition-colors">
                                                            <MoreVerticalIcon className="w-5 h-5" />
                                                        </button>
                                                    </div>
                                                </div>

                                                {openMenuId === order.id && (
                                                    <div className="absolute top-12 right-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-10 py-1" onClick={(e) => e.stopPropagation()}>
                                                        {actionMenuItems.map(item => (
                                                            <button
                                                                key={item.id}
                                                                onClick={() => {
                                                                    item.onClick();
                                                                    setOpenMenuId(null);
                                                                }}
                                                                className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-3 hover:bg-gray-100 ${item.className || 'text-gray-700'}`}
                                                            >
                                                                {item.icon}
                                                                <span>{item.label}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )})}
                    </div>
                )}
            </div>
            <DeliveryTypeModal
                isOpen={isDeliveryModalOpen}
                onClose={() => setIsDeliveryModalOpen(false)}
                onConfirm={(deliveryType) => {
                    if (orderToExport) {
                        exportToXLS(orderToExport, deliveryType);
                        const timestamp = new Date().toISOString();
                        updateOrder({
                            ...orderToExport,
                            completedAt: timestamp,
                            completionDetails: { type: 'xls', timestamp }
                        });
                    }
                    setIsDeliveryModalOpen(false);
                    setOrderToExport(null);
                }}
            />
        </div>
    );
};

export default OrderHistoryPage;