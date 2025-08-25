import React, { useState, useEffect, useRef } from 'react';
import {
  runEnhancedARIMAAnalysis,
  runEnhancedMonteCarloSimulation,
  executeCustomPythonFunction,
  exportToCSV,
  generatePDFReport,
  uploadPythonFile,
  downloadFile,
  SimulationResult,
  EnhancedARIMAParams,
  EnhancedMonteCarloParams,
  CustomPythonParams,
  fetchMetricTimeSeries,          // +++
  listCompaniesFromMetrics,       // +++
  listCanonicalMetrics      
} from '@/lib/dataService';
import toast from 'react-hot-toast';
import { Line } from 'react-chartjs-2';
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
import { 
  Play, 
  Upload, 
  Download, 
  FileText,
  Settings,
  TrendingUp,
  BarChart3,
  Brain,
  Code,
  Sliders,
  Target,
  Activity,
  Zap,
  Database,
  DollarSign,
  Percent,
  RotateCcw,
  Banknote
} from 'lucide-react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

type ModelType = 'arima' | 'montecarlo' | 'python';

type AnalysisTarget = '利润总额' | '毛利率' | 'ROE' | '总资产周转率' | '经营活动现金流净额';

interface CustomParameter {
  id: string;
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
}

interface AnalysisTargetConfig {
  name: AnalysisTarget;
  icon: any;
  description: string;
  unit: string;
  sampleData: number[];
  color: string;
}

