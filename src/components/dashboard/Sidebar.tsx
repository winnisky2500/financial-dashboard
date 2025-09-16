import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { X, BarChart3, TrendingUp, Brain, FileText, Settings, Home, LogOut, FileSpreadsheet } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { isDemoMode } from '@/lib/utils';
import toast from 'react-hot-toast';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const location = useLocation();
  const { signOut, user } = useAuth();

    const navigation = [
    { name: '综合概览', href: '/dashboard/overview', icon: Home },
    { name: '模拟分析', href: '/dashboard/simulation', icon: TrendingUp },
    { name: '模拟分析2', href: '/dashboard/simulation2', icon: TrendingUp },
    { name: '财务分析', href: '/dashboard/analysis', icon: Brain },
    { name: '预算管理', href: '/dashboard/budget', icon: FileSpreadsheet },
    { name: '报告生成', href: '/dashboard/reports', icon: FileText },
    { name: '数据管理', href: '/dashboard/admin', icon: Settings },
  ];


  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success('已成功登出');
    } catch (error) {
      toast.error('登出失败');
    }
  };

  return (
    <>
      {/* 移动端遮罩 */}
      {isOpen && (
        <div className="fixed inset-0 flex z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-gray-600 bg-opacity-75" onClick={onClose}></div>
          <div className="relative flex-1 flex flex-col max-w-xs w-full bg-white">
            <div className="absolute top-0 right-0 -mr-12 pt-2">
              <button
                type="button"
                className="ml-1 flex items-center justify-center h-10 w-10 rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white"
                onClick={onClose}
              >
                <X className="h-6 w-6 text-white" />
              </button>
            </div>
            <SidebarContent navigation={navigation} location={location} onSignOut={handleSignOut} user={user} />
          </div>
        </div>
      )}

      {/* 桌面端侧边栏 */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        <div className="flex flex-col w-64">
          <SidebarContent navigation={navigation} location={location} onSignOut={handleSignOut} user={user} />
        </div>
      </div>
    </>
  );
};

interface SidebarContentProps {
  navigation: Array<{
    name: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
  }>;
  location: any;
  onSignOut: () => void;
  user: any;
}

const SidebarContent: React.FC<SidebarContentProps> = ({ navigation, location, onSignOut, user }) => {
  return (
    <div className="flex flex-col h-0 flex-1 bg-white border-r border-gray-200">
      {/* Logo */}
      <div className="flex-1 flex flex-col pt-5 pb-4 overflow-y-auto">
        <div className="flex items-center flex-shrink-0 px-4">
          <div className="flex items-center">
            <div className="h-8 w-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <BarChart3 className="h-5 w-5 text-white" />
            </div>
            <div className="ml-3">
              <h1 className="text-lg font-semibold text-gray-900">财务分析看板</h1>
              {isDemoMode() && (
                <span className="text-xs text-blue-600 font-medium">演示模式</span>
              )}
            </div>
          </div>
        </div>
        
        {/* 导航菜单 */}
        <nav className="mt-8 flex-1 px-2 space-y-1">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href || (item.href === '/dashboard/overview' && location.pathname === '/dashboard');
            return (
              <Link
                key={item.name}
                to={item.href}
                className={`
                  group flex items-center px-2 py-2 text-sm font-medium rounded-md
                  ${isActive
                    ? 'bg-blue-50 border-r-2 border-blue-600 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }
                `}
              >
                <item.icon
                  className={`mr-3 h-5 w-5 ${
                    isActive ? 'text-blue-500' : 'text-gray-400 group-hover:text-gray-500'
                  }`}
                />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>
      
      {/* 用户信息和登出 */}
      <div className="flex-shrink-0 flex border-t border-gray-200 p-4">
        <div className="flex items-center w-full">
          <div className="flex-shrink-0">
            <div className="h-8 w-8 bg-gray-300 rounded-full flex items-center justify-center">
              <span className="text-sm font-medium text-gray-700">
                {isDemoMode() ? 'D' : (user?.email?.[0]?.toUpperCase() || 'U')}
              </span>
            </div>
          </div>
          <div className="ml-3 flex-1">
            <p className="text-sm font-medium text-gray-700">
              {isDemoMode() ? 'Demo用户' : (user?.email || '用户')}
            </p>
          </div>
          <button
            onClick={onSignOut}
            className="ml-3 flex-shrink-0 p-1 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 transition-colors"
            title="登出"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;