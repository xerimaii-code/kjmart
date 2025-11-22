import React, { useRef, useCallback, useEffect, useState } from 'react';

interface UseSwipeNavigationOptions<T> {
    items: T[];
    activeIndex: number;
    onNavigate: (item: T) => void;
    containerRef: React.RefObject<HTMLDivElement>;
}

export const useSwipeNavigation = <T,>({ items, activeIndex, onNavigate, containerRef }: UseSwipeNavigationOptions<T>) => {
    const isDragging = useRef(false);
    const dragStartCoords = useRef({ x: 0, y: 0 });
    const dragDirection = useRef<'horizontal' | 'vertical' | 'none'>('none');
    
    const [translateX, setTranslateX] = useState(0);
    const [isAnimating, setIsAnimating] = useState(true);

    // Effect for handling navigation via tab clicks and snapping back after a swipe
    useEffect(() => {
        if (containerRef.current?.parentElement && !isDragging.current) {
            const parentWidth = containerRef.current.parentElement.clientWidth;
            setIsAnimating(true);
            setTranslateX(-activeIndex * parentWidth);
        }
    }, [activeIndex, containerRef]);

    // Effect for handling window resize to prevent misalignment
    useEffect(() => {
        let resizeAnimationTimer: number;

        const handleResize = () => {
            if (containerRef.current?.parentElement) {
                const parentWidth = containerRef.current.parentElement.clientWidth;
                // Instantly snap to the correct position without animation
                setIsAnimating(false);
                setTranslateX(-activeIndex * parentWidth);
                
                // Re-enable animation shortly after so future navigations are animated
                clearTimeout(resizeAnimationTimer);
                resizeAnimationTimer = window.setTimeout(() => setIsAnimating(true), 50);
            }
        };

        window.addEventListener('resize', handleResize);

        // Cleanup
        return () => {
            window.removeEventListener('resize', handleResize);
            clearTimeout(resizeAnimationTimer);
        };
    }, [activeIndex, containerRef]);


    const getPositionX = (event: React.TouchEvent) => event.touches[0].clientX;

    const onTouchStart = useCallback((e: React.TouchEvent) => {
        const target = e.target as HTMLElement;
        // Ignore swipes on interactive elements to prevent conflicts
        if (target.closest('button, input, a, select, textarea, [role="dialog"], [data-no-swipe="true"]')) {
            return;
        }

        dragStartCoords.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        dragDirection.current = 'none';
        isDragging.current = true;
        setIsAnimating(false); // Disable CSS animations during manual dragging
    }, []);

    const onTouchMove = useCallback((e: React.TouchEvent) => {
        if (!isDragging.current) return;

        // Determine swipe direction only on the first significant move
        if (dragDirection.current === 'none') {
            const deltaX = Math.abs(e.touches[0].clientX - dragStartCoords.current.x);
            const deltaY = Math.abs(e.touches[0].clientY - dragStartCoords.current.y);
            
            if (deltaX > 5 || deltaY > 5) {
                dragDirection.current = deltaX > deltaY ? 'horizontal' : 'vertical';
            }
        }
        
        // Only proceed if the swipe is horizontal
        if (dragDirection.current === 'horizontal') {
            e.preventDefault(); // Prevent vertical page scroll
            
            const currentPos = getPositionX(e);
            let delta = currentPos - dragStartCoords.current.x;

            if (containerRef.current) {
                const parentWidth = containerRef.current.parentElement!.clientWidth;
                const baseTranslate = -activeIndex * parentWidth;

                const isFirstPage = activeIndex === 0;
                const isLastPage = activeIndex === items.length - 1;

                // Apply resistance for a "chewy" overscroll effect at the boundaries
                if ((isFirstPage && delta > 0) || (isLastPage && delta < 0)) {
                    delta *= 0.4;
                }

                setTranslateX(baseTranslate + delta);
            }
        }
    }, [activeIndex, containerRef, items]);

    const onTouchEnd = useCallback(() => {
        if (!isDragging.current || !containerRef.current || dragDirection.current !== 'horizontal') {
            isDragging.current = false;
            return;
        }
        isDragging.current = false;
        setIsAnimating(true); // Re-enable animations for the snap-back effect

        const containerWidth = containerRef.current.parentElement!.clientWidth;
        const baseTranslate = -activeIndex * containerWidth;
        const movedBy = translateX - baseTranslate;
        
        // Change page if swipe is more than 30% of the screen width
        const threshold = containerWidth * 0.3;

        let newIndex = activeIndex;
        if (movedBy < -threshold && activeIndex < items.length - 1) {
            newIndex = activeIndex + 1;
        } else if (movedBy > threshold && activeIndex > 0) {
            newIndex = activeIndex - 1;
        }
        
        if (newIndex !== activeIndex) {
            onNavigate(items[newIndex]);
        } else {
            // Animate back to the original position if threshold not met
            setTranslateX(baseTranslate);
        }
    }, [activeIndex, containerRef, items, onNavigate, translateX]);

    // Style object to be applied to the swipeable container
    const containerStyle: React.CSSProperties = {
        transform: `translateX(${translateX}px)`,
        transition: isAnimating ? 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)' : 'none',
        willChange: 'transform',
        touchAction: 'pan-y',
    };

    return { onTouchStart, onTouchMove, onTouchEnd, containerStyle };
};