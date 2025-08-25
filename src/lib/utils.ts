import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 格式化数字
export function formatNumber(value: number, decimals: number = 2): string {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

// 格式化百分比
export function formatPercentage(value: number, decimals: number = 2): string {
  return `${formatNumber(value, decimals)}%`;
}

// 格式化货币
export function formatCurrency(value: number, currency: string = 'CNY'): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: currency,
  }).format(value);
}

// 获取趋势方向
export function getTrendDirection(current: number, previous: number): 'up' | 'down' | 'stable' {
  if (current > previous) return 'up';
  if (current < previous) return 'down';
  return 'stable';
}

// 计算同比/环比变化
export function calculateChange(current: number, previous: number): {
  value: number;
  percentage: number;
  direction: 'up' | 'down' | 'stable';
} {
  const value = current - previous;
  const percentage = previous !== 0 ? (value / previous) * 100 : 0;
  const direction = getTrendDirection(current, previous);
  
  return { value, percentage, direction };
}

// Demo模式检查
export function isDemoMode(): boolean {
  return import.meta.env.VITE_DEMO_MODE === 'true';
}