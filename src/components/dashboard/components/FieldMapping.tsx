import React, { useState } from 'react';
import { ArrowRight, Plus, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface FieldMapping {
  id: string;
  dataSourceId: string;
  sourceField: string;
  targetIndicator: string;
  fieldType: 'number' | 'text' | 'date' | 'boolean';
  transformRule: string;
  isRequired: boolean;
  validation: any;
}

const FieldMapping: React.FC = () => {
  const [mappings, setMappings] = useState<FieldMapping[]>([
    {
      id: '1',
      dataSourceId: '1',
      sourceField: 'gross_profit_margin',
      targetIndicator: 'GROSS_MARGIN',
      fieldType: 'number',
      transformRule: 'value * 100', // 转换为百分比
      isRequired: true,
      validation: { min: 0, max: 100 }
    },
    {
      id: '2',
      dataSourceId: '1',
      sourceField: 'net_profit_margin',
      targetIndicator: 'NET_MARGIN',
      fieldType: 'number',
      transformRule: 'value * 100',
      isRequired: true,
      validation: { min: 0, max: 100 }
    },
    {
      id: '3',
      dataSourceId: '2',
      sourceField: 'return_on_equity',
      targetIndicator: 'ROE',
      fieldType: 'number',
      transformRule: 'value',
      isRequired: true,
      validation: { min: -100, max: 100 }
    }
  ]);

  const [newMapping, setNewMapping] = useState<Partial<FieldMapping>>({
    sourceField: '',
    targetIndicator: '',
    fieldType: 'number',
    transformRule: 'value',
    isRequired: false
  });

  // 可用的数据源
  const dataSources = [
    { id: '1', name: '月度财务报表上传' },
    { id: '2', name: 'ERP系统数据接口' },
    { id: '3', name: '政策新闻抓取' }
  ];

  // 可用的目标指标
  const targetIndicators = [
    { code: 'GROSS_MARGIN', name: '毛利率' },
    { code: 'NET_MARGIN', name: '净利率' },
    { code: 'ROE', name: 'ROE' },
    { code: 'ROA', name: 'ROA' },
    { code: 'ASSET_TURNOVER', name: '资产周转率' },
    { code: 'DEBT_RATIO', name: '资产负债率' },
    { code: 'CURRENT_RATIO', name: '流动比率' }
  ];

  // 获取数据源名称
  const getDataSourceName = (id: string) => {
    return dataSources.find(ds => ds.id === id)?.name || '未知数据源';
  };

  // 获取指标名称
  const getIndicatorName = (code: string) => {
    return targetIndicators.find(ind => ind.code === code)?.name || code;
  };

  // 添加映射
  const handleAddMapping = () => {
    if (!newMapping.sourceField || !newMapping.targetIndicator || !newMapping.dataSourceId) {
      toast.error('请填写完整的映射信息');
      return;
    }

    const mapping: FieldMapping = {
      id: Date.now().toString(),
      dataSourceId: newMapping.dataSourceId!,
      sourceField: newMapping.sourceField,
      targetIndicator: newMapping.targetIndicator,
      fieldType: newMapping.fieldType || 'number',
      transformRule: newMapping.transformRule || 'value',
      isRequired: newMapping.isRequired || false,
      validation: {}
    };

    setMappings(prev => [...prev, mapping]);
    setNewMapping({
      sourceField: '',
      targetIndicator: '',
      fieldType: 'number',
      transformRule: 'value',
      isRequired: false
    });
    toast.success('映射规则添加成功！');
  };

  // 删除映射
  const handleDeleteMapping = (mappingId: string) => {
    if (confirm('确定要删除这个映射规则吗？')) {
      setMappings(prev => prev.filter(m => m.id !== mappingId));
      toast.success('映射规则已删除');
    }
  };

  // 批量保存
  const handleSaveAll = () => {
    toast.success('所有映射规则已保存！');
  };

  return (
    <div className="space-y-6">
      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">字段映射配置</h3>
        <button
          onClick={handleSaveAll}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2"
        >
          <Save className="h-4 w-4" />
          <span>保存所有配置</span>
        </button>
      </div>

      {/* 映射规则列表 */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <h4 className="font-medium text-gray-900">当前映射规则</h4>
        </div>
        
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  数据源
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  源字段
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  映射
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  目标指标
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  转换规则
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  必填
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {mappings.map((mapping) => (
                <tr key={mapping.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {getDataSourceName(mapping.dataSourceId)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <code className="text-sm bg-gray-100 px-2 py-1 rounded text-blue-600">
                      {mapping.sourceField}
                    </code>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <ArrowRight className="h-4 w-4 text-gray-400 mx-auto" />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      <code className="text-sm bg-blue-100 px-2 py-1 rounded text-blue-800">
                        {mapping.targetIndicator}
                      </code>
                      <span className="text-sm text-gray-600">
                        ({getIndicatorName(mapping.targetIndicator)})
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <code className="text-xs bg-yellow-100 px-2 py-1 rounded text-yellow-800">
                      {mapping.transformRule}
                    </code>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className={`inline-flex px-2 py-1 text-xs rounded-full ${
                      mapping.isRequired 
                        ? 'bg-red-100 text-red-800' 
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {mapping.isRequired ? '必填' : '可选'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <button
                      onClick={() => handleDeleteMapping(mapping.id)}
                      className="p-1 text-red-600 hover:text-red-800 transition-colors"
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 添加新映射 */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center space-x-2 mb-4">
          <Plus className="h-5 w-5 text-blue-600" />
          <h4 className="font-medium text-gray-900">添加新映射</h4>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">数据源</label>
            <select
              value={newMapping.dataSourceId || ''}
              onChange={(e) => setNewMapping(prev => ({ ...prev, dataSourceId: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">选择数据源</option>
              {dataSources.map(ds => (
                <option key={ds.id} value={ds.id}>{ds.name}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">源字段</label>
            <input
              type="text"
              value={newMapping.sourceField || ''}
              onChange={(e) => setNewMapping(prev => ({ ...prev, sourceField: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="如: gross_profit_margin"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">目标指标</label>
            <select
              value={newMapping.targetIndicator || ''}
              onChange={(e) => setNewMapping(prev => ({ ...prev, targetIndicator: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">选择目标指标</option>
              {targetIndicators.map(ind => (
                <option key={ind.code} value={ind.code}>{ind.name} ({ind.code})</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">数据类型</label>
            <select
              value={newMapping.fieldType || 'number'}
              onChange={(e) => setNewMapping(prev => ({ ...prev, fieldType: e.target.value as any }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="number">数字</option>
              <option value="text">文本</option>
              <option value="date">日期</option>
              <option value="boolean">布尔值</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">转换规则</label>
            <input
              type="text"
              value={newMapping.transformRule || ''}
              onChange={(e) => setNewMapping(prev => ({ ...prev, transformRule: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="如: value * 100"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">设置</label>
            <div className="flex items-center space-x-2 pt-2">
              <input
                type="checkbox"
                checked={newMapping.isRequired || false}
                onChange={(e) => setNewMapping(prev => ({ ...prev, isRequired: e.target.checked }))}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <span className="text-sm text-gray-700">必填字段</span>
            </div>
          </div>
        </div>
        
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleAddMapping}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
          >
            <Plus className="h-4 w-4" />
            <span>添加映射</span>
          </button>
        </div>
      </div>

      {/* 使用说明 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="text-sm font-medium text-blue-800 mb-2">使用说明</h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• <strong>源字段：</strong>上传文件或数据库中的字段名称</li>
          <li>• <strong>目标指标：</strong>系统内的财务指标代码</li>
          <li>• <strong>转换规则：</strong>数据转换公式，可使用 value 代表原始数值</li>
          <li>• 示例：<code>value * 100</code> 将小数转换为百分比，<code>value / 10000</code> 将元转换为万元</li>
        </ul>
      </div>
    </div>
  );
};

export default FieldMapping;