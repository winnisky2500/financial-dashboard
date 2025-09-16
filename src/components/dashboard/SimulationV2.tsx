import React, { useEffect, useState } from 'react';
import {
  seedSimulationV2,
  runSimulationV2,
  uploadRunAttachment,
  listRunHistory,
  listRunArtifacts,
  quickLookupSensitivity,
  type SensitivityRow as V2SensitivityRow,
  saveReportMdV2,
  beautifyReportMdV2
} from '@/lib/dataServiceV2';
import { supabase } from '@/lib/supabase';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid
} from 'recharts';


const AGENT_URL = (import.meta as any).env?.VITE_SIMULATION_AGENT_URL
  || (import.meta as any).env?.VITE_BACKEND_URL
  || '';

const SimulationV2: React.FC = () => {
  const [question, setQuestion] = useState('');
  const [runId, setRunId] = useState<string>('');
  const [thinking, setThinking] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<V2SensitivityRow[]>([]);
  const [arima, setArima] = useState({ enabled: true, p: 1, d: 1, q: 1, periods: 8 });
  const [mc, setMc] = useState({ enabled: true, samples: 1000, quantiles: [0.1, 0.5, 0.9] as number[] });
  const [attachments, setAttachments] = useState<File[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [artifacts, setArtifacts] = useState<any[]>([]);
  const [seedResp, setSeedResp] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [folded, setFolded] = useState(true);              // 敏感性表默认折叠
  const [foldedScenario, setFoldedScenario] = useState(true); // 新增：情景冲击折叠
  const [foldedArima, setFoldedArima] = useState(true);       // 新增：ARIMA 折叠
  const [foldedMc, setFoldedMc] = useState(true);             // 新增：MC 折叠

  const [csvUrl, setCsvUrl] = useState<string>('');
  const [xlsxUrl, setXlsxUrl] = useState<string>('');         // 新增：xlsx 下载链接
  const [mdUrl, setMdUrl]   = useState<string>('');
  const [tableRows, setTableRows] = useState<string[][]>([]);
  const [scenarioRows, setScenarioRows] = useState<{factor:string; optimistic:number; base:number; pessimistic:number;}[]>([]); // 新增
  const [mdRaw, setMdRaw] = useState<string>('');                // 新增：MD 原文
  const [mdLoading, setMdLoading] = useState<boolean>(false);    // 新增：加载状态
  const [showMdPreview, setShowMdPreview] = useState<boolean>(true); // 新增：预览/编辑切换
  const [chartData, setChartData] = useState<any[]>([]);
  const [metricOptions, setMetricOptions] = useState<string[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<string>('');
  const [scenarioOptions, setScenarioOptions] = useState<string[]>([]);
  const [selectedScenarios, setSelectedScenarios] = useState<string[]>([]);
  const [seriesMap, setSeriesMap] = useState<Record<string, Record<string, (number|null)[]>>>({});
  const [periodLabels, setPeriodLabels] = useState<string[]>([]);

  // 固定的场景配色，避免默认同色
  const SCEN_COLORS: Record<string, string> = {
    'ARIMA基线': '#1f77b4',
    '情景-悲观': '#d62728',
    '情景-平缓': '#2ca02c',
    '情景-乐观': '#ff7f0e',
    'MC(p10)':   '#9467bd',
    'MC(p50)':   '#8c564b',
    'MC(p90)':   '#17becf',
  };

  // 数值格式化（确定性）：|x|>=10000 → m.mmme±k；|x|>=1 取整；|x|<1 保留三位有效数字
    const formatSci = (v: any) => {
    const num = Number(v);
    if (!Number.isFinite(num)) return '';
    const abs = Math.abs(num);
    if (abs >= 10000) {
      const exp = Math.floor(Math.log10(abs));
      const mant = num / Math.pow(10, exp);
      const m = mant.toFixed(3);
      const sign = exp >= 0 ? '+' : '';
      return `${m}e${sign}${exp}`;
    }
    if (abs >= 1) return Math.round(num).toString();
    return num.toPrecision(3);
  };

  // 按当前曲线值估算 Y 轴刻度标签的最大宽度（像素），用于自适应留白
  const estimateYAxisWidth = (data: any[], seriesKeys: string[]) => {
    try {
      let maxLen = 0;
      for (const row of data || []) {
        for (const k of seriesKeys || []) {
          const v = row?.[k];
          if (typeof v === 'number' && isFinite(v)) {
            const s = formatSci(v);
            if (s.length > maxLen) maxLen = s.length;
          }
        }
      }
      // 字符宽粗略估 8px，再加边距；限定最小/最大
      return Math.min(140, Math.max(80, maxLen * 8 + 28));
    } catch {
      return 96;
    }
  };

    // 根据期数自适应压缩X轴刻度，避免重叠
  const getTickInterval = (n: number) => {
    if (n <= 8) return 0;        // 全部显示
    if (n <= 12) return 1;       // 隔1个
    if (n <= 20) return 2;       // 隔2个
    return Math.ceil(n / 10);    // 更长时动态压缩
  };

  useEffect(() => {
    (async () => {
      try {
        const h = await listRunHistory();
        setHistory(h.runs || []);
      } catch (e) {
        // ignore
      }
    })();
  }, []);

useEffect(() => {
  if (!selectedMetric || !periodLabels.length) {
    setChartData([]);
    return;
  }
  const scenMap = seriesMap[selectedMetric] || {};
  const data = periodLabels.map((p, idx) => {
    const row: any = { period: p };
    (selectedScenarios || []).forEach(sc => {
      const arr = scenMap[sc] || [];
      row[sc] = arr[idx] ?? null;
    });
    return row;
  });
  setChartData(data);
}, [selectedMetric, selectedScenarios, seriesMap, periodLabels]);

  const pushLog = (s: string) => setThinking((prev) => [...prev, `${new Date().toLocaleTimeString()} ${s}`]);

  const handleUpload = async () => {
    if (!runId) {
      pushLog('请先执行“解析（Seed）”以生成 run_id');
      return;
    }
    for (const f of attachments) {
      pushLog(`上传附件：${f.name}`);
      await uploadRunAttachment(runId, f);
    }
    pushLog('附件上传完成。');
  };

  const onSeed = async () => {
    if (!question.trim()) return;
    setRunning(true);
    setThinking([]);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      if (!uid) {
        pushLog('未登录：无法创建模拟运行。请先登录后再试。');
        setRunning(false);
        return;
      }

      pushLog('调用 /seed：解析公司、自变量X、因变量Y…');
      const r = await seedSimulationV2(question, runId || undefined, uid);
      setRunId(r.run_id);

      setSeedResp(r);
        pushLog(`Seed 完成，run_id=${r.run_id}，公司=${r.company}。`);
        if ((r as any).thinking && Array.isArray((r as any).thinking)) {
          (r as any).thinking.forEach((msg: string) => pushLog(`LLM：${msg}`));
        }
      setCandidates(r.candidates || []);
      setArima({ ...arima, ...r.arima_defaults });
      setMc({ ...mc, quantiles: r.quantiles || mc.quantiles });
      setFolded(false);
      setFoldedScenario(false);
      setFoldedArima(false);
      setFoldedMc(false);

      // 初始化情景冲击（优先用 LLM 返回，其次用候选行的自变量名称）
      try {
        const sj = JSON.parse((r as any).scenario_llm_json || '{}');
        const ass: any[] = Array.isArray(sj?.assumptions) ? sj.assumptions : [];
        const rows = ass.map(a => ({
          factor: a.factor || '',
          optimistic: Number(a.optimistic ?? 0.05),
          base: Number(a.base ?? 0.0),
          pessimistic: Number(a.pessimistic ?? -0.05),
        })).filter(x => x.factor);
        if (rows.length) {
          setScenarioRows(rows);
        } else {
          const factors = Array.from(new Set((r.candidates || []).map((c:any)=>c.factor_name).filter(Boolean)));
          setScenarioRows(factors.map((f:string)=>({ factor:f, optimistic:0.05, base:0, pessimistic:-0.05 })));
        }
      } catch {
        const factors = Array.from(new Set((r.candidates || []).map((c:any)=>c.factor_name).filter(Boolean)));
        setScenarioRows(factors.map((f:string)=>({ factor:f, optimistic:0.05, base:0, pessimistic:-0.05 })));
      }

    } catch (e: any) {
      pushLog(`Seed 失败：${e.message || e}`);
    } finally {
      setRunning(false);
    }
  };
      // 显示来源（统一中文）：db/llm/user/用户填入 → 数据库/大模型生成/用户填入
  const sourceLabel = (s?: string) => {
    const key = (s || '').toString().toLowerCase();
    if (key === 'db' || key === 'database') return '数据库';
    if (key === 'llm' || key === 'ai' || key === 'model') return '大模型生成';
    if (key === 'user' || s === '用户填入') return '用户填入';
    return s || '';
  };

  const onQuickLookup = async (idx: number) => {
    const row = candidates[idx];
    const r = await quickLookupSensitivity(row.company_name, row.canonical_metric, row.factor_name, runId || undefined);
    const next = [...candidates];
      next[idx] = { 
        ...row, 
        elasticity_value: r.elasticity_value ?? null, 
        lag_quarters: typeof r.lag_quarters === 'number' ? r.lag_quarters : row.lag_quarters,
        shock_unit: (r.shock_unit as V2SensitivityRow['shock_unit']) || row.shock_unit,
        source_method: r.source_method || (r.elasticity_value != null ? 'db' : row.source_method),
        note: r.note ?? row.note,
        seasonal_adjust: r.seasonal_adjust ?? (row as any).seasonal_adjust ?? null,
        seasonality_source: r.seasonality_source ?? (row as any).seasonality_source ?? null,
        seasonality_note: r.seasonality_note ?? (row as any).seasonality_note ?? null,
        seasonality_q1: (r as any).seasonality_q1 ?? (row as any).seasonality_q1 ?? null,
        seasonality_q2: (r as any).seasonality_q2 ?? (row as any).seasonality_q2 ?? null,
        seasonality_q3: (r as any).seasonality_q3 ?? (row as any).seasonality_q3 ?? null,
        seasonality_q4: (r as any).seasonality_q4 ?? (row as any).seasonality_q4 ?? null,
      };


    setCandidates(next);
  };


  const onRun = async () => {
    if (!runId) { pushLog('请先完成 Seed。'); return; }
    setRunning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      if (!uid) {
        pushLog('未登录：无法运行推演。请先登录后再试。');
        setRunning(false);
        return;
      }

      pushLog('调用 /run：取数→ARIMA基线→MonteCarlo情景→产出表与报告…');
            const payload = {
        run_id: runId,
        sensitivity_rows: candidates,
        models: { arima, monte_carlo: mc },
        horizon_quarters: arima.periods,
        session_user_id: uid,
        skip_report: false, // 正常运行：生成 MD
        scenario_deltas: scenarioRows, // 新增：把情景冲击传给后端
      };


      const r = await runSimulationV2(payload);
      pushLog(`Run 完成：CSV=${r.wide_table_url}，报告=${r.report_url}`);
      if ((r as any).thinking && Array.isArray((r as any).thinking)) {
        (r as any).thinking.forEach((msg: string) => pushLog(`LLM：${msg}`));
      }

      const arts = await listRunArtifacts(runId);
      await pickUrlsFromArtifacts(arts.artifacts || []);

    } catch (e: any) {
      pushLog(`Run 失败：${e.message || e}`);
    } finally {
      setRunning(false);
    }
  };
  const onRerunFast = async () => {
    if (!runId) { pushLog('请先完成 Seed。'); return; }
    setRunning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      if (!uid) {
        pushLog('未登录：无法运行推演。请先登录后再试。');
        setRunning(false);
        return;
      }

      pushLog('快速再生成：仅数学重算 CSV，不生成 MD…');
            const payload = {
        run_id: runId,
        sensitivity_rows: candidates,
        models: { arima, monte_carlo: mc },
        horizon_quarters: arima.periods,
        session_user_id: uid,
        skip_report: true, // 仅CSV
        scenario_deltas: scenarioRows, // 新增
      };

      const r = await runSimulationV2(payload);
      const arts = await listRunArtifacts(runId);
      await pickUrlsFromArtifacts(arts.artifacts || []);
      pushLog('快速再生成完成。');
    } catch (e: any) {
      pushLog(`快速再生成失败：${e.message || e}`);
    } finally {
      setRunning(false);
    }
  };



  const addCandidateRow = () => {
    setCandidates(prev => [
      ...prev,
      {
        company_name: seedResp?.company || 'XX集团公司',
        canonical_metric: '', factor_name: '',
        elasticity_value: null, lag_quarters: 0, shock_unit: 'percent',
        seasonal_adjust: null, seasonality_source: null, seasonality_note: null,
        seasonality_q1: null, seasonality_q2: null, seasonality_q3: null, seasonality_q4: null
      }

    ]);
  };
  const parseCsv = (text: string): string[][] => {
    const lines = text.trim().split(/\r?\n/);
    return lines.map(line => {
      // 简单 CSV：本项目的导出不含逗号包裹的文本
      return line.split(',').map(c => c.trim());
    });
  };
    // --- 轻量 Markdown 渲染（无第三方依赖，UTF-8 文本已由 loadMdIntoEditor 保证） ---
  const escapeHtml = (s: string) =>
    s.replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'} as any)[ch]);

  const escapeInline = (s: string) => {
    s = escapeHtml(s);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    return s;
  };

  const mdToHtml = (md: string) => {
    const lines = md.split(/\r?\n/);
    const out: string[] = [];
    let inCode = false;
    let inList = false;

    const endList = () => { if (inList) { out.push('</ul>'); inList = false; } };

    for (let raw of lines) {
      const line = raw ?? '';
      if (line.trim().startsWith('```')) {
        if (!inCode) { endList(); inCode = true; out.push('<pre><code>'); }
        else { inCode = false; out.push('</code></pre>'); }
        continue;
      }
      if (inCode) { out.push(escapeHtml(line)); continue; }

      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        endList();
        const level = h[1].length;
        out.push(`<h${level}>${escapeInline(h[2])}</h${level}>`);
        continue;
      }

      const li = line.match(/^\s*[-*]\s+(.*)$/);
      if (li) {
        if (!inList) { inList = true; out.push('<ul>'); }
        out.push(`<li>${escapeInline(li[1])}</li>`);
        continue;
      } else {
        endList();
      }

      if (line.trim() === '') { out.push('<br/>'); continue; }
      out.push(`<p>${escapeInline(line)}</p>`);
    }
    endList();
    return out.join('\n');
  };

  const loadMdIntoEditor = async (url: string) => {
    if (!url) return;
    setMdLoading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('下载MD失败');
      const buf = await res.arrayBuffer();
      const txt = new TextDecoder('utf-8').decode(buf); // 强制 UTF-8，避免乱码
      setMdRaw(txt);
    } catch (e:any) {
      pushLog(`加载MD失败：${e.message || e}`);
      setMdRaw('');
    } finally {
      setMdLoading(false);
    }
  };

  const loadCsvIntoTable = async (url: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('下载CSV失败');
      const txt = await res.text();
      const rows = parseCsv(txt);
      setTableRows(rows);

      // === 组织为 seriesMap[metric][scenario] = 数组 ===
      if (!rows.length) {
        setChartData([]); setSeriesMap({}); setMetricOptions([]);
        setSelectedMetric(''); setScenarioOptions([]); setSelectedScenarios([]);
        setPeriodLabels([]);
        return;
      }
      const header = rows[0] || [];
      if (header.length < 3) {
        setChartData([]); setSeriesMap({}); setMetricOptions([]);
        setSelectedMetric(''); setScenarioOptions([]); setSelectedScenarios([]);
        setPeriodLabels([]);
        return;
      }
      const periods = header.slice(2);
      setPeriodLabels(periods as string[]);

      const m: Record<string, Record<string, (number|null)[]>> = {};
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r.length) continue;
        if ((r[0] || '').startsWith('情景参数')) break;

        const metric = (r[0] || '').trim();
        const scen = (r[1] || '').trim();
        if (!metric || !scen) continue;
        const values = r.slice(2).map(v => v === '' ? null : Number(v));

        if (!m[metric]) m[metric] = {};
        m[metric][scen] = values;
      }

      const metrics = Object.keys(m);
      setSeriesMap(m);
      setMetricOptions(metrics);

      // 默认选择：第一个指标 + 常用三条
      const defaultMetric = metrics[0] || '';
      const scenOps = Object.keys(m[defaultMetric] || {});
      setSelectedMetric(defaultMetric);
      setScenarioOptions(scenOps);

      // 默认优先三条：ARIMA基线 / 情景-平缓 / MC(p50)
      const prefer = ['ARIMA基线','情景-平缓','MC(p50)'];
      const chosen = prefer.filter(s => scenOps.includes(s));
      setSelectedScenarios(chosen.length ? chosen : scenOps.slice(0, Math.min(3, scenOps.length)));
    } catch (e: any) {
      pushLog(`加载CSV失败：${e.message || e}`);
      setTableRows([]);
      setChartData([]);
      setSeriesMap({});
      setMetricOptions([]);
      setSelectedMetric('');
      setScenarioOptions([]);
      setSelectedScenarios([]);
      setPeriodLabels([]);
    }
  };



  const pickUrlsFromArtifacts = async (arts: any[]) => {
    setArtifacts(arts || []);
    const csv = arts.find(a => a.artifact_type === 'csv' || (a.storage_url || '').endsWith('.csv'));
    const xlsx = arts.find(a => a.artifact_type === 'xlsx' || (a.storage_url || '').endsWith('.xlsx')); // 新增
    const md  = arts.find(a => a.artifact_type === 'md'  || (a.storage_url || '').endsWith('.md'));
    const csvLink = csv?.storage_url || '';
    const xlsxLink = xlsx?.storage_url || '';
    const mdLink  = md?.storage_url  || '';
    setCsvUrl(csvLink);
    setXlsxUrl(xlsxLink);
    setMdUrl(mdLink);
    if (csvLink) await loadCsvIntoTable(csvLink);
    if (mdLink) await loadMdIntoEditor(mdLink);
  };


  
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-indigo-900">模拟分析 2</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async ()=>{
              try {
                const res = await fetch(`${AGENT_URL}/simulation_v2/history`, { method: 'GET' });
                if (!res.ok) throw new Error(await res.text());
                pushLog('连通性测试成功：/simulation_v2/history 可访问');
              } catch (e:any) {
                pushLog(`连通性测试失败：${e.message || e}`);
              }
            }}
            className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
          >
            测试连接
          </button>
          {runId && (
            <span className="text-xs px-2 py-1 bg-indigo-50 text-indigo-600 rounded">
              run_id: {runId}
            </span>
          )}
        </div>
      </div>


      {/* 1) 问题 + 附件 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <label className="block text-sm text-gray-600 mb-1">提出你的假设/政策/事件</label>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="w-full h-28 bg-white text-gray-900 px-4 py-3 rounded-lg border border-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            placeholder="例如：请通过附件里的BDI指数预测哪些航线的营业收入会有变动"
          />
          <div className="mt-3 flex items-center gap-3">
            <input
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv"
              onChange={(e) => setAttachments(Array.from(e.target.files || []))}
            />
            <button
              onClick={onSeed}
              disabled={running}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
            >
              提问
            </button>
          </div>
        </div>

        {/* 思考过程 */}
        <div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 h-40 overflow-auto">
            <div className="text-xs text-gray-500 mb-2">思考过程 / 执行日志</div>
            <ul className="space-y-1 text-xs text-gray-700">
              {thinking.map((t, i) => <li key={i}>• {t}</li>)}
            </ul>
          </div>
        </div>
      </div>

      {/* 2) 敏感性窗口表（可编辑） */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-indigo-900">自变量-因变量敏感性</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFolded(f => !f)}
              className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded border border-gray-200"
            >
              {folded ? '展开' : '折叠'}
            </button>
            <button onClick={addCandidateRow} className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded border border-indigo-200">+ 添加一行</button>
          </div>
        </div>

        {!folded && (
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-200 rounded-lg">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-3 py-2 text-left text-xs text-gray-600">公司</th>
          <th className="px-3 py-2 text-left text-xs text-gray-600">因变量（标准名）</th>
          <th className="px-3 py-2 text-left text-xs text-gray-600">自变量（标准名）</th>
          <th className="px-3 py-2 text-right text-xs text-gray-600">敏感性 β</th>
          <th className="px-3 py-2 text-right text-xs text-gray-600">滞后季度</th>
          <th className="px-3 py-2 text-left text-xs text-gray-600">单位</th>
          <th className="px-3 py-2 text-right text-xs text-gray-600">季节调整</th>
          <th className="px-3 py-2 text-right text-xs text-gray-600">Q1</th>
          <th className="px-3 py-2 text-right text-xs text-gray-600">Q2</th>
          <th className="px-3 py-2 text-right text-xs text-gray-600">Q3</th>
          <th className="px-3 py-2 text-right text-xs text-gray-600">Q4</th>
          <th className="px-3 py-2 text-left text-xs text-gray-600">来源</th>
          <th className="px-3 py-2 text-center text-xs text-gray-600">快速匹配</th>
          <th className="px-3 py-2 text-center text-xs text-gray-600">操作</th>
        </tr>
      </thead>
              <tbody className="divide-y divide-gray-100">
                {candidates.map((row, idx) => (
                  <tr key={idx} className="bg-white">
                    <td className="px-3 py-2">
                      <input value={row.company_name} onChange={(e)=> {
                        const next=[...candidates]; next[idx]={...row, company_name:e.target.value}; setCandidates(next);
                      }} className="w-40 border border-gray-200 rounded px-2 py-1 text-sm"/>
                    </td>
                    <td className="px-3 py-2">
                      <input value={row.canonical_metric} onChange={(e)=> {
                        const next=[...candidates]; next[idx]={...row, canonical_metric:e.target.value}; setCandidates(next);
                      }} className="w-48 border border-gray-200 rounded px-2 py-1 text-sm"/>
                    </td>
                    <td className="px-3 py-2">
                      <input value={row.factor_name} onChange={(e)=> {
                        const next=[...candidates]; next[idx]={...row, factor_name:e.target.value}; setCandidates(next);
                      }} className="w-48 border border-gray-200 rounded px-2 py-1 text-sm"/>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" step="0.01"
                        value={row.elasticity_value ?? ''} placeholder="留空表示未知"
                        onChange={(e)=> {
                          const v = e.target.value === '' ? null : Number(e.target.value);
                          const next=[...candidates]; 
                          next[idx]={...row, elasticity_value:v, source_method: '用户填入'}; 
                          setCandidates(next);
                        }}
                        className="w-32 border border-gray-200 rounded px-2 py-1 text-sm text-right"/>
                    </td>

                    <td className="px-3 py-2 text-right">
                      <input type="number" value={row.lag_quarters}
                        onChange={(e)=> {
                          const v = parseInt(e.target.value || '0', 10);
                          const next=[...candidates];
                          next[idx]={...row, lag_quarters: (isNaN(v)?0:v), source_method: '用户填入'};
                          setCandidates(next);
                        }}
                        className="w-16 border border-gray-200 rounded px-2 py-1 text-sm text-right"/>

                    </td>
                    <td className="px-3 py-2">
                      <select value={row.shock_unit}
                        onChange={(e)=> {
                          const unit = e.target.value as V2SensitivityRow['shock_unit'];
                          const next=[...candidates]; next[idx]={...row, shock_unit: unit}; setCandidates(next);
                        }}
                        className="w-28 border border-gray-200 rounded px-2 py-1 text-sm">
                        <option value="percent">percent</option>
                        <option value="abs">abs</option>
                        <option value="bp">bp</option>
                      </select>

                    </td>
                    <td className="px-3 py-2">
                      <input type="checkbox"
                        checked={!!(row as any).seasonal_adjust}
                        onChange={(e)=>{
                          const next=[...candidates];
                          next[idx]={...row, seasonal_adjust: e.target.checked, seasonality_source: '用户填入'};
                          setCandidates(next);
                        }} />
                    </td>
                    {([1,2,3,4] as const).map(q => (
                      <td key={q} className="px-3 py-2 text-right">
                        <input type="number" step="0.01" placeholder=""
                          value={(row as any)[`seasonality_q${q}`] ?? ''}
                          onChange={(e)=>{
                            const v = e.target.value === '' ? null : Number(e.target.value);
                            const next=[...candidates];
                            next[idx]={...row, [`seasonality_q${q}`]: v, seasonality_source: '用户填入'} as any;
                            setCandidates(next);
                          }}
                          className="w-20 border border-gray-200 rounded px-2 py-1 text-sm text-right"/>
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      <span className="text-xs text-gray-700">
                        {(() => {
                          const a = sourceLabel((row as any).seasonality_source as any);
                          const b = sourceLabel(row.source_method);
                          if (a && b && a !== b) return `${a}/${b}`;
                          return b || a || '';
                        })()}
                      </span>
                    </td>

                    <td className="px-3 py-2 text-center">
                      <button onClick={()=>onQuickLookup(idx)} className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded">查库填值</button>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button onClick={()=>{
                        const next = candidates.filter((_,i)=>i!==idx); setCandidates(next);
                      }} className="text-xs px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded">删除</button>
                    </td>


                  </tr>
                ))}
                {candidates.length === 0 && (
                  <tr><td colSpan={14} className="px-3 py-6 text-center text-sm text-gray-500">请先“解析（Seed）”或手动添加一行</td></tr>
                )}


              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* 情景冲击（ΔX，单位：percent，可编辑） */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-gray-800">情景冲击（ΔX，单位：percent）</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFoldedScenario(v => !v)}
              className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded border border-gray-200"
            >
              {foldedScenario ? '展开' : '折叠'}
            </button>
            <button
              onClick={()=>{
                setScenarioRows(prev=>[...prev, {factor:'', optimistic:0.05, base:0, pessimistic:-0.05}]);
              }}
              className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded border border-indigo-200"
            >
              + 添加因子
            </button>
          </div>
        </div>

        {!foldedScenario && (
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-200 rounded-lg text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs text-gray-600">自变量（factor）</th>
                <th className="px-3 py-2 text-right text-xs text-gray-600">悲观</th>
                <th className="px-3 py-2 text-right text-xs text-gray-600">平缓</th>
                <th className="px-3 py-2 text-right text-xs text-gray-600">乐观</th>
                <th className="px-3 py-2 text-center text-xs text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {scenarioRows.map((r, i)=>(
                <tr key={i}>
                  <td className="px-3 py-2">
                    <input value={r.factor} onChange={e=>{
                      const next=[...scenarioRows]; next[i]={...r, factor:e.target.value}; setScenarioRows(next);
                    }} className="w-56 border border-gray-200 rounded px-2 py-1"/>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" step="0.01" value={r.pessimistic} onChange={e=>{
                      const v=Number(e.target.value||0); const next=[...scenarioRows]; next[i]={...r, pessimistic:v}; setScenarioRows(next);
                    }} className="w-24 border border-gray-200 rounded px-2 py-1 text-right"/>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" step="0.01" value={r.base} onChange={e=>{
                      const v=Number(e.target.value||0); const next=[...scenarioRows]; next[i]={...r, base:v}; setScenarioRows(next);
                    }} className="w-24 border border-gray-200 rounded px-2 py-1 text-right"/>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" step="0.01" value={r.optimistic} onChange={e=>{
                      const v=Number(e.target.value||0); const next=[...scenarioRows]; next[i]={...r, optimistic:v}; setScenarioRows(next);
                    }} className="w-24 border border-gray-200 rounded px-2 py-1 text-right"/>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={()=>{
                      const next=scenarioRows.filter((_,idx)=>idx!==i); setScenarioRows(next);
                    }} className="text-xs px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded">删除</button>
                  </td>
                </tr>
              ))}
              {scenarioRows.length===0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-gray-500">暂无情景冲击，请添加</td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>


      {/* 3) 模型参数 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-gray-800">ARIMA 参数</div>
            <button
              onClick={() => setFoldedArima(v => !v)}
              className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded border border-gray-200 text-xs"
            >
              {foldedArima ? '展开' : '折叠'}
            </button>
          </div>
          {!foldedArima && (
            <div className="grid grid-cols-4 gap-3">
              <label className="text-xs text-gray-600">p
                <input type="number" value={arima.p} min={0} max={5} onChange={(e)=>setArima({...arima, p: parseInt(e.target.value)})}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-sm"/>
              </label>
              <label className="text-xs text-gray-600">d
                <input type="number" value={arima.d} min={0} max={2} onChange={(e)=>setArima({...arima, d: parseInt(e.target.value)})}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-sm"/>
              </label>
              <label className="text-xs text-gray-600">q
                <input type="number" value={arima.q} min={0} max={5} onChange={(e)=>setArima({...arima, q: parseInt(e.target.value)})}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-sm"/>
              </label>
              <label className="text-xs text-gray-600">预测期
                <input type="number" value={arima.periods} min={4} max={16} onChange={(e)=>setArima({...arima, periods: parseInt(e.target.value)})}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-sm"/>
              </label>
            </div>
          )}
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-gray-800">Monte Carlo 参数</div>
            <button
              onClick={() => setFoldedMc(v => !v)}
              className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded border border-gray-200 text-xs"
            >
              {foldedMc ? '展开' : '折叠'}
            </button>
          </div>
          {!foldedMc && (
            <div className="grid grid-cols-3 gap-3">
              <label className="text-xs text-gray-600">样本数
                <input type="number" value={mc.samples} min={100} max={10000} step={100} onChange={(e)=>setMc({...mc, samples: parseInt(e.target.value)})}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-sm"/>
              </label>
              <label className="text-xs text-gray-600 col-span-2">分位点（逗号分隔）
                <input type="text" value={mc.quantiles.join(',')} onChange={(e)=>{
                  const arr = e.target.value.split(',').map(s=>parseFloat(s.trim())).filter(v=>!isNaN(v)&&v>0&&v<1);
                  setMc({...mc, quantiles: arr.length?arr:mc.quantiles});
                }} className="w-full border border-gray-200 rounded px-2 py-1 text-sm"/>
              </label>
            </div>
          )}
        </div>
      </div>


      {/* 4) 执行 */}
      <div className="flex items-center gap-3">
        <button onClick={onRun} disabled={running || !candidates.length}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg disabled:opacity-50">
          运行推演（Run）
        </button>
        <button onClick={onRerunFast} disabled={running || !candidates.length}
          className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-5 py-2 rounded-lg disabled:opacity-50">
          快速再生成（仅CSV）
        </button>
      </div>
      {/* 结果预览（CSV 内嵌） */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-sm font-medium text-gray-800 mb-2">结果预览（CSV）</div>
        {csvUrl ? (
          <>
            <div className="text-xs text-gray-600 mb-2">
              CSV：<a href={csvUrl} target="_blank" className="underline text-indigo-600">下载</a>
              {xlsxUrl && <>　|　XLSX：<a href={xlsxUrl} target="_blank" className="underline text-indigo-600">下载（含公式）</a></>}
              {mdUrl && <>　|　报告MD：<a href={mdUrl} target="_blank" className="underline text-indigo-600">下载</a></>}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs border border-gray-200">
                <tbody>
                  {tableRows.map((row, i) => (
                    <tr key={i} className={i===0 ? 'bg-gray-50 font-medium' : ''}>
                      {row.map((cell, j) => (
                        <td key={j} className="px-2 py-1 border border-gray-200 whitespace-nowrap">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="text-xs text-gray-500">暂无CSV结果</div>
        )}
      </div>
      {/* 快速可视化（CSV → 时间序列折线图） */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm font-medium text-gray-800 mb-2">可视化（从 CSV 快速生成）</div>

          {Object.keys(seriesMap).length === 0 ? (
            <div className="text-xs text-gray-500">暂无数据或未生成 CSV。</div>
          ) : (
            <>
              {/* 先选指标 */}
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <label className="text-xs text-gray-600">指标：</label>
                <select
                  value={selectedMetric}
                  onChange={(e)=>{
                    const m = e.target.value;
                    setSelectedMetric(m);
                    const ops = Object.keys(seriesMap[m] || {});
                    setScenarioOptions(ops);
                    const prefer = ['ARIMA基线','情景-平缓','MC(p50)'];
                    const chosen = prefer.filter(s => ops.includes(s));
                    setSelectedScenarios(chosen.length ? chosen : ops.slice(0, Math.min(3, ops.length)));
                  }}
                  className="border border-gray-200 rounded px-2 py-1 text-xs"
                >
                  {metricOptions.map(m => <option key={m} value={m}>{m}</option>)}
                </select>

                {/* 再选场景 */}
                <span className="text-xs text-gray-600">场景：</span>
                {scenarioOptions.map(s => (
                  <label key={s} className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded px-2 py-1 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mr-1"
                      checked={selectedScenarios.includes(s)}
                      onChange={(e)=>{
                        setSelectedScenarios(prev => e.target.checked ? [...prev, s] : prev.filter(x=>x!==s));
                      }}
                    />
                    <span style={{ borderBottom: `2px solid ${SCEN_COLORS[s] || '#333'}` }}>{s}</span>
                  </label>
                ))}
              </div>

              {/* 删除上方“标题：…”行；Y轴留白自适应，去掉竖排标签以避免与刻度重叠 */}
              {(() => {
                const yAxisWidth = estimateYAxisWidth(chartData, selectedScenarios);
                return (
                  <div style={{ width: '100%', height: 360 }}>
                    <ResponsiveContainer>
                      <LineChart
                        data={chartData}
                        // 顶部加一些留白；左侧 margin 小即可，由 YAxis.width 负责主要留白；底部为 Legend 预留更大空间
                        margin={{ top: 26, right: 16, bottom: 26, left: 12 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="period"
                          tick={{ fontSize: 10 }}
                          angle={-20}
                          textAnchor="end"
                          tickMargin={8}
                          interval={getTickInterval(periodLabels.length)}
                        />
                        <YAxis
                          width={yAxisWidth}
                          tick={{ fontSize: 11 }}
                          tickFormatter={formatSci}
                        />
                        <Tooltip
                          formatter={(value: any, name: any) => [
                            typeof value === 'number' ? formatSci(value) : value, name
                          ]}
                        />
                        <Legend
                          verticalAlign="bottom"
                          align="center"
                          iconSize={8}
                          wrapperStyle={{ fontSize: 12, paddingTop: 10 }}
                        />
                        {selectedScenarios.map((s) => (
                          <Line
                            key={s}
                            type="monotone"
                            dataKey={s}
                            dot={false}
                            strokeWidth={2}
                            stroke={SCEN_COLORS[s] || undefined}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()}



            </>
          )}
        </div>


            {/* 报告编辑（Markdown） */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-gray-800">报告编辑（Markdown）</div>
          <div className="flex items-center gap-2">
            <button
              onClick={()=>mdUrl && loadMdIntoEditor(mdUrl)}
              className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs"
              disabled={mdLoading}
            >
              {mdLoading ? '加载中…' : '刷新'}
            </button>
            <button
              onClick={()=>setShowMdPreview(p=>!p)}
              className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs"
            >
              {showMdPreview ? '切到编辑' : '切到预览'}
            </button>
            <button
              onClick={async ()=>{
                try{
                  const { data:{ session } } = await supabase.auth.getSession();
                  const uid = session?.user?.id ?? null;
                  const r = await saveReportMdV2(runId, mdRaw, uid || undefined);
                  pushLog(`MD 已保存：${r.report_url}`);
                  setMdUrl(r.report_url);
                }catch(e:any){ pushLog(`保存MD失败：${e.message || e}`); }
              }}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs"
              disabled={!runId || !mdRaw}
            >
              保存MD
            </button>
            <button
              onClick={async ()=>{
                try{
                  const r = await beautifyReportMdV2(runId, mdRaw);
                  pushLog(`美化完成：${r.report_url}（${r.type||'md'}）`);
                  // 美化后刷新产物列表
                  const arts = await listRunArtifacts(runId);
                  await pickUrlsFromArtifacts(arts.artifacts || []);
                }catch(e:any){ pushLog(`美化失败：${e.message || e}`); }
              }}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs"
              disabled={!runId || !mdRaw}
            >
              一键美化
            </button>
          </div>
        </div>

        {showMdPreview ? (
          <div
            className="prose max-w-none border border-gray-200 rounded p-3 overflow-auto"
            dangerouslySetInnerHTML={{ __html: mdToHtml(mdRaw || '') }}
          />
        ) : (
          <textarea
            value={mdRaw}
            onChange={(e)=>setMdRaw(e.target.value)}
            placeholder="在此编辑 Markdown…"
            className="w-full h-64 border border-gray-200 rounded p-3 font-mono text-sm"
          />
        )}

      </div>


      {/* 5) 历史 & 产物 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm font-medium text-gray-800 mb-3">历史记录（simulation_runs）</div>
          <ul className="text-sm space-y-2 max-h-60 overflow-auto">
            {history.map((h:any)=>(
              <li key={h.run_id} className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{h.title || h.run_id}</div>
                  <div className="text-xs text-gray-500">{h.created_at}</div>
                </div>
                  <button onClick={async ()=>{
                    setRunId(h.run_id);
                    const arts = await listRunArtifacts(h.run_id);
                    await pickUrlsFromArtifacts(arts.artifacts || []); // ← 载入CSV到表格，保留MD下载链接
                  }} className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded">打开</button>

              </li>
            ))}
          </ul>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm font-medium text-gray-800 mb-3">产出文件（simulation_artifacts）</div>
          <ul className="text-sm space-y-2 max-h-60 overflow-auto">
            {artifacts.map((a:any)=>(
              <li key={a.id} className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{a.artifact_type}</div>
                  <div className="text-xs text-gray-500">{a.created_at}</div>
                </div>
                <a href={a.storage_url} target="_blank" className="text-xs px-2 py-1 bg-indigo-50 text-indigo-700 rounded border border-indigo-200">打开</a>
              </li>
            ))}
            {(!artifacts || artifacts.length===0) && <li className="text-xs text-gray-500">暂无产物</li>}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default SimulationV2;
