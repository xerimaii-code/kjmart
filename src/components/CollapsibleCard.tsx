import React, { useState } from 'react';
import { ChevronDownIcon } from './Icons';

interface CollapsibleCardProps {
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
    initiallyOpen?: boolean;
}

const CollapsibleCard: React.FC<CollapsibleCardProps> = ({ title, icon, children, initiallyOpen = false }) => {
    const [isOpen, setIsOpen] = useState(initiallyOpen);

    return (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <button
                className="w-full flex justify-between items-center p-4 hover:bg-gray-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
            >
                <h3 className="font-bold text-gray-800 text-base flex items-center gap-3">
                    {icon}
                    <span>{title}</span>
                </h3>
                <ChevronDownIcon className={`w-6 h-6 text-gray-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            <div 
                className={`grid transition-all duration-300 ease-in-out ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
            >
                <div className="overflow-hidden">
                    <div className="p-4 pt-2 border-t border-gray-200">
                         <div className="space-y-4">
                            {children}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CollapsibleCard;