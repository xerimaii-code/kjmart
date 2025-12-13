
import React, { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react';
import { useDataActions, useAlert, useModals, useMiscUI } from '../context/AppContext';
import { Order } from '../types';
import { SmsIcon, XlsIcon, TrashIcon, ArchiveBoxIcon, UndoIcon, MoreVerticalIcon, ChatBubbleLeftIcon, PencilSquareIcon, SpinnerIcon, ReturnBoxIcon } from '../components/Icons';
import { exportToSMS, exportReturnToPDF, exportToXLS } from '../services/dataService';
import { getAllDraftKeys } from '../services/draftDbService';
import * as db from '../services/dbService';
import DeliveryTypeModal from '../components/DeliveryTypeModal';

// Constants for infinite scroll
const PAGE_SIZE = 30; // Number of items to load per "page"

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
    if (details?.type === 'return') {
        return <ReturnBoxIcon className="w-5 h-5 text-purple-500 mr-2 flex-shrink-0" title={`반품 PDF 완료: ${localeTimestamp}`} />;
    }
    if (order.completedAt) {
         return <ArchiveBoxIcon className="w-5 h-5 text-gray-500 mr-2 flex-shrink-0" title={`완료: ${localeTimestamp}`} />;
    }
    if (hasDraft) {
        return <PencilSquareIcon className="w-5 h-5 text-orange-500 mr-2 flex-shrink-0" title="임시 저장된 수정사항이 있습니다." />;
    }
    return null;
};

interface OrderRowProps {
    order: Order;
    isHighlighted: boolean;
    hasDraft: boolean;
    isMenuOpen: boolean;
    onCardClick: (e: React.MouseEvent) => void;
    onMenuToggle: (e: React.MouseEvent, orderId: number) => void;
    onMenuAction: (action: string, order: Order) => void;
    index: number;
}

