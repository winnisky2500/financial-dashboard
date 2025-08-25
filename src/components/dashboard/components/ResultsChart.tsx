import React from 'react';
import { Line } from 'react-chartjs-2';
import { BarChart3, TrendingUp } from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface SimulationResult {
  id: string;
  timestamp: Date;
  model: string;
  params: any;
  results: {
    scenarios: Array<{
      name: string;
      values: number[];
      probability?: number;
    }>;
    summary: {
      mean: number;
      median: number;
      standardDeviation: number;
      percentiles: { p5: number; p25: number; p75: number; p95: number };
    };
  };
}

interface ResultsChartProps {
  results: SimulationResult | null;
  isLoading: boolean;
}

const ResultsChart: React.FC<ResultsChartProps> = ({ results, isLoading }) => {
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">正在执行模拟分析...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <BarChart3 className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">选择模型并设置参数</h3>
            <p className="text-gray-600">点击“运行模拟”开始分析</p>
          </div>
        </div>
      </div>
    );
  }

  const months = [
    '1月', '2月', '3月', '4月', '5月', '6月',
    '7月', '8月', '9月', '10月', '11月', '12月'
  ];

  const chartData = {
    labels: months,
    datasets: results.results.scenarios.map((scenario, index) => ({
      label: scenario.name,
      data: scenario.values,
      borderColor: [
        'rgb(34, 197, 94)',  // 乐观 - 绿色
        'rgb(59, 130, 246)',  // 基准 - 蓝色
        'rgb(239, 68, 68)'   // 悲观 - 红色
      ][index],
      backgroundColor: [
        'rgba(34, 197, 94, 0.1)',
        'rgba(59, 130, 246, 0.1)',
        'rgba(239, 68, 68, 0.1)'
      ][index],
      borderWidth: 2,
      fill: true,
      tension: 0.4
    }))
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: '模拟结果对比',
      },
    },
    scales: {
      y: {
        beginAtZero: false,
        title: {
          display: true,
          text: '数值'
        }
      },
      x: {
        title: {
          display: true,
          text: '时间'
        }
      }
    },
  };

  return (
    <div className="space-y-6">
      {/* 主图表 */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">模拟结果</h2>
          <p className="text-sm text-gray-600">模型: {results.model} | 执行时间: {results.timestamp.toLocaleString()}</p>
        </div>
        <div className="h-80">
          <Line data={chartData} options={chartOptions} />
        </div>
      </div>

      {/* 统计摘要 */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">统计摘要</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-gray-900">{results.results.summary.mean.toFixed(2)}</div>
            <div className="text-sm text-gray-600">平均值</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-gray-900">{results.results.summary.median.toFixed(2)}</div>
            <div className="text-sm text-gray-600">中位数</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-gray-900">{results.results.summary.standardDeviation.toFixed(2)}</div>
            <div className="text-sm text-gray-600">标准差</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-gray-900">
              {results.results.summary.percentiles.p95.toFixed(2)}
            </div>
            <div className="text-sm text-gray-600">95%分位数</div>
          </div>
        </div>
      </div>

      {/* 场景概率 */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">场景概率分布</h3>
        <div className="space-y-3">
          {results.results.scenarios.map((scenario, index) => (
            <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-3">
                <div 
                  className="w-4 h-4 rounded-full"
                  style={{ 
                    backgroundColor: [
                      'rgb(34, 197, 94)',
                      'rgb(59, 130, 246)',
                      'rgb(239, 68, 68)'
                    ][index] 
                  }}
                ></div>
                <span className="font-medium text-gray-900">{scenario.name}</span>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium text-gray-900">
                  {scenario.probability ? `${(scenario.probability * 100).toFixed(0)}%` : 'N/A'}
                </div>
                <div className="text-xs text-gray-500">
                  最终值: {scenario.values[scenario.values.length - 1].toFixed(2)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 风险指标 */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">风险指标</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 border border-gray-200 rounded-lg">
            <div className="flex items-center space-x-2 mb-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
              <span className="font-medium text-gray-900">上行风险</span>
            </div>
            <div className="text-2xl font-bold text-green-600">
              {((results.results.summary.percentiles.p95 - results.results.summary.mean) / results.results.summary.mean * 100).toFixed(1)}%
            </div>
            <div className="text-sm text-gray-600">最好情况下的潜在收益</div>
          </div>
          <div className="p-4 border border-gray-200 rounded-lg">
            <div className="flex items-center space-x-2 mb-2">
              <TrendingUp className="h-5 w-5 text-red-500 transform rotate-180" />
              <span className="font-medium text-gray-900">下行风险</span>
            </div>
            <div className="text-2xl font-bold text-red-600">
              {((results.results.summary.mean - results.results.summary.percentiles.p5) / results.results.summary.mean * 100).toFixed(1)}%
            </div>
            <div className="text-sm text-gray-600">最坏情况下的潜在损失</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResultsChart;