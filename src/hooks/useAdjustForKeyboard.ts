
import React, { useEffect, useRef } from 'react';

/**
 * A custom hook that adjusts a modal's vertical position to keep a specific target element (or the modal itself)
 * visible when the on-screen keyboard appears.
 * 
 * @param modalContentRef Ref to the modal's main content element that needs to be moved.
 * @param isOpen Boolean indicating if the modal is currently open.
 * @param targetRef (Optional) Ref to a specific element inside the modal that should remain visible (e.g., a Submit button).
 *                  If provided, the modal will shift so that *this element's bottom* aligns with the keyboard top.
 *                  If omitted, ensures the *modal's bottom* aligns with the keyboard top.
 */
export function useAdjustForKeyboard(
    modalContentRef: React.RefObject<HTMLElement>, 
    isOpen: boolean, 
    targetRef?: React.RefObject<HTMLElement>
) {
    const originalTransform = useRef<string | null>(null);

    useEffect(() => {
        if (!isOpen || !modalContentRef.current) return;

        const modalElement = modalContentRef.current;
        const visualViewport = window.visualViewport;

        if (!visualViewport) return;

        const handleResize = () => {
            if (!modalElement) return;

            if (originalTransform.current === null) {
                const computedTransform = window.getComputedStyle(modalElement).transform;
                originalTransform.current = computedTransform === 'none' ? '' : computedTransform;
            }

            const { height: viewportHeight } = visualViewport;
            
            // Determine which element's bottom position dictates the shift
            const referenceElement = targetRef?.current || modalElement;
            const rect = referenceElement.getBoundingClientRect();
            const bottomToCheck = rect.bottom;
            
            const isKeyboardOpen = window.innerHeight > viewportHeight + 50;
            
            // Use 0 padding for flush alignment as requested previously
            if (isKeyboardOpen && bottomToCheck > viewportHeight) {
                const requiredUpwardShift = bottomToCheck - viewportHeight;
                modalElement.style.transform = `translateY(-${requiredUpwardShift}px)`;
            } else {
                modalElement.style.transform = originalTransform.current || '';
            }
        };

        const animationDuration = 550;
        const timerId = setTimeout(() => {
            visualViewport.addEventListener('resize', handleResize);
            handleResize();
        }, animationDuration);

        return () => {
            clearTimeout(timerId);
            visualViewport.removeEventListener('resize', handleResize);
            if (modalElement && originalTransform.current !== null) {
                modalElement.style.transform = originalTransform.current;
            }
            originalTransform.current = null;
        };
    }, [isOpen, modalContentRef, targetRef]);
}
