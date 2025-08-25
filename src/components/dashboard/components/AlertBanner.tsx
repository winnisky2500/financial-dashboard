import React from 'react';
import { AlertTriangle, X, Info, AlertCircle } from 'lucide-react';

interface Alert {
  id: string;
  type: 'warning' | 'error' | 'info';
  title: string;
  message: string;
}

interface AlertBannerProps {
  alerts: Alert[];
  onClose: (id: string) => void;
}

const AlertBanner: React.FC<AlertBannerProps> = ({ alerts, onClose }) => {
  if (alerts.length === 0) return null;

  const getAlertStyle = (type: string) => {
    switch (type) {
      case 'error':
        return 'bg-red-50 border-red-200 text-red-800';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200 text-yellow-800';
      case 'info':
        return 'bg-blue-50 border-blue-200 text-blue-800';
      default:
        return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'error':
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'info':
        return <Info className="h-5 w-5 text-blue-500" />;
      default:
        return <Info className="h-5 w-5 text-gray-500" />;
    }
  };

  return (
    <div className="space-y-2">
      {alerts.map((alert) => (
        <div key={alert.id} className={`border rounded-lg p-4 ${getAlertStyle(alert.type)}`}>
          <div className="flex items-start">
            <div className="flex-shrink-0">
              {getAlertIcon(alert.type)}
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium mb-1">{alert.title}</h3>
              <p className="text-sm opacity-90">{alert.message}</p>
            </div>
            <div className="flex-shrink-0 ml-3">
              <button
                onClick={() => onClose(alert.id)}
                className="inline-flex rounded-md p-1.5 focus:outline-none focus:ring-2 focus:ring-offset-2 hover:bg-black hover:bg-opacity-10 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default AlertBanner;