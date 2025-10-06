import { useState, useEffect } from 'react';

/**
 * Custom hook to track the browser's fullscreen status.
 * @returns {boolean} A boolean indicating if the document is currently in fullscreen mode.
 */
export const useFullscreenStatus = (): boolean => {
    const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        // Also listen for vendor-prefixed events for broader compatibility
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.addEventListener('mozfullscreenchange', handleFullscreenChange);
        document.addEventListener('msfullscreenchange', handleFullscreenChange);

        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
            document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
            document.removeEventListener('msfullscreenchange', handleFullscreenChange);
        };
    }, []);

    return isFullscreen;
};

/**
 * Custom hook to track the PWA's standalone status.
 * @returns {boolean} A boolean indicating if the app is running in standalone mode.
 */
export const useStandaloneStatus = (): boolean => {
    const [isStandalone, setIsStandalone] = useState(false);

    useEffect(() => {
        const checkStandalone = () => {
            const isMatch = window.matchMedia('(display-mode: standalone)').matches;
            // For iOS Safari PWA
            const isNavigatorStandalone = (window.navigator as any).standalone === true;
            setIsStandalone(isMatch || isNavigatorStandalone);
        };
        
        checkStandalone();
        
        // Listen for changes
        const mediaQuery = window.matchMedia('(display-mode: standalone)');
        mediaQuery.addEventListener('change', checkStandalone);
        
        return () => {
             mediaQuery.removeEventListener('change', checkStandalone);
        };
    }, []);

    return isStandalone;
};