const Simulation: React.FC = () => {
  // 状态管理
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelType>('arima');
  const [selectedTarget, setSelectedTarget] = useState<AnalysisTarget>('利润总额');
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // 公司 & 指标下拉
  const [companies, setCompanies] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string>('XX集团公司');
  const [selectedCanonical, setSelectedCanonical] = useState<string>('利润总额'); // 与表里 canonical_name 对齐
  const [currentUnit, setCurrentUnit] = useState<string>(''); // 用于纵轴单位动态展示
  const [seriesLabels, setSeriesLabels] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const cs = await listCompaniesFromMetrics();
      setCompanies(cs);
      // 默认按当前公司过滤指标；如果你想全量，就去掉参数
      const ms = await listCanonicalMetrics(selectedCompany);
      setMetrics(ms);
    })();
  }, []);


  // 分析对象配置
  const analysisTargets: AnalysisTargetConfig[] = [
    {
      name: '利润总额',
      icon: DollarSign,
      description: '企业主营业务收入分析',
      unit: '万元',
      sampleData: [10000, 10500, 11200, 11800, 12500, 13200, 12800, 13500, 14200, 13800, 14500, 15200],
      color: '#3B82F6'
    },
    {
      name: '毛利率',
      icon: TrendingUp,
      description: '企业毛利率变化趋势',
      unit: '万元',
      sampleData: [1200, 1350, 1180, 1420, 1650, 1580, 1380, 1720, 1890, 1760, 1950, 2100],
      color: '#10B981'
    },
    {
      name: 'ROE',
      icon: Percent,
      description: '股东权益收益率分析',
      unit: '%',
      sampleData: [12.5, 13.2, 11.8, 14.1, 15.3, 14.7, 12.9, 15.8, 16.2, 15.4, 16.8, 17.5],
      color: '#8B5CF6'
    },
    {
      name: '总资产周转率',
      icon: RotateCcw,
      description: '资产运营效率指标',
      unit: '次',
      sampleData: [0.85, 0.88, 0.82, 0.91, 0.94, 0.89, 0.86, 0.96, 0.99, 0.92, 1.02, 1.05],
      color: '#F59E0B'
    },
    {
      name: '经营活动现金流净额',
      icon: Banknote,
      description: '经营活动现金流量',
      unit: '万元',
      sampleData: [8500, 9200, 8800, 9600, 10200, 9800, 9100, 10800, 11500, 10900, 11800, 12200],
      color: '#EF4444'
    }
  ];
  
  // 获取当前分析目标的配置
  const getCurrentTarget = () => {
    // 1) 先看 canonical 是否是 5 张卡片之一
    const byCanonical = analysisTargets.find(t => t.name === selectedCanonical);
    if (byCanonical) return byCanonical;

    // 2) 其次兼容老逻辑（点卡片）
    const byTarget = analysisTargets.find(t => t.name === selectedTarget);
    if (byTarget) return byTarget;

    // 3) 都不匹配时给一个兜底颜色与单位（单位用 currentUnit）
    return {
      name: '自定义' as any,
      icon: () => null,
      description: '',
      unit: currentUnit || '',
      sampleData: [],
      color: '#2563EB'
    };
  };

  
  // 通用参数
  const [exchangeRateChange, setExchangeRateChange] = useState<number>(0);
  const [interestRateChange, setInterestRateChange] = useState<number>(0);
  const [customParameters, setCustomParameters] = useState<CustomParameter[]>([]);
  
  // ARIMA参数
  const [arimaParams, setArimaParams] = useState({
    historicalData: getCurrentTarget().sampleData,
    periods: 12,
    p: 1,
    d: 1,
    q: 1
  });
  
  // // 当分析目标改变时，更新历史数据
  // useEffect(() => {
  //   // 只有当卡片的名字与当前 canonical 一致时，才用内置 sampleData 做占位
  //   if (selectedTarget !== selectedCanonical) return;

  //   const currentTarget = getCurrentTarget();
  //   setArimaParams(prev => ({
  //     ...prev,
  //     historicalData: currentTarget.sampleData
  //   }));
  //   setInputData(currentTarget.sampleData);
  // }, [selectedTarget, selectedCanonical]);

  useEffect(() => {
  (async () => {
    if (!selectedCompany || !selectedCanonical) return;
      const series = await fetchMetricTimeSeries({
      companyName: selectedCompany,
      metricName: selectedCanonical,
      maxPoints: 24,
    });
    setArimaParams(prev => ({ ...prev, historicalData: series.values }));
    setInputData(series.values);
    setCurrentUnit('');
    setSeriesLabels(series.labels || []);

    // —— 关键：Monte Carlo 以 Supabase 最新值作为初始值，并可用历史估算 drift/vol —— //
    if (series.values?.length) {
      const last = series.values[series.values.length - 1];

      // 用相邻对数收益估算 μ/σ（可留着，或只设置 initialValue）
      let estMu = monteCarloParams.drift;
      let estSigma = monteCarloParams.volatility;
      if (series.values.length >= 3) {
        const rets: number[] = [];
        for (let i = 1; i < series.values.length; i++) {
          const r = Math.log(series.values[i] / series.values[i - 1]);
          if (isFinite(r)) rets.push(r);
        }
        if (rets.length) {
          const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
          const variance = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / rets.length;
          const std = Math.sqrt(Math.max(variance, 0));
          estMu = mean;         // 期望对数收益 ~ 漂移
          estSigma = std;       // 对数收益标准差 ~ 波动
        }
      }

      setMonteCarloParams(prev => ({
        ...prev,
        initialValue: last,
        drift: estMu,
        volatility: estSigma,
      }));
    }



  })();
}, [selectedCompany, selectedCanonical]);

  // 蒙特卡洛参数
  const [monteCarloParams, setMonteCarloParams] = useState({
    initialValue: 100,
    numSimulations: 1000,
    timeHorizon: 12,
    drift: 0.05,
    volatility: 0.15,
    modelType: 'geometric_brownian' as const
  });
  
  // Python代码参数
  const [pythonCode, setPythonCode] = useState(`# 示例：简单的预测函数
def predict(input_data, parameters={}):
    """
    自定义预测函数
    参数:
    - input_data: 列表，历史数据
    - parameters: 字典，额外参数
    返回: 列表，预测结果
    """
    import numpy as np
    
    # 计算基础统计
    mean_value = np.mean(input_data)
    trend = (input_data[-1] - input_data[0]) / len(input_data)
    
    # 生成预测
    periods = parameters.get('periods', 12)
    predictions = []
    
    for i in range(periods):
        # 线性趋势 + 随机扰动
        value = input_data[-1] + trend * (i + 1)
        # 添加一些随机性
        value += (np.random.random() - 0.5) * mean_value * 0.1
        predictions.append(max(0, value))
    
    return predictions`);
  
  const [inputData, setInputData] = useState([100, 105, 110, 118, 125, 132, 128, 135, 142, 138, 145, 152]);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  
  // 添加自定义参数
  const addCustomParameter = () => {
    const newParam: CustomParameter = {
      id: Date.now().toString(),
      name: `参数${customParameters.length + 1}`,
      value: 0,
      min: -1,
      max: 1,
      step: 0.01
    };
    setCustomParameters([...customParameters, newParam]);
  };
  
  // 删除自定义参数
  const removeCustomParameter = (id: string) => {
    setCustomParameters(customParameters.filter(param => param.id !== id));
  };
  
  // 更新自定义参数
  const updateCustomParameter = (id: string, updates: Partial<CustomParameter>) => {
    setCustomParameters(customParameters.map(param => 
      param.id === id ? { ...param, ...updates } : param
    ));
  };
  
  // 文件上传处理
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (file.type === 'text/x-python' || file.name.endsWith('.py')) {
      setUploadedFile(file);
      // 读取文件内容
      const reader = new FileReader();
      reader.onload = (e) => {
        setPythonCode(e.target?.result as string);
      };
      reader.readAsText(file);
      toast.success(`已上传文件: ${file.name}`);
    } else {
      toast.error('请上传.py文件');
    }
  };
  
  // 运行模拟
  const runSimulation = async () => {
    setLoading(true);
    try {
      let result: SimulationResult;
      
      const customParamsObject = customParameters.reduce((acc, param) => {
        acc[param.name] = param.value;
        return acc;
      }, {} as { [key: string]: number });
      
      switch (selectedModel) {
        case 'arima':
          const arimaRequestParams: EnhancedARIMAParams = {
            ...arimaParams,
            exchangeRateChange: exchangeRateChange / 100,
            interestRateChange: interestRateChange / 100,
            customParams: customParamsObject
          };
          result = await runEnhancedARIMAAnalysis(arimaRequestParams);
          break;
          
        case 'montecarlo':
          const monteCarloRequestParams: EnhancedMonteCarloParams = {
            ...monteCarloParams,
            exchangeRateChange: exchangeRateChange / 100,
            interestRateChange: interestRateChange / 100,
            customParams: customParamsObject
          };
          result = await runEnhancedMonteCarloSimulation(monteCarloRequestParams);
          break;
          
        case 'python':
          const pythonRequestParams: CustomPythonParams = {
            pythonCode,
            inputData,
            parameters: {
              periods: 12,
              exchangeRate: exchangeRateChange / 100,
              interestRate: interestRateChange / 100,
              ...customParamsObject
            }
          };
          result = await executeCustomPythonFunction(pythonRequestParams);
          break;
          
        default:
          throw new Error('无效的模型类型');
      }
      
      setSimulationResult(result);
      toast.success('模拟分析完成!');
    } catch (error: any) {
      console.error('模拟分析失败:', error);
      toast.error(error.message || '模拟分析失败');
    } finally {
      setLoading(false);
    }
  };
  
  // 导出CSV
  const handleExportCSV = async () => {
    if (!simulationResult) return;
    
    try {
      const exportData = {
        simulationData: simulationResult.data,
        metadata: {
          analysisType: selectedModel.toUpperCase(),
          parameters: selectedModel === 'arima' ? arimaParams : 
                     selectedModel === 'montecarlo' ? monteCarloParams : 
                     { pythonCode: pythonCode.substring(0, 100) + '...' },
          timestamp: new Date().toISOString()
        }
      };
      
      const blob = await exportToCSV(exportData);
      downloadFile(blob, `模拟分析_${selectedModel}_${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success('CSV导出成功!');
    } catch (error: any) {
      toast.error(error.message || 'CSV导出失败');
    }
  };
  
  // 生成PDF报告
  const handleGeneratePDF = async () => {
    if (!simulationResult) return;
    
    try {
      const exportData = {
        simulationData: simulationResult.data,
        metadata: {
          analysisType: selectedModel.toUpperCase(),
          parameters: selectedModel === 'arima' ? arimaParams : 
                     selectedModel === 'montecarlo' ? monteCarloParams : 
                     { pythonCode: pythonCode.substring(0, 200) + '...' },
          timestamp: new Date().toISOString()
        },
        chartImages: [] // TODO: 在实际应用中可以捕获图表内容
      };
      
      const reportData = await generatePDFReport(exportData);
      
      // 创建Markdown文件下载
      const blob = new Blob([reportData.reportContent], { type: 'text/markdown' });
      downloadFile(blob, reportData.fileName.replace('.pdf', '.md'));
      
      toast.success('PDF报告生成成功!（已导出Markdown格式）');
    } catch (error: any) {
      toast.error(error.message || 'PDF报告生成失败');
    }
  };
  
  const extendQuarterLabels = (histLabels: string[], futureLen: number) => {
  const out = [...histLabels];
  const last = histLabels[histLabels.length - 1] || '2024Q1';
  // 支持 "2024Q1" / "2024年Q1" / "2024 年 Q1" 等
  const m = last.match(/(\d{4})\D*([1-4])/);
  let y = m ? parseInt(m[1], 10) : 2024;
  let q = m ? parseInt(m[2], 10) : 1;
  for (let i = 0; i < futureLen; i++) {
    q++;
    if (q > 4) { q = 1; y++; }
    out.push(`${y}年Q${q}`);
  }
  return out;
};

  // 准备图表数据
  const prepareChartData = () => {
    if (!simulationResult) return null;
    
    const currentTarget = getCurrentTarget();
    const { data } = simulationResult;
    
    if (selectedModel === 'arima' && data.predictions) {
  const hist = arimaParams.historicalData || [];
  const pred = data.predictions || [];
  // ARIMA 图表 labels：历史 + 未来季度外推
  const histLabels = (seriesLabels && seriesLabels.length === hist.length)
    ? seriesLabels
    : hist.map((_, i) => `历史${i + 1}`);
  const labels = extendQuarterLabels(histLabels, pred.length); // ← 关键


  const datasets: any[] = [
    // 历史数据（实线）
    {
      label: `${selectedCanonical}（历史）`,
      data: [...hist, ...Array(pred.length).fill(null)],
      borderColor: currentTarget.color,
      backgroundColor: `${currentTarget.color}20`,
      tension: 0.4,
      borderWidth: 3,
      pointRadius: 3
    },
    // 预测数据（虚线，从最后一个历史点连过去）
    {
      label: `${selectedCanonical}（预测）`,
      data: [...Array(Math.max(hist.length - 1, 0)).fill(null), hist[hist.length - 1], ...pred],
      borderColor: currentTarget.color,
      backgroundColor: 'transparent',
      borderDash: [6, 6],
      tension: 0.4,
      borderWidth: 3,
      pointRadius: 3
    }
  ];

    // 置信区间（可选）
    if (data.confidenceIntervals) {
      const padNulls = (arr: number[]) => [...Array(hist.length).fill(null), ...arr];
      datasets.push({
        label: '95%置信上界',
        data: padNulls(data.confidenceIntervals.upper95 || []),
        borderColor: `${currentTarget.color}80`,
        backgroundColor: 'transparent',
        borderDash: [4, 4],
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0
      });
      datasets.push({
        label: '95%置信下界',
        data: padNulls(data.confidenceIntervals.lower95 || []),
        borderColor: `${currentTarget.color}80`,
        backgroundColor: 'transparent',
        borderDash: [4, 4],
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0
      });
    }

    return { labels, datasets };

    } else if ((selectedModel === 'montecarlo' || selectedModel === 'python') && data.percentilePaths) {
  const hist = arimaParams.historicalData || []; // 真实历史序列
  const anyPath = Object.values(data.percentilePaths)[0] as number[] | undefined;
  const rawLen = anyPath?.length || 0;
  const futureLen = rawLen > 1 ? rawLen - 1 : rawLen;

  // 统一时间轴：历史标签 + 未来季度外推
  const labels = extendQuarterLabels(seriesLabels, futureLen);

  // 让预测从最后一个历史点接上：前置 null，再接 t0，再接后续
  const padForecast = (arr: number[]) => [
    ...Array(Math.max(hist.length - 1, 0)).fill(null),
    ...(arr.length > 0 ? arr : []), // Edge 函数/兜底里 pXX 都含 t0
  ];

  const datasets: any[] = [];

  // 1) 历史实线（叠加）
  const currentTarget = getCurrentTarget();
  datasets.push({
    label: `${selectedCanonical}（历史）`,
    data: [...hist, ...Array(futureLen).fill(null)],
    borderColor: currentTarget.color,
    backgroundColor: `${currentTarget.color}20`,
    tension: 0.4,
    borderWidth: 3,
    pointRadius: 3
  });

  // 2) 预测分位数（全部虚线；中位数加粗）
  const colors = {
    p5: '#EF4444',
    p25: '#F97316',
    p50: currentTarget.color,
    p75: '#10B981',
    p95: '#8B5CF6'
  } as const;
  const labels_cn = {
    p5: '5%分位数（预测）',
    p25: '25%分位数（预测）',
    p50: `中位数(50%) - ${getCurrentTarget().name}（预测）`,
    p75: '75%分位数（预测）',
    p95: '95%分位数（预测）'
  } as const;

  (Object.entries(data.percentilePaths) as [keyof typeof colors, number[]][])
    .forEach(([key, path]) => {
      const isMedian = key === 'p50';
      datasets.push({
        label: labels_cn[key] || String(key),
        data: padForecast(path || []),
        borderColor: colors[key] || '#666',
        backgroundColor: 'transparent',
        borderDash: [6, 6],           // ← 预测虚线
        tension: 0.4,
        borderWidth: isMedian ? 4 : 2,
        pointRadius: isMedian ? 4 : 2,
        pointBackgroundColor: colors[key],
        pointBorderColor: '#FFFFFF',
        pointBorderWidth: isMedian ? 2 : 1
      });
    });

  return { labels, datasets };
}

    
    return null;
  };
  
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          color: '#1F2937',
          font: {
            size: 12,
            weight: 500
          },
          padding: 20,
          usePointStyle: true
        }
      },
      title: {
        display: true,
        text: `${selectedModel.toUpperCase()}模拟结果 - ${selectedCanonical}`,
        color: '#1D4ED8',
        font: {
          size: 18,
          weight: 'bold' as const
        },
        padding: {
          top: 10,
          bottom: 30
        }
      }
    },
    scales: {
      x: {
        title: {
          display: true,
          text: '时间期数',
          color: '#374151',
          font: {
            size: 12,
            weight: 600
          }
        },
        ticks: {
          color: '#6B7280'
        },
        grid: {
          color: '#E5E7EB'
        }
      },
      y: {
        title: {
          display: true,
          title: { text: `数值 (${currentUnit})`, /* ... */ },
          color: '#374151',
          font: {
            size: 12,
            weight: 600
          }
        },
        ticks: {
          color: '#6B7280'
        },
        grid: {
          color: '#E5E7EB'
        }
      }
    },
    interaction: {
      intersect: false,
      mode: 'index' as const
    }
  };
  
  return (
    <div className="min-h-screen bg-white p-6">
      {/* 页面标题 */}
      <div className="mb-8">
        <div className="bg-white rounded-2xl p-8 border border-blue-100 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold text-blue-900 mb-3 flex items-center gap-3">
                <Brain className="text-blue-500" />
                智能模拟分析系统
              </h1>
              <p className="text-gray-600 text-lg">
                运用ARIMA时间序列、蒙特卡洛模拟和自定义Python算法，实现高精度财务指标预测
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="bg-blue-50 text-blue-600 px-4 py-2 rounded-lg border border-blue-200">
                <Activity className="w-5 h-5 inline mr-2" />
                实时分析
              </div>
              <div className="bg-green-50 text-green-600 px-4 py-2 rounded-lg border border-green-200">
                <Zap className="w-5 h-5 inline mr-2" />
                高性能计算
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 分析对象选择 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      <div>
        <label className="block text-sm text-gray-600 mb-1">选择公司</label>
        <select
          value={selectedCompany}
          onChange={(e) => setSelectedCompany(e.target.value)}
          className="w-full bg-white text-gray-900 px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        >
          {companies.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

    </div>

      <div className="mb-6">
        <div className="bg-white rounded-xl p-6 border border-blue-100 shadow-sm">
          <h2 className="text-xl font-semibold text-blue-900 mb-4 flex items-center gap-2">
            <Database className="text-blue-500" />
            分析对象选择
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {analysisTargets.map((target) => {
              const IconComponent = target.icon;
              return (
                <button
                  key={target.name}
                  onClick={() => {
                  setSelectedTarget(target.name);
                  setSelectedCanonical(target.name); // 同步到 canonical
                }}

                  className={`p-4 rounded-lg border-2 transition-all duration-200 text-left ${
                    selectedCanonical === target.name
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-25'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <IconComponent 
                      className={`w-5 h-5 ${
                        selectedTarget === target.name ? 'text-blue-600' : 'text-gray-500'
                      }`} 
                      style={{ color: selectedTarget === target.name ? target.color : undefined }}
                    />
                    <span className={`font-medium ${
                      selectedTarget === target.name ? 'text-blue-900' : 'text-gray-700'
                    }`}>
                      {target.name}
                    </span>
                  </div>
                  <p className={`text-sm ${
                    selectedTarget === target.name ? 'text-blue-600' : 'text-gray-500'
                  }`}>
                    {target.description}
                  </p>
                  <p className={`text-xs mt-1 ${
                    selectedTarget === target.name ? 'text-blue-500' : 'text-gray-400'
                  }`}>
                    单位：{target.unit}
                  </p>
                </button>
              );
            })}
          </div>
          <div className="mt-4">
          <label className="block text-sm text-gray-600 mb-1">选择其他指标</label>
          <select
            value={selectedCanonical}
            onChange={(e) => {
              setSelectedCanonical(e.target.value);
              // 让卡片不再依赖 selectedTarget 高亮
              // 如果想彻底清空，也可以把 selectedTarget 置空：
              setSelectedTarget('' as any);
            }}
            className="w-full bg-white text-gray-900 px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {metrics.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          
        </div>

        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧配置面板 */}
        <div className="lg:col-span-1 space-y-6">
          {/* 模型选择 */}
          <div className="bg-white rounded-xl p-6 border border-blue-100 shadow-sm">
            <h2 className="text-xl font-semibold text-blue-900 mb-4 flex items-center gap-2">
              <Settings className="text-blue-500" />
              模型选择
            </h2>
            
            <div className="space-y-3">
              {[
                { value: 'arima', label: 'ARIMA时间序列', icon: TrendingUp, desc: '适用于趋势分析和季节性预测' },
                { value: 'montecarlo', label: '蒙特卡洛模拟', icon: BarChart3, desc: '适用于不确定性分析和风险评估' },
                { value: 'python', label: '自定义Python', icon: Code, desc: '适用于个性化算法和复杂模型' }
              ].map(({ value, label, icon: Icon, desc }) => (
                <label key={value} className="block">
                  <div className={`relative p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    selectedModel === value
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 bg-gray-50 hover:border-blue-300 hover:bg-blue-25'
                  }`}>
                    <input
                      type="radio"
                      className="sr-only"
                      checked={selectedModel === value}
                      onChange={() => setSelectedModel(value as ModelType)}
                    />
                    <div className="flex items-start gap-3">
                      <Icon className={`w-5 h-5 mt-0.5 ${
                        selectedModel === value ? 'text-blue-600' : 'text-gray-500'
                      }`} />
                      <div>
                        <div className={`font-medium ${
                          selectedModel === value ? 'text-blue-900' : 'text-gray-700'
                        }`}>
                          {label}
                        </div>
                        <div className="text-sm text-gray-500 mt-1">
                          {desc}
                        </div>
                      </div>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          
          {/* 外部因素调整 */}
          <div className="bg-white rounded-xl p-6 border border-blue-100 shadow-sm">
            <h2 className="text-xl font-semibold text-blue-900 mb-4 flex items-center gap-2">
              <Sliders className="text-green-500" />
              外部因素调整
            </h2>
            
            <div className="space-y-6">
              {/* 汇率变化 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  汇率变化: {exchangeRateChange.toFixed(1)}%
                </label>
                <input
                  type="range"
                  min="-20"
                  max="20"
                  step="0.5"
                  value={exchangeRateChange}
                  onChange={(e) => setExchangeRateChange(parseFloat(e.target.value))}
                  className="w-full h-2 bg-blue-100 rounded-lg appearance-none cursor-pointer slider-thumb"
                  style={{
                    background: `linear-gradient(to right, #3B82F6 0%, #3B82F6 ${(exchangeRateChange + 20) * 2.5}%, #E5E7EB ${(exchangeRateChange + 20) * 2.5}%, #E5E7EB 100%)`
                  }}
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>-20%</span>
                  <span>+20%</span>
                </div>
              </div>
              
              {/* 利率变化 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  利率变化: {interestRateChange.toFixed(1)}%
                </label>
                <input
                  type="range"
                  min="-5"
                  max="5"
                  step="0.1"
                  value={interestRateChange}
                  onChange={(e) => setInterestRateChange(parseFloat(e.target.value))}
                  className="w-full h-2 bg-blue-100 rounded-lg appearance-none cursor-pointer slider-thumb"
                  style={{
                    background: `linear-gradient(to right, #3B82F6 0%, #3B82F6 ${(interestRateChange + 5) * 10}%, #E5E7EB ${(interestRateChange + 5) * 10}%, #E5E7EB 100%)`
                  }}
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>-5%</span>
                  <span>+5%</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* 自定义参数 */}
          <div className="bg-white rounded-xl p-6 border border-blue-100 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-blue-900 flex items-center gap-2">
                <Target className="text-purple-500" />
                自定义参数
              </h2>
              <button
                onClick={addCustomParameter}
                className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-lg transition-colors"
              >
                + 添加
              </button>
            </div>
            
            <div className="space-y-4">
              {customParameters.map((param) => (
                <div key={param.id} className="bg-gray-50 p-4 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <input
                      type="text"
                      value={param.name}
                      onChange={(e) => updateCustomParameter(param.id, { name: e.target.value })}
                      className="bg-white text-gray-900 px-2 py-1 rounded border border-gray-300 text-sm flex-1 mr-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => removeCustomParameter(param.id)}
                      className="text-red-500 hover:text-red-700 text-sm"
                    >
                      删除
                    </button>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs text-gray-600">
                      值: {param.value.toFixed(3)}
                    </label>
                    <input
                      type="range"
                      min={param.min}
                      max={param.max}
                      step={param.step}
                      value={param.value}
                      onChange={(e) => updateCustomParameter(param.id, { value: parseFloat(e.target.value) })}
                      className="w-full h-1 bg-blue-100 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{param.min}</span>
                      <span>{param.max}</span>
                    </div>
                  </div>
                </div>
              ))}
              
              {customParameters.length === 0 && (
                <div className="text-center text-gray-500 py-6">
                  暂无自定义参数
                </div>
              )}
            </div>
          </div>
          
          {/* 运行按钮 */}
          <button
            onClick={runSimulation}
            disabled={loading}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-4 px-6 rounded-xl flex items-center justify-center gap-3 transition-all transform hover:scale-105 disabled:hover:scale-100 shadow-lg"
          >
            <Play className="w-5 h-5" />
            {loading ? '正在运行模拟...' : '运行模拟分析'}
          </button>
        </div>

        {/* 右侧内容区域 */}
        <div className="lg:col-span-2 space-y-6">
          {/* 模型特定参数配置 */}
          <div className="bg-white rounded-xl p-6 border border-blue-100 shadow-sm">
            <h2 className="text-xl font-semibold text-blue-900 mb-4">
              模型参数配置
            </h2>
            
            {selectedModel === 'arima' && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">预测期数</label>
                  <input
                    type="number"
                    min="1"
                    max="36"
                    value={arimaParams.periods}
                    onChange={(e) => setArimaParams({...arimaParams, periods: parseInt(e.target.value)})}
                    className="w-full bg-white text-gray-900 px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">AR阶数(p)</label>
                  <input
                    type="number"
                    min="0"
                    max="5"
                    value={arimaParams.p}
                    onChange={(e) => setArimaParams({...arimaParams, p: parseInt(e.target.value)})}
                    className="w-full bg-white text-gray-900 px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">差分阶数(d)</label>
                  <input
                    type="number"
                    min="0"
                    max="2"
                    value={arimaParams.d}
                    onChange={(e) => setArimaParams({...arimaParams, d: parseInt(e.target.value)})}
                    className="w-full bg-white text-gray-900 px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">MA阶数(q)</label>
                  <input
                    type="number"
                    min="0"
                    max="5"
                    value={arimaParams.q}
                    onChange={(e) => setArimaParams({...arimaParams, q: parseInt(e.target.value)})}
                    className="w-full bg-white text-gray-900 px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}
            
            {selectedModel === 'montecarlo' && (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">初始值</label>
                  <input
                    type="number"
                    value={monteCarloParams.initialValue}
                    onChange={(e) => setMonteCarloParams({...monteCarloParams, initialValue: parseFloat(e.target.value)})}
                    className="w-full bg-white text-gray-900 px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">模拟次数</label>
                  <input
                    type="number"
                    min="100"
                    max="10000"
                    step="100"
                    value={monteCarloParams.numSimulations}
                    onChange={(e) => setMonteCarloParams({...monteCarloParams, numSimulations: parseInt(e.target.value)})}
                    className="w-full bg-white text-gray-900 px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">时间范围</label>
                  <input
                    type="number"
                    min="1"
                    max="36"
                    value={monteCarloParams.timeHorizon}
                    onChange={(e) => setMonteCarloParams({...monteCarloParams, timeHorizon: parseInt(e.target.value)})}
                    className="w-full bg-white text-gray-900 px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">漂移率</label>
                  <input
                    type="number"
                    step="0.01"
                    min="-0.5"
                    max="0.5"
                    value={monteCarloParams.drift}
                    onChange={(e) => setMonteCarloParams({...monteCarloParams, drift: parseFloat(e.target.value)})}
                    className="w-full bg-white text-gray-900 px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">波动率</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="1"
                    value={monteCarloParams.volatility}
                    onChange={(e) => setMonteCarloParams({...monteCarloParams, volatility: parseFloat(e.target.value)})}
                    className="w-full bg-white text-gray-900 px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">模型类型</label>
                  <select
                    value={monteCarloParams.modelType}
                    onChange={(e) => setMonteCarloParams({...monteCarloParams, modelType: e.target.value as any})}
                    className="w-full bg-white text-gray-900 px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="geometric_brownian">几何布朗运动</option>
                    <option value="mean_reverting">均值回归</option>
                    <option value="jump_diffusion">跳跃扩散</option>
                  </select>
                </div>
              </div>
            )}
            
            {selectedModel === 'python' && (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Python代码
                    </label>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-lg flex items-center gap-2"
                    >
                      <Upload className="w-4 h-4" />
                      上传.py文件
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".py"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </div>
                  <textarea
                    value={pythonCode}
                    onChange={(e) => setPythonCode(e.target.value)}
                    className="w-full h-64 bg-gray-900 text-green-400 px-4 py-3 rounded-lg border border-gray-300 font-mono text-sm"
                    placeholder="请输入Python代码..."
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    输入数据 (逗号分隔)
                  </label>
                  <input
                    type="text"
                    value={inputData.join(', ')}
                    onChange={(e) => {
                      const values = e.target.value.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
                      setInputData(values);
                    }}
                    className="w-full bg-white text-gray-900 px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    placeholder="100, 105, 110, 115..."
                  />
                </div>
                
                {uploadedFile && (
                  <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                    <div className="flex items-center gap-2 text-sm text-blue-700">
                      <FileText className="w-4 h-4" />
                      已上传: {uploadedFile.name}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 模拟结果 */}
          {simulationResult && (
            <div className="space-y-6">
              {/* 统计指标 */}
              <div className="bg-white rounded-xl p-6 border border-blue-100 shadow-sm">
                <h2 className="text-xl font-semibold text-blue-900 mb-4">模拟结果统计</h2>
                {/* ARIMA 预测值表格 */}
                {selectedModel === 'arima' && simulationResult?.data?.predictions && Array.isArray(simulationResult.data.predictions) && (
                  <div className="mt-6">
                    <h3 className="text-lg font-medium text-blue-900 mb-3">预测值明细</h3>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 border border-gray-200 rounded-lg">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">序号</th>
                            <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">预测期</th>
                            <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">预测值</th>
                          </tr>
                        </thead>
                          {(() => {
                            const preds: number[] = simulationResult?.data?.predictions || [];
                            const histLabels = seriesLabels || [];
                            const fullLabels = extendQuarterLabels(histLabels, preds.length);
                            const futureLabels = fullLabels.slice(histLabels.length); // 只取未来段

                            return (
                              <tbody>
                                {preds.map((v, i) => (
                                  <tr key={i}>
                                    <td className="px-4 py-2 text-sm text-gray-700">{i + 1}</td>
                                    <td className="px-4 py-2 text-sm text-gray-700">{futureLabels[i]}</td>
                                    <td className="px-4 py-2 text-right text-sm text-gray-900">{Number(v).toFixed(4)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            );
                          })()}

                      </table>
                    </div>
                  </div>
                )}
                {/* Monte Carlo 分位数表格 */}
                {selectedModel === 'montecarlo' && simulationResult?.data?.percentilePaths && (() => {
                  const mc = simulationResult.data.percentilePaths;
                  const anyPath = (mc.p50 || Object.values(mc)[0]) as number[] | undefined;
                  const rawLen = anyPath?.length || 0;
                  const futureLen = rawLen > 1 ? rawLen - 1 : rawLen;
                  const allLabels = extendQuarterLabels(seriesLabels, futureLen);
                  const futureLabels = allLabels.slice(seriesLabels.length);

                  const getCol = (k: 'p5'|'p25'|'p50'|'p75'|'p95') => {
                    const arr = (mc[k] || []) as number[];
                    return (arr.length > 1 ? arr.slice(1) : arr); // 去掉 t0
                  };

                  const rows = futureLabels.map((lbl, i) => ({
                    lbl,
                    p5:  getCol('p5')[i],
                    p25: getCol('p25')[i],
                    p50: getCol('p50')[i],
                    p75: getCol('p75')[i],
                    p95: getCol('p95')[i],
                  }));

                  return (
                    <div className="mt-6">
                      <h3 className="text-lg font-medium text-blue-900 mb-3">模拟结果表（分位数）</h3>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 border border-gray-200 rounded-lg">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">期间</th>
                              <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">5%</th>
                              <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">25%</th>
                              <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">50%（中位）</th>
                              <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">75%</th>
                              <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">95%</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-100">
                            {rows.map((r, idx) => (
                              <tr key={idx}>
                                <td className="px-4 py-2 text-sm text-gray-700">{r.lbl}</td>
                                <td className="px-4 py-2 text-right text-sm text-gray-900">{r.p5?.toFixed(2) ?? '-'}</td>
                                <td className="px-4 py-2 text-right text-sm text-gray-900">{r.p25?.toFixed(2) ?? '-'}</td>
                                <td className="px-4 py-2 text-right text-sm font-medium text-blue-700">{r.p50?.toFixed(2) ?? '-'}</td>
                                <td className="px-4 py-2 text-right text-sm text-gray-900">{r.p75?.toFixed(2) ?? '-'}</td>
                                <td className="px-4 py-2 text-right text-sm text-gray-900">{r.p95?.toFixed(2) ?? '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {simulationResult.data.statistics.finalValues && (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      { label: '平均值', value: simulationResult.data.statistics.finalValues.mean, color: 'blue' },
                      { label: '中位数', value: simulationResult.data.statistics.finalValues.median, color: 'green' },
                      { label: '标准差', value: simulationResult.data.statistics.finalValues.standardDeviation, color: 'purple' },
                      { label: '变异系数', value: simulationResult.data.statistics.finalValues.coefficientOfVariation, color: 'orange' }
                    ].map(({ label, value, color }) => (
                      <div key={label} className={`bg-${color === 'blue' ? 'blue' : color === 'green' ? 'green' : color === 'purple' ? 'purple' : 'yellow'}-50 border border-${color === 'blue' ? 'blue' : color === 'green' ? 'green' : color === 'purple' ? 'purple' : 'yellow'}-200 rounded-lg p-4`}>
                        <div className={`text-${color === 'blue' ? 'blue' : color === 'green' ? 'green' : color === 'purple' ? 'purple' : 'yellow'}-700 text-sm font-medium`}>{label}</div>
                        <div className={`text-${color === 'blue' ? 'blue' : color === 'green' ? 'green' : color === 'purple' ? 'purple' : 'yellow'}-900 text-2xl font-bold`}>
                          {typeof value === 'number' ? value.toFixed(2) : 'N/A'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* 风险指标 */}
                {simulationResult.data.riskMetrics && (
                  <div className="mt-6">
                    <h3 className="text-lg font-medium text-blue-900 mb-3">风险指标</h3>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      {simulationResult.data.riskMetrics.valueAtRisk && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                          <div className="text-red-700 text-sm font-medium">95% VaR</div>
                          <div className="text-red-900 text-xl font-bold">
                            {simulationResult.data.riskMetrics.valueAtRisk.var95.toFixed(2)}%
                          </div>
                        </div>
                      )}
                      
                      {simulationResult.data.riskMetrics.probabilityMetrics && (
                        <>
                          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                            <div className="text-green-700 text-sm font-medium">盈利概率</div>
                            <div className="text-green-900 text-xl font-bold">
                              {simulationResult.data.riskMetrics.probabilityMetrics.probabilityOfGain.toFixed(1)}%
                            </div>
                          </div>
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <div className="text-blue-700 text-sm font-medium">预期收益</div>
                            <div className="text-blue-900 text-xl font-bold">
                              {simulationResult.data.riskMetrics.probabilityMetrics.expectedReturn.toFixed(2)}%
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
              
              {/* 图表展示 */}
              <div className="bg-white rounded-xl p-6 border border-blue-100 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold text-blue-900">模拟结果图表</h2>
                  <div className="flex gap-2">
                    <button
                      onClick={handleExportCSV}
                      className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      导出CSV
                    </button>
                    {/* <button
                      onClick={handleGeneratePDF}
                      className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm transition-colors"
                    >
                      <FileText className="w-4 h-4" />
                      生成报告
                    </button> */}
                  </div>
                </div>
                
                <div className="h-96">
                  {prepareChartData() && (
                    <Line 
                      options={chartOptions} 
                      data={prepareChartData()!} 
                    />
                  )}
                </div>
              </div>
              
              {/* 场景分析 */}
              {simulationResult.data.scenarios && (
                <div className="bg-white rounded-xl p-6 border border-blue-100 shadow-sm">
                  <h2 className="text-xl font-semibold text-blue-900 mb-4">场景分析</h2>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {simulationResult.data.scenarios.map((scenario, index) => (
                      <div key={index} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                        <div className="text-gray-900 font-medium mb-2">{scenario.name}</div>
                        <div className="text-2xl font-bold text-blue-600 mb-2">
                          {(scenario.probability * 100).toFixed(1)}%
                        </div>
                        <div className="text-sm text-gray-600">
                          {scenario.description}
                        </div>
                        <div className="text-xs text-gray-500 mt-2">
                          模拟次数: {scenario.count}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Simulation;