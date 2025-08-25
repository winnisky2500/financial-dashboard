import React from 'react';
import { BarChart3, TrendingUp, Activity } from 'lucide-react';

interface Model {
  id: string;
  name: string;
  description: string;
  parameters: string[];
}

interface ModelSelectorProps {
  models: Model[];
  selectedModel: string;
  onModelChange: (modelId: string) => void;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({ models, selectedModel, onModelChange }) => {
  const getModelIcon = (modelId: string) => {
    switch (modelId) {
      case 'arima':
        return <TrendingUp className="h-5 w-5" />;
      case 'montecarlo':
        return <Activity className="h-5 w-5" />;
      case 'regression':
        return <BarChart3 className="h-5 w-5" />;
      default:
        return <BarChart3 className="h-5 w-5" />;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">选择模型</h2>
      <div className="space-y-3">
        {models.map((model) => (
          <div key={model.id}>
            <label className="flex items-start space-x-3 cursor-pointer group">
              <input
                type="radio"
                name="model"
                value={model.id}
                checked={selectedModel === model.id}
                onChange={(e) => onModelChange(e.target.value)}
                className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
              />
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <div className={`p-1 rounded ${selectedModel === model.id ? 'text-blue-600' : 'text-gray-400'}`}>
                    {getModelIcon(model.id)}
                  </div>
                  <div className={`font-medium ${selectedModel === model.id ? 'text-blue-900' : 'text-gray-900'}`}>
                    {model.name}
                  </div>
                </div>
                <p className="text-sm text-gray-600 mt-1">
                  {model.description}
                </p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {model.parameters.map((param, index) => (
                    <span key={index} className="inline-flex px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">
                      {param}
                    </span>
                  ))}
                </div>
              </div>
            </label>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ModelSelector;