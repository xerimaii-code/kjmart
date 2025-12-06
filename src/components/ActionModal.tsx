
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { RemoveIcon, ChevronLeftIcon } from './Icons';

interface ActionModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    headerActions?: React.ReactNode;
    headerLeft?: React.ReactNode;
    containerRef?: React.Ref<HTMLDivElement>;
    heightClass?: string;
    disableBodyScroll?: boolean;
    zIndexClass?: string;
    onBack?: () => void;
    slideDirection?: 'bottom' | 'right'; // Added prop
}

const ActionModal: React.FC<ActionModalProps> = ({ 
    isOpen, 
    onClose, 
    title, 
    children, 
    footer, 
    headerActions, 
    headerLeft, 
    containerRef, 
    heightClass, 
    disableBodyScroll, 
    zIndexClass = 'z-30', 
    onBack,
    slideDirection = 'bottom' // Default to bottom
}) => {
    const [isMounted, setIsMounted] = useState(isOpen);
    const [isRendered, setIsRendered] = useState(isOpen);
    const animationDuration = 300;

    useEffect(() => {
        if (isOpen) {
            setIsMounted(true);
            const renderTimer = setTimeout(() => setIsRendered(true), 10);
            return () => clearTimeout(renderTimer);
        } else {
            setIsRendered(false);
            const unmountTimer = setTimeout(() => setIsMounted(false), animationDuration);
            return () => clearTimeout(unmountTimer);
        }
    }, [isOpen]);

    if (!isMounted) return null;

    const style = heightClass ? {} : { top: 'calc(3.5rem + env(safe-area-inset-top))' };
    
    // Determine translation classes based on direction
    const translateClosed = slideDirection === 'right' ? 'translate-x-full' : 'translate-y-full';
    const translateOpen = slideDirection === 'right' ? 'translate-x-0' : 'translate-y-0';
    
    const baseClasses = heightClass 
        ? `absolute bottom-0 left-0 right-0 flex flex-col bg-gray-50 shadow-2xl rounded-t-2xl will-change-[transform,opacity] ${heightClass}`
        : `absolute bottom-0 left-0 right-0 flex flex-col bg-gray-50 shadow-lg ${slideDirection === 'bottom' ? 'rounded-t-2xl' : ''} will-change-[transform,opacity]`;

    // For right slide, we usually want full height and square corners on the left (or all corners if it covers full screen)
    // Adjusting base classes slightly if direction is right to look more like a page push
    const directionClasses = slideDirection === 'right' 
        ? 'top-0 rounded-none h-full' 
        : 'rounded-t-2xl';

    return createPortal(
        <div 
            className={`fixed inset-0 bg-black ${zIndexClass} transition-opacity duration-300 ${isRendered ? 'bg-opacity-50' : 'bg-opacity-0'}`}
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            <div 
                ref={containerRef}
                style={slideDirection === 'right' ? { top: 0, bottom: 0, height: '100%' } : style}
                className={`${baseClasses} ${directionClasses} transition-transform ${
                    isRendered
                        ? 'ease-[cubic-bezier(0.32,1.25,0.37,1.02)] duration-500' 
                        : 'ease-[cubic-bezier(0.36,0,0.66,-0.56)] duration-300'
                } ${isRendered ? translateOpen : translateClosed}`}
                onClick={e => e.stopPropagation()}
            >
                <header className="relative bg-white px-3 py-2 flex-shrink-0 border-b border-gray-200 z-20 rounded-t-inherit flex items-center justify-center min-h-[44px]">
                    <div className="absolute top-1/2 left-2 -translate-y-1/2 flex items-center gap-1">
                        {onBack && (
                            <button onClick={onBack} className="p-1.5 text-gray-500 hover:bg-gray-200 rounded-full transition-colors" aria-label="뒤로가기">
                                <ChevronLeftIcon className="w-6 h-6"/>
                            </button>
                        )}
                        {headerLeft}
                    </div>
                    
                    <h2 className="text-lg font-bold text-gray-800 truncate px-12 text-center">{title}</h2>
                    
                    <div className="absolute top-1/2 right-2 -translate-y-1/2 flex items-center gap-1">
                        {headerActions}
                        <button onClick={onClose} className="p-1.5 text-gray-500 hover:bg-gray-200 rounded-full transition-colors" aria-label="닫기">
                            <RemoveIcon className="w-6 h-6"/>
                        </button>
                    </div>
                </header>
                <main className={`flex-grow relative flex flex-col ${disableBodyScroll ? 'overflow-hidden' : 'overflow-y-auto'}`}>
                    {children}
                </main>
                {footer && (
                     <footer className="p-2 bg-white border-t border-gray-200 z-10 flex-shrink-0 safe-area-pb">
                        <div className="max-w-2xl mx-auto">
                           {footer}
                        </div>
                    </footer>
                )}
            </div>
        </div>,
        document.body
    );
};

export default ActionModal;
