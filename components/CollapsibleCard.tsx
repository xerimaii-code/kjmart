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
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
            <button
                className="w-full flex justify-between items-center p-4 bg-gray-50 hover:bg-gray-100 transition-colors border-b border-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
            >
                <h3 className="font-bold text-gray-800 text-base flex items-center gap-2">
                    {icon}
                    <span>{title}</span>
                </h3>
                <ChevronDownIcon className={`w-5 h-5 text-gray-500 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
                <div className="p-4 space-y-4 animate-fade-in-down">
                    {children}
                </div>
            )}
        </div>
    );
};

export default CollapsibleCard;
