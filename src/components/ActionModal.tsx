
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
    containerRef?: React.Ref<HTMLDivElement>;
    heightClass?: string;
    disableBodyScroll?: boolean;
    zIndexClass?: string;
    onBack?: () => void;
}

const ActionModal: React.FC<ActionModalProps> = ({ isOpen, onClose, title, children, footer, headerActions, containerRef, heightClass, disableBodyScroll, zIndexClass = 'z-30', onBack }) => {
    const [isMounted, setIsMounted] = useState(isOpen);
    const [isRendered, setIsRendered] = useState(isOpen);
    const animationDuration = 300; // Match close animation duration

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
    const baseClasses = heightClass 
        ? `absolute bottom-0 left-0 right-0 flex flex-col bg-gray-50 shadow-2xl rounded-t-2xl will-change-[transform,opacity] ${heightClass}`
        : `absolute bottom-0 left-0 right-0 flex flex-col bg-gray-50 shadow-lg rounded-t-2xl will-change-[transform,opacity]`;

    return createPortal(
        <div 
            className={`fixed inset-0 bg-black ${zIndexClass} transition-opacity duration-300 ${isRendered ? 'bg-opacity-50' : 'bg-opacity-0'}`}
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            <div 
                ref={containerRef}
                style={style}
                className={`${baseClasses} transition-transform ${
                    isRendered
                        ? 'ease-[cubic-bezier(0.32,1.25,0.37,1.02)] duration-500' // Bouncy ease-out for opening
                        : 'ease-[cubic-bezier(0.36,0,0.66,-0.56)] duration-300' // Ease-in-back for closing
                } ${isRendered ? 'translate-y-0' : 'translate-y-full'}`}
                onClick={e => e.stopPropagation()}
            >
                <header className="relative bg-white px-3 py-2 flex-shrink-0 border-b border-gray-200 z-20 rounded-t-2xl flex items-center justify-center min-h-[44px]">
                    {onBack && (
                        <div className="absolute top-1/2 left-2 -translate-y-1/2">
                            <button onClick={onBack} className="p-1.5 text-gray-500 hover:bg-gray-200 rounded-full transition-colors" aria-label="뒤로가기">
                                <ChevronLeftIcon className="w-6 h-6"/>
                            </button>
                        </div>
                    )}
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
