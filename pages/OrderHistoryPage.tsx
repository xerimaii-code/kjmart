import React, { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react';
import { useDataActions, useUIActions, useUIState } from '../context/AppContext';
import { Order } from '../types';
import { SmsIcon, XlsIcon, TrashIcon, ArchiveBoxIcon, UndoIcon, MoreVerticalIcon, ChatBubbleLeftIcon, PencilSquareIcon, SpinnerIcon } from '../components/Icons';
import { exportToSMS } from '../services/dataService';
import { getAllDraftKeys } from '../services/draftDbService';
import * as db from '../services/dbService';

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
}: {
    order: Order;
    isHighlighted: boolean;
    isMenuOpen: boolean;
    hasDraft: boolean;
    onCardClick: () => void;
    onMenuToggle: (e: React.MouseEvent) => void;
    actionMenuItems: ActionMenuItem[];
}) => {
    const isCompleted = !!order.completedAt || !!order.completionDetails;

    return (
        <div className={`relative ${isMenuOpen ? 'z-10' : ''}`}>
            <div
                id={`order-item-${order.id}`}
                className={`flex items-center bg-white transition-all duration-300 ease-in-out border-b border-gray-200 last:border-b-0 ${isHighlighted ? 'bg-yellow-100' : 'hover:bg-gray-50'}`}
            >
                <div
                    onClick={onCardClick}
                    className={`flex-grow p-4 cursor-pointer ${isCompleted ? 'opacity-60' : ''}`}
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
                            <p className="text-xs text-gray-500 mt-0.5">{new Date(order.date).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                        </div>
                        <p className="font-semibold text-gray-700 text-base tabular-nums flex-shrink-0">
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
                <div className="absolute top-12 right-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-20 py-1" onClick={(e) => e.stopPropagation()}>
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
OrderRow.displayName = 'OrderRow';


const OrderHistoryPage: React.FC<OrderHistoryPageProps> = ({ isActive }) => {
    const { deleteOrder, updateOrderStatus } = useDataActions();
    const { lastModifiedOrderId } = useUIState();
    const { openDetailModal, showAlert, setLastModifiedOrderId, openDeliveryModal } = useUIActions();

    const [orders, setOrders] = useState<Order[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeMenuOrderId, setActiveMenuOrderId] = useState<number | null>(null);
    const [draftKeys, setDraftKeys] = useState<Set<string | number>>(new Set());
    const listRef = useRef<HTMLDivElement>(null);

    // Fetch orders and drafts when page is active
    useEffect(() => {
        if (!isActive) {
            setActiveMenuOrderId(null);
            return;
        }
        
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 30);
        
        setIsLoading(true);
        const unsubscribe = db.listenToOrdersByDateRange(
            startDate,
            endDate,
            (fetchedOrders) => {
                const sortedOrders = fetchedOrders.sort((a, b) => b.id - a.id);
                setOrders(sortedOrders);
                setIsLoading(false);
            }
        );

        getAllDraftKeys().then(keys => setDraftKeys(new Set(keys)));
        
        return () => unsubscribe();
    }, [isActive]);

    // Group orders by date
    const groupedOrders = useMemo(() => {
        const groups: { [key: string]: { orders: Order[]; total: number } } = {};

        orders.forEach(order => {
            const dateKey = new Date(order.date).toISOString().slice(0, 10);
            if (!groups[dateKey]) {
                groups[dateKey] = { orders: [], total: 0 };
            }
            groups[dateKey].orders.push(order);
            groups[dateKey].total += order.total;
        });

        return Object.keys(groups)
            .sort((a, b) => b.localeCompare(a)) // Sort dates descending
            .map(dateKey => ({
                date: dateKey,
                ...groups[dateKey]
            }));
    }, [orders]);

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
        return () => {
            document.removeEventListener('click', handleClickOutside, true);
        };
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
            const orderWithItems = { ...order, items: await db.getOrderItems(order.id) };
            if(orderWithItems.items.length === 0){
                showAlert("품목이 없어 내보낼 수 없습니다.");
                return;
            }
            const smsBody = exportToSMS(orderWithItems);
            const encodedSmsBody = encodeURIComponent(smsBody);
            window.location.href = `sms:?body=${encodedSmsBody}`;
            const timestamp = new Date().toISOString();
            updateOrderStatus(order.id, { type: 'sms', timestamp });
        });

        const handleXls = closeMenuAnd(() => openDeliveryModal(order));
        
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
        setIsLoading(true);
        try {
            const items = await db.getOrderItems(order.id);
            openDetailModal({ ...order, items });
        } catch (error) {
            console.error("Failed to fetch order items:", error);
            showAlert("주문 상세 정보를 불러오는 데 실패했습니다.");
        } finally {
            setIsLoading(false);
        }
    }, [openDetailModal, showAlert]);

    return (
        <div className="h-full flex flex-col bg-gray-100">
            <div className="fixed-filter p-3 bg-white border-b border-gray-200 shadow-sm">
                <h2 className="text-xl font-bold text-gray-800">발주 내역</h2>
            </div>
            <div ref={listRef} className="scrollable-content p-2 space-y-3">
                {(isLoading && orders.length === 0) ? (
                    <div className="flex items-center justify-center h-full pt-16">
                        <SpinnerIcon className="w-10 h-10 text-blue-500" />
                    </div>
                ) : orders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 pt-16 text-center">
                        <ArchiveBoxIcon className="w-16 h-16 text-gray-300 mb-4" />
                        <p className="text-lg font-semibold">발주 내역이 없습니다</p>
                        <p className="text-sm mt-1">신규 발주를 생성해보세요.</p>
                    </div>
                ) : (
                    groupedOrders.map(group => {
                        const isGroupActive = group.orders.some(order => order.id === activeMenuOrderId);
                        return (
                            <div key={group.date} className={`bg-white rounded-xl shadow-md ${isGroupActive ? 'relative z-10' : ''}`}>
                                <div className="flex justify-between items-center p-4 bg-gray-50 border-b border-gray-200">
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
                                <div>
                                    {group.orders.map(order => (
                                        <OrderRow
                                            key={order.id}
                                            order={order}
                                            isHighlighted={order.id === lastModifiedOrderId}
                                            isMenuOpen={activeMenuOrderId === order.id}
                                            hasDraft={draftKeys.has(order.id)}
                                            onCardClick={() => handleCardClick(order)}
                                            onMenuToggle={(e) => handleMenuToggle(e, order.id)}
                                            actionMenuItems={getActionMenuItems(order)}
                                        />
                                    ))}
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    );
};

export default OrderHistoryPage;