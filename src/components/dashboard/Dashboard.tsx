// Dashboard.tsx
import React, { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import Overview from './Overview';
import Simulation from './Simulation';
import Analysis from './Analysis';
import Reports from './Reports';
import Admin from './Admin';
import PolicyDetail from './components/PolicyDetail';
import SimulationV2 from './SimulationV2';
import Budget from './Budget.tsx';

const Dashboard: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    // 原: "h-screen flex bg-gray-50"
    <div className="h-screen flex bg-page text-page">
      {/* 侧边栏 */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* 主内容区域 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部导航栏 */}
        <Header onMenuClick={() => setSidebarOpen(true)} />

        {/* 主内容 */}
        {/* 原: "flex-1 overflow-x-hidden overflow-y-auto bg-gray-50" */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-page text-page">
          <div className="container mx-auto px-6 py-8">
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/overview" element={<Overview />} />
              <Route path="/simulation" element={<Simulation />} />
              <Route path="/simulation2" element={<SimulationV2 />} />
              <Route path="/analysis" element={<Analysis />} />
              <Route path="/budget" element={<Budget />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/policy-detail" element={<PolicyDetail />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
