
import React from 'react';

interface SearchDropdownProps<T> {
    items: T[];
    renderItem: (item: T) => React.ReactNode;
    show: boolean;
}

const SearchDropdown = <T,>({ items, renderItem, show }: SearchDropdownProps<T>) => {
    if (!show || items.length === 0) return null;
    return (
        <div className="absolute z-40 w-full bg-white shadow-lg border border-gray-200 rounded-lg mt-1 max-h-72 overflow-y-auto">
            {items.map((item, index) => (
                <React.Fragment key={index}>{renderItem(item)}</React.Fragment>
            ))}
        </div>
    );
};

export default SearchDropdown;
