import React, { useState } from 'react';
import { Save, RefreshCw, Shield, Globe, Clock, Mail } from 'lucide-react';
import { isDemoMode } from '@/lib/utils';
import toast from 'react-hot-toast';

interface SystemSettingsData {
  siteName: string;
  siteDescription: string;
  adminEmail: string;
  sessionTimeout: number;
  maxFileSize: number;
  allowedFileTypes: string[];
  enableNotifications: boolean;
  enableDebugMode: boolean;
  defaultLanguage: string;
  timeZone: string;
  autoBackup: boolean;
  backupFrequency: string;
}

const SystemSettings: React.FC = () => {
  const [settings, setSettings] = useState<SystemSettingsData>({
    siteName: '企业财务分析看板',
    siteDescription: '为集团财务团队构建的综合性财务分析看板',
    adminEmail: 'admin@company.com',
    sessionTimeout: 30,
    maxFileSize: 10,
    allowedFileTypes: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv'],
    enableNotifications: true,
    enableDebugMode: false,
    defaultLanguage: 'zh-CN',
    timeZone: 'Asia/Shanghai',
    autoBackup: true,
    backupFrequency: 'daily'
  });
  
  const [loading, setLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // 更新设置值
  const updateSetting = (key: keyof SystemSettingsData, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  // 保存设置
  const handleSave = async () => {
    setLoading(true);
    try {
      // 在Demo模式下模拟保存
      if (isDemoMode()) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        toast.success('系统设置已保存（演示模式）');
      } else {
        // TODO: 实际保存逻辑
        toast.success('系统设置已保存');
      }
      setHasChanges(false);
    } catch (error) {
      toast.error('保存设置失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 保存操作栏 */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900">系统设置</h3>
        <div className="flex space-x-3">
          <button
            onClick={handleSave}
            disabled={!hasChanges || loading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? (
              <RefreshCw className="w-4 h-4 mr-2 inline animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2 inline" />
            )}
            {loading ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>

      {/* 基础设置 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h4 className="text-md font-medium text-gray-900 mb-4 flex items-center">
          <Globe className="w-5 h-5 mr-2" />
          基础设置
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              网站名称
            </label>
            <input
              type="text"
              value={settings.siteName}
              onChange={(e) => updateSetting('siteName', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              管理员邮箱
            </label>
            <input
              type="email"
              value={settings.adminEmail}
              onChange={(e) => updateSetting('adminEmail', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* 安全设置 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h4 className="text-md font-medium text-gray-900 mb-4 flex items-center">
          <Shield className="w-5 h-5 mr-2" />
          安全设置
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              会话超时时间 (分钟)
            </label>
            <input
              type="number"
              value={settings.sessionTimeout}
              onChange={(e) => updateSetting('sessionTimeout', parseInt(e.target.value))}
              min="5"
              max="120"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              最大文件大小 (MB)
            </label>
            <input
              type="number"
              value={settings.maxFileSize}
              onChange={(e) => updateSetting('maxFileSize', parseInt(e.target.value))}
              min="1"
              max="100"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>
      
      {hasChanges && (
        <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4">
          <p className="text-sm text-yellow-700">
            您有未保存的更改，请记得点击"保存设置"按钮。
          </p>
        </div>
      )}
    </div>
  );
};

export default SystemSettings;
