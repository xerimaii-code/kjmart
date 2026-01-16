
import React, { useEffect, useRef } from 'react';

/**
 * A custom hook that adjusts a modal's vertical position to keep a specific target element (or the modal itself)
 * visible when the on-screen keyboard appears.
 * 
 * Optimized: Removed polling intervals. Now purely event-driven using VisualViewport API.
 * Disables CSS transitions during adjustment to prevent jitter.
 */
export function useAdjustForKeyboard(
    modalContentRef: React.RefObject<HTMLElement>, 
    isOpen: boolean, 
    targetRef?: React.RefObject<HTMLElement>, // Optional: specific input to keep in view
    isEnabled: boolean = true // Optional: disable adjustment if needed (e.g., locked position)
) {
    useEffect(() => {
        // If disabled, reset any existing transform and return
        if (!isEnabled || !isOpen || !modalContentRef.current) {
            if (modalContentRef.current) {
                modalContentRef.current.style.transform = '';
            }
            return;
        }

        if (!window.visualViewport) return;

        const modalElement = modalContentRef.current;
        const viewport = window.visualViewport;

        const handleResize = () => {
            if (!modalElement) return;

            // 1. Temporarily disable transition to make movement instant (prevents rubber-banding/jitter)
            modalElement.style.transition = 'none';

            // 2. Calculate Geometry
            const viewportHeight = viewport.height;
            const viewportTop = viewport.offsetTop; // Key: This changes when keyboard pushes viewport up/down
            
            // Determine reference point (either specific input or bottom of modal)
            const referenceElement = targetRef?.current || modalElement;
            const rect = referenceElement.getBoundingClientRect();
            
            // Calculate where the element currently is relative to the visual viewport
            // Note: We use a simple logic: "If bottom of element is covered, shift up".
            
            // Reset transform first to get natural position relative to layout
            // (We assume the modal is centered via CSS flexbox initially)
            // However, resetting causes a flash. We calculate delta based on current visual rect.

            const visualViewportBottom = viewportTop + viewportHeight;
            const elementBottom = rect.bottom;
            
            // Margin from keyboard (10px)
            const MARGIN = 10;

            // If element sticks out below the visual viewport (covered by keyboard)
            if (elementBottom > visualViewportBottom - MARGIN) {
                const shiftAmount = elementBottom - (visualViewportBottom - MARGIN);
                
                // Get current transform value if any
                const style = window.getComputedStyle(modalElement);
                const matrix = new WebKitCSSMatrix(style.transform);
                const currentY = matrix.m42;

                // Apply new shift (adding to existing shift)
                const newY = currentY - shiftAmount;
                modalElement.style.transform = `translateY(${newY}px)`;
            } 
            // If viewport is full size (keyboard closed), reset.
            else if (viewportHeight >= window.innerHeight * 0.9) {
                 modalElement.style.transform = '';
            }

            // 3. Re-enable transitions after a brief delay (optional, mainly for smooth close)
            // Keeping it 'none' while keyboard interacts is usually safer for performance.
        };

        viewport.addEventListener('resize', handleResize);
        viewport.addEventListener('scroll', handleResize);

        return () => {
            viewport.removeEventListener('resize', handleResize);
            viewport.removeEventListener('scroll', handleResize);
            if (modalElement) {
                modalElement.style.transform = '';
                modalElement.style.transition = '';
            }
        };
    }, [isOpen, modalContentRef, targetRef, isEnabled]);
}
