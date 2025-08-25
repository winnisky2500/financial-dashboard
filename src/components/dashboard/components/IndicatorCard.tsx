import React, { useState } from 'react';
import { Eye, HelpCircle, TrendingUp, TrendingDown } from 'lucide-react';
import { calculateChange, formatPercentage } from '@/lib/utils';

type AnyIndicator = {
  id: string;
  name: string;
  code: string;
  value: number;
  previousValue?: number;
  lastYearValue?: number;
  baselineTarget?: number;             // 目标值
  unit?: string;
  category?: string;
  companyName?: string;
  recommendedQuestions?: string[];     // 兼容旧数据
  questions?: string[];
};

interface IndicatorCardProps {
  indicator: AnyIndicator;
  onQuestionClick?: (question?: string) => void;
  /** 为了显示“动态分析问题”的文案 */
  period?: string;
  companyForQuestion?: string;
}

/** 数值显示：|x|>10000 千分位取整；|x|<1 保留4位；其他2位 */
const formatNumber = (v: number | null | undefined) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '';
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs > 10000) return Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(Math.round(n));
  if (abs < 1) return n.toFixed(4);
  return n.toFixed(2);
};

const IndicatorCard: React.FC<IndicatorCardProps> = ({ indicator, onQuestionClick, period, companyForQuestion }) => {
  const [showDetails, setShowDetails] = useState(false);
  const [showQuestions, setShowQuestions] = useState(false);

  const { value, previousValue, baselineTarget, unit } = indicator;

  // 变化（上红下绿）
  const change = previousValue !== undefined ? calculateChange(value, previousValue) : { valueDiff: 0, percentage: 0 };
  const isUp = (change?.percentage ?? 0) >= 0;
  const trendColor = isUp ? 'text-red-600' : 'text-green-600';
  const TrendIcon = isUp ? TrendingUp : TrendingDown;

  // 目标达成
  const hasTarget = typeof baselineTarget === 'number' && baselineTarget !== 0;
  const targetProgress = hasTarget ? (value / (baselineTarget as number)) * 100 : null;

  // 动态问题文案（优先显示）
  const dynamicQuestion =
    companyForQuestion && period ? `分析一下 ${companyForQuestion} ${period} ${indicator.name} 的变动原因` : undefined;

  // 兼容：如果没有 period/company，则回退到内置的推荐问题
  const questions = dynamicQuestion ? [dynamicQuestion] : (indicator.recommendedQuestions ?? indicator.questions ?? []);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow transition-shadow">
      {/* 标题行 */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-gray-500 mb-1">{indicator.category || ''}</div>
          <h3 className="text-base font-semibold text-gray-900">{indicator.name}</h3>
        </div>
        <div className="flex items-center space-x-2">
          <button className="text-gray-400 hover:text-gray-600" onClick={() => setShowDetails(v => !v)} title={showDetails ? '收起明细' : '查看明细'}>
            <Eye className="w-4 h-4" />
          </button>
          <button className="text-gray-400 hover:text-gray-600" onClick={() => setShowQuestions(v => !v)} title={showQuestions ? '收起问题' : '查看推荐问题'}>
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 当前值 */}
      <div className="mt-3 text-2xl font-semibold text-gray-900">
        {formatNumber(value)}{unit}
      </div>

      {/* 环比涨跌（涨红跌绿） */}
      {previousValue !== undefined && (
        <div className="mt-2 flex items-center text-sm">
          <TrendIcon className={`w-4 h-4 mr-1 ${trendColor}`} />
          <span className={`${trendColor} mr-1`}>{formatPercentage(change.percentage)}</span>
          <span className="text-gray-500">较上期</span>
        </div>
      )}

      {/* 目标进度 */}
      <div className="mt-4">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>目标达成</span>
          <span>{targetProgress === null ? '—' : formatPercentage(targetProgress)}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-300 ${
              targetProgress === null ? 'bg-gray-300' : targetProgress >= 100 ? 'bg-green-500' : targetProgress >= 90 ? 'bg-yellow-500' : 'bg-red-500'
            }`}
            style={{ width: `${targetProgress === null ? 0 : Math.min(targetProgress, 100)}%` }}
          />
        </div>
        <div className="text-xs text-gray-500 mt-1">
          目标: {baselineTarget != null ? formatNumber(baselineTarget) : '—'}{unit}
        </div>
      </div>

      {/* 明细 */}
      {showDetails && (
        <div className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">当前值:</span>
            <span className="text-gray-900">{formatNumber(value)}{unit}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">上期值:</span>
            <span className="text-gray-900">
              {previousValue !== undefined ? (<>{formatNumber(previousValue)}{unit ?? ''}</>) : '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">目标值:</span>
            <span className="text-gray-900">
              {baselineTarget != null ? (<>{formatNumber(baselineTarget)}{unit ?? ''}</>) : '—'}
            </span>
          </div>
          {previousValue !== undefined && (
            <div className="flex justify-between">
              <span className="text-gray-500">变化幅度:</span>
              <span className={`${trendColor}`}>{formatPercentage(change.percentage)}</span>
            </div>
          )}
        </div>
      )}

      {/* 推荐/动态问题 */}
      {showQuestions && questions.length > 0 && (
        <div className="border-t border-gray-200 pt-3 mt-3">
          <p className="text-xs text-gray-500 mb-2">点击问题可跳转至财务分析：</p>
          <div className="space-y-1">
            {questions.map((q, idx) => (
              <button
                key={idx}
                onClick={() => onQuestionClick?.(/* 不传入旧 q，父组件统一构造动态问题 */)}
                className="block w-full text-left text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 p-1 rounded transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default IndicatorCard;
