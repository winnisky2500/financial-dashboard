import { supabase, isDemoMode, getDemoFinancialIndicators, getDemoPolicyNews, getDemoSubsidiaries, getDemoSectors } from './supabase';
import { createClient } from '@supabase/supabase-js';


// 数据类型定义
export interface ReportTemplateRow {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  template_data: any;             // jsonb
  created_at?: string;
  updated_at?: string;
}
export interface FinancialIndicator {
  id: string;
  name: string;
  code: string;
  value: number;
  previousValue: number;
  targetValue: number;
  unit: string;
  category: string;
  questions: string[];
}

// 统一的政策数据类型（仅供前端渲染使用）
export interface PolicyNewsItem {
  id: string;
  title: string;
  category?: string;
  publisher?: string;   // ✅ 发布机构（唯一来源显示字段）
  url?: string;         // 原文链接（查看全文）
  content?: string;     // 摘要
  detail?: string;      // ✅ 详细内容（Markdown/纯文本）
  publishDate?: string; // YYYY-MM-DD
  createdAt?: string;
  [k: string]: any;
}

export interface SubsidiaryData {
  id: number;
  name: string;
  sector_id: number;
  parent_id: number | null;
  level: number;
}

export interface KPIData {
  id: number;
  name: string;
  code: string;
  unit: string;
  category: string;
  description: string;
}

export interface FinancialData {
  id: number;
  subsidiary_id: number;
  kpi_id: number;
  period_date: string;
  period_type: string;
  value: number;
}

// 增强的模拟分析类型定义
export interface EnhancedARIMAParams {
  historicalData: number[];
  periods?: number;
  p?: number;
  d?: number;
  q?: number;
  exchangeRateChange?: number;
  interestRateChange?: number;
  customParams?: { [key: string]: any };
}

export interface EnhancedMonteCarloParams {
  initialValue: number;
  numSimulations?: number;
  timeHorizon?: number;
  drift?: number;
  volatility?: number;
  exchangeRateChange?: number;
  interestRateChange?: number;
  customParams?: { [key: string]: any };
  modelType?: 'geometric_brownian' | 'mean_reverting' | 'jump_diffusion';
  jumpParameters?: any;
}

export interface CustomPythonParams {
  pythonCode: string;
  inputData: number[];
  parameters?: { [key: string]: any };
  executionTimeout?: number;
}

export interface SimulationResult {
  success: boolean;
  model: string;
  data: {
    predictions?: number[];
    simulations?: number[][];
    percentilePaths?: { [key: string]: number[] };
    scenarios?: {
      name: string;
      probability: number;
      count: number;
      averagePath: number[];
      description: string;
    }[];
    statistics: {
      finalValues?: {
        mean: number;
        median: number;
        standardDeviation: number;
        min: number;
        max: number;
        [key: string]: any;
      };
      distribution?: {
        skewness: number;
        kurtosis: number;
        percentiles: { [key: string]: number };
      };
      [key: string]: any;
    };
    riskMetrics?: {
      valueAtRisk?: {
        var95: number;
        var99: number;
        interpretation: string;
      };
      drawdownAnalysis?: {
        averageMaxDrawdown: number;
        worstCaseDrawdown: number;
        interpretation: string;
      };
      probabilityMetrics?: {
        probabilityOfLoss: number;
        probabilityOfGain: number;
        expectedReturn: number;
      };
      [key: string]: any;
    };
    confidenceIntervals?: {
      lower95: number[];
      upper95: number[];
      lower99: number[];
      upper99: number[];
    };
    diagnostics?: any;
    modelFit?: {
      aic: number;
      bic: number;
      rsquared: number;
    };
    executionInfo?: {
      codeLength: number;
      inputDataPoints: number;
      executionTime: number;
      memoryUsage: string;
      codeComplexity: any;
    };
    [key: string]: any;
  };
  timestamp?: string;
  executionTime?: number;
}

export interface ExportRequest {
  simulationData: any;
  metadata: {
    analysisType: string;
    parameters: any;
    timestamp: string;
  };
  chartImages?: any[];
}

