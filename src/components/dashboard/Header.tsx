import React from 'react';
import { Menu, Bell, Search } from 'lucide-react';
import { isDemoMode } from '@/lib/utils';

interface HeaderProps {
  onMenuClick: () => void;
}

const Header: React.FC<HeaderProps> = ({ onMenuClick }) => {
  return (
    <div className="relative z-10 flex-shrink-0 flex h-16 bg-white border-b border-gray-200">
      {/* 移动端菜单按钮 */}
      <button
        type="button"
        className="px-4 border-r border-gray-200 text-gray-500 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 lg:hidden"
        onClick={onMenuClick}
      >
        <Menu className="h-6 w-6" />
      </button>
      
      {/* 顶部内容 */}
      <div className="flex-1 px-4 flex justify-between items-center">
        {/* 搜索框
        <div className="flex-1 flex items-center justify-center px-2 lg:ml-6 lg:justify-start">
          <div className="max-w-lg w-full lg:max-w-xs">
            <label htmlFor="search" className="sr-only">搜索</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <input
                id="search"
                name="search"
                className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="搜索指标、公司或政策..."
                type="search"
              />
            </div>
          </div>
        </div> */}
        
        {/* 右侧操作 */}
        <div className="ml-4 flex items-center md:ml-6">
          {/* 通知 */}
          <button
            type="button"
            className="bg-white p-1 rounded-full text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <Bell className="h-6 w-6" />
          </button>
          
          {/* 时间信息 */}
          <div className="ml-4 text-sm text-gray-500">
            {new Date().toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              weekday: 'long'
            })}
          </div>
          
          {isDemoMode() && (
            <div className="ml-4 px-3 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
              演示模式
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Header;