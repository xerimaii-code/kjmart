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

        if (!visualViewport) return;
        
        const originalCSSTransition = modalElement.style.transition || '';
        
        // Capture the initial transform style only once.
        if (originalTransform.current === '') {
            const computedTransform = getComputedStyle(modalElement).transform;
            // 'none' is the computed value for no transform, which we treat as an empty string.
            originalTransform.current = computedTransform === 'none' ? '' : computedTransform;
        }
        
        // Use a variable within the effect's scope to track the keyboard state across resize events.
        let wasKeyboardOpen = window.innerHeight > visualViewport.height;

        const handleResize = () => {
            if (!modalElement) return;

            const isKeyboardOpen = window.innerHeight > visualViewport.height;

            if (isKeyboardOpen) {
                // Keyboard is opening or is currently open.
                // We move the modal instantly (transition: 'none') to prevent visual stuttering
                // as multiple resize events fire during the keyboard's animation.
                modalElement.style.transition = 'none';

                const modalRect = modalElement.getBoundingClientRect();
                // Check if the bottom of the modal is obscured by the keyboard.
                if (modalRect.bottom > visualViewport.height) {
                    const padding = 8; // A small gap between the modal and the keyboard.
                    const requiredUpwardShift = modalRect.bottom - visualViewport.height + padding;
                    modalElement.style.transform = `translateY(-${requiredUpwardShift}px)`;
                }
            } else if (wasKeyboardOpen) {
                // This condition is true only on the first resize event after the keyboard closes.
                // We restore the original CSS transition to animate the modal back to its place.
                modalElement.style.transition = originalCSSTransition;
                modalElement.style.transform = originalTransform.current;
            }
            
            // Update the state for the next resize event.
            wasKeyboardOpen = isKeyboardOpen;
        };

        visualViewport.addEventListener('resize', handleResize);
        
        // Run once initially to position correctly if keyboard is already open.
        handleResize();

        return () => {
            visualViewport.removeEventListener('resize', handleResize);
            // On cleanup (modal closes), ensure all styles are reset to their original state.
            if (modalElement) {
                modalElement.style.transition = originalCSSTransition;
                modalElement.style.transform = originalTransform.current;
            }
            originalTransform.current = ''; // Reset for the next time the modal opens.
        };
    }, [isOpen, modalContentRef]);
}