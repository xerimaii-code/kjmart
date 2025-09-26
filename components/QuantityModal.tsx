import React from 'react';

interface QuantityModalProps {
  initialQuantity: number;
  onSelect: (quantity: number) => void;
  onClose: () => void;
}

const QuantityModal: React.FC<QuantityModalProps> = ({ initialQuantity, onSelect, onClose }) => {
  const tens = Math.floor(initialQuantity / 10);
  const startNum = tens < 1 ? 0 : tens * 10;
  const quantities = Array.from({ length: 10 }, (_, i) => startNum + ((i + 1) * 10));

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-white rounded-lg shadow-xl w-full max-w-xs" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-center p-4 border-b">수량 선택</h3>
            <div className="grid grid-cols-2 gap-2 p-4">
                {quantities.map(q => (
                    <button
                        key={q}
                        onClick={() => { onSelect(q); onClose(); }}
                        className="p-4 text-center text-lg font-semibold bg-gray-100 rounded-md hover:bg-blue-100"
                    >
                        {q}
                    </button>
                ))}
            </div>
        </div>
    </div>
  );
};

export default QuantityModal;
