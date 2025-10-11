import { useRef, useCallback, useEffect }from 'react';

interface UseSwipeNavigationOptions<T> {
    items: T[];
    activeIndex: number;
    onNavigate: (item: T) => void;
    containerRef: React.RefObject<HTMLDivElement>;
}

export const useSwipeNavigation = <T,>({ items, activeIndex, onNavigate, containerRef }: UseSwipeNavigationOptions<T>) => {
    const isDragging = useRef(false);
    const dragStartCoords = useRef({ x: 0, y: 0 });
    const currentTranslate = useRef(0);
    const dragDirection = useRef<'horizontal' | 'vertical' | 'none'>('none');

    const getPositionX = (event: React.TouchEvent) => event.touches[0].clientX;
    
    const setPosition = useCallback((x: number, animate = false) => {
        if (containerRef.current) {
            containerRef.current.style.transition = animate ? 'transform 0.3s ease-out' : 'none';
            containerRef.current.style.transform = `translateX(${x}px)`;
        }
    }, [containerRef]);

    const onTouchStart = useCallback((e: React.TouchEvent) => {
        const target = e.target as HTMLElement;
        // Ignore swipes on interactive elements to prevent conflicts
        if (target.closest('button, input, a, select, textarea, [role="dialog"]')) {
            return;
        }

        dragStartCoords.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        dragDirection.current = 'none';
        isDragging.current = true;
    }, []);
    
    const onTouchMove = useCallback((e: React.TouchEvent) => {
        if (!isDragging.current) return;
    
        if (dragDirection.current === 'none') {
            const deltaX = Math.abs(e.touches[0].clientX - dragStartCoords.current.x);
            const deltaY = Math.abs(e.touches[0].clientY - dragStartCoords.current.y);
            
            // Determine swipe direction after a small threshold to avoid accidental vertical scroll blocking
            if (deltaX > 5 || deltaY > 5) {
                dragDirection.current = deltaX > deltaY ? 'horizontal' : 'vertical';
            }
        }
        
        if (dragDirection.current === 'horizontal') {
            e.preventDefault(); // Prevent vertical scroll while swiping horizontally
            const currentPos = getPositionX(e);
            const delta = currentPos - dragStartCoords.current.x;
            
            if (containerRef.current) {
                const parentWidth = containerRef.current.parentElement!.clientWidth;
                const baseTranslate = -activeIndex * parentWidth;
                currentTranslate.current = baseTranslate + delta;
                setPosition(currentTranslate.current);
            }
        }
    }, [activeIndex, containerRef, setPosition]);

    const onTouchEnd = useCallback(() => {
        if (!isDragging.current || !containerRef.current || dragDirection.current !== 'horizontal') {
            isDragging.current = false;
            return;
        }
        isDragging.current = false;

        const containerWidth = containerRef.current.parentElement!.clientWidth;
        const movedBy = currentTranslate.current - (-activeIndex * containerWidth);
        const threshold = containerWidth / 4;
    
        let newIndex = activeIndex;
        if (movedBy < -threshold && activeIndex < items.length - 1) {
            newIndex = activeIndex + 1;
        } else if (movedBy > threshold && activeIndex > 0) {
            newIndex = activeIndex - 1;
        }
    
        if (newIndex !== activeIndex) {
            onNavigate(items[newIndex]);
        } else {
            // Animate back to the original position if swipe threshold was not met
            setPosition(-activeIndex * containerWidth, true);
        }
    }, [activeIndex, containerRef, items, onNavigate, setPosition]);

    // Effect to animate the container when activeIndex changes programmatically (e.g., by tab click)
    useEffect(() => {
        if (containerRef.current && !isDragging.current) {
            const containerWidth = containerRef.current.parentElement!.clientWidth;
            const newTranslate = -activeIndex * containerWidth;
            currentTranslate.current = newTranslate;
            setPosition(newTranslate, true);
        }
    }, [activeIndex, containerRef, setPosition]);

    return { onTouchStart, onTouchMove, onTouchEnd };
};
