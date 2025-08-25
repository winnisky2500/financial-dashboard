import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase, getCurrentUser, signIn as supabaseSignIn, signOut as supabaseSignOut, isDemoMode } from '@/lib/supabase';

export interface AuthContextType {
  user: User | any | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<any>;
  signOut: () => Promise<void>;
  isDemoMode: boolean;
  authReady: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | any | null>(null);
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const demoMode = isDemoMode();

  // 匿名登录函数
  const signInAnonymously = async () => {
    try {
      console.log('尝试匿名登录...');
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        console.error('匿名登录错误:', error);
        throw error;
      }
      console.log('匿名登录成功:', data);
      return data;
    } catch (error) {
      console.error('匿名登录异常:', error);
      throw error;
    }
  };
  
  // 初始化时加载用户
  useEffect(() => {
    async function loadUser() {
      setLoading(true);
      setAuthReady(false);
      try {
        if (demoMode) {
          // 在演示模式下，首先检查是否已经有会话
          const { data: { session } } = await supabase.auth.getSession();
          
          if (!session) {
            // 如果没有会话，进行匿名登录
            console.log('演示模式下没有检测到会话，执行匿名登录');
            await signInAnonymously();
            // 等待短暂时间确保会话已建立
            await new Promise(resolve => setTimeout(resolve, 500));
            // 再次获取用户信息
            const { data: { user: anonymousUser } } = await supabase.auth.getUser();
            setUser(anonymousUser);
          } else {
            console.log('演示模式下检测到现有会话');
            setUser(session.user);
          }
        } else {
          // 非演示模式，正常获取用户
          const currentUser = await getCurrentUser();
          setUser(currentUser);
        }
      } catch (error) {
        console.error('加载用户时出错:', error);
      } finally {
        setLoading(false);
        setAuthReady(true);
      }
    }
    loadUser();

    // 设置认证状态监听器 (对所有模式都生效)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        console.log('认证状态变化:', _event, session?.user?.id);
        setUser(session?.user || null);
      }
    );

    return () => subscription.unsubscribe();
  }, [demoMode]);

  // 登录方法
  async function signIn(email: string, password: string) {
    return await supabaseSignIn(email, password);
  }

  // 登出方法
  async function signOut() {
    await supabaseSignOut();
    setUser(null);
  }

  const value = {
    user,
    loading: loading || !authReady,
    signIn,
    signOut,
    isDemoMode: demoMode,
    authReady
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
