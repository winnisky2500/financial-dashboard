import React, { useState } from 'react';
import { Bell, Plus, Save, Trash2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

interface AlertRule {
  id: string;
  name: string;
  indicatorId: string;
  companyId?: string;
  thresholdType: 'absolute' | 'percentage_change' | 'target_deviation';
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  thresholdValue: number;
  alertLevel: 'info' | 'warning' | 'critical';
  isActive: boolean;
  notificationMethods: string[];
  description: string;
}

const AlertSettings: React.FC = () => {
  const [alertRules, setAlertRules] = useState<AlertRule[]>([
    {
      id: '1',
      name: '毛利率大幅下降预警',
      indicatorId: 'GROSS_MARGIN',
      thresholdType: 'percentage_change',
      operator: '<',
      thresholdValue: -15,
      alertLevel: 'warning',
      isActive: true,
      notificationMethods: ['email', 'system'],
      description: '当毛利率较上期下降超过15%时预警'
    },
    {
      id: '2',
      name: 'ROE目标偏离预警',
      indicatorId: 'ROE',
      thresholdType: 'target_deviation',
      operator: '<',
      thresholdValue: 85,
      alertLevel: 'info',
      isActive: true,
      notificationMethods: ['system'],
      description: '当ROE目标达成率低于85%时提醒'
    },
    {
      id: '3',
      name: '资产负债率过高预警',
      indicatorId: 'DEBT_RATIO',
      thresholdType: 'absolute',
      operator: '>',
      thresholdValue: 70,
      alertLevel: 'critical',
      isActive: true,
      notificationMethods: ['email', 'sms', 'system'],
      description: '当资产负债率超过70%时紧急预警'
    }
  ]);

  const [newRule, setNewRule] = useState<Partial<AlertRule>>({
    name: '',
    indicatorId: '',
    thresholdType: 'percentage_change',
    operator: '>',
    thresholdValue: 0,
    alertLevel: 'warning',
    isActive: true,
    notificationMethods: ['system'],
    description: ''
  });

  const [showAddForm, setShowAddForm] = useState(false);

  // 指标列表
  const indicators = [
    { code: 'GROSS_MARGIN', name: '毛利率' },
    { code: 'NET_MARGIN', name: '净利率' },
    { code: 'ROE', name: 'ROE' },
    { code: 'ROA', name: 'ROA' },
    { code: 'ASSET_TURNOVER', name: '资产周转率' },
    { code: 'DEBT_RATIO', name: '资产负债率' },
    { code: 'CURRENT_RATIO', name: '流动比率' }
  ];

  // 公司列表
  const companies = [
    { id: 'all', name: '全集团' },
    { id: 'finance', name: '金融子公司' },
    { id: 'port', name: '港口子公司' },
    { id: 'realestate', name: '地产子公司' },
    { id: 'manufacturing', name: '制造子公司' }
  ];

  // 通知方式
  const notificationOptions = [
    { value: 'email', label: '邮件通知' },
    { value: 'sms', label: '短信通知' },
    { value: 'system', label: '系统通知' },
    { value: 'webhook', label: 'Webhook' }
  ];

  // 获取指标名称
  const getIndicatorName = (code: string) => {
    return indicators.find(ind => ind.code === code)?.name || code;
  };

  // 获取阈值类型名称
  const getThresholdTypeName = (type: string) => {
    switch (type) {
      case 'absolute': return '绝对值';
      case 'percentage_change': return '百分比变化';
      case 'target_deviation': return '目标偏离';
      default: return type;
    }
  };

  // 获取预警级别样式
  const getAlertLevelStyle = (level: string) => {
    switch (level) {
      case 'info':
        return 'bg-blue-100 text-blue-800';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800';
      case 'critical':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // 添加预警规则
  const handleAddRule = () => {
    if (!newRule.name || !newRule.indicatorId || newRule.thresholdValue === undefined) {
      toast.error('请填写完整的预警规则信息');
      return;
    }

    const rule: AlertRule = {
      id: Date.now().toString(),
      name: newRule.name,
      indicatorId: newRule.indicatorId,
      companyId: newRule.companyId,
      thresholdType: newRule.thresholdType || 'percentage_change',
      operator: newRule.operator || '>',
      thresholdValue: newRule.thresholdValue,
      alertLevel: newRule.alertLevel || 'warning',
      isActive: newRule.isActive ?? true,
      notificationMethods: newRule.notificationMethods || ['system'],
      description: newRule.description || ''
    };

    setAlertRules(prev => [...prev, rule]);
    setNewRule({
      name: '',
      indicatorId: '',
      thresholdType: 'percentage_change',
      operator: '>',
      thresholdValue: 0,
      alertLevel: 'warning',
      isActive: true,
      notificationMethods: ['system'],
      description: ''
    });
    setShowAddForm(false);
    toast.success('预警规则添加成功！');
  };

  // 删除预警规则
  const handleDeleteRule = (ruleId: string) => {
    if (confirm('确定要删除这个预警规则吗？')) {
      setAlertRules(prev => prev.filter(r => r.id !== ruleId));
      toast.success('预警规则已删除');
    }
  };

  // 切换规则状态
  const toggleRuleStatus = (ruleId: string) => {
    setAlertRules(prev => prev.map(r => 
      r.id === ruleId ? { ...r, isActive: !r.isActive } : r
    ));
  };

  // 保存所有配置
  const handleSaveAll = () => {
    toast.success('所有预警规则已保存！');
  };

  return (
    <div className="space-y-6">
      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">预警规则管理</h3>
        <div className="flex space-x-3">
          <button
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
          >
            <Plus className="h-4 w-4" />
            <span>添加规则</span>
          </button>
          <button
            onClick={handleSaveAll}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2"
          >
            <Save className="h-4 w-4" />
            <span>保存配置</span>
          </button>
        </div>
      </div>

      {/* 预警规则列表 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {alertRules.map((rule) => (
          <div key={rule.id} className={`bg-white border rounded-lg p-6 hover:shadow-md transition-shadow ${
            !rule.isActive ? 'opacity-60' : ''
          }`}>
            {/* 规则标题 */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h4 className="font-medium text-gray-900">{rule.name}</h4>
                <p className="text-sm text-gray-600 mt-1">{rule.description}</p>
              </div>
              <div className="flex items-center space-x-2">
                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                  getAlertLevelStyle(rule.alertLevel)
                }`}>
                  {rule.alertLevel === 'info' ? '信息' :
                   rule.alertLevel === 'warning' ? '警告' : '严重'}
                </span>
                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                  rule.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                }`}>
                  {rule.isActive ? '启用' : '禁用'}
                </span>
              </div>
            </div>

            {/* 规则详情 */}
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex justify-between">
                <span>指标:</span>
                <span className="font-medium">{getIndicatorName(rule.indicatorId)}</span>
              </div>
              <div className="flex justify-between">
                <span>阈值类型:</span>
                <span>{getThresholdTypeName(rule.thresholdType)}</span>
              </div>
              <div className="flex justify-between">
                <span>条件:</span>
                <span className="font-mono font-medium">
                  {rule.operator} {rule.thresholdValue}
                  {rule.thresholdType === 'percentage_change' && '%'}
                  {rule.thresholdType === 'target_deviation' && '%'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>通知方式:</span>
                <div className="flex flex-wrap gap-1">
                  {rule.notificationMethods.map((method, index) => (
                    <span key={index} className="inline-flex px-1 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                      {notificationOptions.find(opt => opt.value === method)?.label || method}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => toggleRuleStatus(rule.id)}
                className={`flex items-center space-x-1 text-xs px-2 py-1 rounded transition-colors ${
                  rule.isActive 
                    ? 'text-gray-600 hover:bg-gray-100' 
                    : 'text-green-600 hover:bg-green-50'
                }`}
              >
                <span>{rule.isActive ? '禁用' : '启用'}</span>
              </button>
              <div className="flex space-x-2">
                <button
                  onClick={() => handleDeleteRule(rule.id)}
                  className="p-1 text-red-600 hover:text-red-800 transition-colors"
                  title="删除"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 添加预警规则表单 */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">添加预警规则</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">规则名称</label>
                <input
                  type="text"
                  value={newRule.name || ''}
                  onChange={(e) => setNewRule(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="输入规则名称"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">目标指标</label>
                <select
                  value={newRule.indicatorId || ''}
                  onChange={(e) => setNewRule(prev => ({ ...prev, indicatorId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">选择指标</option>
                  {indicators.map(ind => (
                    <option key={ind.code} value={ind.code}>{ind.name}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">阈值类型</label>
                <select
                  value={newRule.thresholdType || 'percentage_change'}
                  onChange={(e) => setNewRule(prev => ({ ...prev, thresholdType: e.target.value as any }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="absolute">绝对值</option>
                  <option value="percentage_change">百分比变化</option>
                  <option value="target_deviation">目标偏离</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">比较符</label>
                <select
                  value={newRule.operator || '>'}
                  onChange={(e) => setNewRule(prev => ({ ...prev, operator: e.target.value as any }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value=">">大于 (&gt;)</option>
                  <option value="<">小于 (&lt;)</option>
                  <option value=">=">大于等于 (&gt;=)</option>
                  <option value="<=">小于等于 (&lt;=)</option>
                  <option value="==">等于 (==)</option>
                  <option value="!=">不等于 (!=)</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">阈值</label>
                <input
                  type="number"
                  step="0.01"
                  value={newRule.thresholdValue || 0}
                  onChange={(e) => setNewRule(prev => ({ ...prev, thresholdValue: parseFloat(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="输入阈值"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">预警级别</label>
                <select
                  value={newRule.alertLevel || 'warning'}
                  onChange={(e) => setNewRule(prev => ({ ...prev, alertLevel: e.target.value as any }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="info">信息</option>
                  <option value="warning">警告</option>
                  <option value="critical">严重</option>
                </select>
              </div>
            </div>
            
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">通知方式</label>
              <div className="grid grid-cols-2 gap-2">
                {notificationOptions.map((option) => (
                  <label key={option.value} className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={(newRule.notificationMethods || []).includes(option.value)}
                      onChange={(e) => {
                        const methods = newRule.notificationMethods || [];
                        if (e.target.checked) {
                          setNewRule(prev => ({ 
                            ...prev, 
                            notificationMethods: [...methods, option.value] 
                          }));
                        } else {
                          setNewRule(prev => ({ 
                            ...prev, 
                            notificationMethods: methods.filter(m => m !== option.value) 
                          }));
                        }
                      }}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-700">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
            
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
              <textarea
                value={newRule.description || ''}
                onChange={(e) => setNewRule(prev => ({ ...prev, description: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="输入规则描述"
              />
            </div>
            
            <div className="mt-6 flex items-center justify-end space-x-3">
              <button
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleAddRule}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 说明信息 */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-700 mb-2">阈值类型说明</h4>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• <strong>绝对值：</strong>按指标的具体数值进行判断</li>
          <li>• <strong>百分比变化：</strong>按指标相对上期的变化百分比进行判断</li>
          <li>• <strong>目标偏离：</strong>按指标相对目标值的达成率进行判断</li>
        </ul>
      </div>
    </div>
  );
};

export default AlertSettings;