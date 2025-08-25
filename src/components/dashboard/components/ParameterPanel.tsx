import React from 'react';
import { Sliders } from 'lucide-react';

interface SimulationParams {
  // ARIMA参数
  p?: number;
  d?: number;
  q?: number;
  length?: number;
  historicalData?: number[];
  variance?: number;
  
  // 蒙特卡洛参数
  numSimulations?: number;
  timeHorizon?: number;
  initialValue?: number;
  drift?: number;
  volatility?: number;
  
  // 通用参数
  customParams?: Record<string, number>;
}

interface ParameterPanelProps {
  parameters: SimulationParams;
  onParametersChange: (params: SimulationParams) => void;
  selectedModel: string;
}

const ParameterPanel: React.FC<ParameterPanelProps> = ({ parameters, onParametersChange, selectedModel }) => {
  const updateParameter = (key: string, value: number) => {
    onParametersChange({
      ...parameters,
      [key]: value
    });
  };

  // 根据选中的模型显示不同参数
  const getModelSpecificParams = () => {
    switch (selectedModel) {
      case 'arima':
        return [
          { key: 'p', label: 'AR阶数(p)', min: 0, max: 5, step: 1, defaultValue: 2 },
          { key: 'd', label: '差分阶数(d)', min: 0, max: 2, step: 1, defaultValue: 1 },
          { key: 'q', label: 'MA阶数(q)', min: 0, max: 5, step: 1, defaultValue: 1 },
          { key: 'length', label: '预测长度', min: 6, max: 24, step: 1, defaultValue: 12 },
          { key: 'variance', label: '噪声方差', min: 0.1, max: 3.0, step: 0.1, defaultValue: 1.0 }
        ];
      case 'montecarlo':
        return [
          { key: 'numSimulations', label: '模拟次数', min: 100, max: 5000, step: 100, defaultValue: 1000 },
          { key: 'timeHorizon', label: '时间范围', min: 6, max: 60, step: 1, defaultValue: 12 },
          { key: 'initialValue', label: '初始值', min: 50, max: 200, step: 10, defaultValue: 100 },
          { key: 'drift', label: '漂移率', min: -0.1, max: 0.2, step: 0.01, defaultValue: 0.05 },
          { key: 'volatility', label: '波动率', min: 0.05, max: 0.5, step: 0.01, defaultValue: 0.2 }
        ];
      case 'regression':
        return [
          { key: 'factors', label: '因子数量', min: 2, max: 10, step: 1, defaultValue: 5 },
          { key: 'correlation', label: '相关性', min: 0.1, max: 0.9, step: 0.1, defaultValue: 0.7 },
          { key: 'significance', label: '显著性', min: 0.01, max: 0.1, step: 0.01, defaultValue: 0.05 }
        ];
      default:
        return [];
    }
  };

  const modelParams = getModelSpecificParams();

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center space-x-2 mb-4">
        <Sliders className="h-5 w-5 text-gray-600" />
        <h2 className="text-lg font-semibold text-gray-900">参数设置</h2>
      </div>
      
      <div className="space-y-4">
        {/* 模型特有参数 */}
        {modelParams.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">模型参数</h3>
            <div className="space-y-3">
              {modelParams.map((param) => {
                const paramValue = parameters[param.key as keyof SimulationParams];
                let currentValue: number;
                
                if (typeof paramValue === 'number') {
                  currentValue = paramValue;
                } else if (Array.isArray(paramValue)) {
                  currentValue = paramValue[0] || param.defaultValue;
                } else {
                  currentValue = param.defaultValue;
                }
                
                return (
                  <div key={param.key}>
                    <label className="block text-sm text-gray-600 mb-1">
                      {param.label}: {currentValue}
                    </label>
                    <input
                      type="range"
                      min={param.min}
                      max={param.max}
                      step={param.step}
                      value={currentValue}
                      onChange={(e) => updateParameter(param.key, parseFloat(e.target.value))}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {/* 参数摘要 */}
        <div className="bg-gray-50 rounded-lg p-3">
          <h4 className="text-xs font-medium text-gray-700 mb-2">参数摘要</h4>
          <div className="text-xs text-gray-600 space-y-1">
            {selectedModel === 'arima' && (
              <>
                <div>AR阶数: {parameters.p || 2}</div>
                <div>差分阶数: {parameters.d || 1}</div>
                <div>MA阶数: {parameters.q || 1}</div>
                <div>预测长度: {parameters.length || 12}</div>
              </>
            )}
            {selectedModel === 'montecarlo' && (
              <>
                <div>模拟次数: {parameters.numSimulations || 1000}</div>
                <div>时间范围: {parameters.timeHorizon || 12}</div>
                <div>初始值: {parameters.initialValue || 100}</div>
                <div>漂移率: {((parameters.drift || 0.05) * 100).toFixed(1)}%</div>
                <div>波动率: {((parameters.volatility || 0.2) * 100).toFixed(1)}%</div>
              </>
            )}
            {parameters.customParams && Object.entries(parameters.customParams).map(([key, value]) => (
              <div key={key}>{key}: {value}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ParameterPanel;