// App.tsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from '@/contexts/AuthContext';
import Login from '@/components/auth/Login';
import Dashboard from '@/components/dashboard/Dashboard';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import ThemeToggle from '@/components/ThemeToggle'; // 新增主题切换按钮

function App() {
  return (
    <AuthProvider>
      <Router>
        {/* 原: min-h-screen bg-gray-50 */}
        <div className="min-h-screen bg-page text-page">
          {/* 右上角切换按钮 */}
          <ThemeToggle />   {/* 新增这一行 */}
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/dashboard/*"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
          </Routes>

          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: '#363636',
                color: '#fff',
              },
            }}
          />
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
