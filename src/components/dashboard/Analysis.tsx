// === Analysis.tsx ===
import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Send, Bot, User, RefreshCw, BarChart3, TrendingUp, Search, AlertTriangle,
  Upload as UploadIcon, File as FileIcon, X, Check, Sparkles, Plus,
  Zap, PlusSquare
} from "lucide-react";
import { Markdown } from "@/components/ui/Markdown";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";

/* =================== Types =================== */
type AnalysisMode = "dimension" | "metric" | "business" | "anomaly";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  images?: string[];
};

interface UploadedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
  processed: boolean;
  processResult?: any;
}

/* =================== UI Tabs (kept) =================== */
const analysisTabsConfig = [
  { id: "dimension", name: "维度下钻", description: "按时间、地区、业务线等维度深入分析", icon: BarChart3, color: "blue" },
  { id: "metric",   name: "指标下钻", description: "深入分析特定财务指标的构成和变化", icon: TrendingUp, color: "blue" },
  { id: "business", name: "业务下钻", description: "分析具体业务板块的财务表现",       icon: Search,     color: "blue", hasFileUpload: true },
  { id: "anomaly",  name: "异动分析", description: "识别和分析财务数据的异常变化",       icon: AlertTriangle, color: "blue" },
];

/* =================== Data agent base =================== */
const DATA_API: string =
  (window.localStorage.getItem("DATA_API") as string) ??
  (import.meta as any).env?.VITE_DATA_AGENT_URL ??
  "http://127.0.0.1:18010";

/** 👉 专用快速取数端点（此版本前端已直查 Supabase，不再依赖它） */
const DATA_FAST_API: string =
  (window.localStorage.getItem("DATA_FAST_API") as string) ??
  (import.meta as any).env?.VITE_DATA_FAST_API ??
  `${DATA_API}/metrics/fast_value`;

/* =================== Suggestions =================== */
const BASE_SUGGESTIONS = [
  "2024 Q2 XX港口公司的营业收入是多少？",
  "2024 年 Q1 XX集团公司的总资产周转率？",
];
const MODE_SUGGESTIONS: Record<AnalysisMode, string[]> = {
  dimension: ["对比 XX集团公司 2024 年各季度营业收入", "XX港口公司 2023-2024 年 ROE 趋势"],
  metric:   ["杜邦分解 XX港口公司 2024 Q2 的 ROE", "XX集团公司 2024 Q2 的净利率是多少？"],
  business: ["分析 港口 板块 2024 Q2 的收入与成本", "地产 板块 2024 年度利润构成"],
  anomaly:  ["找出 2024 Q2 同比/环比波动最大的指标", "哪些公司 2024 Q2 ROE 变化最异常？"],
};
function getQuickQuestions(selected: Set<AnalysisMode>): string[] {
  const extra = Array.from(selected).flatMap((m) => MODE_SUGGESTIONS[m] ?? []);
  return Array.from(new Set([...BASE_SUGGESTIONS, ...extra])).slice(0, 8);
}

/* =================== DataQuery call（普通问答） =================== */
type DataQueryResp = {
  need_clarification?: boolean;
  ask?: string;
  resolved?: { metric_canonical?: string; company_name?: string; year?: number; quarter?: string };
  value?: { metric_name: string; metric_value: number; unit?: string };
  formula?: { expression: string; substituted: string; result: number; table?: Array<Record<string,string>> };
  message?: string;
};
const FETCH_TIMEOUT =
  Number((import.meta as any).env?.VITE_DATA_AGENT_TIMEOUT_MS) || 45000;

