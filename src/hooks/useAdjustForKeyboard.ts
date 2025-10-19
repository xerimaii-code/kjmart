import React, { useEffect, useRef } from 'react';

/**
 * A custom hook that adjusts a modal's vertical position to keep it visible when the on-screen keyboard appears.
 * It uses the visualViewport API to detect keyboard presence and repositions the modal using CSS transform.
 * @param modalContentRef Ref to the modal's content element that needs to be moved.
 * @param isOpen Boolean indicating if the modal is currently open.
 */
export function useAdjustForKeyboard(modalContentRef: React.RefObject<HTMLElement>, isOpen: boolean) {
    const originalTransform = useRef('');

    useEffect(() => {
        if (!isOpen || !modalContentRef.current) return;

        const modalElement = modalContentRef.current;
        const visualViewport = window.visualViewport;

        // Exit if the visualViewport API is not supported.
        if (!visualViewport) return;

        const handleResize = () => {
            if (!modalElement) return;

            // Save the original transform style on the first run, if it's not already set.
            if (originalTransform.current === '') {
                originalTransform.current = modalElement.style.transform;
            }

            const { height: viewportHeight } = visualViewport;
            const modalRect = modalElement.getBoundingClientRect();
            
            // Check if the keyboard is likely open by comparing visual viewport height to the window's inner height.
            const isKeyboardOpen = window.innerHeight > viewportHeight;
            
            // If the keyboard is open and the bottom of the modal is below the visible part of the viewport...
            if (isKeyboardOpen && modalRect.bottom > viewportHeight) {
                const padding = 8; // 8px padding between modal and keyboard
                const requiredUpwardShift = modalRect.bottom - viewportHeight + padding;
                // Apply a transform to move the modal up.
                modalElement.style.transform = `translateY(-${requiredUpwardShift}px)`;
            } else {
                // Otherwise (keyboard is closed or modal is not obscured), restore the original transform.
                modalElement.style.transform = originalTransform.current;
            }
        };

        visualViewport.addEventListener('resize', handleResize);
        
        // Run once initially in case the keyboard is already open when the modal appears.
        handleResize();

        return () => {
            visualViewport.removeEventListener('resize', handleResize);
            // On cleanup, ensure the transform is reset to its original state.
            if (modalElement) {
                modalElement.style.transform = originalTransform.current;
            }
            originalTransform.current = '';
        };
    }, [isOpen, modalContentRef]);
}