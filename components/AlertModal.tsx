import React, { useContext } from 'react';
import { AppContext } from '../context/AppContext';

const AlertModal: React.FC = () => {
  const { alert, hideAlert } = useContext(AppContext);

  if (!alert.isOpen) {
    return null;
  }

  const handleConfirm = () => {
    if (alert.onConfirm) {
      alert.onConfirm();
    }
    hideAlert();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" role="alertdialog" aria-modal="true" aria-labelledby="alert-message">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
        <div className="p-6 text-center">
          <p id="alert-message" className="text-gray-700 text-lg">{alert.message}</p>
        </div>
        <div className="flex border-t border-gray-200">
          {alert.isConfirm && (
            <button
              onClick={hideAlert}
              className="w-1/2 p-3 text-gray-600 hover:bg-gray-100 rounded-bl-lg focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              취소
            </button>
          )}
          <button
            onClick={handleConfirm}
            className={`${alert.isConfirm ? 'w-1/2' : 'w-full'} p-3 text-blue-600 font-bold hover:bg-gray-100 ${alert.isConfirm ? 'border-l rounded-br-lg' : 'rounded-b-lg'} focus:outline-none focus:ring-2 focus:ring-blue-400`}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
};

export default AlertModal;
