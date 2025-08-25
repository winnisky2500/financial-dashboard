import React from 'react';
import { Filter } from 'lucide-react';

interface AnalysisFilterType {
  company: string;
  indicator: string;
  period: string;
  analysisType: string[];
}

interface AnalysisFilterProps {
  filters: AnalysisFilterType;
  onFiltersChange: (filters: AnalysisFilterType) => void;
}

const AnalysisFilter: React.FC<AnalysisFilterProps> = ({ filters, onFiltersChange }) => {
  const companies = [
    { value: 'all', label: '全集团' },
    { value: 'finance', label: '金融子公司' },
    { value: 'port', label: '港口子公司' },
    { value: 'realestate', label: '地产子公司' },
    { value: 'manufacturing', label: '制造子公司' }
  ];

  const indicators = [
    { value: 'all', label: '所有指标' },
    { value: 'profitability', label: '盈利能力' },
    { value: 'operational', label: '运营能力' },
    { value: 'solvency', label: '偿债能力' },
    { value: 'cashflow', label: '现金流量' }
  ];

  const periods = [
    { value: '2024', label: '2024年' },
    { value: '2023', label: '2023年' },
    { value: 'q4_2024', label: '2024Q4' },
    { value: 'q3_2024', label: '2024Q3' },
    { value: 'ytd_2024', label: '2024年至今' }
  ];

  const analysisTypes = [
    { value: '维度下钻', label: '维度下钻', description: '按子公司、板块等维度分解分析' },
    { value: '指标下钻', label: '指标下钻', description: '按公式拆解分析指标构成' },
    { value: '业务下钻', label: '业务下钻', description: '按业务流程分析指标表现' },
    { value: '异动分析', label: '异动分析', description: '识别和分析指标异常波动' }
  ];

  const updateFilter = (key: keyof AnalysisFilterType, value: string | string[]) => {
    onFiltersChange({
      ...filters,
      [key]: value
    });
  };

  const toggleAnalysisType = (type: string) => {
    const newTypes = filters.analysisType.includes(type)
      ? filters.analysisType.filter(t => t !== type)
      : [...filters.analysisType, type];
    updateFilter('analysisType', newTypes);
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center space-x-2 mb-4">
        <Filter className="h-5 w-5 text-gray-600" />
        <h2 className="text-lg font-semibold text-gray-900">分析配置</h2>
      </div>
      
      <div className="space-y-4">
        {/* 公司选择 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            分析范围
          </label>
          <select
            value={filters.company}
            onChange={(e) => updateFilter('company', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {companies.map((company) => (
              <option key={company.value} value={company.value}>
                {company.label}
              </option>
            ))}
          </select>
        </div>
        
        {/* 指标选择 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            指标类别
          </label>
          <select
            value={filters.indicator}
            onChange={(e) => updateFilter('indicator', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {indicators.map((indicator) => (
              <option key={indicator.value} value={indicator.value}>
                {indicator.label}
              </option>
            ))}
          </select>
        </div>
        
        {/* 时间选择 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            时间范围
          </label>
          <select
            value={filters.period}
            onChange={(e) => updateFilter('period', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {periods.map((period) => (
              <option key={period.value} value={period.value}>
                {period.label}
              </option>
            ))}
          </select>
        </div>
        
        {/* 分析方式 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            分析方式
          </label>
          <div className="space-y-2">
            {analysisTypes.map((type) => (
              <div key={type.value}>
                <label className="flex items-start space-x-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={filters.analysisType.includes(type.value)}
                    onChange={() => toggleAnalysisType(type.value)}
                    className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">
                      {type.label}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {type.description}
                    </div>
                  </div>
                </label>
              </div>
            ))}
          </div>
        </div>
        
        {/* 当前配置摘要 */}
        <div className="bg-gray-50 rounded-lg p-3">
          <h4 className="text-xs font-medium text-gray-700 mb-2">当前配置</h4>
          <div className="text-xs text-gray-600 space-y-1">
            <div>范围: {companies.find(c => c.value === filters.company)?.label}</div>
            <div>指标: {indicators.find(i => i.value === filters.indicator)?.label}</div>
            <div>时间: {periods.find(p => p.value === filters.period)?.label}</div>
            <div>方式: {filters.analysisType.join(', ')}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnalysisFilter;