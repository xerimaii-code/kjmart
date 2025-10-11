import React, { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react';
import { useDataState, useDataActions, useUIActions, useUIState } from '../context/AppContext';
import { Order } from '../types';
import { SmsIcon, XlsIcon, TrashIcon, ArchiveBoxIcon, UndoIcon, MoreVerticalIcon, ChatBubbleLeftIcon, PencilSquareIcon } from '../components/Icons';
import { exportToSMS } from '../services/dataService';
import { getAllDraftKeys } from '../services/draftDbService';

interface ActionMenuItem {
    id: string;
    label: string;
    icon: React.ReactNode;
    className?: string;
    onClick: () => void;
}

interface OrderHistoryPageProps {
    isActive: boolean;
}

const getStatusIcon = (order: Order, hasDraft: boolean) => {
    const details = order.completionDetails;
    const timestamp = details?.timestamp || order.completedAt;
    const localeTimestamp = timestamp ? new Date(timestamp).toLocaleString() : '';

    if (details?.type === 'sms') {
        return <SmsIcon className="w-5 h-5 text-green-500 mr-2 flex-shrink-0" title={`SMS 완료: ${localeTimestamp}`} />;
    }
    if (details?.type === 'xls') {
        return <XlsIcon className="w-5 h-5 text-blue-500 mr-2 flex-shrink-0" title={`XLS 완료: ${localeTimestamp}`} />;
    }
    if (order.completedAt) {
         return <ArchiveBoxIcon className="w-5 h-5 text-gray-500 mr-2 flex-shrink-0" title={`완료: ${localeTimestamp}`} />;
    }
    if (hasDraft) {
        return <PencilSquareIcon className="w-5 h-5 text-orange-500 mr-2 flex-shrink-0" title="임시 저장된 수정사항이 있습니다." />;
    }
    return null;
};

const OrderCard = memo(({
    order,
    isHighlighted,
    isMenuOpen,
    hasDraft,
    onCardClick,
    onMenuToggle,
    onSmsExport,
    onXlsExport,
    onDelete,
    onCancelCompletion,
}: {
    order: Order;
    isHighlighted: boolean;
    isMenuOpen: boolean;
    hasDraft: boolean;
    onCardClick: (id: number) => void;
    onMenuToggle: (id: number) => void;
    onSmsExport: (order: Order) => void;
    onXlsExport: (order: Order) => void;
    onDelete: (order: Order) => void;
    onCancelCompletion: (order: Order) => void;
}) => {
    const isCompleted = !!order.completedAt || !!order.completionDetails;

    const handleInternalCardClick = useCallback(() => {
        onCardClick(order.id);
    }, [onCardClick, order.id]);

    const handleInternalMenuToggle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onMenuToggle(order.id);
    }, [onMenuToggle, order.id]);

    const actionMenuItems: ActionMenuItem[] = useMemo(() => {
        const commonDeleteAction = {
            id: 'delete',
            label: '삭제',
            icon: <TrashIcon className="w-5 h-5 text-red-500" />,
            className: 'text-red-500 font-medium',
            onClick: () => onDelete(order),
        };

        if (isCompleted) {
            return [
                {
                    id: 'cancel',
                    label: '완료 취소',
                    icon: <UndoIcon className="w-5 h-5 text-gray-500" />,
                    onClick: () => onCancelCompletion(order),
                },
                commonDeleteAction,
            ];
        }

        return [
            {
                id: 'sms',
                label: 'SMS 내보내기',
                icon: <SmsIcon className="w-5 h-5 text-gray-500" />,
                onClick: () => onSmsExport(order),
            },
            {
                id: 'xls',
                label: 'XLS 내보내기',
                icon: <XlsIcon className="w-5 h-5 text-gray-500" />,
                onClick: () => onXlsExport(order),
            },
            commonDeleteAction,
        ];
    }, [isCompleted, order, onCancelCompletion, onDelete, onSmsExport, onXlsExport]);

    return (
        <div className={`relative ${isMenuOpen ? 'z-10' : ''}`}>
            <div
                id={`order-item-${order.id}`}
                className={`flex items-center bg-white rounded-xl transition-colors duration-500 ease-in-out ${isHighlighted ? 'bg-yellow-100 ring-2 ring-yellow-300' : 'hover:bg-slate-100'}`}
            >
                <div
                    onClick={handleInternalCardClick}
                    className={`flex-grow p-3 cursor-pointer rounded-l-xl ${isCompleted ? 'opacity-60' : ''}`}
                    role="button"
                >
                    <div className="flex justify-between items-center">
                        <p className="font-bold text-gray-800 text-lg flex items-center" title={order.customer.name}>
                            {getStatusIcon(order, hasDraft)}
                            <span className="truncate">{order.customer.name}</span>
                            {order.memo && order.memo.trim() && <ChatBubbleLeftIcon className="w-5 h-5 text-gray-400 ml-2 flex-shrink-0" title="메모 있음" />}
                        </p>
                        <p className="font-bold text-gray-700 text-lg tabular-nums">
                            {order.total.toLocaleString()} 원
                        </p>
                    </div>
                </div>
                <div className="flex-shrink-0 px-1">
                    <button onClick={handleInternalMenuToggle} className="p-2 rounded-full text-gray-500 hover:bg-gray-200/80 transition-colors">
                        <MoreVerticalIcon className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {isMenuOpen && (
                <div className="absolute top-12 right-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-10 py-1" onClick={(e) => e.stopPropagation()}>
                    {actionMenuItems.map(item => (
                        <button
                            key={item.id}
                            onClick={item.onClick}
                            className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-3 hover:bg-gray-100 ${item.className || 'text-gray-700'}`}
                        >
                            {item.icon}
                            <span>{item.label}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
});
OrderCard.displayName = 'OrderCard';


const OrderHistoryPage: React.FC<OrderHistoryPageProps> = ({ isActive }) => {
    const { orders } = useDataState();
    const { deleteOrder, updateOrder } = useDataActions();
    const { lastModifiedOrderId, isDeliveryModalOpen } = useUIState();
    const { openDetailModal, showAlert, setLastModifiedOrderId, openDeliveryModal, closeDeliveryModal } = useUIActions();

    const [highlightedOrderId, setHighlightedOrderId] = useState<number | null>(null);
    const [draftOrderIds, setDraftOrderIds] = useState<Set<number>>(new Set());

    const getLocalDateString = (date: Date): string => {
        const offset = date.getTimezoneOffset();
        const adjustedDate = new Date(date.getTime() - (offset * 60 * 1000));
        return adjustedDate.toISOString().split('T')[0];
    };

    const getInitialDateRange = () => {
        const today = new Date();
        const endDate = getLocalDateString(today);
        
        const weekAgo = new Date();
        weekAgo.setDate(today.getDate() - 6);
        const startDate = getLocalDateString(weekAgo);

        return { startDate, endDate };
    };

    const [startDate, setStartDate] = useState(() => getInitialDateRange().startDate);
    const [endDate, setEndDate] = useState(() => getInitialDateRange().endDate);
    const [openMenuId, setOpenMenuId] = useState<number | null>(null);

    const scrollableContainerRef = useRef<HTMLDivElement>(null);
    const filterContainerRef = useRef<HTMLDivElement>(null);

     useEffect(() => {
        const fetchDrafts = async () => {
            try {
                const keys = await getAllDraftKeys();
                const numericKeys = keys.filter(key => typeof key === 'number') as number[];
                setDraftOrderIds(new Set(numericKeys));
            } catch (error) {
                console.error("Failed to fetch draft keys:", error);
            }
        };
        fetchDrafts();
    }, [orders, isActive]);
    
    useEffect(() => {
        if (!isActive) {
            setOpenMenuId(null);
            if (isDeliveryModalOpen) {
                closeDeliveryModal();
            }
        }
    }, [isActive, isDeliveryModalOpen, closeDeliveryModal]);
    
    useEffect(() => {
        if (lastModifiedOrderId) {
            setHighlightedOrderId(lastModifiedOrderId);

            const scrollTimer = setTimeout(() => {
                const element = document.getElementById(`order-item-${lastModifiedOrderId}`);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);

            const highlightTimer = setTimeout(() => {
                setHighlightedOrderId(null);
                setLastModifiedOrderId(null);
            }, 3000);

            return () => {
                clearTimeout(scrollTimer);
                clearTimeout(highlightTimer);
            };
        }
    }, [lastModifiedOrderId, setLastModifiedOrderId]);

    useEffect(() => {
        const { startDate, endDate } = getInitialDateRange();
        setStartDate(startDate);
        setEndDate(endDate);
    }, []);

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

    const filteredOrders = useMemo(() => {
        if (!startDate || !endDate) return [];

        const startOfDay = new Date(startDate);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        
        return orders.filter(order => {
            const orderDate = new Date(order.date);
            return orderDate.getTime() >= startOfDay.getTime() && orderDate.getTime() <= endOfDay.getTime();
        }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
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
    
    // Scroll to bottom when the page becomes active and orders are loaded.
    useEffect(() => {
        const scrollToBottom = () => {
            if (scrollableContainerRef.current) {
                scrollableContainerRef.current.scrollTop = scrollableContainerRef.current.scrollHeight;
            }
        };
        
        if (isActive && filteredOrders.length > 0) {
            // A short timeout can help ensure layout is complete before scrolling.
            const timer = setTimeout(scrollToBottom, 50);
            return () => clearTimeout(timer);
        }
    }, [isActive, filteredOrders.length]);

    const handleDelete = useCallback((order: Order) => {
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
    }, [showAlert, deleteOrder]);

    const handleSmsExport = useCallback(async (order: Order) => {
        const message = exportToSMS(order);
        let success = false;

        if (navigator.share) {
            try {
                await navigator.share({ text: message });
                success = true;
            } catch (error) {
                if ((error as DOMException).name !== 'AbortError') {
                    console.error('Share error:', error);
                    showAlert('공유 기능을 사용할 수 없습니다.');
                }
                success = false;
            }
        } else {
            showAlert('문자 앱으로 연결합니다. 발주 내용이 긴 경우 일부가 잘릴 수 있습니다.');
            window.location.href = `sms:?body=${encodeURIComponent(message)}`;
            success = true;
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
    }, [showAlert, updateOrder]);

    const handleXlsExport = useCallback((order: Order) => {
        openDeliveryModal(order);
        setOpenMenuId(null);
    }, [openDeliveryModal]);

    const handleCancelCompletion = useCallback((order: Order) => {
        showAlert(
            '이 발주의 \'완료\' 상태를 취소하시겠습니까?',
            () => {
                updateOrder({ ...order, completedAt: null, completionDetails: null });
                setOpenMenuId(null);
            },
            '실행 취소'
        );
    }, [showAlert, updateOrder]);

    const handleBackgroundClick = useCallback(() => {
        if (openMenuId !== null) {
            setOpenMenuId(null);
        }
    }, [openMenuId]);
    
    const handleMenuToggle = useCallback((orderId: number) => {
        setOpenMenuId(prevId => (prevId === orderId ? null : orderId));
    }, []);
    
    const handleCardClick = useCallback((orderId: number) => {
        openDetailModal(orderId)
    }, [openDetailModal]);

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
                                        return (
                                            <OrderCard
                                                key={order.id}
                                                order={order}
                                                isHighlighted={highlightedOrderId === order.id}
                                                isMenuOpen={openMenuId === order.id}
                                                hasDraft={draftOrderIds.has(order.id)}
                                                onCardClick={handleCardClick}
                                                onMenuToggle={handleMenuToggle}
                                                onSmsExport={handleSmsExport}
                                                onXlsExport={handleXlsExport}
                                                onDelete={handleDelete}
                                                onCancelCompletion={handleCancelCompletion}
                                            />
                                        )
                                    })}
                                </div>
                            </div>
                        )})}
                    </div>
                )}
            </div>
        </div>
    );
};

export default OrderHistoryPage;