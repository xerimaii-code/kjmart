
import React, { useEffect, useRef } from 'react';

/**
 * A custom hook that adjusts a modal's vertical position to keep it visible when the on-screen keyboard appears.
 * It uses the visualViewport API to detect keyboard presence and repositions the modal using CSS transform.
 * @param modalContentRef Ref to the modal's content element that needs to be moved.
 * @param isOpen Boolean indicating if the modal is currently open.
 */
export function useAdjustForKeyboard(modalContentRef: React.RefObject<HTMLElement>, isOpen: boolean) {
    // Using `useRef` to store the original transform value across re-renders and effects.
    // Initialize with `null` to indicate it hasn't been captured yet.
    const originalTransform = useRef<string | null>(null);

    useEffect(() => {
        if (!isOpen || !modalContentRef.current) return;

        const modalElement = modalContentRef.current;
        const visualViewport = window.visualViewport;

        // Exit if the visualViewport API is not supported.
        if (!visualViewport) return;

        const handleResize = () => {
            // Ensure the modal element still exists.
            if (!modalElement) return;

            // Capture the original transform style only once when the adjustment logic first runs.
            // We use getComputedStyle for a more reliable value than .style.transform.
            if (originalTransform.current === null) {
                const computedTransform = window.getComputedStyle(modalElement).transform;
                // 'none' is the default value, treat it as an empty string for simplicity.
                originalTransform.current = computedTransform === 'none' ? '' : computedTransform;
            }

            const { height: viewportHeight } = visualViewport;
            const modalRect = modalElement.getBoundingClientRect();
            
            // Check if the keyboard is likely open. A threshold helps prevent false positives.
            const isKeyboardOpen = window.innerHeight > viewportHeight + 50;
            
            if (isKeyboardOpen && modalRect.bottom > viewportHeight) {
                const padding = 16; // Desired space between modal and keyboard
                const requiredUpwardShift = modalRect.bottom - viewportHeight + padding;
                // Apply a transform to move the modal up.
                modalElement.style.transform = `translateY(-${requiredUpwardShift}px)`;
            } else {
                // Restore the original transform if keyboard is closed or modal isn't obscured.
                modalElement.style.transform = originalTransform.current || '';
            }
        };

        // The key fix: The timing issue occurs because the resize handler is called
        // before the modal's opening animation completes, resulting in an incorrect
        // initial position calculation.
        // We delay attaching the listener and the initial check to after the animation.
        const animationDuration = 550; // Slightly longer than the modal's 500ms transition.
        const timerId = setTimeout(() => {
            visualViewport.addEventListener('resize', handleResize);
            // Run the check once after the delay to handle pre-existing keyboards.
            handleResize();
        }, animationDuration);

        // Cleanup function for the effect.
        return () => {
            clearTimeout(timerId);
            visualViewport.removeEventListener('resize', handleResize);
            // On cleanup, ensure the transform is reset to its original state.
            if (modalElement && originalTransform.current !== null) {
                modalElement.style.transform = originalTransform.current;
            }
            // Reset the ref for the next time the modal opens.
            originalTransform.current = null;
        };
    }, [isOpen, modalContentRef]);
}