async function askData(question: string): Promise<DataQueryResp> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(`${DATA_API}/metrics/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error((await res.text().catch(()=> "")) || `HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

/* =================== Helpers =================== */
function mdFromRows(rows?: Array<Record<string, any>>): string {
  if (!rows || !rows.length) return "";
  const cols = Object.keys(rows[0]);
  let md = `\n\n| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |\n`;
  rows.forEach(r => { md += `| ${cols.map(c => (r[c] ?? "-")).join(" | ")} |\n`; });
  return md;
}

/* =========================================================
   缺失别名弹窗（保持原逻辑）
   ========================================================= */
type AliasColumns = { hasComputeKey: boolean; hasDisplayNameCn: boolean; hasAliases: boolean };

async function detectAliasColumns(): Promise<AliasColumns> {
  let hasComputeKey = true, hasDisplayNameCn = true, hasAliases = true;
  let cols = "canonical_name,aliases,compute_key,display_name_cn";
  let { error } = await supabase.from("metric_alias_catalog").select(cols).limit(1);
  if (error) {
    const msg = (error as any)?.message || (error as any)?.details || "";
    if (/compute_key/i.test(msg)) hasComputeKey = false;
    if (/display_name_cn/i.test(msg)) hasDisplayNameCn = false;
    if (/aliases/i.test(msg)) hasAliases = false;
    cols = "canonical_name"
      + (hasAliases ? ",aliases" : "")
      + (hasDisplayNameCn ? ",display_name_cn" : "");
    const retry = await supabase.from("metric_alias_catalog").select(cols).limit(1);
    if (retry.error) { hasAliases = false; hasDisplayNameCn = false; hasComputeKey = false; }
  }
  return { hasComputeKey, hasDisplayNameCn, hasAliases };
}

type NewAliasRow = { cn: string; compute_key: string };

const MissingAliasModal: React.FC<{
  open: boolean;
  onClose: () => void;
  names: string[];
  onCreated: () => void;
  aliasCols: AliasColumns;
}> = ({ open, onClose, names, onCreated, aliasCols }) => {
  const cleanNames = names.map(n => n.replace(/^【指标名：(.+)】$/, "$1"));
  const [rows, setRows] = useState<NewAliasRow[]>(
    cleanNames.map(n => ({ cn: n, compute_key: "" }))
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setRows(cleanNames.map(n => ({ cn: n, compute_key: "" })));
  }, [open]);

  const update = (i: number, patch: Partial<NewAliasRow>) => {
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const onSubmit = async () => {
    if (!aliasCols.hasComputeKey) return;
    for (const r of rows) {
      if (!r.compute_key.trim()) {
        return toast.error("请为每个中文名填写英文 compute_key（建议 snake_case）");
      }
    }
    setLoading(true);
    try {
      const payload = rows.map(r => {
        const base: any = {
          canonical_name: r.cn,
          compute_key: r.compute_key.trim(),
        };
        if (aliasCols.hasAliases) base.aliases = [r.cn];
        if (aliasCols.hasDisplayNameCn) base.display_name_cn = r.cn;
        return base;
      });
      const { error } = await supabase.from("metric_alias_catalog").insert(payload);
      if (error) throw error;
      toast.success("已添加到指标库！");
      onClose();
      onCreated();
    } catch (e: any) {
      toast.error(e.message || "新增失败");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const needAddColumn = !aliasCols.hasComputeKey;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]">
      <div className="w-[760px] max-w-[95vw] bg-white rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="text-lg font-semibold text-gray-900">新增指标映射</div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {needAddColumn ? (
          <div className="text-sm text-gray-700 space-y-3">
            <p>当前数据表 <code>metric_alias_catalog</code> 尚无 <code>compute_key</code> 列。</p>
            <p>请在数据库执行以下 SQL 后再回来继续：</p>
            <pre className="bg-gray-50 p-3 rounded border text-xs overflow-auto">
{`ALTER TABLE metric_alias_catalog
  ADD COLUMN IF NOT EXISTS compute_key text;`}
            </pre>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600 mb-3">
              这些中文指标还未建映射。系统将把它们作为 <code>canonical_name</code>（中文），并使用你填写的英文
              <code> compute_key</code> 作为计算键。
            </p>
            <div className="space-y-4 max-h-[50vh] overflow-auto pr-1">
              {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-2 gap-4 border rounded-lg p-3 bg-gray-50">
                  <div className="col-span-1">
                    <div className="block text-sm text-gray-600 mb-1">标准中文名（canonical_name）</div>
                    <div className="px-3 py-2 bg-white rounded border">{r.cn}</div>
                  </div>
                  <div className="col-span-1">
                    <label className="block text-sm text-gray-600 mb-1">计算键（compute_key，英文）</label>
                    <input
                      value={r.compute_key}
                      onChange={(e) => update(i, { compute_key: e.target.value })}
                      placeholder="例如：accounts_receivable_turnover"
                      className="w-full rounded-lg border-gray-300 focus:ring-purple-500 focus:border-purple-500"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button onClick={onClose} className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 bg-white hover:bg-gray-50">
                取消
              </button>
              <button
                onClick={onSubmit}
                disabled={loading}
                className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60 inline-flex items-center"
              >
                {loading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                确认添加
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/* =================== Upload Formula Modal =================== */
type AliasRow = { canonical_name: string; aliases?: string[]; compute_key?: string; display_name_cn?: string };

const UploadFormulaModal: React.FC<{
  open: boolean;
  onClose: () => void;
  defaultMetricName?: string;
}> = ({ open, onClose, defaultMetricName }) => {
  const [loading, setLoading] = useState(false);
  const [aliasCols, setAliasCols] = useState<AliasColumns>({ hasAliases: true, hasComputeKey: true, hasDisplayNameCn: true });

  // 中文变量/中文公式 + 可选描述 —— 默认空
  const [metricName, setMetricName] = useState(defaultMetricName || "");
  const [description, setDescription] = useState("");
  const [variablesCN, setVariablesCN] = useState("");
  const [computeCN, setComputeCN] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [isStandard, setIsStandard] = useState(true);

  const [missingOpen, setMissingOpen] = useState(false);
  const [missingNames, setMissingNames] = useState<string[]>([]);

  useEffect(() => { setMetricName(defaultMetricName || ""); }, [defaultMetricName]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cols = await detectAliasColumns();
        if (alive) setAliasCols(cols);
      } catch {}
    })();
    return () => { alive = false; };
  }, [open]);

  const fetchAliasMap = async (): Promise<{ cn2key: Record<string,string>, keyOfMetric: (name: string)=>string|null }> => {
    const cols = "canonical_name"
      + (aliasCols.hasAliases ? ",aliases" : "")
      + (aliasCols.hasComputeKey ? ",compute_key" : "")
      + (aliasCols.hasDisplayNameCn ? ",display_name_cn" : "");
    const { data, error } = await supabase.from("metric_alias_catalog").select(cols);
    if (error) throw error;

    const rows = (data ?? []) as unknown as AliasRow[];
    const cn2key: Record<string,string> = {};
    rows.forEach(row => {
      const key = (aliasCols.hasComputeKey ? (row as any).compute_key : undefined) || "";
      const names = new Set<string>();
      if (aliasCols.hasDisplayNameCn && (row as any).display_name_cn) names.add(((row as any).display_name_cn as string).trim());
      names.add(row.canonical_name?.trim() || "");
      if (aliasCols.hasAliases && Array.isArray(row.aliases)) row.aliases.forEach(a => a && names.add(String(a).trim()));
      names.forEach(n => { if (n && key) cn2key[n] = key; });
    });
    const keyOfMetric = (name: string) => cn2key[name.trim()] || null;
    return { cn2key, keyOfMetric };
  };

  const actuallySubmit = async () => {
    setLoading(true);
    try {
      const { cn2key, keyOfMetric } = await fetchAliasMap();

      const rawVars = variablesCN.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
      const varPairs: Array<{ cn: string; key: string }> = rawVars.map(cn => ({ cn, key: cn2key[cn] }));

      const metricKey = keyOfMetric(metricName)!;

      let expr = computeCN.trim();
      varPairs.sort((a,b)=>b.cn.length-a.cn.length).forEach(({cn, key})=>{
        const pat = new RegExp(cn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
        expr = expr.replace(pat, key);
      });

      const variables: Record<string,string> = {};
      varPairs.forEach(({cn, key}) => variables[key] = cn);
      const compute = { [metricKey]: expr };

      const { error } = await supabase.from("metric_formulas").insert([{
        metric_name: metricKey,
        description: description || null,
        variables,
        compute,
        enabled,
        is_standard: isStandard,
        method: "ratio",
        version: 1
      }]);
      if (error) throw error;

      toast.success("已上传公式！");
      onClose();
    } catch (e: any) {
      toast.error(e.message || "上传失败");
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async () => {
    try {
      if (!metricName.trim()) return toast.error("请填写指标名（中文，如：总资产周转率）");

      const { cn2key, keyOfMetric } = await fetchAliasMap();

      const rawVars = variablesCN.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
      if (rawVars.length === 0) return toast.error("请至少填写一个变量");

      const missing: string[] = [];
      rawVars.forEach(cn => { if (!cn2key[cn]) missing.push(cn); });

      const metricKey = keyOfMetric(metricName);
      if (!metricKey) missing.push(`【指标名：${metricName}】`);

      if (!aliasCols.hasComputeKey || missing.length > 0) {
        setMissingNames(missing.length ? missing : [metricName]);
        setMissingOpen(true);
        return;
      }

      await actuallySubmit();
    } catch (e: any) {
      toast.error(e.message || "上传失败");
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
        <div className="w-[760px] max-w-[95vw] bg-white rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="text-lg font-semibold text-gray-900">上传公式</div>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">指标名 metric_name</label>
              <input
                value={metricName}
                onChange={e=>setMetricName(e.target.value)}
                placeholder="例：总资产周转率 / ROE / 营业收入（推荐中文）"
                className="w-full rounded-lg border-gray-300 focus:ring-purple-500 focus:border-purple-500 placeholder-gray-400"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">描述 description（可选）</label>
              <input
                value={description}
                onChange={e=>setDescription(e.target.value)}
                placeholder="例：标准口径：营业收入 / 平均应收账款"
                className="w-full rounded-lg border-gray-300 focus:ring-purple-500 focus:border-purple-500 placeholder-gray-400"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">变量 variables（中文，逗号隔开）</label>
              <textarea
                rows={2}
                value={variablesCN}
                onChange={e=>setVariablesCN(e.target.value)}
                placeholder="例：营业收入，平均应收账款"
                className="w-full rounded-lg border-gray-300 focus:ring-purple-500 focus:border-purple-500 placeholder-gray-400"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">计算公式 compute（中文）</label>
              <textarea
                rows={2}
                value={computeCN}
                onChange={e=>setComputeCN(e.target.value)}
                placeholder="例：营业收入/平均应收账款"
                className="w-full rounded-lg border-gray-300 focus:ring-purple-500 focus:border-purple-500 placeholder-gray-400"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">是否启用 enabled</label>
              <select
                value={enabled ? "1" : "0"}
                onChange={e=>setEnabled(e.target.value==="1")}
                className="w-full rounded-lg border-gray-300 focus:ring-purple-500 focus:border-purple-500"
              >
                <option value="1">true</option>
                <option value="0">false</option>
              </select>
            </div>

            <div className="flex items-center gap-3">
              <input id="isStandard" type="checkbox" checked={isStandard} onChange={e=>setIsStandard(e.target.checked)}/>
              <label htmlFor="isStandard" className="text-sm text-gray-700">
                设为<span className="text-purple-700 font-medium">标准公式</span>
              </label>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 bg-white hover:bg-gray-50"
            >
              取消
            </button>
            <button
              onClick={onSubmit}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60 inline-flex items-center"
            >
              {loading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              提交
            </button>
          </div>
        </div>
      </div>

      <MissingAliasModal
        open={missingOpen}
        onClose={()=>setMissingOpen(false)}
        names={missingNames}
        aliasCols={aliasCols}
        onCreated={actuallySubmit}
      />
    </>
  );
};

/* =================== Add Metric Modal（保持） =================== */
const AddMetricModal: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const [aliasCols, setAliasCols] = useState<AliasColumns>({ hasAliases: true, hasComputeKey: true, hasDisplayNameCn: true });
  const [rows, setRows] = useState<Array<NewAliasRow>>([{ cn: "", compute_key: "" }]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const cols = await detectAliasColumns();
        if (alive) setAliasCols(cols);
      } catch {}
    })();
    return () => { alive = false; };
  }, [open]);

  const updateRow = (i: number, patch: Partial<NewAliasRow>) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  };
  const addRow = () => setRows(prev => [...prev, { cn: "", compute_key: "" }]);
  const removeRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!aliasCols.hasComputeKey) {
      return toast.error("当前表缺少 compute_key 列，请先在数据库增加后再试。");
    }
    const invalid = rows.find(r => !r.cn.trim() || !r.compute_key.trim());
    if (invalid) return toast.error("请填写每行的中文名与英文 compute_key");

    setLoading(true);
    try {
      const payload = rows.map(r => {
        const base: any = {
          canonical_name: r.cn.trim(),
          compute_key: r.compute_key.trim(),
        };
        if (aliasCols.hasAliases) base.aliases = [r.cn.trim()];
        if (aliasCols.hasDisplayNameCn) base.display_name_cn = r.cn.trim();
        return base;
      });
      const { error } = await supabase.from("metric_alias_catalog").insert(payload);
      if (error) throw error;
      toast.success("已添加指标映射！");
      onClose();
    } catch (e: any) {
      toast.error(e.message || "添加失败");
    } finally { setLoading(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]">
      <div className="w-[760px] max-w-[95vw] bg-white rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="text-lg font-semibold text-gray-900">添加指标（仅映射）</div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        <p className="text-sm text-gray-600 mb-3">
          仅向 <code>metric_alias_catalog</code> 添加映射：<b>canonical_name=中文、compute_key=英文</b>。
        </p>

        {!aliasCols.hasComputeKey ? (
          <div className="bg-amber-50 border border-amber-200 p-3 rounded text-amber-800 text-sm">
            当前库没有 <code>compute_key</code> 列，请先执行：<br />
            <code>ALTER TABLE metric_alias_catalog ADD COLUMN IF NOT EXISTS compute_key text;</code>
          </div>
        ) : (
          <div className="space-y-3 max-h-[50vh] overflow-auto pr-1">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-2 gap-3 bg-gray-50 border rounded p-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">标准中文名（canonical_name）</label>
                  <input value={r.cn} onChange={e=>updateRow(i,{cn:e.target.value})}
                         placeholder="例如：总资产周转率"
                         className="w-full rounded-lg border-gray-300 focus:ring-purple-500 focus:border-purple-500"/>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">计算键（compute_key，英文）</label>
                  <input value={r.compute_key} onChange={e=>updateRow(i,{compute_key:e.target.value})}
                         placeholder="例如：total_asset_turnover"
                         className="w-full rounded-lg border-gray-300 focus:ring-purple-500 focus:border-purple-500"/>
                </div>
                <div className="col-span-2 flex justify-end">
                  {rows.length > 1 && (
                    <button onClick={()=>removeRow(i)} className="text-sm text-red-600 hover:underline">删除本行</button>
                  )}
                </div>
              </div>
            ))}
            <button onClick={addRow} className="inline-flex items-center text-purple-700 hover:underline text-sm">
              <PlusSquare className="h-4 w-4 mr-1" /> 增加一行
            </button>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 bg-white hover:bg-gray-50">取消</button>
          <button onClick={submit} disabled={!aliasCols.hasComputeKey || loading}
                  className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60 inline-flex items-center">
            {loading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            添加
          </button>
        </div>
      </div>
    </div>
  );
};

