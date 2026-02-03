
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useLocalStorage } from './useLocalStorage';

export interface LayoutState {
    width: number;
    height: number;
    ratio: number; // 왼쪽 패널의 비율 (0.2 ~ 0.8)
}

interface DragState {
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    startRatio: number;
}

export function useResizableLayout(key: string, defaultState: LayoutState) {
    const [layout, setLayout] = useLocalStorage<LayoutState>(key, defaultState, { deviceSpecific: true });
    
    // 로컬 스토리지 로드 전이나 값이 없을 때의 안전장치
    const safeLayout = layout || defaultState;

    const dragState = useRef<DragState | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // --- Window Resize Constraints ---
    useEffect(() => {
        // 화면보다 모달이 크면 줄여주는 로직 (초기 로드 시)
        if (typeof window !== 'undefined') {
            const maxWidth = window.innerWidth * 0.98;
            const maxHeight = window.innerHeight * 0.95;
            
            if (safeLayout.width > maxWidth || safeLayout.height > maxHeight) {
                setLayout(prev => ({
                    ...prev!,
                    width: Math.min(prev?.width || defaultState.width, maxWidth),
                    height: Math.min(prev?.height || defaultState.height, maxHeight)
                }));
            }
        }
    }, []);

    // --- Helper: Get Client Coordinates ---
    const getClientCoords = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
        if ('touches' in e) {
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
        return { x: (e as React.MouseEvent).clientX, y: (e as React.MouseEvent).clientY };
    };

    // --- Resizer Handlers (Bottom-Right) ---
    const handleResizeStart = (e: React.MouseEvent | React.TouchEvent) => {
        e.stopPropagation(); // Prevent interaction with underlying elements
        const { x, y } = getClientCoords(e);
        dragState.current = {
            startX: x,
            startY: y,
            startWidth: safeLayout.width,
            startHeight: safeLayout.height,
            startRatio: safeLayout.ratio
        };
        document.addEventListener('mousemove', handleResizeMove);
        document.addEventListener('mouseup', handleResizeEnd);
        document.addEventListener('touchmove', handleResizeMove, { passive: false });
        document.addEventListener('touchend', handleResizeEnd);
    };

    const handleResizeMove = useCallback((e: MouseEvent | TouchEvent) => {
        if (!dragState.current) return;
        if (e.cancelable) e.preventDefault(); // Prevent scrolling

        const { x, y } = getClientCoords(e);
        const deltaX = x - dragState.current.startX;
        const deltaY = y - dragState.current.startY;

        const newWidth = Math.max(280, Math.min(window.innerWidth * 0.98, dragState.current.startWidth + deltaX));
        const newHeight = Math.max(300, Math.min(window.innerHeight * 0.95, dragState.current.startHeight + deltaY));

        setLayout(prev => ({ ...prev!, width: newWidth, height: newHeight }));
    }, [setLayout]);

    const handleResizeEnd = () => {
        dragState.current = null;
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
        document.removeEventListener('touchmove', handleResizeMove);
        document.removeEventListener('touchend', handleResizeEnd);
    };

    // --- Splitter Handlers (Middle) ---
    const handleSplitStart = (e: React.MouseEvent | React.TouchEvent) => {
        e.stopPropagation();
        const { x } = getClientCoords(e);
        dragState.current = {
            startX: x,
            startY: 0,
            startWidth: safeLayout.width,
            startHeight: safeLayout.height,
            startRatio: safeLayout.ratio
        };
        document.addEventListener('mousemove', handleSplitMove);
        document.addEventListener('mouseup', handleSplitEnd);
        document.addEventListener('touchmove', handleSplitMove, { passive: false });
        document.addEventListener('touchend', handleSplitEnd);
    };

    const handleSplitMove = useCallback((e: MouseEvent | TouchEvent) => {
        if (!dragState.current || !containerRef.current) return;
        if (e.cancelable) e.preventDefault();

        const { x } = getClientCoords(e);
        const deltaX = x - dragState.current.startX;
        const totalWidth = containerRef.current.offsetWidth;
        
        // Calculate new ratio based on delta pixels
        // ratio = (startLeftWidth + delta) / totalWidth
        const startLeftWidth = totalWidth * dragState.current.startRatio;
        let newRatio = (startLeftWidth + deltaX) / totalWidth;

        // Clamp ratio between 0.2 and 0.8
        newRatio = Math.max(0.2, Math.min(0.8, newRatio));

        setLayout(prev => ({ ...prev!, ratio: newRatio }));
    }, [setLayout]);

    const handleSplitEnd = () => {
        dragState.current = null;
        document.removeEventListener('mousemove', handleSplitMove);
        document.removeEventListener('mouseup', handleSplitEnd);
        document.removeEventListener('touchmove', handleSplitMove);
        document.removeEventListener('touchend', handleSplitEnd);
    };

    return {
        layout: safeLayout,
        containerRef,
        handleResizeStart,
        handleSplitStart
    };
}
