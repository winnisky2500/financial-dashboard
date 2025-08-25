import React, { useState } from 'react';
import { Plus, Edit2, Trash2, RefreshCw, CheckCircle, XCircle, Upload } from 'lucide-react';
import { isDemoMode } from '@/lib/utils';
import toast from 'react-hot-toast';

interface DataSource {
  id: string;
  name: string;
  type: 'file_upload' | 'database_api' | 'policy_api' | 'manual_input';
  status: 'active' | 'inactive' | 'error';
  config: any;
  lastSync: Date | null;
  description: string;
  createdBy: string;
}

const DataSourceManager: React.FC = () => {
  const [dataSources, setDataSources] = useState<DataSource[]>([
    {
      id: '1',
      name: '月度财务报表上传',
      type: 'file_upload',
      status: 'active',
      config: {
        allowedFormats: ['xlsx', 'csv'],
        maxFileSize: '10MB',
        autoProcess: true
      },
      lastSync: new Date('2024-08-20'),
      description: '用于上传月度财务数据报表',
      createdBy: 'admin'
    },
    {
      id: '2',
      name: 'ERP系统数据接口',
      type: 'database_api',
      status: 'active',
      config: {
        endpoint: 'https://erp.company.com/api/financial',
        authType: 'api_key',
        syncFrequency: 'daily'
      },
      lastSync: new Date('2024-08-21'),
      description: '与ERP系统对接获取实时财务数据',
      createdBy: 'admin'
    },
    {
      id: '3',
      name: '政策新闻抓取',
      type: 'policy_api',
      status: 'active',
      config: {
        sources: ['中国政府网', '人民日报', '财经新闻'],
        keywords: ['金融政策', '港口政策', '地产政策'],
        updateFrequency: 'hourly'
      },
      lastSync: new Date('2024-08-21'),
      description: '自动抓取相关政策新闻和行业动态',
      createdBy: 'admin'
    }
  ]);
  
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingSource, setEditingSource] = useState<DataSource | null>(null);
  const [newSource, setNewSource] = useState<Partial<DataSource>>({
    name: '',
    type: 'file_upload',
    description: '',
    config: {}
  });

  // 获取数据源类型显示名称
  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'file_upload': return '文件上传';
      case 'database_api': return '数据库API';
      case 'policy_api': return '政策接口';
      case 'manual_input': return '手动录入';
      default: return '未知';
    }
  };

  // 获取状态样式
  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'inactive':
        return 'bg-gray-100 text-gray-800';
      case 'error':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // 手动同步
  const handleSync = async (sourceId: string) => {
    const source = dataSources.find(s => s.id === sourceId);
    if (!source) return;

    toast.success(`正在同步 ${source.name}...`);
    
    // 模拟同步延时
    setTimeout(() => {
      setDataSources(prev => prev.map(s => 
        s.id === sourceId ? { ...s, lastSync: new Date() } : s
      ));
      toast.success('同步完成！');
    }, 2000);
  };

  // 添加数据源
  const handleAddSource = () => {
    if (!newSource.name || !newSource.description) {
      toast.error('请填写完整信息');
      return;
    }

    const source: DataSource = {
      id: Date.now().toString(),
      name: newSource.name,
      type: newSource.type as any,
      status: 'active',
      config: newSource.config || {},
      lastSync: null,
      description: newSource.description,
      createdBy: 'current_user'
    };

    setDataSources(prev => [...prev, source]);
    setNewSource({ name: '', type: 'file_upload', description: '', config: {} });
    setShowAddForm(false);
    toast.success('数据源添加成功！');
  };

  // 删除数据源
  const handleDeleteSource = (sourceId: string) => {
    if (confirm('确定要删除这个数据源吗？')) {
      setDataSources(prev => prev.filter(s => s.id !== sourceId));
      toast.success('数据源已删除');
    }
  };

  // 切换状态
  const toggleStatus = (sourceId: string) => {
    setDataSources(prev => prev.map(s => 
      s.id === sourceId 
        ? { ...s, status: s.status === 'active' ? 'inactive' : 'active' as any }
        : s
    ));
  };

  return (
    <div className="space-y-6">
      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">数据源列表</h3>
        <button
          onClick={() => setShowAddForm(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
        >
          <Plus className="h-4 w-4" />
          <span>添加数据源</span>
        </button>
      </div>

      {/* 数据源列表 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {dataSources.map((source) => (
          <div key={source.id} className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
            {/* 数据源标题 */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h4 className="font-medium text-gray-900">{source.name}</h4>
                <p className="text-sm text-gray-600 mt-1">{source.description}</p>
              </div>
              <div className="flex items-center space-x-2">
                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                  getStatusStyle(source.status)
                }`}>
                  {source.status === 'active' ? '正常' : 
                   source.status === 'inactive' ? '禁用' : '错误'}
                </span>
              </div>
            </div>

            {/* 数据源信息 */}
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex justify-between">
                <span>类型:</span>
                <span>{getTypeLabel(source.type)}</span>
              </div>
              <div className="flex justify-between">
                <span>最后同步:</span>
                <span>{source.lastSync ? source.lastSync.toLocaleString() : '从未同步'}</span>
              </div>
              <div className="flex justify-between">
                <span>创建者:</span>
                <span>{source.createdBy}</span>
              </div>
            </div>

            {/* 配置信息 */}
            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
              <h5 className="text-xs font-medium text-gray-700 mb-2">配置信息</h5>
              <div className="text-xs text-gray-600">
                {Object.entries(source.config).map(([key, value]) => (
                  <div key={key} className="flex justify-between py-1">
                    <span>{key}:</span>
                    <span className="font-mono">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="mt-4 flex items-center justify-between">
              <div className="flex space-x-2">
                <button
                  onClick={() => handleSync(source.id)}
                  className="p-1 text-blue-600 hover:text-blue-800 transition-colors"
                  title="手动同步"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setEditingSource(source)}
                  className="p-1 text-gray-600 hover:text-gray-800 transition-colors"
                  title="编辑"
                >
                  <Edit2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDeleteSource(source.id)}
                  className="p-1 text-red-600 hover:text-red-800 transition-colors"
                  title="删除"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <button
                onClick={() => toggleStatus(source.id)}
                className={`flex items-center space-x-1 text-xs px-2 py-1 rounded transition-colors ${
                  source.status === 'active' 
                    ? 'text-red-600 hover:bg-red-50' 
                    : 'text-green-600 hover:bg-green-50'
                }`}
              >
                {source.status === 'active' ? (
                  <><XCircle className="h-3 w-3" /><span>禁用</span></>
                ) : (
                  <><CheckCircle className="h-3 w-3" /><span>启用</span></>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 添加数据源表单 */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">添加数据源</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">数据源名称</label>
                <input
                  type="text"
                  value={newSource.name || ''}
                  onChange={(e) => setNewSource(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="输入数据源名称"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">数据源类型</label>
                <select
                  value={newSource.type || 'file_upload'}
                  onChange={(e) => setNewSource(prev => ({ ...prev, type: e.target.value as any }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="file_upload">文件上传</option>
                  <option value="database_api">数据库API</option>
                  <option value="policy_api">政策接口</option>
                  <option value="manual_input">手动录入</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <textarea
                  value={newSource.description || ''}
                  onChange={(e) => setNewSource(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  placeholder="输入数据源描述"
                />
              </div>
            </div>
            
            <div className="mt-6 flex items-center justify-end space-x-3">
              <button
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleAddSource}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataSourceManager;