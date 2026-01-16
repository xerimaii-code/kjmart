
import React from 'react';
import { useResizableLayout } from '../hooks/useResizableLayout';
import { useAdjustForKeyboard } from '../hooks/useAdjustForKeyboard';
import { LockClosedIcon, LockOpenIcon } from './Icons';
import { useLocalStorage } from '../hooks/useLocalStorage';

interface KeypadLayoutProps {
    layoutId: string;
    isLeftHanded: boolean;
    onToggleHandedness: () => void;
    leftContent: React.ReactNode;
    rightContent: React.ReactNode;
    defaultRatio?: number;
    containerRef?: React.RefObject<HTMLDivElement>;
    headerContent?: React.ReactNode;
}

const KeypadLayout: React.FC<KeypadLayoutProps> = ({
    layoutId,
    isLeftHanded,
    onToggleHandedness,
    leftContent,
    rightContent,
    defaultRatio = 0.45,
    containerRef: externalContainerRef,
    headerContent
}) => {
    // Position Lock Preference
    const [isPositionLocked, setIsPositionLocked] = useLocalStorage<boolean>('pos_modal_locked', false);

    // Resizable Layout Hook
    const { layout, containerRef, handleResizeStart, handleSplitStart } = useResizableLayout(
        layoutId, 
        { width: 340, height: 500, ratio: defaultRatio }
    );

    // Use internal ref if external one isn't provided (though standard is usually internal first)
    // We attach `containerRef` from hook to the div.
    
    // Disable automatic keyboard adjustment if locked
    useAdjustForKeyboard(containerRef, false, undefined, !isPositionLocked);

    const leftFlex = layout.ratio;
    const rightFlex = 1 - layout.ratio;

    return (
        <div 
            ref={containerRef}
            style={{ width: layout.width, height: layout.height }}
            className="bg-white rounded-xl border border-gray-300 overflow-hidden my-1 flex flex-col relative shadow-sm" // Removed shadow-2xl, added border/shadow-sm
            onClick={e => e.stopPropagation()}
        >
            <div className="flex-grow flex flex-row overflow-hidden p-3 relative h-full">
                {/* Left Pane */}
                <div style={{ flex: leftFlex }} className="h-full overflow-hidden flex flex-col">
                    {isLeftHanded ? (
                        <div className="h-full w-full flex flex-col">
                            {leftContent}
                        </div>
                    ) : (
                        <div className="h-full w-full flex flex-col">
                            {rightContent}
                        </div>
                    )}
                </div>

                {/* Splitter Handle */}
                {!isPositionLocked && (
                    <div 
                        onMouseDown={handleSplitStart}
                        onTouchStart={handleSplitStart}
                        className="w-4 -mx-2 z-10 cursor-col-resize flex flex-col justify-center items-center group touch-none"
                    >
                        <div className="w-[1px] h-10 bg-gray-300 group-hover:bg-blue-500 transition-colors"></div>
                    </div>
                )}

                {/* Right Pane */}
                <div style={{ flex: rightFlex }} className="h-full overflow-hidden flex flex-col">
                    {isLeftHanded ? (
                        <div className="h-full w-full flex flex-col">
                            {rightContent}
                        </div>
                    ) : (
                        <div className="h-full w-full flex flex-col">
                            {leftContent}
                        </div>
                    )}
                </div>
            </div>

            {/* Resize Handle (Bottom-Right) */}
            {!isPositionLocked && (
                <div 
                    onMouseDown={handleResizeStart}
                    onTouchStart={handleResizeStart}
                    className="absolute bottom-0 right-0 w-8 h-8 cursor-nwse-resize z-20 flex items-end justify-end p-1.5 touch-none"
                >
                    <div className="w-0 h-0 border-b-[8px] border-r-[8px] border-b-transparent border-r-gray-400/50 hover:border-r-blue-500"></div>
                </div>
            )}
            
            <div className="absolute top-2 right-2 z-30 flex gap-1">
                 {/* Only show if NO header content is provided to avoid overlap */}
            </div>
        </div>
    );
};

export const KeypadHeaderControls: React.FC<{
    isLocked: boolean;
    onToggleLock: () => void;
    isLeft: boolean;
    onToggleHandedness: () => void;
}> = ({ isLocked, onToggleLock, isLeft, onToggleHandedness }) => (
    <div className="flex gap-1" onMouseDown={(e) => e.stopPropagation()}>
        <button
            onClick={onToggleLock}
            className={`text-[10px] border rounded px-1.5 py-0.5 transition-colors flex items-center justify-center ${isLocked ? 'bg-red-50 text-red-500 border-red-200' : 'bg-white text-gray-400 border-gray-200'}`}
            title={isLocked ? "화면 위치 잠금" : "화면 위치 자동 조절"}
        >
            {isLocked ? <LockClosedIcon className="w-3 h-3" /> : <LockOpenIcon className="w-3 h-3" />}
        </button>
        <button 
            onClick={onToggleHandedness}
            className={`text-[10px] font-bold border rounded px-2 py-0.5 transition-colors w-7 flex items-center justify-center ${isLeft ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-white text-gray-500 border-gray-200'}`}
        >
            {isLeft ? 'L' : 'R'}
        </button>
    </div>
);

export default KeypadLayout;
