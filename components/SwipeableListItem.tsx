import React, { useRef, useState, useEffect, useCallback } from 'react';

interface Action {
    id: string;
    icon: React.ReactNode;
    className: string;
    onClick: () => void;
}

interface SwipeableListItemProps {
    children: React.ReactNode;
    actions: Action[];
    onClick: () => void;
    isOpen: boolean;
    onOpen: () => void;
    onClose: () => void;
}

const ACTION_WIDTH = 72; // px

const SwipeableListItem: React.FC<SwipeableListItemProps> = ({
    children,
    actions,
    onClick,
    isOpen,
    onOpen,
    onClose,
}) => {
    const itemRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragStartX = useRef(0);
    const currentTranslateX = useRef(0);
    const wasDragged = useRef(false);

    const maxTranslateX = actions.length * ACTION_WIDTH;
    const swipeThreshold = maxTranslateX * 0.4; // Open/close if dragged 40% of the way

    const getPointerX = (e: React.PointerEvent | PointerEvent) => e.clientX;

    const setTransform = useCallback((value: number, isAnimated: boolean) => {
        if (itemRef.current) {
            itemRef.current.style.transition = isAnimated ? 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
            itemRef.current.style.transform = `translateX(${value}px)`;
        }
    }, []);
    
    const handlePointerDown = (e: React.PointerEvent) => {
        if (e.target instanceof HTMLButtonElement || e.button !== 0) return;

        dragStartX.current = getPointerX(e);
        wasDragged.current = false;
        setIsDragging(true);
        itemRef.current?.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = useCallback((e: PointerEvent) => {
        if (!isDragging) return;

        const deltaX = e.clientX - dragStartX.current;
        if (Math.abs(deltaX) > 5) {
            wasDragged.current = true;
        }

        const newTranslateX = isOpen ? -maxTranslateX + deltaX : deltaX;
        
        // Resist over-swiping for a bouncier feel
        const resistance = 0.4;
        if (newTranslateX > 0) {
            currentTranslateX.current = newTranslateX * resistance;
        } else if (newTranslateX < -maxTranslateX) {
            currentTranslateX.current = -maxTranslateX + (newTranslateX + maxTranslateX) * resistance;
        } else {
            currentTranslateX.current = newTranslateX;
        }
        setTransform(currentTranslateX.current, false);
    }, [isDragging, isOpen, maxTranslateX, setTransform]);

    const handlePointerUp = useCallback(() => {
        if (!isDragging) return;
        setIsDragging(false);

        if (isOpen) {
            if (currentTranslateX.current > -maxTranslateX + swipeThreshold) {
                onClose();
            } else {
                setTransform(-maxTranslateX, true);
            }
        } else {
            if (currentTranslateX.current < -swipeThreshold) {
                onOpen();
            } else {
                setTransform(0, true);
            }
        }
    }, [isDragging, isOpen, maxTranslateX, onClose, onOpen, setTransform, swipeThreshold]);


    useEffect(() => {
        const item = itemRef.current;
        if (!isDragging || !item) return;

        const upHandler = (e: PointerEvent) => {
             item.releasePointerCapture(e.pointerId);
             handlePointerUp();
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', upHandler, { once: true });

        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', upHandler);
        };
    }, [isDragging, handlePointerMove, handlePointerUp]);

    // Animate to open/closed state when controlled externally
    useEffect(() => {
        if (!isDragging) {
            setTransform(isOpen ? -maxTranslateX : 0, true);
        }
    }, [isOpen, isDragging, maxTranslateX, setTransform]);


    const handleClick = () => {
        if (!wasDragged.current) {
            onClick();
        }
    };
    
    const isActive = isDragging || isOpen;

    return (
        <div className="relative w-full overflow-hidden">
            <div className="absolute top-0 right-0 h-full flex">
                {actions.map(action => (
                    <button
                        key={action.id}
                        onClick={(e) => {
                            e.stopPropagation();
                            action.onClick();
                        }}
                        className={`${action.className} h-full flex items-center justify-center text-white`}
                        style={{ width: `${ACTION_WIDTH}px` }}
                    >
                        {action.icon}
                    </button>
                ))}
            </div>
            <div
                ref={itemRef}
                onPointerDown={handlePointerDown}
                onClick={handleClick}
                className={`relative w-full bg-white transition-shadow duration-200 rounded-xl ${isActive ? 'shadow-lg' : 'shadow-md'}`}
            >
                {children}
            </div>
        </div>
    );
};

export default SwipeableListItem;