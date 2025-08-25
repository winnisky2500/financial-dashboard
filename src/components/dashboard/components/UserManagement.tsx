import React, { useState } from 'react';
import { Users, UserPlus, Shield, Mail, Phone, Edit2, Trash2, Key } from 'lucide-react';
import toast from 'react-hot-toast';

interface User {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: 'admin' | 'analyst' | 'viewer';
  permissions: string[];
  status: 'active' | 'inactive' | 'pending';
  lastLogin: Date | null;
  createdAt: Date;
  department: string;
}

const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<User[]>([
    {
      id: '1',
      fullName: '张三',
      email: 'zhang.san@company.com',
      phone: '13812345678',
      role: 'admin',
      permissions: ['all'],
      status: 'active',
      lastLogin: new Date('2024-08-21T09:30:00'),
      createdAt: new Date('2024-01-15'),
      department: '财务部'
    },
    {
      id: '2',
      fullName: '李四',
      email: 'li.si@company.com',
      phone: '13912345678',
      role: 'analyst',
      permissions: ['dashboard_view', 'analysis', 'reports_generate'],
      status: 'active',
      lastLogin: new Date('2024-08-21T08:45:00'),
      createdAt: new Date('2024-02-20'),
      department: '财务部'
    },
    {
      id: '3',
      fullName: '王五',
      email: 'wang.wu@company.com',
      phone: '13712345678',
      role: 'viewer',
      permissions: ['dashboard_view'],
      status: 'active',
      lastLogin: new Date('2024-08-20T16:20:00'),
      createdAt: new Date('2024-03-10'),
      department: '经营部'
    },
    {
      id: '4',
      fullName: '赵六',
      email: 'zhao.liu@company.com',
      phone: '13612345678',
      role: 'analyst',
      permissions: ['dashboard_view', 'analysis'],
      status: 'pending',
      lastLogin: null,
      createdAt: new Date('2024-08-19'),
      department: '财务部'
    }
  ]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newUser, setNewUser] = useState<Partial<User>>({
    fullName: '',
    email: '',
    phone: '',
    role: 'viewer',
    permissions: ['dashboard_view'],
    status: 'pending',
    department: ''
  });

  // 角色定义
  const roles = [
    {
      value: 'admin',
      label: '管理员',
      description: '拥有所有权限，可管理系统配置',
      permissions: ['all']
    },
    {
      value: 'analyst',
      label: '分析师',
      description: '可查看仪表盘、进行分析和生成报告',
      permissions: ['dashboard_view', 'analysis', 'simulation', 'reports_generate']
    },
    {
      value: 'viewer',
      label: '查看者',
      description: '仅可查看仪表盘内容',
      permissions: ['dashboard_view']
    }
  ];

  // 权限定义
  const allPermissions = [
    { value: 'dashboard_view', label: '仪表盘查看' },
    { value: 'analysis', label: '财务分析' },
    { value: 'simulation', label: '模拟分析' },
    { value: 'reports_generate', label: '报告生成' },
    { value: 'admin_access', label: '后台管理' },
    { value: 'user_management', label: '用户管理' },
    { value: 'system_config', label: '系统配置' }
  ];

  // 部门列表
  const departments = [
    '财务部',
    '经营部',
    '投资部',
    '风控部',
    '信息技术部',
    '人力资源部'
  ];

  // 获取角色信息
  const getRoleInfo = (roleValue: string) => {
    return roles.find(role => role.value === roleValue) || roles[2];
  };

  // 获取状态样式
  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'inactive':
        return 'bg-gray-100 text-gray-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // 添加用户
  const handleAddUser = () => {
    if (!newUser.fullName || !newUser.email || !newUser.department) {
      toast.error('请填写完整的用户信息');
      return;
    }

    const roleInfo = getRoleInfo(newUser.role || 'viewer');
    const user: User = {
      id: Date.now().toString(),
      fullName: newUser.fullName,
      email: newUser.email,
      phone: newUser.phone || '',
      role: newUser.role as any,
      permissions: roleInfo.permissions,
      status: 'pending',
      lastLogin: null,
      createdAt: new Date(),
      department: newUser.department
    };

    setUsers(prev => [...prev, user]);
    setNewUser({
      fullName: '',
      email: '',
      phone: '',
      role: 'viewer',
      permissions: ['dashboard_view'],
      status: 'pending',
      department: ''
    });
    setShowAddForm(false);
    toast.success('用户添加成功！邀请邮件已发送。');
  };

  // 删除用户
  const handleDeleteUser = (userId: string) => {
    if (confirm('确定要删除这个用户吗？该操作不可恢复。')) {
      setUsers(prev => prev.filter(u => u.id !== userId));
      toast.success('用户已删除');
    }
  };

  // 切换用户状态
  const toggleUserStatus = (userId: string) => {
    setUsers(prev => prev.map(u => 
      u.id === userId 
        ? { ...u, status: u.status === 'active' ? 'inactive' : 'active' as any }
        : u
    ));
  };

  // 重置密码
  const handleResetPassword = (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (user && confirm(`确定要重置 ${user.fullName} 的密码吗？新密码将通过邮件发送。`)) {
      toast.success('密码重置邮件已发送！');
    }
  };

  return (
    <div className="space-y-6">
      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">用户管理</h3>
        <button
          onClick={() => setShowAddForm(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
        >
          <UserPlus className="h-4 w-4" />
          <span>添加用户</span>
        </button>
      </div>

      {/* 用户统计 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-blue-50 rounded-lg p-4">
          <div className="flex items-center space-x-2">
            <Users className="h-5 w-5 text-blue-600" />
            <span className="text-sm font-medium text-blue-800">总用户数</span>
          </div>
          <div className="text-2xl font-bold text-blue-900 mt-1">{users.length}</div>
        </div>
        <div className="bg-green-50 rounded-lg p-4">
          <div className="text-sm font-medium text-green-800">活跃用户</div>
          <div className="text-2xl font-bold text-green-900 mt-1">
            {users.filter(u => u.status === 'active').length}
          </div>
        </div>
        <div className="bg-yellow-50 rounded-lg p-4">
          <div className="text-sm font-medium text-yellow-800">待激活</div>
          <div className="text-2xl font-bold text-yellow-900 mt-1">
            {users.filter(u => u.status === 'pending').length}
          </div>
        </div>
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="text-sm font-medium text-gray-800">管理员</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {users.filter(u => u.role === 'admin').length}
          </div>
        </div>
      </div>

      {/* 用户列表 */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  用户信息
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  部门
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  角色
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  状态
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  最后登录
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10">
                        <div className="h-10 w-10 rounded-full bg-gray-300 flex items-center justify-center">
                          <span className="text-sm font-medium text-gray-700">
                            {user.fullName.charAt(0)}
                          </span>
                        </div>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">{user.fullName}</div>
                        <div className="text-sm text-gray-500 flex items-center space-x-3">
                          <span className="flex items-center space-x-1">
                            <Mail className="h-3 w-3" />
                            <span>{user.email}</span>
                          </span>
                          {user.phone && (
                            <span className="flex items-center space-x-1">
                              <Phone className="h-3 w-3" />
                              <span>{user.phone}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {user.department}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      <Shield className="h-4 w-4 text-gray-400" />
                      <span className="text-sm text-gray-900">
                        {getRoleInfo(user.role).label}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                      getStatusStyle(user.status)
                    }`}>
                      {user.status === 'active' ? '正常' :
                       user.status === 'inactive' ? '禁用' : '待激活'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {user.lastLogin ? user.lastLogin.toLocaleString() : '从未登录'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <div className="flex items-center justify-center space-x-2">
                      <button
                        onClick={() => setEditingUser(user)}
                        className="p-1 text-blue-600 hover:text-blue-800 transition-colors"
                        title="编辑"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleResetPassword(user.id)}
                        className="p-1 text-yellow-600 hover:text-yellow-800 transition-colors"
                        title="重置密码"
                      >
                        <Key className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => toggleUserStatus(user.id)}
                        className={`p-1 transition-colors ${
                          user.status === 'active' 
                            ? 'text-red-600 hover:text-red-800' 
                            : 'text-green-600 hover:text-green-800'
                        }`}
                        title={user.status === 'active' ? '禁用' : '启用'}
                      >
                        <Shield className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        className="p-1 text-red-600 hover:text-red-800 transition-colors"
                        title="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 添加用户表单 */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">添加新用户</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">姓名</label>
                <input
                  type="text"
                  value={newUser.fullName || ''}
                  onChange={(e) => setNewUser(prev => ({ ...prev, fullName: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="输入用户姓名"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">邮箱</label>
                <input
                  type="email"
                  value={newUser.email || ''}
                  onChange={(e) => setNewUser(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="输入邮箱地址"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">手机号</label>
                <input
                  type="tel"
                  value={newUser.phone || ''}
                  onChange={(e) => setNewUser(prev => ({ ...prev, phone: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="输入手机号码"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">部门</label>
                <select
                  value={newUser.department || ''}
                  onChange={(e) => setNewUser(prev => ({ ...prev, department: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">选择部门</option>
                  {departments.map(dept => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>
              
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">角色</label>
                <div className="space-y-2">
                  {roles.map((role) => (
                    <label key={role.value} className="flex items-start space-x-3 cursor-pointer">
                      <input
                        type="radio"
                        name="role"
                        value={role.value}
                        checked={newUser.role === role.value}
                        onChange={(e) => setNewUser(prev => ({ ...prev, role: e.target.value as any }))}
                        className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                      />
                      <div>
                        <div className="font-medium text-gray-900">{role.label}</div>
                        <div className="text-sm text-gray-600">{role.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
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
                onClick={handleAddUser}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                添加用户
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;