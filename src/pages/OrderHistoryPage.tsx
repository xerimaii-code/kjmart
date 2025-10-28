import React, { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react';
import { useDataActions, useAlert, useModals, useMiscUI } from '../context/AppContext';
import { Order } from '../types';
import { SmsIcon, XlsIcon, TrashIcon, ArchiveBoxIcon, UndoIcon, MoreVerticalIcon, ChatBubbleLeftIcon, PencilSquareIcon, SpinnerIcon } from '../components/Icons';
import { exportToSMS } from '../services/dataService';
import { getAllDraftKeys } from '../services/draftDbService';
import * as db from '../services/dbService';
import * as cache from './cacheDbService';

const PAGE_SIZE = 30;

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

const OrderRow = memo(({
    order,
    isHighlighted,
    isMenuOpen,
    hasDraft,
    onCardClick,
    onMenuToggle,
    actionMenuItems,
    index,
}: {
    order: Order;
    isHighlighted: boolean;
    isMenuOpen: boolean;
    hasDraft: boolean;
    onCardClick: () => void;
    onMenuToggle: (e: React.MouseEvent) => void;
    actionMenuItems: ActionMenuItem[];
    index: number;
}) => {
    const isCompleted = !!order.completedAt || !!order.completionDetails;
    const isUpdated = order.updatedAt && order.createdAt && new Date(order.updatedAt).getTime() > new Date(order.createdAt).getTime();

    return (
        <div 
            className={`relative ${isMenuOpen ? 'z-10' : ''} animate-card-enter`}
            style={{ animationDelay: `${Math.min(index * 30, 400)}ms` }}
        >
            <div
                id={`order-item-${order.id}`}
                className={`flex items-center transition-all duration-300 ease-in-out ${isHighlighted ? 'bg-yellow-100' : 'hover:bg-gray-50'}`}
            >
                <div
                    onClick={onCardClick}
                    className={`flex-grow p-4 cursor-pointer ${isCompleted ? 'opacity-70' : ''}`}
                    role="button"
                    aria-label={`${order.customer.name} 주문 보기`}
                >
                    <div className="flex justify-between items-center gap-2">
                        <div className="flex-grow min-w-0">
                            <p className="font-bold text-gray-800 text-base flex items-center" title={order.customer.name}>
                                {getStatusIcon(order, hasDraft)}
                                <span className="truncate">{order.customer.name}</span>
                                {order.memo && order.memo.trim() && <ChatBubbleLeftIcon className="w-5 h-5 text-gray-400 ml-2 flex-shrink-0" title="메모 있음" />}
                            </p>
                            <div className="text-sm text-gray-500 mt-1">
                                <span>{new Date(order.date).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                                {isUpdated && (
                                    <span className="text-xs text-gray-400 ml-1.5">(최초: {new Date(order.createdAt).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })})</span>
                                )}
                            </div>
                        </div>
                        <p className="font-semibold text-gray-800 text-base tabular-nums tracking-tighter flex-shrink-0">
                            {order.total.toLocaleString()} 원
                        </p>
                    </div>
                </div>
                <div className="flex-shrink-0 pr-2">
                    <button onClick={onMenuToggle} className="p-2 rounded-full text-gray-500 hover:bg-gray-200/80 transition-colors" aria-label="추가 옵션">
                        <MoreVerticalIcon className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {isMenuOpen && (
                <div className="absolute top-12 right-4 w-52 bg-white rounded-xl shadow-2xl border border-gray-200/60 z-20 py-2 animate-fade-in-down" onClick={(e) => e.stopPropagation()}>
                    {actionMenuItems.map(item => (
                        <button
                            key={item.id}
                            onClick={item.onClick}
                            className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 hover:bg-gray-100 transition-colors ${item.className || 'text-gray-700'}`}
                        >
                            {item.icon}
                            <span className="font-medium">{item.label}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
});
OrderRow.displayName = 'OrderRow';


const OrderHistoryPage: React.FC<OrderHistoryPageProps> = ({ isActive }) => {
    const { deleteOrder, updateOrderStatus } = useDataActions();
    const { showAlert } = useAlert();
    const { openDetailModal, openDeliveryModal } = useModals();
    const { lastModifiedOrderId, setLastModifiedOrderId } = useMiscUI();

    const [orders, setOrders] = useState<Order[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeMenuOrderId, setActiveMenuOrderId] = useState<number | null>(null);
    const [draftKeys, setDraftKeys] = useState<Set<string | number>>(new Set());
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    
    const getLocalDateString = (date: Date) => {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const getTodayString = () => getLocalDateString(new Date());

    const getStartDateString = () => {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 6);
        return getLocalDateString(startDate);
    };

    const [customStartDate, setCustomStartDate] = useState(getStartDateString);
    const [customEndDate, setCustomEndDate] = useState(getTodayString);
    
    const listRef = useRef<HTMLDivElement>(null);
    const observerRef = useRef<HTMLDivElement>(null);

    const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setCustomStartDate(e.target.value);
    };

    const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setCustomEndDate(e.target.value);
    };

    const sortOrders = (orderArray: Order[]) => orderArray.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    useEffect(() => {
        if (!isActive) {
            setActiveMenuOrderId(null);
            return;
        }
    
        const calculateDates = () => {
            const start = customStartDate ? new Date(customStartDate) : undefined;
            if (start && !isNaN(start.getTime())) start.setHours(0, 0, 0, 0);
            const end = customEndDate ? new Date(customEndDate) : new Date();
            end.setHours(23, 59, 59, 999);
            return { startDate: start, endDate: end };
        };
    
        setIsLoading(true);
        setVisibleCount(PAGE_SIZE);
    
        const { startDate, endDate } = calculateDates();
        
        cache.getCachedData<Order>('orders').then(cachedOrders => {
            const filtered = cachedOrders.filter(o => {
                const orderDate = new Date(o.date);
                return orderDate <= endDate && (!startDate || orderDate >= startDate);
            });
            setOrders(sortOrders(filtered));
            setIsLoading(false);
        });

        const unsubscribe = db.listenToOrderChangesByDateRange(
            endDate,
            {
                onAdd: (newOrder) => {
                    setOrders(prevOrders => {
                        const map = new Map(prevOrders.map(o => [o.id, o]));
                        map.set(newOrder.id, newOrder);
                        // FIX: Use Array.from for robust type inference, as spread syntax was failing.
                        return sortOrders(Array.from(map.values()));
                    });
                    db.getOrderItems(newOrder.id).then(items => cache.addOrUpdateCachedOrder({ ...newOrder, items }));
                },
                onChange: (changedOrder) => {
                    setOrders(prevOrders => {
                        const map = new Map(prevOrders.map(o => [o.id, o]));
                        map.set(changedOrder.id, changedOrder);
                        // FIX: Use Array.from for robust type inference, as spread syntax was failing.
                        return sortOrders(Array.from(map.values()));
                    });
                    db.getOrderItems(changedOrder.id).then(items => cache.addOrUpdateCachedOrder({ ...changedOrder, items }));
                },
                onRemove: (removedOrder) => {
                    setOrders(prevOrders => prevOrders.filter(o => o.id !== removedOrder.id));
                    cache.removeCachedOrder(removedOrder.id);
                }
            },
            startDate
        );
    
        getAllDraftKeys().then(keys => setDraftKeys(new Set(keys)));
    
        return () => unsubscribe();
    }, [isActive, customStartDate, customEndDate]);

    const visibleOrders = useMemo(() => orders.slice(0, visibleCount), [orders, visibleCount]);

    useEffect(() => {
        if (!isActive || isLoading) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && orders.length > visibleCount) {
                    setVisibleCount(prev => prev + PAGE_SIZE);
                }
            },
            { root: listRef.current, rootMargin: '200px' }
        );

        const currentObserverRef = observerRef.current;
        if (currentObserverRef) observer.observe(currentObserverRef);
        return () => { if (currentObserverRef) observer.unobserve(currentObserverRef); };
    }, [isActive, isLoading, orders.length, visibleCount]);

    const groupedOrders = useMemo(() => {
        const groups: { [key: string]: { orders: Order[]; total: number } } = {};

        visibleOrders.forEach(order => {
            const d = new Date(order.date);
            const dateKey = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
            if (!groups[dateKey]) groups[dateKey] = { orders: [], total: 0 };
            groups[dateKey].orders.push(order);
            groups[dateKey].total += order.total;
        });

        return Object.keys(groups)
            .sort((a, b) => b.localeCompare(a))
            .map(dateKey => ({ date: dateKey, ...groups[dateKey] }));
    }, [visibleOrders]);

    useEffect(() => {
        if (lastModifiedOrderId) {
            const el = document.getElementById(`order-item-${lastModifiedOrderId}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const timer = setTimeout(() => setLastModifiedOrderId(null), 3000);
                return () => clearTimeout(timer);
            }
        }
    }, [lastModifiedOrderId, setLastModifiedOrderId]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (activeMenuOrderId !== null && !(event.target as HTMLElement).closest('.relative.z-10')) {
                setActiveMenuOrderId(null);
            }
        };

        if (activeMenuOrderId !== null) {
            document.addEventListener('click', handleClickOutside, true);
        }
        return () => document.removeEventListener('click', handleClickOutside, true);
    }, [activeMenuOrderId]);

    const handleMenuToggle = (e: React.MouseEvent, orderId: number) => {
        e.stopPropagation();
        setActiveMenuOrderId(prev => (prev === orderId ? null : orderId));
    };

    const getActionMenuItems = useCallback((order: Order): ActionMenuItem[] => {
        const isCompleted = !!order.completedAt || !!order.completionDetails;

        const closeMenuAnd = (fn: () => void) => () => {
            setActiveMenuOrderId(null);
            fn();
        };

        const handleDelete = closeMenuAnd(() => {
            showAlert(
                `'${order.customer.name}'의 발주 내역을 삭제하시겠습니까?`,
                () => deleteOrder(order.id),
                '삭제',
                'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
            );
        });

        const handleUndoCompletion = closeMenuAnd(() => {
            showAlert(
                `'${order.customer.name}'의 발주를 완료 취소하시겠습니까?`,
                () => updateOrderStatus(order.id, null)
            );
        });
        
        const handleSms = closeMenuAnd(async () => {
            const items = order.items || await db.getOrderItems(order.id);
            if(items.length === 0){
                showAlert("품목이 없어 내보낼 수 없습니다.");
                return;
            }
            const orderWithItems = { ...order, items };
            const smsBody = exportToSMS(orderWithItems);
            const encodedSmsBody = encodeURIComponent(smsBody);
            window.location.href = `sms:?body=${encodedSmsBody}`;
            const timestamp = new Date().toISOString();
            updateOrderStatus(order.id, { type: 'sms', timestamp });
        });

        const handleXls = closeMenuAnd(async () => {
            const items = order.items || await db.getOrderItems(order.id);
            if (items.length === 0) {
                showAlert("품목이 없어 내보낼 수 없습니다.");
                return;
            }
            const orderWithItems = { ...order, items };
            openDeliveryModal(orderWithItems);
        });
        
        const menuItems: ActionMenuItem[] = [];

        if (isCompleted) {
            menuItems.push({ id: 'undo', label: '완료 취소', icon: <UndoIcon className="w-5 h-5" />, onClick: handleUndoCompletion });
        } else {
            menuItems.push({ id: 'sms', label: 'SMS로 내보내기', icon: <SmsIcon className="w-5 h-5" />, onClick: handleSms });
            menuItems.push({ id: 'xls', label: 'XLS로 내보내기', icon: <XlsIcon className="w-5 h-5" />, onClick: handleXls });
        }
        
        menuItems.push({ id: 'delete', label: '삭제', icon: <TrashIcon className="w-5 h-5" />, className: 'text-red-600', onClick: handleDelete });

        return menuItems;
    }, [showAlert, deleteOrder, updateOrderStatus, openDeliveryModal]);
    
    const handleCardClick = useCallback(async (order: Order) => {
        const items = order.items || await db.getOrderItems(order.id);
        openDetailModal({ ...order, items });
    }, [openDetailModal]);

    return (
        <div className="h-full flex flex-col bg-white">
            <div className="sticky top-0 z-10 p-3 bg-white border-b border-gray-200 shadow-sm">
                <div className="flex flex-wrap justify-end items-center gap-x-4 gap-y-2 max-w-2xl mx-auto w-full">
                    <div className="flex items-center gap-2 text-sm w-full sm:w-auto justify-end">
                        <input type="date" value={customStartDate} onChange={handleStartDateChange} className="p-2 border-2 border-gray-200 rounded-lg text-gray-700 flex-1 sm:flex-initial bg-white" aria-label="시작일" />
                        <span className="text-gray-500 font-semibold">~</span>
                        <input type="date" value={customEndDate} onChange={handleEndDateChange} className="p-2 border-2 border-gray-200 rounded-lg text-gray-700 flex-1 sm:flex-initial bg-white" aria-label="종료일" />
                    </div>
                </div>
            </div>

            <div ref={listRef} className="scrollable-content flex-grow">
                {isLoading ? (
                    <div className="flex items-center justify-center h-full pt-16">
                        <SpinnerIcon className="w-10 h-10 text-blue-500" />
                    </div>
                ) : orders.length === 0 ? (
                    <div className="p-3 flex flex-col items-center justify-center h-full text-gray-400 pt-16 text-center">
                        <ArchiveBoxIcon className="w-16 h-16 text-gray-300 mb-4" />
                        <p className="text-lg font-semibold">선택한 기간에 발주 내역이 없습니다</p>
                        <p className="text-sm mt-1">다른 기간을 선택하거나 신규 발주를 생성해보세요.</p>
                    </div>
                ) : (
                    <>
                        <div className="p-3 space-y-4 max-w-2xl mx-auto w-full">
                            {groupedOrders.map(group => {
                                const isGroupActive = group.orders.some(order => order.id === activeMenuOrderId);
                                return (
                                    <div key={group.date} className={`${isGroupActive ? 'relative z-10' : ''}`}>
                                        <div className="flex justify-between items-center p-4 bg-gray-100">
                                            <h3 className="font-bold text-gray-800 text-base" id={`date-header-${group.date}`}>
                                                {new Date(group.date).toLocaleDateString('ko-KR', {
                                                    year: 'numeric',
                                                    month: 'long',
                                                    day: 'numeric',
                                                    weekday: 'short',
                                                })}
                                            </h3>
                                            <p className="text-sm text-gray-600 font-semibold">{group.orders.length}건 &middot; <span className="font-bold text-gray-800">{group.total.toLocaleString('ko-KR')} 원</span></p>
                                        </div>
                                        <div className="divide-y divide-gray-200">
                                            {group.orders.map((order, index) => (
                                                <OrderRow
                                                    key={order.id}
                                                    order={order}
                                                    isHighlighted={order.id === lastModifiedOrderId}
                                                    isMenuOpen={activeMenuOrderId === order.id}
                                                    hasDraft={draftKeys.has(order.id)}
                                                    onCardClick={() => handleCardClick(order)}
                                                    onMenuToggle={(e) => handleMenuToggle(e, order.id)}
                                                    actionMenuItems={getActionMenuItems(order)}
                                                    index={index}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                        
                        <div ref={observerRef} style={{ height: '1px' }} />

                        {isActive && !isLoading && orders.length > 0 && visibleCount < orders.length && (
                            <div className="flex justify-center items-center p-4">
                                <SpinnerIcon className="w-8 h-8 text-blue-500" />
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default OrderHistoryPage;