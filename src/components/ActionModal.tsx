
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, ChevronLeftIcon } from './Icons';

interface ActionModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
    headerActions?: React.ReactNode;
    headerLeft?: React.ReactNode;
    containerRef?: React.Ref<HTMLDivElement>;
    heightClass?: string;
    disableBodyScroll?: boolean;
    zIndexClass?: string;
    onBack?: () => void;
    slideDirection?: 'bottom' | 'right';
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
    slideDirection = 'bottom'
}) => {
    const [isMounted, setIsMounted] = useState(isOpen);
    const [isRendered, setIsRendered] = useState(false);
    const animationDuration = 250;

    useEffect(() => {
        if (isOpen) {
            setIsMounted(true);
            const renderTimer = setTimeout(() => setIsRendered(true), 30);
            return () => clearTimeout(renderTimer);
        } else {
            setIsRendered(false);
            const unmountTimer = setTimeout(() => setIsMounted(false), animationDuration);
            return () => clearTimeout(unmountTimer);
        }
    }, [isOpen]);

    if (!isMounted) return null;

    const style = heightClass ? {} : { top: 'calc(3.5rem + env(safe-area-inset-top))' };
    
    const translateClosed = slideDirection === 'right' ? 'translate-x-full' : 'translate-y-full';
    const translateOpen = slideDirection === 'right' ? 'translate-x-0' : 'translate-y-0';
    
    const baseClasses = heightClass 
        ? `absolute bottom-0 left-0 right-0 flex flex-col bg-gray-50 shadow-2xl rounded-t-2xl will-change-[transform,opacity] ${heightClass}`
        : `absolute bottom-0 left-0 right-0 flex flex-col bg-gray-50 shadow-lg ${slideDirection === 'bottom' ? 'rounded-t-2xl' : ''} will-change-[transform,opacity]`;

    const directionClasses = slideDirection === 'right' 
        ? 'top-0 rounded-none h-full' 
        : 'rounded-t-2xl';

    return createPortal(
        <div 
            className={`fixed inset-0 bg-black ${zIndexClass} transition-opacity duration-300 ${isRendered ? 'bg-opacity-50' : 'bg-opacity-0'}`}
            onClick={onClose}
            onDoubleClick={onClose} // 배경 더블 클릭 시 닫기 추가
            role="dialog"
            aria-modal="true"
        >
            <div 
                ref={containerRef}
                style={slideDirection === 'right' ? { top: 0, bottom: 0, height: '100%' } : style}
                className={`${baseClasses} ${directionClasses} transition-transform ${
                    isRendered
                        ? 'ease-[cubic-bezier(0.32,1.25,0.37,1.02)] duration-300' 
                        : 'ease-[cubic-bezier(0.36,0,0.66,-0.56)] duration-200'
                } ${isRendered ? translateOpen : translateClosed}`}
                onClick={e => e.stopPropagation()}
                onDoubleClick={e => e.stopPropagation()} // 모달 내부 더블 클릭은 전파 방지
            >
                <header className="relative bg-white px-3 py-2 flex-shrink-0 border-b border-gray-200 z-20 rounded-t-inherit flex items-center justify-center min-h-[44px]">
                    <div className="absolute top-1/2 left-2 -translate-y-1/2 flex items-center gap-1">
                        {onBack && (
                            <button onClick={(e) => { e.stopPropagation(); onBack(); }} className="p-3 text-gray-500 hover:bg-gray-100 rounded-full transition-colors -ml-2" aria-label="뒤로가기">
                                <ChevronLeftIcon className="w-6 h-6"/>
                            </button>
                        )}
                        {headerLeft}
                    </div>
                    
                    <div className="px-10 w-full flex justify-center pointer-events-none">
                        {typeof title === 'string' ? (
                            <h2 className="text-lg font-bold text-gray-800 truncate">{title}</h2>
                        ) : (
                            title
                        )}
                    </div>
                    
                    <div className="absolute top-1/2 right-2 -translate-y-1/2 flex items-center gap-1">
                        {headerActions}
                        <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="p-3 text-gray-500 hover:bg-gray-100 rounded-full transition-colors -mr-2" aria-label="닫기">
                            <XMarkIcon className="w-6 h-6"/>
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
