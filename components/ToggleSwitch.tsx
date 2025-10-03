import React from 'react';

interface ToggleSwitchProps {
    id: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
    disabled?: boolean;
    color?: 'red' | 'blue';
    className?: string;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ id, checked, onChange, label, disabled = false, color = 'blue', className }) => {
    const bgColor = checked ? (color === 'red' ? 'bg-red-500' : 'bg-blue-600') : 'bg-gray-300';
    const dotPosition = checked ? 'translate-x-5' : 'translate-x-0';

    return (
        <div className={`flex items-center ${className || ''}`}>
            <label htmlFor={id} className={`mr-2 text-sm font-medium ${disabled ? 'text-gray-400' : 'text-gray-700'} select-none cursor-pointer`}>
                {label}
            </label>
            <button
                id={id}
                role="switch"
                aria-checked={checked}
                onClick={() => !disabled && onChange(!checked)}
                disabled={disabled}
                className={`relative inline-flex items-center h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 ${color === 'red' ? 'focus:ring-red-500' : 'focus:ring-blue-500'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${bgColor}`}
            >
                <span
                    aria-hidden="true"
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${dotPosition}`}
                />
            </button>
        </div>
    );
};

export default ToggleSwitch;