const OrderRow = memo(({
    order,
    isHighlighted,
    hasDraft,
    isMenuOpen,
    onCardClick,
    onMenuToggle,
    onMenuAction,
    index,
}: OrderRowProps) => {
    const isCompleted = !!order.completedAt || !!order.completionDetails;
    
    return (
        <div 
            className="relative animate-card-enter z-0"
            style={{ 
                animationDelay: `${Math.min(index * 30, 400)}ms`,
                zIndex: isMenuOpen ? 50 : 0 
            }}
        >
            <div
                id={`order-item-${order.id}`}
                className={`flex items-center transition-colors duration-200 border border-gray-200 rounded-lg shadow-sm ${isHighlighted ? 'bg-yellow-50 border-yellow-200 ring-1 ring-yellow-200' : 'bg-white hover:border-blue-300'}`}
            >
                <div
                    onClick={onCardClick}
                    data-order-id={order.id}
                    className={`flex-grow p-3 cursor-pointer ${isCompleted ? 'opacity-60' : ''}`}
                    role="button"
                    aria-label={`${order.customer.name} 주문 보기`}
                >
                    <div className="flex justify-between items-center gap-2">
                        <div className="flex-grow min-w-0">
                            <p className="font-bold text-gray-800 text-[15px] flex items-center leading-tight" title={order.customer.name}>
                                {getStatusIcon(order, hasDraft)}
                                <span className="truncate">{order.customer.name}</span>
                            </p>
                            <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                                <span>{new Date(order.date).toLocaleString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                            </div>
                        </div>
                        <p className="font-bold text-gray-900 text-base tabular-nums tracking-tight flex-shrink-0">
                            {order.total.toLocaleString()}
                            <span className="text-xs font-normal text-gray-500 ml-0.5">원</span>
                        </p>
                    </div>
                </div>
                
                <div className="relative flex-shrink-0 pr-1 pl-1 border-l border-gray-100">
                    <button 
                        onClick={(e) => onMenuToggle(e, order.id)} 
                        className={`p-2 rounded-full transition-colors relative z-10 ${isMenuOpen ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}`}
                        aria-label="추가 옵션"
                    >
                        <MoreVerticalIcon className="w-5 h-5" />
                    </button>
                    
                    {isMenuOpen && (
                        <>
                            <div className="fixed inset-0 z-40 cursor-default" onClick={(e) => onMenuToggle(e, 0)} aria-hidden="true"></div>
                            <div className="absolute right-0 top-9 z-50 w-44 bg-white rounded-lg shadow-xl border border-gray-200 py-1 origin-top-right animate-fade-in-down overflow-hidden ring-1 ring-black ring-opacity-5">
                                {isCompleted ? (
                                    <button
                                        onClick={() => onMenuAction('undo', order)}
                                        className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 flex items-center gap-2 hover:bg-gray-50 active:bg-gray-100"
                                    >
                                        <UndoIcon className="w-4 h-4 text-gray-500" />
                                        완료 취소
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => onMenuAction('sms', order)}
                                            className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 flex items-center gap-2 hover:bg-gray-50 active:bg-gray-100 border-b border-gray-50"
                                        >
                                            <SmsIcon className="w-4 h-4 text-green-500" />
                                            SMS 내보내기
                                        </button>
                                        <button
                                            onClick={() => onMenuAction('xls', order)}
                                            className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 flex items-center gap-2 hover:bg-gray-50 active:bg-gray-100 border-b border-gray-50"
                                        >
                                            <XlsIcon className="w-4 h-4 text-blue-500" />
                                            XLS 내보내기
                                        </button>
                                        <button
                                            onClick={() => onMenuAction('return', order)}
                                            className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 flex items-center gap-2 hover:bg-gray-50 active:bg-gray-100"
                                        >
                                            <ReturnBoxIcon className="w-4 h-4 text-purple-500" />
                                            반품서 PDF
                                        </button>
                                    </>
                                )}
                                <div className="h-px bg-gray-100 my-0.5"></div>
                                <button
                                    onClick={() => onMenuAction('delete', order)}
                                    className="w-full text-left px-4 py-3 text-sm font-bold text-red-600 flex items-center gap-2 hover:bg-red-50 active:bg-red-100"
                                >
                                    <TrashIcon className="w-4 h-4" />
                                    삭제
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
});
OrderRow.displayName = 'OrderRow';


const OrderHistoryPage: React.FC<OrderHistoryPageProps> = ({ isActive }) => {
    const { deleteOrder, updateOrderStatus } = useDataActions();
    const { showAlert, showToast } = useAlert();
    const { openDetailModal, openDeliveryModal, isDeliveryModalOpen, orderToExport, closeDeliveryModal } = useModals();
    const { lastModifiedOrderId, setLastModifiedOrderId, activeMenuOrderId, setActiveMenuOrderId } = useMiscUI();

    const [orders, setOrders] = useState<Order[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [draftKeys, setDraftKeys] = useState<Set<string | number>>(new Set());
    const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);
    
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
    const observerRef = useRef<HTMLDivElement>(null); // Ref for the infinite scroll sentinel

    const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setCustomStartDate(e.target.value);
    };

    const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setCustomEndDate(e.target.value);
    };

    useEffect(() => {
        if (!isActive) {
            setActiveMenuOrderId(null);
            return;
        }
    
        const calculateDates = () => {
            const start = customStartDate ? new Date(customStartDate) : undefined;
            if (start && !isNaN(start.getTime())) {
                start.setHours(0, 0, 0, 0);
            }
            const end = customEndDate ? new Date(customEndDate) : new Date();
            end.setHours(23, 59, 59, 999);
            return { startDate: start, endDate: end };
        };
    
        setIsLoading(true);
        setOrders([]);
        setVisibleCount(PAGE_SIZE);
    
        const { startDate, endDate } = calculateDates();
    
        const unsubscribe = db.listenToOrderChangesByDateRange(
            endDate,
            {
                onAdd: (newOrder) => {
                    setOrders(prevOrders => {
                        if (prevOrders.some(o => o.id === newOrder.id)) return prevOrders;
                        const newArr = [...prevOrders, newOrder];
                        newArr.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                        return newArr;
                    });
                    setIsLoading(false);
                },
                onChange: (changedOrder) => {
                    setOrders(prevOrders => 
                        prevOrders
                            .map(o => o.id === changedOrder.id ? changedOrder : o)
                            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    );
                },
                onRemove: (removedOrder) => {
                    setOrders(prevOrders => prevOrders.filter(o => o.id !== removedOrder.id));
                }
            },
            startDate
        );
    
        const timer = setTimeout(() => setIsLoading(false), 2000); // Failsafe to hide spinner if no data arrives
    
        getAllDraftKeys().then(keys => setDraftKeys(new Set(keys)));
    
        return () => {
            unsubscribe();
            clearTimeout(timer);
        };
    }, [isActive, customStartDate, customEndDate, setActiveMenuOrderId]);

    // --- Infinite Scroll Logic ---
    const visibleOrders = useMemo(() => orders.slice(0, visibleCount), [orders, visibleCount]);

    useEffect(() => {
        if (!isActive || isLoading) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0] && entries[0].isIntersecting && orders.length > visibleCount) {
                    setVisibleCount(prev => prev + PAGE_SIZE);
                }
            },
            { 
                root: listRef.current,
                rootMargin: '200px',
            }
        );

        const currentObserverRef = observerRef.current;
        if (currentObserverRef) {
            observer.observe(currentObserverRef);
        }

        return () => {
            if (currentObserverRef) {
                observer.unobserve(currentObserverRef);
            }
        };
    }, [isActive, isLoading, orders.length, visibleCount]);

    const groupedOrders = useMemo(() => {
        const groups: { [key: string]: { orders: Order[]; total: number } } = {};

        visibleOrders.forEach(order => {
            const d = new Date(order.date);
            const dateKey = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
            if (!groups[dateKey]) {
                groups[dateKey] = { orders: [], total: 0 };
            }
            groups[dateKey].orders.push(order);
            groups[dateKey].total += order.total;
        });

        return Object.keys(groups)
            .sort((a, b) => b.localeCompare(a))
            .map(dateKey => ({
                date: dateKey,
                ...groups[dateKey]
            }));
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

    const ordersMap = useMemo(() => new Map(orders.map(o => [o.id, o])), [orders]);

    const handleMenuToggle = useCallback((e: React.MouseEvent, orderId: number) => {
        e.stopPropagation();
        // If clicking the same ID, toggle off (null). If clicking background (id=0), close.
        setActiveMenuOrderId(prev => (prev === orderId || orderId === 0 ? null : orderId));
    }, [setActiveMenuOrderId]);

    const handleCardClick = useCallback(async (e: React.MouseEvent) => {
        const orderId = Number((e.currentTarget as HTMLElement).dataset.orderId);
        const order = ordersMap.get(orderId);
        if (order) {
            try {
                const items = await db.getOrderItems(order.id);
                openDetailModal({ ...order, items });
            } catch (error) {
                console.error("Failed to fetch order items:", error);
                showAlert("주문 상세 정보를 불러오는 데 실패했습니다.");
            }
        }
    }, [ordersMap, openDetailModal, showAlert]);

    const handleLocalStatusUpdate = useCallback((orderId: number, completionDetails: Order['completionDetails']) => {
        setOrders(prevOrders => {
            const now = new Date().toISOString();
            const completedAt = completionDetails ? now : null;
    
            return prevOrders.map(order => 
                order.id === orderId 
                ? { ...order, completedAt, completionDetails, updatedAt: now } 
                : order
            );
        });
    }, []);

    const handleExportConfirm = async (deliveryType: '일반배송' | '택배배송') => {
        if (orderToExport) {
            try {
                await exportToXLS(orderToExport, deliveryType);
                const timestamp = new Date().toISOString();
                const completionDetails: Order['completionDetails'] = { type: 'xls', timestamp };

                handleLocalStatusUpdate(orderToExport.id, completionDetails);
                updateOrderStatus(orderToExport.id, completionDetails).catch(err => {
                    showToast('XLS 상태 업데이트에 실패했습니다.', 'error');
                });
                showToast(`${orderToExport.customer.name} 발주서가 XLS 파일로 저장되었습니다.`, 'success');
            } catch (err: any) {
                showAlert(err.message);
            }
        }
        closeDeliveryModal();
    };

    const handleMenuAction = useCallback((action: string, order: Order) => {
        setActiveMenuOrderId(null);
    
        switch (action) {
            case 'delete':
                showAlert(
                    `'${order.customer.name}'의 발주 내역을 삭제하시겠습니까?`,
                    () => deleteOrder(order.id),
                    '삭제',
                    'bg-rose-500 hover:bg-rose-600 focus:ring-rose-500'
                );
                break;
            case 'undo':
                showAlert(
                    `'${order.customer.name}'의 발주를 완료 취소하시겠습니까?`,
                    () => {
                        handleLocalStatusUpdate(order.id, null);
                        updateOrderStatus(order.id, null).catch(() => showToast('완료 취소에 실패했습니다.', 'error'));
                    }
                );
                break;
            case 'sms':
                (async () => {
                    const orderWithItems = { ...order, items: await db.getOrderItems(order.id) };
                    if(orderWithItems.items.length === 0){
                        showAlert("품목이 없어 내보낼 수 없습니다.");
                        return;
                    }
                    const smsBody = exportToSMS(orderWithItems);
                    const encodedSmsBody = encodeURIComponent(smsBody);
                    showToast('SMS 메시지가 준비되었습니다.', 'success');
                    window.location.href = `sms:?body=${encodedSmsBody}`;
                    
                    const timestamp = new Date().toISOString();
                    const completionDetails: Order['completionDetails'] = { type: 'sms', timestamp };
                    handleLocalStatusUpdate(order.id, completionDetails);
                    updateOrderStatus(order.id, completionDetails).catch(() => showToast('SMS 상태 업데이트에 실패했습니다.', 'error'));
                })();
                break;
            case 'xls':
                (async () => {
                    try {
                        const items = await db.getOrderItems(order.id);
                        if (items.length === 0) {
                            showAlert("품목이 없어 내보낼 수 없습니다.");
                            return;
                        }
                        const orderWithItems = { ...order, items };
                        openDeliveryModal(orderWithItems);
                    } catch (error) {
                        console.error("Failed to fetch order items for XLS export:", error);
                        showAlert("XLS로 내보내기 위해 주문 품목을 불러오는 데 실패했습니다.");
                    }
                })();
                break;
            case 'return':
                (async () => {
                    let blobUrl: string | null = null;
                    try {
                        const items = await db.getOrderItems(order.id);
                        if (items.length === 0) {
                            showAlert("품목이 없어 내보낼 수 없습니다.");
                            return;
                        }
                        const orderWithItems = { ...order, items };
                        const pdfData = await exportReturnToPDF(orderWithItems);
                        blobUrl = pdfData.blobUrl;

                        const link = document.createElement('a');
                        link.href = blobUrl;
                        link.download = pdfData.file.name;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        
                        showToast('반품서 PDF 파일이 다운로드되었습니다.', 'success');
                        
                        const timestamp = new Date().toISOString();
                        const completionDetails: Order['completionDetails'] = { type: 'return', timestamp };

                        handleLocalStatusUpdate(order.id, completionDetails);
                        updateOrderStatus(order.id, completionDetails).catch(() => showToast('반품 상태 업데이트에 실패했습니다.', 'error'));

                    } catch (error) {
                        if (error instanceof Error) {
                            showAlert(error.message);
                        } else {
                            console.error('PDF export failed', error);
                            showAlert('PDF 내보내기에 실패했습니다.');
                        }
                    } finally {
                        if (blobUrl) {
                            URL.revokeObjectURL(blobUrl);
                        }
                    }
                })();
                break;
        }
    }, [showAlert, deleteOrder, updateOrderStatus, openDeliveryModal, showToast, setActiveMenuOrderId, handleLocalStatusUpdate]);

    return (
        <div className="h-full flex flex-col bg-gray-50">
            <div className="fixed-filter w-full p-2 bg-white border-b border-gray-200 z-30 shadow-sm">
                <div className="flex items-center justify-center gap-2 max-w-2xl mx-auto">
                    <input
                        type="date"
                        value={customStartDate}
                        onChange={handleStartDateChange}
                        className="w-full p-2 border border-gray-300 rounded-lg text-gray-700 bg-white shadow-sm focus:ring-1 focus:ring-blue-500"
                        aria-label="시작일"
                    />
                    <span className="text-gray-400 font-bold">~</span>
                    <input
                        type="date"
                        value={customEndDate}
                        onChange={handleEndDateChange}
                        className="w-full p-2 border border-gray-300 rounded-lg text-gray-700 bg-white shadow-sm focus:ring-1 focus:ring-blue-500"
                        aria-label="종료일"
                    />
                </div>
            </div>
             <div 
                ref={listRef} 
                className="scrollable-content px-3 py-3"
             >
                {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <SpinnerIcon className="w-10 h-10 text-blue-500" />
                    </div>
                ) : groupedOrders.length === 0 ? (
                    <div className="text-center p-8 text-gray-500 pt-16">
                        <p className="font-semibold text-lg">발주 내역이 없습니다.</p>
                        <p className="text-sm mt-1">기간을 변경하거나 신규 발주를 생성해주세요.</p>
                    </div>
                ) : (
                    <div className="max-w-2xl mx-auto w-full space-y-4">
                        {groupedOrders.map(({ date, orders: dayOrders, total }) => (
                            <div key={date}>
                                <div className="sticky top-0 z-20 bg-gray-50/95 backdrop-blur-sm px-1 py-2 flex justify-between items-center mb-1">
                                    <h3 className="font-bold text-gray-600 text-sm">
                                        {new Date(date + 'T00:00:00').toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
                                    </h3>
                                    <span className="font-bold text-gray-800 text-sm">{total.toLocaleString()} 원</span>
                                </div>
                                <div className="space-y-2">
                                    {dayOrders.map((order, index) => (
                                        <OrderRow
                                            key={order.id}
                                            order={order}
                                            isHighlighted={order.id === lastModifiedOrderId}
                                            hasDraft={draftKeys.has(order.id)}
                                            isMenuOpen={activeMenuOrderId === order.id}
                                            onCardClick={handleCardClick}
                                            onMenuToggle={handleMenuToggle}
                                            onMenuAction={handleMenuAction}
                                            index={index}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                        <div ref={observerRef} style={{ height: '1px' }} />
                    </div>
                )}
            </div>
             <DeliveryTypeModal
                isOpen={isDeliveryModalOpen}
                onClose={closeDeliveryModal}
                onConfirm={handleExportConfirm}
            />
        </div>
    );
};

export default OrderHistoryPage;