// AI财务分析相关类型定义
export interface AnalysisQuery {
  query: string;
  analysisMode: 'dimension' | 'metric' | 'business' | 'anomaly';
  contextData?: any;
  chatHistory?: ChatMessage[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface AnalysisResponse {
  analysis: string;
  insights: string[];
  recommendations: string[];
  chartSuggestions: {
    type: string;
    title: string;
    description: string;
    dataSource: string;
  }[];
  followUpQuestions: string[];
}

export interface AIAnalysisResult {
  response: AnalysisResponse;
  mode: string;
  timestamp: string;
  note?: string;
}

// 模拟相关类型定义（保持向后兼容）
export interface ARIMAParams {
  p: number;
  d: number;
  q: number;
  length: number;
  historicalData?: number[];
  arCoeffs?: number[];
  maCoeffs?: number[];
  variance?: number;
}

export interface MonteCarloParams {
  numSimulations: number;
  timeHorizon: number;
  initialValue: number;
  drift?: number;
  volatility?: number;
  seed?: number;
}

// ==== 上传文件（report_uploads）表的行 ====
export interface ReportUploadRow {
  id: string;
  user_id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  bucket: string;      // 'uploads'
  path: string;        // {user_id}/{ts}-{filename}
  meta: any;
  created_at: string;
  signedUrl?: string;  // 便于预览（私有桶）
}

// ==== 自然语言报告 Agent 请求/响应 ====
export interface FreeReportRequest {
  prompt: string;
  selected_file_ids: string[];
  allow_web_search?: boolean;
  language?: 'zh' | 'en';
}

export interface FreeReportParams {
  prompt: string;
  language?: 'zh' | 'en';
  allow_web_search?: boolean;
  selected_file_ids?: string[];
  template_text?: string;
  template_file_id?: string;
  meta?: Record<string, any>;
}

export interface FreeReportResult {
  job_id: string;
  generated_at: string;
  content_md: string;
  attachments_used?: string[];
  web_refs?: Array<Record<string, any>>;
}

export interface FreeReportResponse {
  job_id: string;
  generated_at: string;
  content_md: string;
  attachments_used: string[];
  web_refs: Array<{ title: string; url: string; summary: string }>;
}

// ==== 美化 Agent 响应 ====
export interface BeautifyResponse {
  html_download_url?: string;
  docx_download_url?: string;
  pdf_download_url?: string;
}

/**
 * 获取财务指标数据
 */
export async function getFinancialIndicators(): Promise<FinancialIndicator[]> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      console.error('获取财务指标时无有效会话');
    } else {
      console.log('获取财务指标时有有效会话:', session.user?.id);
    }
    
    if (isDemoMode()) {
      console.log('使用演示模式数据 - 财务指标');
      return await getDemoFinancialIndicators();
    }
    
    const { data: indicators, error: indicatorError } = await supabase
      .from('financial_indicators')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true });
    
    if (indicatorError) {
      console.error('获取财务指标数据失败:', indicatorError);
      return [];
    }

    if (!indicators || indicators.length === 0) {
      console.warn('没有找到财务指标数据');
      return [];
    }
    
    return indicators.map(indicator => ({
      id: indicator.id.toString(),
      name: indicator.name,
      code: indicator.code,
      value: indicator.current_value,
      previousValue: indicator.previous_value,
      targetValue: indicator.target_value,
      unit: indicator.unit,
      category: indicator.category,
      questions: indicator.suggested_questions || []
    }));
  } catch (error) {
    console.error('获取财务指标异常:', error);
    return [];
  }
}

/**
 * 获取政策动态数据
 */
export async function getPolicyNews(): Promise<PolicyNewsItem[]> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      console.error('获取政策动态时无有效会话');
    } else {
      console.log('获取政策动态时有有效会话:', session.user?.id);
    }

    if (isDemoMode()) {
      console.log('使用演示模式数据 - 政策动态');
      return await getDemoPolicyNews();
    }

    // 统一从 policy_news 读取；* 便于兼容不同列名
    const { data, error } = await supabase
      .from('policy_news')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('获取政策动态失败:', error);
      return [];
    }
    if (!data || data.length === 0) {
      console.warn('没有找到政策动态数据');
      return [];
    }

    const isHttp = (s: any) => typeof s === 'string' && /^https?:\/\//i.test(s);

    return data.map((item: any) => {
      // URL 多重兜底：url -> source_url -> link -> (source是URL)
      const url =
        item.url ??
        item.source_url ??
        item.link ??
        (isHttp(item.source) ? item.source : '') ??
        '';

      // 发布机构：优先 publisher，其次可能的别名列
      const publisher =
        item.publisher ??
        item.publisher_name ??
        item.source_name ??
        '';

      // 日期列兼容：publish_date / published_at / created_at
      const publishDateRaw =
        item.publish_date ??
        item.published_at ??
        item.publishDate ??
        item.created_at ??
        '';

      return {
        id: String(item.id),
        title: item.title ?? '',
        category: item.category ?? '',
        industry: item.industry ?? '宏观综合',
        impact: item.impact ?? undefined,

        // ✅ 关键字段
        publisher,                   // 机构名（标题下显示）
        url,                         // 原文链接（“来源”行显示）
        content: item.content ?? item.summary ?? '', // 摘要
        detail: item.detail ?? item.details ?? '',   // 详细内容

        publishDate: publishDateRaw ? String(publishDateRaw).slice(0, 10) : '',
        createdAt: item.created_at ?? undefined,

        // 兼容旧字段（不在页面使用）
        source: item.source ?? undefined,
        summary: item.summary ?? undefined,
      } as PolicyNewsItem;
    });
  } catch (error) {
    console.error('获取政策动态异常:', error);
    return [];
  }
}

// ==== 上传到 Storage + 写入 report_uploads ====
export async function uploadReportFile(file: File): Promise<ReportUploadRow> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('未登录，无法上传');

  const bucket = 'uploads';
  const objectKey = `${user.id}/${Date.now()}-${file.name}`;

  // 1) 存储
  const up = await supabase.storage.from(bucket).upload(objectKey, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'application/octet-stream',
  });
  if (up.error) throw up.error;

  // 2) 表记录
  const ins = await supabase.from('report_uploads')
    .insert({
      user_id: user.id,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      bucket, path: objectKey,
      meta: {},
    })
    .select('*').single();
  if (ins.error) throw ins.error;

  // 3) 签名 URL（私有桶）
  const signed = await supabase.storage.from(bucket).createSignedUrl(objectKey, 3600);
  return { ...(ins.data as ReportUploadRow), signedUrl: signed.data?.signedUrl };
}

// ==== 列出本人上传 ====
export async function listReportUploads(): Promise<ReportUploadRow[]> {
  // 允许未登录也能看到（配合上面的“select all”策略）
  const { data, error } = await supabase
    .from('report_uploads')
    .select('id,user_id,file_name,mime_type,size_bytes,bucket,path,meta,created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;

  // 不生成 signedUrl；仅返回行数据即可
  const rows = (data || []) as ReportUploadRow[];
  rows.forEach(r => { (r as any).signedUrl = undefined; });
  return rows;
}


// ==== 删除（Storage + 表） ====
export async function deleteReportUpload(id: string): Promise<void> {
  const { data, error } = await supabase.from('report_uploads').select('*').eq('id', id).single();
  if (error) throw error;
  const row = data as ReportUploadRow;

  const rm = await supabase.storage.from(row.bucket).remove([row.path]);
  if (rm.error) throw rm.error;

  const del = await supabase.from('report_uploads').delete().eq('id', id);
  if (del.error) throw del.error;
}

/**
 * 获取子公司数据
 */
export async function getSubsidiaries(): Promise<SubsidiaryData[]> {
  try {
    if (isDemoMode()) {
      return await getDemoSubsidiaries();
    }
    
    const { data, error } = await supabase
      .from('subsidiaries')
      .select('*')
      .order('id', { ascending: true });
    
    if (error) {
      console.error('获取子公司数据失败:', error);
      return [];
    }
    
    return data;
  } catch (error) {
    console.error('获取子公司异常:', error);
    return [];
  }
}

/**
 * 获取板块数据
 */
export async function getSectors() {
  try {
    if (isDemoMode()) {
      return await getDemoSectors();
    }
    
    const { data, error } = await supabase
      .from('sectors')
      .select('*');
    
    if (error) {
      console.error('获取板块数据失败:', error);
      return [];
    }
    
    return data;
  } catch (error) {
    console.error('获取板块异常:', error);
    return [];
  }
}

/**
 * 增强的ARIMA分析
 */
export async function runEnhancedARIMAAnalysis(params: EnhancedARIMAParams): Promise<SimulationResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.access_token) authHeaders.Authorization = `Bearer ${session.access_token}`;

    const { data, error } = await supabase.functions.invoke('enhanced-arima-analysis', {
      body: {
        historicalData: params.historicalData,
        parameters: { /* ... */ }
      },
      headers: authHeaders
    });


    if (error) {
      // Edge Function 没部署/报500时，给出清晰提示 + 本地兜底
      console.warn('Edge Function 调用失败，使用本地兜底 ARIMA 近似：', error);

      const y = (params.historicalData || []).map(Number);
      const n = y.length || 12;
      const periods = params.periods || 12;

      // 简单线性趋势外推（最小二乘斜率）
      const xs = Array.from({ length: n }, (_, i) => i + 1);
      const xbar = xs.reduce((a, b) => a + b, 0) / n;
      const ybar = y.reduce((a, b) => a + b, 0) / n;
      const slope = xs.reduce((s, xi, i) => s + (xi - xbar) * (y[i] - ybar), 0) /
                    xs.reduce((s, xi) => s + (xi - xbar) ** 2, 0 || 1);
      const intercept = ybar - slope * xbar;

      const predictions = Array.from({ length: periods }, (_, k) => {
        const t = n + (k + 1);
        return Math.max(0, intercept + slope * t);
      });

      return {
        success: true,
        model: 'Enhanced-ARIMA(Fallback)',
        data: {
          predictions,
          statistics: {},
        },
        timestamp: new Date().toISOString(),
        executionTime: 0.01
      };
    }


    return {
      success: true,
      model: 'Enhanced-ARIMA',
      data: data,
      timestamp: new Date().toISOString(),
      executionTime: 1.2
    };
  } catch (error) {
    console.error('Enhanced ARIMA调用失败:', error);
    throw error;
  }
}

/**
 * 增强的蒙特卡洛模拟
 */
export async function runEnhancedMonteCarloSimulation(
  params: EnhancedMonteCarloParams
): Promise<SimulationResult> {
  try {
    // 跟 ARIMA 一致：带上用户态 token
    const { data: { session } } = await supabase.auth.getSession();
    const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.access_token) authHeaders.Authorization = `Bearer ${session.access_token}`;

    // 调用 Edge Function（保持你现有参数命名）
    const { data, error } = await supabase.functions.invoke('enhanced-monte-carlo-simulation', {
      body: {
        initialValue: params.initialValue,
        parameters: {
          numSimulations: params.numSimulations ?? 1000,
          timeHorizon: params.timeHorizon ?? 12,
          drift: params.drift ?? 0.05,
          volatility: params.volatility ?? 0.15,
          exchangeRateChange: params.exchangeRateChange ?? 0,
          interestRateChange: params.interestRateChange ?? 0,
          customParams: params.customParams ?? {},
          modelType: params.modelType ?? 'geometric_brownian',
          jumpParameters: params.jumpParameters
        }
      },
      headers: authHeaders
    });

    if (error) {
      // 与 ARIMA 一致：函数报错 → 本地兜底
      console.warn('Edge Function 调用失败，使用本地兜底 Monte Carlo 近似：', error);

      // ---- 本地兜底：几何布朗运动（生成各分位路径） ----
      const N = params.timeHorizon ?? 12;
      const mu = params.drift ?? 0.05;
      const sigma = params.volatility ?? 0.15;
      const S0 = Math.max(0, Number(params.initialValue ?? 0));
      const zmap = {
        p5: -1.6448536269,
        p25: -0.67448975,
        p50: 0,
        p75: 0.67448975,
        p95: 1.6448536269
      };
      const genPath = (zScore: number) => {
        const path: number[] = [S0];
        for (let t = 1; t <= N; t++) {
          const prev = path[path.length - 1];
          const next = prev * Math.exp((mu - 0.5 * sigma * sigma) * 1 + sigma * zScore * Math.sqrt(1));
          path.push(next);
        }
        return path;
      };
      const percentilePaths = {
        p5: genPath(zmap.p5),
        p25: genPath(zmap.p25),
        p50: genPath(zmap.p50),
        p75: genPath(zmap.p75),
        p95: genPath(zmap.p95)
      };

      return {
        success: true,
        model: 'Enhanced-Monte-Carlo(Fallback)',
        data: {
          percentilePaths,
          statistics: {
            initialValue: S0,
            drift: mu,
            volatility: sigma,
            horizon: N
          }
        },
        timestamp: new Date().toISOString(),
        executionTime: 0.01
      };
    }

    // 成功返回
    return {
      success: true,
      model: 'Enhanced-Monte-Carlo',
      data: data,
      timestamp: new Date().toISOString(),
      executionTime: 1.2
    };
  } catch (error) {
    console.error('Enhanced Monte Carlo 调用失败:', error);
    // 为了和当前前端结构兼容，catch 里也返回兜底（防止 data 为 null）
    const N = params.timeHorizon ?? 12;
    const mu = params.drift ?? 0.05;
    const sigma = params.volatility ?? 0.15;
    const S0 = Math.max(0, Number(params.initialValue ?? 0));
    const zmap = { p5: -1.6448536269, p25: -0.67448975, p50: 0, p75: 0.67448975, p95: 1.6448536269 };
    const genPath = (z: number) => {
      const path = [S0];
      for (let t = 1; t <= N; t++) {
        const prev = path[path.length - 1];
        path.push(prev * Math.exp((mu - 0.5 * sigma * sigma) + sigma * z));
      }
      return path;
    };
    const percentilePaths = {
      p5: genPath(zmap.p5),
      p25: genPath(zmap.p25),
      p50: genPath(zmap.p50),
      p75: genPath(zmap.p75),
      p95: genPath(zmap.p95)
    };
    return {
      success: true,
      model: 'Enhanced-Monte-Carlo(Fallback)',
      data: { percentilePaths, statistics: { initialValue: S0, drift: mu, volatility: sigma, horizon: N } },
      timestamp: new Date().toISOString(),
      executionTime: 0.01
    };
  }
}



/**
 * 执行自定义Python函数
 */
export async function executeCustomPythonFunction(params: CustomPythonParams): Promise<SimulationResult> {
  try {
    const { data, error } = await supabase.functions.invoke('secure-python-executor', {
      body: {
        pythonCode: params.pythonCode,
        inputData: params.inputData,
        parameters: params.parameters || {},
        executionTimeout: params.executionTimeout || 30000
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (error) {
      throw new Error(error.message || 'Python代码执行失败');
    }

    return {
      success: true,
      model: 'Custom-Python',
      data: data,
      timestamp: new Date().toISOString(),
      executionTime: data.executionInfo?.executionTime || 1.0
    };
  } catch (error) {
    console.error('Custom Python执行失败:', error);
    throw error;
  }
}

/**
 * 导出CSV数据
 */
export async function exportToCSV(request: ExportRequest): Promise<Blob> {
  try {
    const response = await fetch(
      'https://ldmttwyxmfxbdmegfxef.supabase.co/functions/v1/csv-export',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxkbXR0d3l4bWZ4YmRtZWdmeGVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU1ODIxMzgsImV4cCI6MjA3MTE1ODEzOH0.B93dW93pZirLyPqSZvxEzsLwEBsHgoQrepb9-VcabDg'
        },
        body: JSON.stringify(request)
      }
    );

    if (!response.ok) {
      throw new Error('CSV导出失败');
    }

    return await response.blob();
  } catch (error) {
    console.error('CSV导出错误:', error);
    throw error;
  }
}

/**
 * 生成PDF报告
 */
export async function generatePDFReport(request: ExportRequest): Promise<{ reportContent: string; fileName: string; metadata: any }> {
  try {
    const { data, error } = await supabase.functions.invoke('pdf-report-generator', {
      body: request,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (error) {
      throw new Error(error.message || 'PDF报告生成失败');
    }

    return data;
  } catch (error) {
    console.error('PDF报告生成错误:', error);
    throw error;
  }
}

/**
 * 上传Python文件到Storage
 */
export async function uploadPythonFile(file: File): Promise<{ publicUrl: string; fileName: string }> {
  try {
    const fileName = `python-functions/${Date.now()}-${file.name}`;
    
    const { data, error } = await supabase.storage
      .from('simulation-files')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      throw new Error(error.message || '文件上传失败');
    }

    const { data: { publicUrl } } = supabase.storage
      .from('simulation-files')
      .getPublicUrl(fileName);

    return {
      publicUrl,
      fileName: file.name
    };
  } catch (error) {
    console.error('文件上传错误:', error);
    throw error;
  }
}

/**
 * 下载文件
 */
export function downloadFile(blob: Blob, fileName: string): void {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

/**
 * AI财务分析代理
 */
export async function queryFinancialAnalysisAgent(params: AnalysisQuery): Promise<AIAnalysisResult> {
  try {
    const { data, error } = await supabase.functions.invoke('financial-analysis-agent', {
      body: {
        query: params.query,
        analysisMode: params.analysisMode,
        contextData: params.contextData,
        chatHistory: params.chatHistory
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (error) {
      throw new Error(error.message || 'AI财务分析失败');
    }

    return data;
  } catch (error) {
    console.error('AI财务分析调用失败:', error);
    throw error;
  }
}

/**
 * 获取分析模式列表
 */
export function getAnalysisModes() {
  return [
    {
      id: 'dimension' as const,
      name: '维度分析',
      description: '从时间、地区、产品等多个维度分析财务数据',
      icon: '📈'
    },
    {
      id: 'metric' as const,
      name: '指标分析', 
      description: '分析关键财务指标，如收入、利润、成本等',
      icon: '📊'
    },
    {
      id: 'business' as const,
      name: '业务钻取分析',
      description: '深入分析特定业务领域，提供详细业务洞察',
      icon: '🔍'
    },
    {
      id: 'anomaly' as const,
      name: '异常分析',
      description: '识别和分析财务数据中的异常情况和风险',
      icon: '⚠️'
    }
  ];
}

/**
 * 报告生成AI函数（兼容性函数）
 */
export async function callReportGenerationAI(query: string): Promise<any> {
  try {
    const result = await queryFinancialAnalysisAgent({
      query: query,
      analysisMode: 'business',
      contextData: {
        reportType: 'comprehensive',
        timestamp: new Date().toISOString()
      }
    });
    
    return {
      response: {
        analysis: result.response.analysis,
        summary: result.response.analysis.substring(0, 200) + '...',
        key_metrics: [],
        charts: []
      },
      metadata: {
        timestamp: result.timestamp,
        reportType: 'AI Generated Report'
      }
    };
  } catch (error) {
    console.error('报告生成失败:', error);
    throw error;
  }
}

// ==== 生成自由报告 ====
export async function generateFreeReport(
  params: FreeReportParams
): Promise<FreeReportResult> {
  // ✅ 命中 freereport_agent 的 /freereport/generate
  const url = FREE_BASE ? `${FREE_BASE}/freereport/generate` : `/freereport/generate`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // ✅ 与后端 auth_check 对应：Authorization 或 X-Agent-Token 都可（Bearer <token>）
      'Authorization': `Bearer ${FREE_TOKEN}`,
      // 'X-Agent-Token': `Bearer ${FREE_TOKEN}`,
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => `${res.status}`);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return await res.json();
}

// ==== 美化导出 ====
export async function beautifyMarkdown(markdown: string, extra?: {
  instructions?: string; language?: 'zh' | 'en'; style?: any;
}): Promise<BeautifyResponse> {
  if (!BEAUTIFY_URL) throw new Error('缺少 VITE_BEAUTIFY_AGENT_URL');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (REPORT_AGENT_TOKEN) headers['Authorization'] = `Bearer ${REPORT_AGENT_TOKEN}`;

  const payload = {
    markdown,
    language: extra?.language ?? 'zh',
    instructions: extra?.instructions ?? '保持事实准确，优化结构，保留 ```echarts``` 图表；生成 HTML/DOCX/PDF 下载。',
    style: extra?.style ?? {
      font_family: 'Inter, "Microsoft YaHei", system-ui, -apple-system, Segoe UI, sans-serif',
      theme: 'light', base_font_size: 16, line_height: 1.75, content_width_px: 920,
    },
  };

  const resp = await fetch(`${BEAUTIFY_URL}/beautify/run`, {
    method: 'POST',
    headers, body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(await resp.text());
  return await resp.json() as BeautifyResponse;
}


// 智能报告生成相关类型定义
export interface ReportGenerationParams {
  reportType: string; // e.g. 'annual_financial'
  language?: 'zh' | 'en';
  customRequirements?: string;           // 额外说明
  templateId?: string;                   // 选中的模板ID（可选）
  parameters?: {
    company_name: string;
    start: { year: number; quarter: 'Q1'|'Q2'|'Q3'|'Q4' };
    end:   { year: number; quarter: 'Q1'|'Q2'|'Q3'|'Q4' };
  };
}

export interface ReportGenerationResult {
  reportId: string;
  content: string;
  metadata: {
    reportType: string;
    language: string;
    sections: string[];
    generatedAt: string;
    dataRange: string;
    aiGenerated: boolean;
    note?: string;
  };
  downloadUrl: string;
  fileName: string;
  generatedAt: string;
}

export interface TemplateInfo {
  templateId: string;
  fileName: string;
  fileType: string;
  templateType: string;
  publicUrl?: string;
  content?: string;
  structure?: {
    sections: any[];
    variables: string[];
    placeholders: any[];
    headings: any[];
    tables: any[];
  };
  size?: number;
  uploadedAt?: string;
  lastModified?: string;
}

export interface DocumentExportParams {
  content: string;
  format: 'pdf' | 'docx' | 'word' | 'md' | 'markdown' | 'html' | 'txt';
  fileName?: string;
  metadata?: any;
  options?: any;
}

export interface DocumentExportResult {
  fileName: string;
  downloadUrl: string;
  fileSize: number;
  contentType: string;
  content?: string;
  metadata: {
    exportedAt: string;
    format: string;
    [key: string]: any;
  };
}

// ==== 自然语言报告 + 美化 agent 的环境变量（新增） ====
const FREE_AGENT_URL   = import.meta.env.VITE_FREE_REPORT_AGENT_URL;     // 例如 http://127.0.0.1:18060
const FREE_AGENT_TOKEN = import.meta.env.VITE_FREE_REPORT_AGENT_TOKEN;   // 例如 dev-secret-01
const BEAUTIFY_URL     = import.meta.env.VITE_BEAUTIFY_AGENT_URL;        // 例如 http://127.0.0.1:8010
const REPORT_AGENT_TOKEN = import.meta.env.VITE_REPORT_AGENT_TOKEN;      // 你已有，用于 beautify

// —— 模板驱动的 report_agent（常走 /report/...，通常端口 8010）
const REPORT_BASE =
  ((import.meta as any).env?.VITE_REPORT_AGENT_URL as string || '').replace(/\/$/, '');
const REPORT_TOKEN =
  (import.meta as any).env?.VITE_REPORT_AGENT_TOKEN || 'dev-secret-01';

// —— 自然语言自由生成的 freereport_agent（走 /freereport/...，你的端口 18060）
const FREE_BASE =
  ((import.meta as any).env?.VITE_FREE_REPORT_AGENT_URL as string || '').replace(/\/$/, '');
const FREE_TOKEN =
  (import.meta as any).env?.VITE_FREE_REPORT_AGENT_TOKEN || 'dev-secret-01';

/**
 * 智能报告生成
 */
export async function generateIntelligentReport(params: ReportGenerationParams): Promise<ReportGenerationResult> {
  const url =
    import.meta.env.VITE_REPORT_AGENT_URL?.replace(/\/$/, '') ||
    (import.meta.env.VITE_ROE_AGENT_URL ? `${import.meta.env.VITE_ROE_AGENT_URL.replace(/\/$/, '')}/report/generate` : '');

  if (!url) {
    throw new Error('未配置 REPORT_AGENT_URL 或 ROE_AGENT_URL，无法生成报告');
  }

  const token =
    import.meta.env.VITE_REPORT_AGENT_TOKEN || import.meta.env.VITE_ROE_AGENT_TOKEN || '';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(params)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`报告生成失败: ${res.status} ${text}`);
  }

  const data = await res.json();

  // 适配前端现有类型
  const result: ReportGenerationResult = {
    reportId: data.job_id || data.report_id || crypto.randomUUID(),
    content: data.content_md || data.content || '',
    metadata: data.metadata || {
      reportType: params.reportType,
      language: params.language || 'zh',
      sections: (data.sections || []).map((s: any) => s.title || String(s)),
      generatedAt: data.generated_at || new Date().toISOString(),
      dataRange: data.data_range || '',
      aiGenerated: true,
      note: data.note || undefined
    },
    downloadUrl: data.pdf_url || data.docx_url || '',
    fileName: data.file_name || 'report.pdf',
    generatedAt: data.generated_at || new Date().toISOString()
  };

  return result;
}

/**
 * 模板管理相关函数
 */
export async function uploadTemplate(row: {
  name: string;
  description?: string;
  category?: string;
  template_data: any;
}): Promise<ReportTemplateRow> {
  const { data, error } = await supabase
    .from('report_templates')
    .insert({
      name: row.name,
      description: row.description ?? null,
      category: row.category ?? null,
      template_data: row.template_data,
    })
    .select('id, name, description, category, template_data, created_at, updated_at')
    .single();
  if (error) throw error;
  return data as ReportTemplateRow;
}

/** 列出模板（按更新时间倒序） */
export async function listTemplates(): Promise<ReportTemplateRow[]> {
  const { data, error } = await supabase
    .from('report_templates')
    .select('id, name, description, category, template_data, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as ReportTemplateRow[];
}

export async function getTemplate(templateId: string): Promise<ReportTemplateRow> {
  const { data, error } = await supabase
    .from('report_templates')
    .select('id, name, description, category, template_data, created_at, updated_at')
    .eq('id', templateId)
    .single();
  if (error) throw error;
  return data as ReportTemplateRow;
}

/** 删除模板 */
export async function deleteTemplate(templateId: string): Promise<void> {
  const { error } = await supabase
    .from('report_templates')
    .delete()
    .eq('id', templateId);
  if (error) throw error;
}

export async function updateTemplate(templateId: string, patch: {
  name?: string;
  description?: string;
  category?: string;
  template_data?: any;
}): Promise<void> {
  const { error } = await supabase
    .from('report_templates')
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.template_data !== undefined ? { template_data: patch.template_data } : {}),
      updated_at: new Date().toISOString()
    })
    .eq('id', templateId);
  if (error) throw error;
}

/**
 * 文档导出函数
 */
export async function exportDocument(params: DocumentExportParams): Promise<DocumentExportResult> {
  try {
    const { data, error } = await supabase.functions.invoke('document-exporter', {
      body: params,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (error) {
      throw new Error(error.message || '文档导出失败');
    }

    return data;
  } catch (error) {
    console.error('文档导出失败:', error);
    throw error;
  }
}

/**
 * 获取报告类型列表
 */
export function getReportTypes() {
  return [
    {
      id: 'annual-financial',
      name: '年度财务报告',
      description: '全面的年度财务业绩报告，包括收入、利润、现金流等分析',
      sections: 8,
      estimatedPages: '15-25',
      color: 'blue'
    },
    {
      id: 'quarterly-performance',
      name: '季度业绩报告',
      description: '季度经营业绩和财务表现分析，关注短期趋势',
      sections: 5,
      estimatedPages: '8-15',
      color: 'green'
    },
    {
      id: 'risk-assessment',
      name: '风险评估报告',
      description: '全面的风险识别、评估和管理建议报告',
      sections: 7,
      estimatedPages: '12-20',
      color: 'red'
    },
    {
      id: 'industry-analysis',
      name: '行业分析报告',
      description: '深入的行业分析，包括市场趋势、竞争格局等',
      sections: 7,
      estimatedPages: '10-18',
      color: 'purple'
    },
    {
      id: 'investment-recommendation',
      name: '投资建议报告',
      description: '专业的投资分析和建议，包括估值和风险评估',
      sections: 7,
      estimatedPages: '8-15',
      color: 'orange'
    },
    {
      id: 'compliance-audit',
      name: '合规审计报告',
      description: '合规性检查和内控制度评估报告',
      sections: 7,
      estimatedPages: '10-16',
      color: 'gray'
    }
  ];
}

// 兼容性函数（保持旧API）
export async function runARIMASimulation(params: ARIMAParams): Promise<SimulationResult> {
  return runEnhancedARIMAAnalysis({
    historicalData: params.historicalData || [100, 105, 110, 115, 120, 125],
    periods: params.length,
    p: params.p,
    d: params.d,
    q: params.q
  });
}

export async function runMonteCarloSimulation(params: MonteCarloParams): Promise<SimulationResult> {
  return runEnhancedMonteCarloSimulation({
    initialValue: params.initialValue,
    numSimulations: params.numSimulations,
    timeHorizon: params.timeHorizon,
    drift: params.drift,
    volatility: params.volatility
  });
}

/* =========================
 * 模拟页取数：financial_metrics & 指标库
 * 追加于文件末尾
 * ========================= */

export type MetricSeries = { labels: string[]; values: number[]; unit?: string };
export type MetricAliasItem = { canonical_name: string; unit?: string; description?: string | null };

/** 从 financial_metrics 读取某公司某 canonical_name 的时间序列 */
export async function fetchMetricTimeSeries({
  companyName,
  metricName,                 // ← 改为 metricName（表字段）
  metricCanonicalName,        // ← 兼容旧入参：若传了也当作 metricName 用
  maxPoints = 24,
}: {
  companyName: string;
  metricName?: string;
  metricCanonicalName?: string;
  maxPoints?: number;
}) {
  const finalMetric = metricName ?? metricCanonicalName;
  if (!companyName || !finalMetric) return { labels: [], values: [], unit: '' };

  const { data, error } = await supabase
    .from('financial_metrics')
    .select('year, quarter, metric_value, company_name, metric_name')
    .eq('company_name', companyName)
    .eq('metric_name', finalMetric)      // ← 用 metric_name
    .order('year', { ascending: true })
    .order('quarter', { ascending: true })
    .limit(maxPoints);

  if (error) throw error;
  if (!data || data.length === 0) return { labels: [], values: [], unit: '' }; // ← 不造数

  const labels = data.map(r => `${r.year}年Q${r.quarter}`);
  const values = data.map(r => Number(r.metric_value));
  return { labels, values, unit: '' }; // ← 表里无 unit，这里固定空串以兼容旧代码
}


/** 从 financial_metrics 列出可选公司（去重） */
export async function listCompaniesFromMetrics(): Promise<string[]> {
  const { data, error } = await supabase
    .from('financial_metrics')
    .select('company_name');

  if (error) throw error;

  const uniq = Array.from(new Set((data ?? []).map(d => d.company_name))).filter(Boolean);
  return uniq.sort((a, b) => a.localeCompare(b, 'zh-CN'));
}


/** 列出可用的 canonical_name（建议直接来自 metric_alias_catalog） */
export async function listCanonicalMetrics(companyName?: string): Promise<string[]> {
  let q = supabase.from('financial_metrics').select('metric_name, company_name');
  if (companyName) q = q.eq('company_name', companyName);

  const { data, error } = await q;
  if (error) throw error;

  const uniq = Array.from(new Set((data ?? []).map(d => d.metric_name))).filter(Boolean);
  return uniq.sort((a, b) => a.localeCompare(b, 'zh-CN'));
}



/** 公司下拉：列出 financial_metrics 里出现过的公司 */
export async function listCompanies(): Promise<string[]> {
  try {
    // 统一从 company_catalog 读取可选公司（与维度下钻的映射口径保持一致）
    const { data, error } = await supabase
      .from('company_catalog')
      .select('display_name')
      .order('display_name', { ascending: true })
      .limit(5000);
    if (error) throw error;

    const arr = Array.from(
      new Set((data || []).map((r: any) => r?.display_name).filter(Boolean))
    ) as string[];
    if (arr.length) return arr;

    // 兜底：若表暂时为空，回退到历史 metrics 列表（兼容旧库）
    const { data: fm, error: e2 } = await supabase
      .from('financial_metrics')
      .select('company_name')
      .limit(10000);
    if (e2) throw e2;
    const backup = Array.from(new Set((fm || []).map((r: any) => r?.company_name).filter(Boolean))) as string[];
    backup.sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return backup.length ? backup : ['XX集团公司'];
  } catch {
    return ['XX集团公司'];
  }
}


/** 指标库：metric_alias_catalog（支持关键字模糊） */
export async function listMetricAliases(keyword?: string): Promise<MetricAliasItem[]> {
  try {
    let q = supabase
      .from('metric_alias_catalog')
      .select('canonical_name,unit')        // 仅选稳定列，避免环境差异导致 400
      .limit(5000);
    if (keyword && keyword.trim()) {
      q = q.ilike('canonical_name', `%${keyword.trim()}%`);
    }
    const { data, error } = await q;
    if (error) throw error;

    return (data || []).map((r: any) => ({
      canonical_name: r?.canonical_name,
      unit: r?.unit ?? undefined,
      description: null                     // 统一置空，兼容 UI typing
    })) as MetricAliasItem[];
  } catch {
    return [
      { canonical_name: '营业收入', unit: '万元', description: null },
      { canonical_name: '净利润', unit: '万元', description: null },
      { canonical_name: 'ROE', unit: '%',   description: null },
      { canonical_name: '总资产周转率', unit: '次', description: null },
      { canonical_name: '经营活动现金流净额', unit: '万元', description: null }
    ];
  }
}

export async function loadCompanyCatalog(): Promise<Array<{
  id: string; parent_id: string | null; company_id: string | null;
  display_name: string; aliases: string[] | null
}>> {
  const { data, error } = await supabase
    .from('company_catalog')
    .select('id,parent_id,company_id,display_name,aliases')
    .order('id', { ascending: true })
    .limit(5000);
  if (error) throw error;
  return (data || []) as any[];
}


