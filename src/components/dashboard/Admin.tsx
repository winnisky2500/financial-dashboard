import React, { useState } from 'react';
import { Settings, Database, Users, AlertTriangle, BarChart, Shield } from 'lucide-react';
import { isDemoMode } from '@/lib/utils';
import DataSourceManager from './components/DataSourceManager';
import FieldMapping from './components/FieldMapping';
import AlertSettings from './components/AlertSettings';
import UserManagement from './components/UserManagement';
import SystemSettings from './components/SystemSettings';

const Admin: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'datasources' | 'mapping' | 'alerts' | 'users' | 'system'>('datasources');

  // 管理员模块列表
  const adminTabs = [
    {
      id: 'datasources',
      name: '数据源管理',
      icon: Database,
      description: '配置上传模板、数据库API、外部政策接口'
    },
    {
      id: 'mapping',
      name: '字段映射',
      icon: BarChart,
      description: '上传文件/数据库字段与系统指标的映射配置'
    },
    {
      id: 'alerts',
      name: '预警设置',
      icon: AlertTriangle,
      description: '配置指标预警规则和通知方式'
    },
    {
      id: 'users',
      name: '用户管理',
      icon: Users,
      description: '管理系统用户和权限配置'
    },
    {
      id: 'system',
      name: '系统设置',
      icon: Settings,
      description: '系统参数配置和基础设置'
    }
  ];

  // 权限检查（Demo模式下允许访问）
  const hasAdminAccess = () => {
    if (isDemoMode()) return true;
    // 在生产环境中这里需要检查用户权限
    return true;
  };

  if (!hasAdminAccess()) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="text-center py-12">
          <Shield className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">无访问权限</h3>
          <p className="mt-1 text-sm text-gray-500">您没有权限访问数据管理后台，请联系管理员。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">数据管理后台</h1>
            <p className="mt-2 text-gray-600">系统配置和数据源管理</p>
          </div>
          {isDemoMode() && (
            <div className="bg-yellow-100 border border-yellow-300 rounded-lg px-4 py-2">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <span className="text-sm font-medium text-yellow-800">演示模式</span>
              </div>
              <p className="text-xs text-yellow-700 mt-1">
                当前处于演示模式，配置更改仅作演示用途
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 管理模块导航 */}
      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 px-6">
            {adminTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`group inline-flex items-center py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <tab.icon className={`mr-2 h-5 w-5 ${
                  activeTab === tab.id ? 'text-blue-500' : 'text-gray-400 group-hover:text-gray-500'
                }`} />
                {tab.name}
              </button>
            ))}
          </nav>
        </div>

        {/* 模块内容 */}
        <div className="p-6">
          {/* 模块说明 */}
          <div className="mb-6">
            <p className="text-gray-600">
              {adminTabs.find(tab => tab.id === activeTab)?.description}
            </p>
          </div>

          {/* 具体模块内容 */}
          {activeTab === 'datasources' && <DataSourceManager />}
          {activeTab === 'mapping' && <FieldMapping />}
          {activeTab === 'alerts' && <AlertSettings />}
          {activeTab === 'users' && <UserManagement />}
          {activeTab === 'system' && <SystemSettings />}
        </div>
      </div>
    </div>
  );
};

export default Admin;