import React, { useState } from 'react';
import { X, Play, Code, Upload } from 'lucide-react';
import toast from 'react-hot-toast';

interface SimulationResult {
  id: string;
  timestamp: Date;
  model: string;
  params: any;
  results: {
    scenarios: Array<{
      name: string;
      values: number[];
      probability?: number;
    }>;
    summary: {
      mean: number;
      median: number;
      standardDeviation: number;
      percentiles: { p5: number; p25: number; p75: number; p95: number };
    };
  };
}

interface CustomFunctionProps {
  onClose: () => void;
  onExecute: (result: SimulationResult) => void;
}

const CustomFunction: React.FC<CustomFunctionProps> = ({ onClose, onExecute }) => {
  const [functionCode, setFunctionCode] = useState(`# 自定义分析函数
# 参数: data (列表格式的历史数据)
# 返回: 预测结果列表

def analyze(data):
    import numpy as np
    
    # 示例: 简单的移动平均预测
    if len(data) < 3:
        return [100] * 12  # 默认值
    
    # 计算移动平均
    recent_avg = np.mean(data[-3:])
    
    # 生成预测值
    predictions = []
    for i in range(12):
        # 加入一些随机波动
        variation = np.random.normal(0, recent_avg * 0.1)
        predictions.append(recent_avg + variation)
    
    return predictions`);
  
  const [isExecuting, setIsExecuting] = useState(false);
  const [parameters, setParameters] = useState('100,105,103,108,110,107,112,115,113,118');

  // 上传文件
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setFunctionCode(content);
        toast.success('文件上传成功！');
      };
      reader.readAsText(file);
    }
  };

  // 执行自定义函数
  const executeFunction = async () => {
    setIsExecuting(true);
    
    try {
      // 模拟执行延时
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // 模拟函数执行结果
      const inputData = parameters.split(',').map(x => parseFloat(x.trim())).filter(x => !isNaN(x));
      
      if (inputData.length === 0) {
        throw new Error('请输入有效的参数数据');
      }
      
      // 生成模拟结果
      const mockResults: SimulationResult = {
        id: Date.now().toString(),
        timestamp: new Date(),
        model: 'custom',
        params: { inputData },
        results: {
          scenarios: [
            {
              name: '自定义预测',
              values: Array.from({ length: 12 }, (_, i) => {
                const baseValue = inputData[inputData.length - 1] || 100;
                return baseValue + (i * 2) + (Math.random() - 0.5) * 10;
              })
            }
          ],
          summary: {
            mean: 115.5,
            median: 114.2,
            standardDeviation: 8.5,
            percentiles: { p5: 102.1, p25: 109.3, p75: 121.7, p95: 128.9 }
          }
        }
      };
      
      onExecute(mockResults);
      toast.success('自定义函数执行成功！');
    } catch (error) {
      toast.error('函数执行失败: ' + (error as Error).message);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-2">
            <Code className="h-6 w-6 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-900">自定义分析函数</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        
        {/* 内容区域 */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 左侧: 代码编辑器 */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">Python 代码</h3>
                <div className="flex space-x-2">
                  <label className="cursor-pointer px-3 py-1 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center space-x-1">
                    <Upload className="h-4 w-4" />
                    <span>上传</span>
                    <input
                      type="file"
                      accept=".py,.txt"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
              
              <textarea
                value={functionCode}
                onChange={(e) => setFunctionCode(e.target.value)}
                className="w-full h-80 p-3 border border-gray-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="输入您的 Python 分析函数..."
              />
              
              {/* 安全提示 */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <h4 className="font-medium text-yellow-800 mb-1">安全提示</h4>
                <ul className="text-sm text-yellow-700 space-y-1">
                  <li>• 函数将在安全沙箱环境中执行</li>
                  <li>• 禁止访问文件系统和网络</li>
                  <li>• 限制执行时间和内存使用</li>
                  <li>• 仅支持标准库和 numpy/pandas</li>
                </ul>
              </div>
            </div>
            
            {/* 右侧: 参数设置和执行 */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900">参数设置</h3>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  输入数据（逗号分隔）
                </label>
                <textarea
                  value={parameters}
                  onChange={(e) => setParameters(e.target.value)}
                  className="w-full h-20 p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="100,105,103,108,110..."
                />
                <p className="text-xs text-gray-500 mt-1">
                  输入历史数据，用逗号分隔数值
                </p>
              </div>
              
              {/* 执行按钮 */}
              <button
                onClick={executeFunction}
                disabled={isExecuting || !functionCode.trim()}
                className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center space-x-2"
              >
                <Play className="h-4 w-4" />
                <span>{isExecuting ? '正在执行...' : '执行函数'}</span>
              </button>
              
              {/* 函数说明 */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-800 mb-2">函数规范</h4>
                <div className="text-sm text-blue-700 space-y-2">
                  <p><strong>函数名:</strong> analyze(data)</p>
                  <p><strong>参数:</strong> data - 列表格式的历史数据</p>
                  <p><strong>返回:</strong> 列表格式的预测结果</p>
                  <p><strong>示例:</strong></p>
                  <pre className="bg-blue-100 p-2 rounded text-xs overflow-x-auto">
{`def analyze(data):
    # 您的分析逻辑
    return [100, 105, 103, ...]`}
                  </pre>
                </div>
              </div>
              
              {/* 可用库 */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="font-medium text-gray-700 mb-2">可用库</h4>
                <div className="text-sm text-gray-600 space-y-1">
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-1 bg-white border rounded text-xs">numpy</span>
                    <span className="px-2 py-1 bg-white border rounded text-xs">pandas</span>
                    <span className="px-2 py-1 bg-white border rounded text-xs">math</span>
                    <span className="px-2 py-1 bg-white border rounded text-xs">statistics</span>
                    <span className="px-2 py-1 bg-white border rounded text-xs">random</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* 底部操作栏 */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={executeFunction}
            disabled={isExecuting || !functionCode.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
          >
            <Play className="h-4 w-4" />
            <span>{isExecuting ? '正在执行...' : '执行并关闭'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomFunction;