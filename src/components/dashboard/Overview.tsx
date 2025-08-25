import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, LineChart, Plus } from 'lucide-react';
import { calculateChange, formatPercentage, isDemoMode } from '@/lib/utils';
import {
  getPolicyNews,
  type FinancialIndicator,
  type PolicyNewsItem,
} from '@/lib/dataService';
import IndicatorCard from './components/IndicatorCard';
import PolicyNews from './components/PolicyNews';
import AlertBanner from './components/AlertBanner';

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
import toast from 'react-hot-toast';
import { createClient } from '@supabase/supabase-js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

// ====== 环境变量（兼容 Next/Vite）======
const getEnv = (kNext: string, kVite: string) =>
  (typeof process !== 'undefined' ? (process.env as any)[kNext] : undefined) ??
  (typeof import.meta !== 'undefined' ? (import.meta as any).env?.[kVite] : undefined);

const SUPABASE_URL = getEnv('NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL') as string | undefined;
const SUPABASE_KEY = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY') as string | undefined;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// ====== 表名（与你示例一致）======
const FM_TABLE = 'financial_metrics';
const CATALOG_TABLE = 'metric_alias_catalog';

// ====== 指标分类（与 catalog.category 文案一致）======
const INDICATOR_CATEGORIES = [
  { key: '一利五率', label: '一利五率', description: '核心经营效益指标' },
  { key: '盈利能力', label: '盈利能力', description: '盈利水平与质量' },
  { key: '营运能力', label: '营运能力', description: '资产运营效率' },
  { key: '偿债能力', label: '偿债能力', description: '债务偿还能力' },
  { key: '发展能力', label: '发展能力', description: '成长发展潜力' },
  { key: '现金流', label: '现金流', description: '现金流量状况' },
] as const;

// 收藏 Tab
const FAV_TAB_KEY = '__fav__';
const FAV_TAB = { key: FAV_TAB_KEY, label: '我关注的指标', description: '自定义常用指标' };

// ====== 数值显示规则（不加 %）======
const formatNumber = (v: number | null | undefined) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '';
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs > 10000) return Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(Math.round(n));
  if (abs < 1) return n.toFixed(4);
  return n.toFixed(2);
};

// 从任意输入清洗出数值，再按显示规则收敛
const normalizeNumber = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/[%％,\s]/g, '');
  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  const abs = Math.abs(n);
  if (abs > 10000) return Math.round(n);
  if (abs < 1) return Number(n.toFixed(4));
  return Number(n.toFixed(2));
};

const norm = (s: any) => String(s ?? '').trim().replace(/\s+/g, '').toLowerCase();

// ====== 公司与颜色（时间序列用四家公司）======
const COMPANY_LIST = ['XX集团公司', 'XX港口公司', 'XX金融公司', 'XX地产公司'] as const;
type CompanyName = typeof COMPANY_LIST[number];
const COMPANY_COLORS: Record<CompanyName, string> = {
  'XX集团公司': '#2563eb',
  'XX港口公司': '#10b981',
  'XX金融公司': '#f59e0b',
  'XX地产公司': '#ef4444',
};

const FAV_KEY = 'dashboard_favorite_metrics';

interface Alert {
  id: string;
  type: 'warning' | 'error' | 'info';
  title: string;
  message: string;
}

const Overview: React.FC = () => {
  const [indicators, setIndicators] = useState<FinancialIndicator[]>([]);
  const [seriesRows, setSeriesRows] = useState<any[]>([]);
  const [policyNews, setPolicyNews] = useState<PolicyNewsItem[]>([]);
  const [alertsTop, setAlertsTop] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('一利五率');
  const [chartMode, setChartMode] = useState(false);
  const [selectedMetricName, setSelectedMetricName] = useState<string | null>(null);

  // 卡片展示的公司
  const [cardCompany, setCardCompany] = useState<CompanyName>('XX集团公司');

  // 收藏的指标名
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => { void loadData(); }, []);

  useEffect(() => {
    if (!chartMode) return;
    const first = indicators.find(i => i.category === activeCategory && (i as any).companyName === cardCompany);
    setSelectedMetricName(first ? first.name : null);
  }, [activeCategory, indicators, chartMode, cardCompany]);

  useEffect(() => { localStorage.setItem(FAV_KEY, JSON.stringify(favorites)); }, [favorites]);

  const addFavorite = () => {
    const name = (window.prompt('请输入要关注的指标名称：') || '').trim();
    if (!name) return;
    if (favorites.includes(name)) {
      toast('该指标已在关注列表中');
      return;
    }
    setFavorites(prev => [...prev, name]);
    setActiveCategory(FAV_TAB_KEY);
    toast.success('已添加到我关注的指标');
  };

  // === 读取指标（保持你现有实现） ===
  const fetchFromSupabase = async () => {
    const client = supabase;
    if (!client) return { mapped: [] as FinancialIndicator[], series: [] as any[] };

    const selectFM =
      'id,company_id,year,quarter,metric_name,metric_value,business_unit,created_at,updated_at,company_name,baseline_target,last_year_value,last_period_value,source,if_current';

    let { data: curr, error: err1 } = await client.from(FM_TABLE).select(selectFM).eq('if_current', true);
    if (err1) throw err1;

    if (!curr || curr.length === 0) {
      const { data: latest, error: err2 } = await client
        .from(FM_TABLE)
        .select(selectFM)
        .order('year', { ascending: false })
        .order('quarter', { ascending: false })
        .limit(500);
      if (err2) throw err2;
      if (latest && latest.length > 0) {
        const y0 = latest[0].year, q0 = latest[0].quarter;
        curr = latest.filter(r => r.year === y0 && r.quarter === q0);
      } else {
        curr = [];
      }
    }

    const currentRows: any[] = (curr || []).filter(r => (COMPANY_LIST as readonly string[]).includes(r.company_name));

    const { data: catalog, error: err3 } = await client
      .from(CATALOG_TABLE)
      .select('canonical_name, aliases, category');
    if (err3) throw err3;

    const validCats = new Set(INDICATOR_CATEGORIES.map(c => c.key));
    const key2cat = new Map<string, string>();
    (catalog || []).forEach((row: any) => {
      if (!row || !row.category) return;
      if (!validCats.has(row.category)) return;
      const ck = norm(row.canonical_name);
      if (ck) key2cat.set(ck, row.category);
      if (row.aliases) {
        try {
          const arr = JSON.parse(row.aliases);
          if (Array.isArray(arr)) arr.forEach((alias: any) => key2cat.set(norm(alias), row.category));
        } catch { /* ignore */ }
      }
    });

    const mapped: FinancialIndicator[] = [];
    currentRows.forEach((r: any) => {
      const cat = key2cat.get(norm(r.metric_name));
      if (!cat) return;
      const value = normalizeNumber(r.metric_value);
      const prev  = normalizeNumber(r.last_period_value);
      const yoy   = normalizeNumber(r.last_year_value);
      const tgt   = normalizeNumber(r.baseline_target);

      mapped.push({
        id: String(r.id ?? `${r.metric_name}-${r.year}Q${r.quarter}-${r.company_name}`),
        code: r.metric_name,
        name: r.metric_name,
        category: cat,
        value: value ?? 0,
        previousValue: prev ?? undefined,
        lastYearValue: yoy ?? undefined,
        baselineTarget: tgt ?? undefined,
        unit: undefined,
        source: r.source ?? '公司季度财报',
        // @ts-ignore
        recommendedQuestions: [`分析一下${r.metric_name}的变化原因`],
        // @ts-ignore
        trendColorMode: 'inverse',
        // @ts-ignore
        companyName: r.company_name,
      } as unknown as FinancialIndicator);
    });

    const cy = currentRows?.[0]?.year ?? new Date().getFullYear();
    const fromYear = cy - 1;
    const { data: series, error: err4 } = await client
      .from(FM_TABLE)
      .select(selectFM)
      .in('company_name', COMPANY_LIST as unknown as string[])
      .gte('year', fromYear)
      .lte('year', cy)
      .order('year', { ascending: true })
      .order('quarter', { ascending: true });
    if (err4) throw err4;

    return { mapped, series: (series as any[]) || [] };
  };

  // === 加载 ===
  const loadData = async () => {
    setLoading(true);
    try {
      const [{ mapped, series }, policy] = await Promise.all([fetchFromSupabase(), getPolicyNews()]);
      setIndicators(mapped);
      setSeriesRows(series);
      setPolicyNews(policy);

      // 预警：变化幅度绝对值排序取前 3（按当前 cardCompany）
      const top = mapped
        .filter(ind => (ind as any).companyName === cardCompany && ind.previousValue !== undefined)
        .map(ind => {
          const { percentage } = calculateChange(ind.value, ind.previousValue!);
          return {
            id: ind.id,
            type: 'warning' as const,
            title: `${(ind as any).companyName} | ${ind.name}异常波动`,
            message: `${ind.name}较上期变化${formatPercentage(Math.abs(percentage))}，请关注风险`,
            magnitude: Math.abs(percentage || 0),
          };
        })
        .filter(a => a.magnitude > 15)
        .sort((a, b) => b.magnitude - a.magnitude)
        .slice(0, 3)
        .map(({ magnitude, ...rest }) => rest);
      setAlertsTop(top);

      const first = mapped.find(i => i.category === activeCategory && (i as any).companyName === cardCompany);
      setSelectedMetricName(first ? first.name : null);

      toast.success('数据加载完成');
    } catch (e) {
      console.error(e);
      toast.error('数据加载失败，请核对连接与列名');
    } finally {
      setLoading(false);
    }
  };

  // ====== 政策 Tab（完全由 policy_news.category 决定，不写死映射）======
  const [activePolicyTab, setActivePolicyTab] = useState<string>('全部');

  // 去重后的分类集，自动从表中生成
  const policyTabs = useMemo(() => {
    const cats = Array.from(new Set((policyNews || []).map(n => (n.category || '').trim()).filter(Boolean)));
    return ['全部', ...cats];
  }, [policyNews]);

  // 真过滤：根据 Tab 过滤；“全部”不过滤
  const filteredPolicyNews = useMemo(() => {
    if (activePolicyTab === '全部') return policyNews || [];
    return (policyNews || []).filter(n => (n.category || '') === activePolicyTab);
  }, [policyNews, activePolicyTab]);

  // 刷新
  const handleRefresh = async () => {
    setRefreshing(true);
    try { await loadData(); toast.success('数据刷新完成'); }
    catch { toast.error('数据刷新失败'); }
    finally { setRefreshing(false); }
  };

  // 当前期间（优先 if_current）
  const currentPeriod = useMemo(() => {
    if (Array.isArray(seriesRows) && seriesRows.length > 0) {
      const curr = seriesRows.find((r: any) => r.if_current === true);
      if (curr) return `${curr.year}Q${curr.quarter}`;
      const latest = [...seriesRows].sort((a: any, b: any) =>
        a.year === b.year ? a.quarter - b.quarter : a.year - b.year
      ).pop();
      if (latest) return `${latest.year}Q${latest.quarter}`;
    }
    return '当期';
  }, [seriesRows]);

  // 问号点击：使用 动态公司 + 动态期间 + 指标名
  const handleIndicatorQuestion = (ind: FinancialIndicator) => {
    const params = new URLSearchParams();
    params.set('indicator', ind.code);
    const company = (ind as any).companyName || cardCompany;
    const q = `分析一下 ${company} ${currentPeriod} ${ind.name} 的变动原因`;
    params.set('question', q);
    params.set('send', '0'); // 仅预填，不自动发送
    window.location.href = `/dashboard/analysis?${params.toString()}`;
  };

  // 当前分类卡片（按所选公司筛）
  const indicatorsInTab = useMemo(
    () =>
      activeCategory === FAV_TAB_KEY
        ? indicators.filter(
            ind => (ind as any).companyName === cardCompany &&
              favorites.some(f => norm(ind.name).includes(norm(f)))
          )
        : indicators.filter(
            ind => ind.category === activeCategory && (ind as any).companyName === cardCompany
          ),
    [indicators, activeCategory, cardCompany, favorites]
  );

  // 时间序列（四家公司一起）
  const chartData = useMemo(() => {
    if (!seriesRows.length || !selectedMetricName) return null;
    const labels = Array.from(new Set(seriesRows.map((r: any) => `${r.year}Q${r.quarter}`))).sort((a,b)=> a>b?1:-1);
    const companies: ReadonlyArray<CompanyName> = COMPANY_LIST;

    const datasets = companies.map(c => {
      const color = COMPANY_COLORS[c];
      const data = labels.map(l => {
        const [y,q] = l.split('Q').map(Number);
        const row = seriesRows.find((r:any) => r.company_name===c && r.metric_name===selectedMetricName && r.year===y && r.quarter===q);
        const v = normalizeNumber(row?.metric_value ?? null);
        return v==null ? null : v;
      });
      return { label: c, data, spanGaps: true, tension: 0.25, borderColor: color, backgroundColor: color };
    });

    return { labels, datasets };
  }, [seriesRows, selectedMetricName]);

  // 时间序列顶部指标 Tab
  const metricTabs = useMemo(
    () =>
      (activeCategory === FAV_TAB_KEY
        ? indicators.filter(ind => (ind as any).companyName === cardCompany && favorites.some(f => norm(ind.name).includes(norm(f))))
        : indicators.filter(ind => ind.category === activeCategory && (ind as any).companyName === cardCompany)
      )
        .map(i => i.name)
        .filter((v, i, arr) => arr.indexOf(v) === i),
    [indicators, activeCategory, cardCompany, favorites]
  );

  // 下拉切换公司
  const updateCompany = (next: CompanyName) => {
    setCardCompany(next);

    const first = indicators.find(i =>
      activeCategory === FAV_TAB_KEY
        ? (i as any).companyName === next && favorites.some(f => norm(i.name).includes(norm(f)))
        : i.category === activeCategory && (i as any).companyName === next
    );
    setSelectedMetricName(first ? first.name : null);

    const top = indicators
      .filter(ind => (ind as any).companyName === next && ind.previousValue !== undefined)
      .map(ind => {
        const { percentage } = calculateChange(ind.value, ind.previousValue!);
        return {
          id: ind.id,
          type: 'warning' as const,
          title: `${(ind as any).companyName} | ${ind.name}异常波动`,
          message: `${ind.name}较上期变化${formatPercentage(Math.abs(percentage))}，请关注风险`,
          magnitude: Math.abs(percentage || 0),
        };
      })
      .filter(a => a.magnitude > 15)
      .sort((a, b) => b.magnitude - a.magnitude)
      .slice(0, 3)
      .map(({ magnitude, ...rest }) => rest);
    setAlertsTop(top);
  };

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">综合概览</h1>
            <p className="mt-2 text-gray-600">实时监控企业财务指标、政策动态和预警信息</p>
            {isDemoMode() && (
              <div className="mt-2">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">演示模式</span>
              </div>
            )}
          </div>
          <div className="flex space-x-2">
            <button onClick={handleRefresh} disabled={refreshing}
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? '刷新中...' : '刷新数据'}
            </button>
          </div>
        </div>
      </div>

      {/* 预警 Banner */}
      {alertsTop.length > 0 && (
        <AlertBanner alerts={alertsTop} onClose={(id) => setAlertsTop(prev => prev.filter(a => a.id !== id))} />
      )}

      {/* 经营概览（指标卡 / 时间序列，保持不变） */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">经营概览</h2>
            <p className="text-sm text-gray-500 mt-1">核心财务指标实时监控</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setChartMode(m => !m)}
              className={`inline-flex items-center px-3 py-2 rounded-md border text-sm ${chartMode ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
              title={chartMode ? '切换为指标卡' : '切换为时间序列图'}>
              <LineChart className="h-4 w-4 mr-1" />
              {chartMode ? '指标卡' : '时间序列'}
            </button>

            <label className="sr-only">选择公司</label>
            <select
              value={cardCompany}
              onChange={(e) => updateCompany(e.target.value as CompanyName)}
              className="px-3 py-2 rounded-md border bg-white text-sm text-gray-700 hover:bg-gray-50 border-gray-300"
              title="选择卡片展示公司"
            >
              {(COMPANY_LIST as readonly CompanyName[]).map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 分类 Tab + “我关注的指标” */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex items-center justify-between px-6" aria-label="Tabs">
            <div className="flex space-x-8">
              {INDICATOR_CATEGORIES.map((c) => {
                const isActive = activeCategory === c.key;
                return (
                  <button key={c.key} onClick={() => setActiveCategory(c.key)}
                    className={`${isActive ? 'border-purple-500 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'} whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}>
                    {c.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center">
              <button
                onClick={() => setActiveCategory(FAV_TAB_KEY)}
                className={`${activeCategory === FAV_TAB_KEY ? 'border-purple-500 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'} whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
                title="我关注的指标"
              >
                我关注的指标
              </button>
              <button
                onClick={addFavorite}
                className="ml-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-purple-50 text-purple-600 hover:bg-purple-100 border border-purple-200"
                title="添加关注指标"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </nav>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-500">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" /> 正在加载财务指标数据...
            </div>
          ) : chartMode ? (
            <>
              {/* 指标切换 */}
              <div className="mb-4 flex flex-wrap gap-2">
                {metricTabs.length === 0 ? (
                  <span className="text-gray-400 text-sm">暂无可绘制的指标</span>
                ) : metricTabs.map(name => {
                  const active = name === selectedMetricName;
                  return (
                    <button key={name} onClick={() => setSelectedMetricName(name)}
                      className={`px-3 py-1 rounded-full text-sm border ${active ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                      title={name}>
                      {name}
                    </button>
                  );
                })}
              </div>

              {/* 折线图 */}
              {chartData && chartData.labels.length > 0 && selectedMetricName ? (
                <>
                  <Line
                    data={chartData}
                    options={{
                      responsive: true,
                      plugins: {
                        legend: { display: true, position: 'bottom' },
                        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label || ''}: ${formatNumber(ctx.parsed.y)}` } }
                      },
                      scales: { y: { ticks: { callback: (v: any) => `${formatNumber(v)}` } } }
                    }}
                  />
                  <div className="mt-2 text-xs text-gray-500">
                    展示范围：上一年至本年（按季度）；公司：{(COMPANY_LIST as readonly string[]).join('、')}
                  </div>
                </>
              ) : (
                <div className="text-center py-12 text-gray-500">暂无可绘制的时间序列数据</div>
              )}
            </>
          ) : (
            indicatorsInTab.length > 0 ? (
              <>
                <div className="mb-6 p-4 bg-blue-50 rounded-lg">
                  <h3 className="text-lg font-medium text-blue-900 mb-1">
                    {(activeCategory === FAV_TAB_KEY ? FAV_TAB.label : INDICATOR_CATEGORIES.find(cat => cat.key === activeCategory)?.label) || ''}
                  </h3>
                  <p className="text-sm text-blue-700">
                    {(activeCategory === FAV_TAB_KEY ? FAV_TAB.description : INDICATOR_CATEGORIES.find(cat => cat.key === activeCategory)?.description) || ''}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {indicatorsInTab.map(indicator => (
                    <IndicatorCard
                      key={indicator.id}
                      indicator={indicator}
                      period={currentPeriod}
                      companyForQuestion={cardCompany}
                      onQuestionClick={() => handleIndicatorQuestion(indicator)}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <p>
                  {activeCategory === FAV_TAB_KEY
                    ? '暂无关注的指标，点击右上角“＋”添加'
                    : `${cardCompany} 在该分类下暂无财务指标数据`}
                </p>
                <button onClick={handleRefresh} className="mt-2 text-blue-600 hover:text-blue-800">点击重新加载</button>
              </div>
            )
          )}
        </div>
      </div>

      {/* 政策动态（Tab 从 policy_news.category 动态生成） */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">政策动态</h2>
            <p className="text-sm text-gray-500 mt-1">按板块快速浏览与分析</p>
          </div>
          <nav className="flex items-center space-x-4" aria-label="Policy Tabs">
            {policyTabs.map(t => {
              const active = activePolicyTab === t;
              return (
                <button
                  key={t}
                  onClick={() => setActivePolicyTab(t)}
                  className={`whitespace-nowrap py-1.5 px-3 rounded-md text-sm border
                    ${active ? 'border-purple-500 text-purple-600 bg-purple-50' : 'border-transparent text-gray-600 hover:text-gray-800 hover:border-gray-200'}`}
                >
                  {t}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-500">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" /> 正在加载政策动态数据...
            </div>
          ) : (filteredPolicyNews.length > 0) ? (
            <PolicyNews news={filteredPolicyNews} onQuestionClick={() => {}} />
          ) : (
            <div className="text-center py-12 text-gray-500">
              <p>暂无政策动态数据</p>
              <button onClick={handleRefresh} className="mt-2 text-purple-600 hover:text-purple-800">
                点击重新加载
              </button>
            </div>
          )}
        </div>
      </div>

    </div>
  );
};

export default Overview;