/* =================== Quick Fetch Modal（按 company_name 精确查 + 标准公式计算） =================== */

const QuickFetchModal: React.FC<{
  open: boolean;
  onClose: () => void;
  setInputQuery: (q: string) => void;
}> = ({ open, onClose, setInputQuery }) => {
  const [year, setYear] = useState<number | "">("");
  const [quarter, setQuarter] = useState<string>(""); // Q1~Q4（查询时转 1~4）
  const [company, setCompany] = useState<string>("");
  const [metricCN, setMetricCN] = useState<string>("");

  const [yearOptions, setYearOptions] = useState<number[]>([]);
  const [metricOptions, setMetricOptions] = useState<string[]>([]);
  const [companyOptions, setCompanyOptions] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");

  // 取指标（中文）、公司（合并多来源）、年份（真实年份）
  useEffect(() => {
    if (!open) return;

    (async () => {
      // 1) 指标（中文，从别名表或事实表兜底）
      try {
        const { data } = await supabase
          .from("metric_alias_catalog")
          .select("canonical_name")
          .order("canonical_name", { ascending: true });
        const rows = (data ?? []) as unknown as { canonical_name: string }[];
        if (rows?.length) setMetricOptions(rows.map(r => r.canonical_name).filter(Boolean));
      } catch {}
      if (!metricOptions.length) {
        try {
          const { data } = await supabase
            .from("financial_metrics")
            .select("metric_name")
            .limit(20000);
          const s = new Set<string>();
          (data ?? []).forEach((r: any) => r?.metric_name && s.add(String(r.metric_name)));
          setMetricOptions(Array.from(s).sort((a,b)=>a.localeCompare(b,"zh-CN")));
        } catch {}
      }

      // 2) 公司 —— 合并三处：company_catalog + v_company_list + financial_metrics.company_name
      const setNames = new Set<string>();
      try {
        const { data } = await supabase.from("company_catalog").select("display_name").order("display_name");
        (data ?? []).forEach((r: any) => r?.display_name && setNames.add(r.display_name.trim()));
      } catch {}
      try {
        const { data } = await supabase.from("v_company_list").select("name").order("name");
        (data ?? []).forEach((r: any) => r?.name && setNames.add(r.name.trim()));
      } catch {}
      try {
        const { data } = await supabase.from("financial_metrics").select("company_name").limit(20000);
        (data ?? []).forEach((r: any) => r?.company_name && setNames.add(r.company_name.trim()));
      } catch {}
      setCompanyOptions(Array.from(setNames).filter(Boolean).sort((a,b)=>a.localeCompare(b,"zh-CN")));

      // 3) 年份 —— 以事实表真实存在的年份为准（取不到则回退到最近15年）
      try {
        const { data } = await supabase
          .from("financial_metrics")
          .select("year")
          .order("year", { ascending: false })
          .limit(5000);
        const ys = Array.from(new Set((data ?? []).map((r: any) => Number(r?.year)).filter(Number.isFinite))).sort((a,b)=>b-a);
        if (ys.length) setYearOptions(ys);
        else {
          const now = new Date().getFullYear();
          setYearOptions(Array.from({ length: 15 }, (_, i) => now - i));
        }
      } catch {
        const now = new Date().getFullYear();
        setYearOptions(Array.from({ length: 15 }, (_, i) => now - i));
      }
    })();
  }, [open]);

  /* ---------- 工具：季度映射 ---------- */
  const quarterToInt = (q: string | number | "") =>
    typeof q === "number" ? q :
    q === "Q1" ? 1 : q === "Q2" ? 2 : q === "Q3" ? 3 : q === "Q4" ? 4 : null;

  /* ---------- 工具：选优单位字段 ---------- */
  const pickUnit = (row: any) =>
    row?.unit ?? row?.value_unit ?? row?.unit_cn ?? row?.unit_en ?? null;

  /* ---------- 核心：按标准公式计算 ----------
     metric_formulas:
       - metric_name: 目标指标中文（如 "ROE"）
       - variables:   JSON 对象 { compute_key: "中文基础指标名", ... }
       - compute:     JSON 对象 { "某个结果键": "a/b" } —— 表达式里用 compute_key
  ------------------------------------------------ */
  const computeByStandardFormula = async (
    companyName: string, yearNum: number, quarterNum: number, metricNameCN: string
  ): Promise<{ ok: boolean; result?: number; substituted?: string; reason?: string }> => {
    try {
      // 1) 取启用的标准公式（优先 is_standard=true）
      const { data: fdata, error: ferr } = await supabase
        .from("metric_formulas")
        .select("variables, compute, enabled, is_standard")
        .eq("metric_name", metricNameCN)
        .eq("enabled", true)
        .order("is_standard", { ascending: false })
        .limit(1);
      if (ferr) { console.error(ferr); return { ok: false, reason: "读取公式失败" }; }
      const frow = fdata?.[0];
      if (!frow) return { ok: false, reason: `未找到 ${metricNameCN} 的标准公式` };

      // 2) 解析 JSON
      const variablesObj = typeof frow.variables === "string" ? JSON.parse(frow.variables) : (frow.variables || {});
      const computeObj   = typeof frow.compute   === "string" ? JSON.parse(frow.compute)   : (frow.compute   || {});
      const expr: string = Object.values(computeObj)[0] as string;
      const varKeys: string[] = Object.keys(variablesObj || {});
      if (!expr || !varKeys.length) return { ok: false, reason: "公式定义不完整" };

      // 3) 准备去事实表取基础指标（按中文名）
      const baseNamesCN: string[] = varKeys.map(k => variablesObj[k]).filter(Boolean);
      const { data: bdata, error: berr } = await supabase
        .from("financial_metrics")
        .select("metric_name, metric_value")
        .eq("company_name", companyName)
        .eq("year", yearNum)
        .eq("quarter", quarterNum)
        .in("metric_name", baseNamesCN);
      if (berr) { console.error(berr); return { ok: false, reason: "读取基础指标失败" }; }

      const name2val = new Map<string, number>();
      (bdata ?? []).forEach((r: any) => {
        if (r?.metric_name != null && r?.metric_value != null) {
          name2val.set(String(r.metric_name), Number(r.metric_value));
        }
      });

      // 4) 构造 compute_key -> 数值
      const key2val = new Map<string, number>();
      varKeys.forEach(k => {
        const cn = variablesObj[k];
        if (name2val.has(cn)) key2val.set(k, name2val.get(cn)!);
      });

      // 5) 检查缺失
      const missingKeys = varKeys.filter(k => !key2val.has(k));
      if (missingKeys.length) {
        const missCN = missingKeys.map(k => variablesObj[k] || k);
        return { ok: false, reason: `基础指标缺失：${missCN.join("，")}` };
      }

      // 6) 代入并计算（仅四则运算）
      let substituted = expr;
      for (const [k, v] of key2val.entries()) {
        const re = new RegExp(`\\b${k}\\b`, "g");
        substituted = substituted.replace(re, `(${v})`);
      }
      if (/\b[a-zA-Z_]\w*\b/.test(substituted)) {
        return { ok: false, reason: "公式计算失败（存在未替换变量）", substituted };
      }
      // eslint-disable-next-line no-new-func
      const result = Function(`"use strict"; return (${substituted});`)();
      if (!Number.isFinite(result)) return { ok: false, reason: "公式计算失败（结果非数值）", substituted };

      return { ok: true, result: Number(result), substituted };
    } catch (e: any) {
      console.error(e);
      return { ok: false, reason: e?.message || "标准公式计算异常" };
    }
  };

  /* ---------- 查询主流程：先查原值，再算公式 ---------- */
  const doFetch = async () => {
    if (!year || !quarter || !company || !metricCN) {
      return toast.error("请选择 年/季/公司/指标");
    }
    setLoading(true);
    setResult("");

    try {
      const qInt = quarterToInt(quarter) as number;

      // 1) 直接命中 financial_metrics
      const { data: d1, error: e1 } = await supabase
        .from("financial_metrics")
        .select("*")
        .eq("year", Number(year))
        .eq("quarter", qInt)
        .eq("company_name", company)
        .eq("metric_name", metricCN)
        .limit(1);

      if (e1) throw e1;
      if (d1 && d1.length) {
        const u = pickUnit(d1[0]);
        setResult(`${d1[0].metric_value}${u ? " " + u : ""}`);
        return;
      }

      // 2) 未命中原值 → 尝试按标准公式计算（完全基于 metric_formulas）
      const comp = await computeByStandardFormula(company, Number(year), qInt, metricCN);
      if (comp.ok) {
        setResult(String(comp.result));
        return;
      }

      // 3) 两种方式都未得到 —— 明确提示
      setResult(
        comp.reason ||
        `未在 financial_metrics 命中：company_name="${company}", year=${year}, quarter="${quarter}", metric_name="${metricCN}"`
      );
    } catch (e: any) {
      setResult(e?.message || "查询失败");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const putQuestion = (q: string) => setInputQuery(q);

  const hasCtx = Boolean(year && quarter && company && metricCN);
  const q1 = `${year || "年份"} 年 ${quarter || "季度"} ${company || "公司"} 的 ${metricCN || "指标"} 达到预期值了吗？`;
  const q2 = `${year || "年份"} 年 ${quarter || "季度"} ${company || "公司"} 的 ${metricCN || "指标"} 的同比表现怎么样？`;
  const q3 = `${year || "年份"} 年 ${quarter || "季度"} ${company || "公司"} 的 ${metricCN || "指标"} 的环比表现怎么样？`;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]">
      <div className="w-[820px] max-w-[96vw] bg-white rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="text-lg font-semibold text-gray-900">快速取数</div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="h-5 w-5"/></button>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* 左：选择区 */}
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">年份</label>
              <select
                value={year}
                onChange={e => {
                  const v = e.target.value;
                  setYear(v ? Number(v) : "");
                }}
                className="w-full rounded-lg border-gray-300 focus:ring-purple-500 focus:border-purple-500"
              >
                <option value="">选择年份</option>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">季度</label>
              <select value={quarter} onChange={e=>setQuarter(e.target.value)}
                      className="w-full rounded-lg border-gray-300 focus:ring-purple-500 focus:border-purple-500">
                <option value="">选择季度</option>
                <option value="Q1">Q1</option>
                <option value="Q2">Q2</option>
                <option value="Q3">Q3</option>
                <option value="Q4">Q4</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">公司</label>
              <select value={company} onChange={e=>setCompany(e.target.value)}
                      className="w-full rounded-lg border-gray-300 focus:ring-purple-500 focus:border-purple-500">
                <option value="">选择公司</option>
                {companyOptions.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">指标名（中文）</label>
              <select value={metricCN} onChange={e=>setMetricCN(e.target.value)}
                      className="w-full rounded-lg border-gray-300 focus:ring-purple-500 focus:border-purple-500">
                <option value="">选择指标</option>
                {metricOptions.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>

          {/* 右：操作按钮 */}
          <div className="flex flex-col justify-start items-end gap-3">
            <button
              onClick={doFetch}
              disabled={loading}
              className="inline-flex items-center px-4 py-2 rounded-md shadow-sm text-sm font-medium border"
              style={{ background: "#ffffff", color: "#6d28d9", borderColor: "#d6bcfa" }}
            >
              {loading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
              查询
            </button>
            <button
              onClick={onClose}
              className="inline-flex items-center px-4 py-2 rounded-md shadow-sm text-sm font-medium border"
              style={{ background: "hsl(var(--card-bg))", color: "hsl(var(--sidebar-foreground))", borderColor: "hsl(var(--card-border))" }}
            >
              取消
            </button>
          </div>
        </div>

        {/* 结果 */}
        <div className="mt-5">
          <div className="rounded-lg border p-4 min-h-[80px] bg-gray-50">
            {result ? <div className="text-lg font-semibold">{result}</div> : <div className="text-gray-500 text-sm">查询结果将显示在这里</div>}
          </div>

          {/* 底部快捷问题：未选全只显示一句提示 */}
          <div className="mt-3 text-sm">
            {!hasCtx ? (
              <div className="text-gray-400">请先选择 年/季/公司/指标</div>
            ) : (
              <div className="flex flex-wrap gap-3">
                <button onClick={()=> putQuestion(q1)} className="underline text-purple-700" title={q1}>“{q1}”</button>
                <button onClick={()=> putQuestion(q2)} className="underline text-purple-700" title={q2}>“{q2}”</button>
                <button onClick={()=> putQuestion(q3)} className="underline text-purple-700" title={q3}>“{q3}”</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* =================== Main component（保持） =================== */
const FinancialAnalysis: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputQuery, setInputQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedTabs, setSelectedTabs] = useState<Set<AnalysisMode>>(new Set(["metric"]));
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [fileProcessing, setFileProcessing] = useState(false);

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadDefaultMetric, setUploadDefaultMetric] = useState<string | undefined>(undefined);

  // 新增：添加指标 & 快速取数
  const [showAddMetric, setShowAddMetric] = useState(false);
  const [showQuickFetch, setShowQuickFetch] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { generateWelcomeMessage(); }, [selectedTabs, uploadedFiles.length]);
  const generateWelcomeMessage = () => {
    const selectedModes = Array.from(selectedTabs);
    let welcome = "你好！我是AI财务分析助手，可以帮你进行**问数/计算**等操作。\n\n";
    if (selectedModes.length === 0) welcome += "**当前处于通用分析模式**\n\n直接输入问题开始查询，比如：\n";
    else if (selectedModes.length === 1) {
      const mode = analysisTabsConfig.find((t) => t.id === selectedModes[0]);
      welcome += `**当前分析模式**: ${mode?.name}\n\n`;
    } else {
      welcome += `**当前分析模式**: 多模式\n\n`;
    }
    welcome += '- "2024 Q2 XX港口公司的营业收入是多少？"\n';
    welcome += '- "杜邦分解 XX集团公司 2024 Q2 的 ROE"\n';
    welcome += '- "2023 年 Q4 XX地产公司的净利润？"\n\n';
    if (selectedTabs.has("business") && uploadedFiles.length > 0) {
      welcome += `**已上传文件**: ${uploadedFiles.length} 个文件可用于分析\n\n`;
    }
    setMessages([{ role: "assistant", content: welcome, timestamp: new Date().toISOString() }]);
  };

  useEffect(() => {
    const question = searchParams.get("question");
    const mode = searchParams.get("mode");
    const send = searchParams.get("send");
    if (mode && ["dimension", "metric", "business", "anomaly"].includes(mode)) {
      setSelectedTabs(new Set([mode as AnalysisMode]));
    }
    if (question) {
      setInputQuery(question);
      // 只有当 send !== "0" 时才自动发送（兼容老链接）
      if (send !== "0") {
        setTimeout(() => handleSendMessage(question), 400);
      }
    }
  }, [searchParams]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // 让“点此上传公式”能点
  useEffect(() => {
    const handler = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target?.dataset?.trigger === "upload-formula") {
        const metric = target.dataset.metric || "";
        openUploadModal(metric);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  const openUploadModal = (metric?: string) => {
    setUploadDefaultMetric(metric || undefined);
    setShowUploadModal(true);
  };

  const handleTabClick = (tabId: AnalysisMode) => {
    const next = new Set(selectedTabs);
    next.has(tabId) ? next.delete(tabId) : next.add(tabId);
    setSelectedTabs(next);
  };
  const handleTabDoubleClick = (tabId: AnalysisMode) => {
    const next = new Set(selectedTabs);
    next.delete(tabId);
    setSelectedTabs(next);
  };

  const handleSendMessage = async (query?: string) => {
    const messageText = query || inputQuery.trim();
    if (!messageText) return toast.error("请输入问题");
    setMessages((m) => [...m, { role: "user", content: messageText, timestamp: new Date().toISOString() }]);
    setInputQuery("");
    setLoading(true);
    try {
      const r = await askData(messageText);
      if (r.need_clarification && r.ask) {
        let content = r.ask;
        const metricName = r.resolved?.metric_canonical || "";
        if (content.startsWith("未找到") && content.endsWith("请上传")) {
          content += `\n\n<span data-trigger="upload-formula" data-metric="${metricName}" style="color:#7c3aed;cursor:pointer;text-decoration:underline;font-size:12px;">点此上传公式</span>`;
        }
        setMessages((m) => [...m, { role: "assistant", content, timestamp: new Date().toISOString() }]);
        return;
      }
      const scope = r.resolved ? `${r.resolved.year}/${r.resolved.quarter} ${r.resolved.company_name ?? ""}` : "";
      let md = "";
      if (r.formula) {
        md += `## 📊 查询结果\n\n${scope} ${r.resolved?.metric_canonical ?? ""}\n`;
        md += `公式：${r.formula.expression}\n\n代入：${r.formula.substituted}\n\n`;
        md += `结果：${typeof r.formula.result === "number" ? r.formula.result.toFixed(4) : r.formula.result}`;
        md += mdFromRows(r.formula.table);
      } else if (r.value) {
        md += `## 📊 查询结果\n\n${scope} ${r.value.metric_name} = ${r.value.metric_value}${r.value.unit ? ` ${r.value.unit}` : ""}`;
      } else {
        md += r.message || "没有查询到数据。";
      }
      setMessages((m) => [...m, { role: "assistant", content: md, timestamp: new Date().toISOString() }]);
      toast.success("完成");
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: `出错：${e?.message || "未知错误"}`, timestamp: new Date().toISOString() }]);
      toast.error("失败");
    } finally {
      setLoading(false);
    }
  };

  // 文件上传（保持原逻辑）
  const readFileContent = (file: File): Promise<string> =>
    new Promise((resolve, reject) => { const r = new FileReader(); r.onload = e => resolve(e.target?.result as string); r.onerror = reject; r.readAsText(file); });

  const handleFileUpload = async (files: FileList | File[]) => {
    if (!selectedTabs.has("business")) return toast.error('请先选择"业务下钻"模式再上传文件');
    setFileProcessing(true);
    for (const file of Array.from(files)) {
      try {
        const supported = [".py", ".json", ".yaml", ".yml", ".csv", ".xlsx"];
        const ext = file.name.toLowerCase().substring(file.name.lastIndexOf("."));
        if (!supported.includes(ext)) { toast.error(`不支持的文件类型: ${file.name}`); continue; }
        if (file.size > 10 * 1024 * 1024) { toast.error(`文件过大: ${file.name} (最大10MB)`); continue; }

        const content = await readFileContent(file);
        const { data, error } = await supabase.functions.invoke("business-file-processor", {
          body: { fileContent: content, fileName: file.name, fileType: file.type, analysisQuery: "用户上传了文件进行业务分析" },
        });
        if (error) throw error;

        setUploadedFiles((prev) => [...prev, {
          id: `${Date.now()}-${Math.random()}`,
          name: file.name, type: file.type, size: file.size,
          uploadedAt: new Date().toISOString(), processed: true, processResult: data,
        }]);
        toast.success(`文件处理完成: ${file.name}`);
      } catch (err) { console.error(err); toast.error(`文件处理失败: ${file.name}`); }
    }
    setFileProcessing(false);
  };

  const removeUploadedFile = (fileId: string) => { setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId)); toast.success("文件已删除"); };
  const clearHistory = () => { generateWelcomeMessage(); toast.success("对话历史已清空"); };

  return (
    <div className="h-full flex flex-col bg-page text-page">
      {/* Header */}
      <div className="px-6 py-4 border-b rounded-md shadow"
        style={{ background: "hsl(var(--card-bg))", color: "hsl(var(--sidebar-foreground))", borderColor: "hsl(var(--card-border))", borderStyle: "solid", borderWidth: 1 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-full">
              <Bot className="h-6 w-6" style={{ color: "hsl(var(--sidebar-primary))" }} />
            </div>
            <div>
              <h1 className="text-2xl font-bold">财务智能分析</h1>
              <p className="text-sm" style={{ color: "hsl(var(--muted-fg))" }}>AI驱动的对话式财务问数与分析助手</p>
            </div>
          </div>

          {/* 右侧按钮：清空对话 + 添加指标 + 上传公式 */}
          <div className="flex flex-col items-end space-y-2">
            <button
              onClick={clearHistory}
              className="inline-flex items-center px-3 py-1.5 rounded-md shadow-sm text-sm leading-4 font-medium hover:opacity-90 focus:outline-none focus:ring-2"
              style={{ background: "hsl(var(--card-bg))", color: "hsl(var(--sidebar-foreground))", border: "1px solid hsl(var(--card-border))", ["--tw-ring-color" as any]: "hsl(var(--sidebar-ring))" }}
            >
              <RefreshCw className="h-4 w-4 mr-1" /> 清空对话
            </button>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => setShowAddMetric(true)}
                className="inline-flex items-center px-3 py-1.5 rounded-md shadow-sm text-sm leading-4 font-medium border transition-colors"
                style={{ background: "#ffffff", color: "#6d28d9", borderColor: "#d6bcfa" }}
              >
                <PlusSquare className="h-4 w-4 mr-1" /> 添加指标
              </button>

              <button
                onClick={() => setShowUploadModal(true)}
                className="inline-flex items-center px-3 py-1.5 rounded-md shadow-sm text-sm leading-4 font-medium border transition-colors"
                style={{ background: "#ffffff", color: "#6d28d9", borderColor: "#d6bcfa" }}
              >
                <UploadIcon className="h-4 w-4 mr-1" /> 上传公式
              </button>
            </div>
          </div>
        </div>

        {/* 快速取数入口 */}
        <div className="mt-4">
          <div className="flex items-center space-x-2 flex-wrap">
            <button
              onClick={() => setShowQuickFetch(true)}
              className="flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 border-2 transform hover:scale-105 active:scale-95 shadow-sm hover:bg-[hsl(var(--sidebar-primary)/0.15)]"
              style={{ background: "transparent", borderColor: "hsl(var(--sidebar-primary) / 0.3)", color: "hsl(var(--sidebar-primary))" }}
            >
              <Zap className="h-4 w-4 mr-2" /> 快速取数
            </button>
          </div>
        </div>

        {/* 下钻方式选择 + Tabs */}
        <div className="mt-4">
          <div className="flex items-center space-x-3 flex-wrap">
            <div className="text-sm font-semibold text-black mr-1">下钻方式选择</div>
            {analysisTabsConfig.map((tab) => {
              const Icon = tab.icon;
              const sel = selectedTabs.has(tab.id as AnalysisMode);
              const base = "flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 border-2 transform hover:scale-105 active:scale-95";
              const style: React.CSSProperties = sel
                ? { background: "hsl(var(--sidebar-primary))", borderColor: "hsl(var(--sidebar-primary))", color: "hsl(var(--sidebar-primary-foreground))" }
                : { background: "transparent", borderColor: "hsl(var(--sidebar-primary) / 0.3)", color: "hsl(var(--sidebar-primary))" };
              return (
                <button
                  key={tab.id}
                  onClick={() => { const s = new Set(selectedTabs); s.has(tab.id as AnalysisMode) ? s.delete(tab.id as AnalysisMode) : s.add(tab.id as AnalysisMode); setSelectedTabs(s); }}
                  onDoubleClick={() => { const s = new Set(selectedTabs); s.delete(tab.id as AnalysisMode); setSelectedTabs(s); }}
                  className={`${base} ${sel ? "shadow-lg" : "shadow-sm"} ${sel ? "" : "hover:bg-[hsl(var(--sidebar-primary)/0.15)]"}`}
                  style={style}
                  title={`${tab.description}\n\n单击选择，双击取消选择（不影响问数逻辑）`}
                >
                  <Icon className="h-4 w-4 mr-2" /> {tab.name}
                  {tab.hasFileUpload && selectedTabs.has(tab.id as AnalysisMode) && uploadedFiles.length > 0 && (
                    <span className="ml-2 px-1.5 py-0.5 rounded-full text-xs" style={{ background: "hsl(var(--sidebar-primary) / 0.2)", color: "hsl(var(--sidebar-primary-foreground))" }}>
                      {uploadedFiles.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 pb-40">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`flex items-start space-x-3 max-w-4xl ${m.role === "user" ? "flex-row-reverse space-x-reverse" : ""}`}>
              <div className={`flex items-center justify-center w-8 h-8 rounded-full ${m.role === "user" ? "bg-blue-600" : "bg-gray-600"}`}>
                {m.role === "user" ? <User className="h-5 w-5 text-white" /> : <Bot className="h-5 w-5 text-white" />}
              </div>
              <div className={`px-4 py-3 rounded-lg max-w-full ${m.role === "user" ? "bg-blue-600 text-white" : "bg-gray-50 border border-gray-200 text-gray-900"}`}>
                {m.role === "user" ? <p className="whitespace-pre-wrap">{m.content}</p> : <div className="prose prose-sm max-w-none prose-gray"><Markdown content={m.content} /></div>}
                <p className={`text-xs mt-2 ${m.role === "user" ? "text-blue-100" : "text-gray-500"}`}>{new Date(m.timestamp).toLocaleTimeString()}</p>
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="flex items-start space-x-3 max-w-4xl">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-600">
                <Bot className="h-5 w-5 text-white" />
              </div>
              <div className="bg-gray-50 border border-gray-200 px-4 py-3 rounded-lg">
                <div className="flex items-center space-x-2">
                  <RefreshCw className="h-4 w-4 text-gray-500 animate-spin" />
                  <span className="text-sm text-gray-600">正在查询...</span>
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="bg-white/95 backdrop-blur border-t border-gray-200 px-6 py-4 sticky bottom-0 z-50 shadow-[0_-6px_12px_rgba(0,0,0,0.06)]">
        <div className="flex items-center space-x-3">
          <div className="flex-1 relative">
            <input
              type="text"
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              placeholder="输入您的财务分析问题（如：2024 Q2 XX港口公司的营业收入是多少）..."
              className="block w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg shadow-sm bg-white text-gray-900 placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              onKeyDown={(e) => e.key === "Enter" && !loading && handleSendMessage()}
              disabled={loading}
            />
            <div className="absolute inset-y-0 right-0 flex items-center pr-3">
              <Sparkles className="h-5 w-5 text-gray-400" />
            </div>
          </div>
          <button
            onClick={() => handleSendMessage()}
            disabled={loading || !inputQuery.trim()}
            className="inline-flex items-center px-4 py-3 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>

        {/* Quick suggestions */}
        <div className="mt-3 flex flex-wrap gap-2">
          {getQuickQuestions(selectedTabs).map((q, i) => (
            <button
              key={i}
              onClick={() => setInputQuery(q)}
              onDoubleClick={() => handleSendMessage(q)}
              className="inline-flex items-center px-2.5 py-1 border border-gray-300 shadow-sm text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
              title="单击填入输入框，双击直接发送"
              disabled={loading}
            >
              {q}
            </button>
          ))}
        </div>

        {/* Business uploads (kept) */}
        {selectedTabs.has("business") && (
          <BusinessUpload
            uploadedFiles={uploadedFiles}
            setUploadedFiles={setUploadedFiles}
            dragOver={dragOver}
            setDragOver={setDragOver}
            fileProcessing={fileProcessing}
            setFileProcessing={setFileProcessing}
          />
        )}
      </div>

      {/* Modals */}
      <UploadFormulaModal
        open={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        defaultMetricName={uploadDefaultMetric}
      />
      <AddMetricModal open={showAddMetric} onClose={()=>setShowAddMetric(false)} />
      <QuickFetchModal open={showQuickFetch} onClose={()=>setShowQuickFetch(false)} setInputQuery={setInputQuery} />
    </div>
  );
};

/* =================== Business upload subcomponent (kept) =================== */
const BusinessUpload: React.FC<{
  uploadedFiles: UploadedFile[];
  setUploadedFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
  dragOver: boolean;
  setDragOver: React.Dispatch<React.SetStateAction<boolean>>;
  fileProcessing: boolean;
  setFileProcessing: React.Dispatch<React.SetStateAction<boolean>>;
}> = ({ uploadedFiles, setUploadedFiles, dragOver, setDragOver, fileProcessing, setFileProcessing }) => {
  const readFileContent = (file: File): Promise<string> =>
    new Promise((resolve, reject) => { const r = new FileReader(); r.onload = e => resolve(e.target?.result as string); r.onerror = reject; r.readAsText(file); });

  const handleFileUpload = async (files: FileList | File[]) => {
    setFileProcessing(true);
    for (const file of Array.from(files)) {
      try {
        const supported = [".py", ".json", ".yaml", ".yml", ".csv", ".xlsx"];
        const ext = file.name.toLowerCase().substring(file.name.lastIndexOf("."));
        if (!supported.includes(ext)) { toast.error(`不支持的文件类型: ${file.name}`); continue; }
        if (file.size > 10 * 1024 * 1024) { toast.error(`文件过大: ${file.name} (最大10MB)`); continue; }

        const content = await readFileContent(file);
        const { data, error } = await supabase.functions.invoke("business-file-processor", {
          body: { fileContent: content, fileName: file.name, fileType: file.type, analysisQuery: "用户上传了文件进行业务分析" },
        });
        if (error) throw error;

        setUploadedFiles((prev) => [...prev, {
          id: `${Date.now()}-${Math.random()}`,
          name: file.name, type: file.type, size: file.size,
          uploadedAt: new Date().toISOString(), processed: true, processResult: data,
        }]);
        toast.success(`文件处理完成: ${file.name}`);
      } catch (err) { console.error(err); toast.error(`文件处理失败: ${file.name}`); }
    }
    setFileProcessing(false);
  };

  const removeUploadedFile = (fileId: string) => { setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId)); toast.success("文件已删除"); };

  return (
    <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-700 flex items-center">
          <UploadIcon className="h-4 w-4 mr-2" /> 业务分析文件上传
        </h3>
        <span className="text-xs text-gray-500">支持: .py, .json, .yaml, .csv, .xlsx (最大10MB)</span>
      </div>

      <div
        className={`
          border-2 border-dashed rounded-lg p-6 text-center transition-all duration-200
          ${dragOver ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400 hover:bg-blue-50"}
          ${fileProcessing ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        `}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(false);
          const files = e.dataTransfer.files;
          if (files.length > 0) handleFileUpload(files);
        }}
        onClick={() => !fileProcessing && (document.getElementById("hidden-file-input") as HTMLInputElement)?.click()}
      >
        {fileProcessing ? (
          <div className="flex items-center justify-center">
            <RefreshCw className="h-6 w-6 text-blue-600 animate-spin mr-2" />
            <span className="text-gray-600">正在处理文件...</span>
          </div>
        ) : (
          <>
            <UploadIcon className="h-8 w-8 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-600 mb-1">拖拽文件到这里或点击上传</p>
            <p className="text-xs text-gray-500">支持Python函数、分析模板、数据文件</p>
          </>
        )}
      </div>

      <input
        id="hidden-file-input"
        type="file"
        multiple
        accept=".py,.json,.yaml,.yml,.csv,.xlsx"
        className="hidden"
        onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
        disabled={fileProcessing}
      />

      {uploadedFiles.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-medium text-gray-700 mb-2">已上传文件:</h4>
          <div className="space-y-2">
            {uploadedFiles.map((file) => (
              <div key={file.id} className="flex items-center justify-between p-2 bg-white rounded border border-gray-200">
                <div className="flex items-center space-x-3">
                  <FileIcon className="h-4 w-4 text-blue-600" />
                  <div>
                    <p className="text-sm text-gray-900">{file.name}</p>
                    <p className="text-xs text-gray-500">
                      {(file.size / 1024).toFixed(1)}KB • {new Date(file.uploadedAt).toLocaleTimeString()}
                    </p>
                  </div>
                  {file.processed && <Check className="h-4 w-4 text-green-500" />}
                </div>
                <button onClick={() => removeUploadedFile(file.id)} className="p-1 text-gray-400 hover:text-red-500 transition-colors" title="删除文件">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default FinancialAnalysis;
