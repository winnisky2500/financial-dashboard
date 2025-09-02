// === Analysis.tsx ===
import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Send, Bot, User, RefreshCw, BarChart3, TrendingUp, Search, AlertTriangle,
  Upload as UploadIcon, File as FileIcon, X, Check, Sparkles, Plus,
  Zap, PlusSquare, Copy, PauseCircle,Info
} from "lucide-react";

import Markdown_2 from "@/components/ui/Markdown_2";
import IndicatorCard from "./components/IndicatorCard";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";

import {
  PieChart as RPieChart, Pie, Tooltip, Legend, ResponsiveContainer,
  BarChart as RBarChart, Bar, XAxis, YAxis,
  LineChart as RLineChart, Line, Cell
} from "recharts"; // ← 新增 Cell

const GRADIENTS = [
  ["#7C3AED","#C4B5FD"], ["#0EA5E9","#93C5FD"], ["#22C55E","#A7F3D0"],
  ["#F59E0B","#FDE68A"], ["#EF4444","#FCA5A5"], ["#14B8A6","#99F6E4"],
  ["#A855F7","#D8B4FE"], ["#3B82F6","#93C5FD"]
];

const AutoChart: React.FC<{ cfg: { type:"pie"|"bar"|"line"; data:any[]; xKey?:string; yKey?:string; nameKey?:string } }> = ({ cfg }) => {
  const xKey = cfg.xKey || "name";
  const yKey = cfg.yKey || "value";
  const nameKey = cfg.nameKey || "name";

  if (cfg.type === "pie") {
    return (
      <div className="w-[520px] max-w-full h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <RPieChart>
            <defs>
              {cfg.data.map((_: any, i: number) => (
                <linearGradient id={`g${i}`} x1="0" y1="0" x2="1" y2="1" key={i}>
                  <stop offset="0%" stopColor={GRADIENTS[i % GRADIENTS.length][0]} />
                  <stop offset="100%" stopColor={GRADIENTS[i % GRADIENTS.length][1]} />
                </linearGradient>
              ))}
            </defs>
            <Pie data={cfg.data} dataKey={yKey} nameKey={nameKey} label>
              {cfg.data.map((_: any, i: number) => <Cell key={i} fill={`url(#g${i})`} />)}
            </Pie>
            <Tooltip /><Legend />
          </RPieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (cfg.type === "bar") {
    return (
      <div className="w-[640px] max-w-full h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <RBarChart data={cfg.data}>
            <XAxis dataKey={xKey} /><YAxis />
            <Tooltip /><Legend />
            <Bar dataKey={yKey} />
          </RBarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // line
  return (
    <div className="w-[640px] max-w-full h-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <RLineChart data={cfg.data}>
          <XAxis dataKey={xKey} /><YAxis />
          <Tooltip /><Legend />
          <Line type="monotone" dataKey={yKey} dot={false} />
        </RLineChart>
      </ResponsiveContainer>
    </div>
  );
};



/* =================== Types =================== */
type AnalysisMode = "dimension" | "metric" | "business" | "anomaly";
type Step = {
  label: string;
  status: "pending" | "doing" | "done" | "error";
  detail?: string;
};
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  images?: string[];
  indicatorCard?: DataQueryResp['indicator_card'];
  chart?: { type: "pie" | "bar" | "line"; data: any[]; xKey?: string; yKey?: string; nameKey?: string };
  debug?: any;
  progress?: Step[];
  collapsed?: boolean;
  /** ✅ 新增：后端返回的逐步原始日志，放在对话里折叠显示 */
  progressRaw?: any[];
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

/* =================== Intent agent base =================== */
const INTENT_API: string =
  (window.localStorage.getItem("INTENT_API") as string) ??
  (import.meta as any).env?.VITE_INTENT_AGENT_URL ??
  "http://127.0.0.1:18040";

/* =================== Deep Analysis agent base =================== */
// Deep Analysis agent base
const DEEP_API: string =
  (window.localStorage.getItem("DEEP_API") as string) ??
  (import.meta as any).env?.VITE_DEEP_AGENT_URL ??
  "http://127.0.0.1:18030";

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
  dimension: ["对比 XX集团公司 2024 年各季度营业收入", "维度下钻 XX集团公司 2025 Q2 自由现金流"],
  metric:   ["分析一下 XX港口公司 2024 Q2 的 ROE", "XX集团公司 2024 Q2 的净利率是多少？"],
  business: ["杜邦分析 XX地产公司 2025 Q1 的ROE"],
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
  /** 👇 新增：指标卡（含当前值、同比/环比、与目标差距） */
  indicator_card?: {
    company: string;
    time: string;          // 例如 "2024 Q2"
    metric: string;        // 指标中文名
    unit?: string | null;

    current?: number | null;
    current_str?: string | null;

    yoy_delta?: number | null;
    yoy_delta_str?: string | null;

    qoq_delta?: number | null;
    qoq_delta_str?: string | null;

    target_gap?: number | null;       // 当前值 - 目标值（或按后端逻辑）
    target_gap_str?: string | null;

    refs?: {
      baseline_target?: number | null;
      last_year_value?: number | null;
      last_period_value?: number | null;
    };
  };
  debug?: {
    need_llm?: boolean;
    llm_first?: { ok?: boolean; endpoint?: string; elapsed_ms?: number };
    llm_second?: { ok?: boolean; endpoint?: string; elapsed_ms?: number };
    fetch_ok?: boolean;
    fetch_mode?: "direct" | "formula" | "formula_missing" | "formula_need_base" | "formula_error" | string;
    source?: string | null;
    resolved?: any;
  } | null;
  /** [ADD] 步骤轨迹（可选） */
  steps?: Array<{ stage?: string; called?: boolean; ok?: boolean; endpoint?: string; elapsed_ms?: number }>;
  message?: string;
};


const FETCH_TIMEOUT =
  Number((import.meta as any).env?.VITE_DATA_AGENT_TIMEOUT_MS) || 45000;

// === 业务公式中文化辅助 ===
const toCNExpr = (
  expr: string,
  key2cn: Record<string, string>,
  varMap?: Record<string, string> // 公式里 variables 的 { compute_key: "中文" }
) => {
  const dict = { ...(key2cn || {}), ...(varMap || {}) }; // variables 优先
  return String(expr || "").replace(/\b[a-zA-Z_]\w*\b/g, (w) => dict[w] || w);
};

// === 用 canonical_name 做唯一中文映射 ===
const fetchAliasNameMap = async () => {
  // 只取这三列；没有 display_name_cn
  const { data, error } = await supabase
    .from("metric_alias_catalog")
    .select("compute_key, canonical_name, aliases");
  if (error) throw error;

  const key2cn: Record<string, string> = {};
  const cn2key: Record<string, string> = {};

  (data || []).forEach((r: any) => {
    const ck = (r?.compute_key || "").trim();      // 英文/计算键，如 roe, net_profit
    const cn = (r?.canonical_name || "").trim();   // 中文名（你表里就是这个）
    if (ck && cn) {
      key2cn[ck] = cn;
      cn2key[cn] = ck;
    }
    // 可选：把 aliases 也指向中文（JSON 或逗号分隔都兼容）
    let aliases: string[] = [];
    if (typeof r?.aliases === "string") {
      try {
        const p = JSON.parse(r.aliases);
        if (Array.isArray(p)) aliases = p;
      } catch {
        aliases = r.aliases.split(/[,\s;|]+/).filter(Boolean);
      }
    } else if (Array.isArray(r?.aliases)) {
      aliases = r.aliases;
    }
    aliases.forEach((a) => {
      const ak = String(a || "").trim();
      if (ak && !key2cn[ak]) key2cn[ak] = cn;
    });
  });

  return { key2cn, cn2key };
};


// 之前：async function askData(question: string): Promise<DataQueryResp> { ... }
async function askData(question: string, ctrl: AbortController): Promise<DataQueryResp> {
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

function DebugChecks({ resp }: { resp?: any }) {
  if (!resp || !resp.debug) return null;
  const d = resp.debug || {};
  const okBadge = (ok: boolean) =>
    ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700";

  const needLLM = !!d.need_llm;
  const llmOk = !!((d.llm_first && d.llm_first.ok) || (d.llm_second && d.llm_second.ok));
  const fetchOk = !!(resp.value || resp.formula);

  return (
    <div className="flex flex-wrap gap-2 my-3">
      <span className={`px-2 py-1 rounded-full text-xs ${okBadge(needLLM)}`}>
        缺项→LLM：{needLLM ? "是" : "否"}
      </span>
      <span className={`px-2 py-1 rounded-full text-xs ${okBadge(llmOk)}`}>
        LLM解析：{llmOk ? "成功" : "失败"}
        {d.llm_second?.endpoint || d.llm_first?.endpoint ? (
          <span className="ml-1 opacity-70">
            ({d.llm_second?.endpoint || d.llm_first?.endpoint})
          </span>
        ) : null}
      </span>
      <span className={`px-2 py-1 rounded-full text-xs ${okBadge(fetchOk)}`}>
        取数：{fetchOk ? "成功" : "失败"}
        {resp.message ? <span className="ml-1 opacity-70">（{resp.message}）</span> : null}
      </span>
    </div>
  );
}
const ProgressBubble: React.FC<{
  steps: Step[];
  raw?: any[];                  // ✅ 新增
  showRaw?: boolean;    
  collapsed?: boolean;
  onToggle?: () => void;
}> = ({ steps, raw, showRaw = false, collapsed, onToggle }) => {
  const allDone = steps.every(s => s.status === "done" || s.status === "error");
  if (collapsed) {
    return (
      <div className="text-sm">
        <button onClick={onToggle} className="underline text-purple-700">
          执行进度（{allDone ? "已完成" : "进行中"}）
        </button>
      </div>
    );
  }
  return (
    <div className="mx-0 p-3 rounded-lg border border-gray-200 bg-amber-50/40">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-gray-700">执行进度</div>
        <button onClick={onToggle} className="text-xs text-gray-500 hover:text-gray-700">折叠</button>
      </div>
      <ol className="space-y-1 mt-1">
        {steps.map((s, i) => (
          <li key={i} className="text-sm">
            <span className="inline-flex items-center gap-2">
              {s.status === "pending" && <span className="w-2 h-2 rounded-full bg-gray-300" />}
              {s.status === "doing"   && <RefreshCw className="w-3 h-3 animate-spin text-blue-500" />}
              {s.status === "done"    && <Check className="w-3 h-3 text-green-600" />}
              {s.status === "error"   && <AlertTriangle className="w-3 h-3 text-red-600" />}
              <span className="font-medium">{s.label}</span>
              <span className="text-xs text-gray-500">({s.status})</span>
            </span>
            {s.detail && (
              <div className="ml-5 mt-1 text-xs text-gray-600 whitespace-pre-wrap">{s.detail}</div>
            )}
          </li>
        ))}
      </ol>

      {/* 原始日志仅在显式允许时显示 */}
  {showRaw && Array.isArray(raw) && raw.length > 0 && (
    <details className="mt-2">
      <summary className="text-xs text-gray-600 cursor-pointer">展开后端进度原始日志</summary>
      <pre className="text-xs mt-1 bg-white border rounded p-2 overflow-auto max-h-64">
{JSON.stringify(raw, null, 2)}
      </pre>
    </details>
  )}
    </div>
  );
};



async function runDeepAnalysis(payload: any, ctrl?: AbortController) {
  const res = await fetch(`${DEEP_API}/deepanalysis/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${(import.meta as any).env?.VITE_ROE_AGENT_TOKEN || ""}`
    },
    body: JSON.stringify(payload),
    mode: "cors",
    credentials: "omit",
    signal: ctrl?.signal,   // ✅ 支持中止
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

// === 新增：流式（SSE）调用 deep analysis，直到收到 done 才 resolve ===
async function runDeepAnalysisStream(
  payload: any,
  ctrl: AbortController,
  onProgress: (ev: any) => void
): Promise<any> {
  const res = await fetch(`${DEEP_API}/deepanalysis/analyze/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${(import.meta as any).env?.VITE_ROE_AGENT_TOKEN || ""}`
    },
    body: JSON.stringify(payload),
    signal: ctrl.signal,
  });

  // 某些代理不支持 SSE；回退到非流式
  const ctype = res.headers.get("content-type") || "";
  if (!res.ok || !ctype.includes("text/event-stream") || !res.body) {
    throw new Error("no-stream");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  return new Promise(async (resolve, reject) => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // 解析 SSE: 以 \n\n 分隔事件块
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          let evt = "message";
          let data = "";
          for (const line of raw.split("\n")) {
            if (line.startsWith("event:")) evt = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }

          if (evt === "progress") {
            try { onProgress(JSON.parse(data)); } catch {}
          } else if (evt === "done") {
            try { resolve(JSON.parse(data)); } catch { resolve({}); }
            return;
          }
        }
      }
      // 流意外结束
      resolve({});
    } catch (e) {
      reject(e);
    }
  });
}


async function routeIntent(payload: any) {
  const res = await fetch(`${INTENT_API}/intent/route`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${import.meta.env.VITE_ROE_AGENT_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

/* =================== Helpers =================== */
/* 数字格式化：|x|>10000 → 千分位整数；|x|<1 → 4 位小数；否则 2 位小数 */
function fmtNumberForTable(v: any): string {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const a = Math.abs(n);
  if (a > 10000) return Math.round(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  if (a < 1) return n.toFixed(4);
  return n.toFixed(2);
}

/** 优先使用 *_str；否则按规则格式化数值；并把 impact_estimate -> impact 等做友好列名 */
function mdFromRows(rows?: Array<Record<string, any>>): string {
  if (!rows || !rows.length) return "";

  // 1) 统一列集合（所有行的并集），并把 *_str 的基名收集起来
  const allKeys = new Set<string>();
  rows.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
  // 不展示的技术字段
  const hide = new Set<string>(["base_raw", "new_raw", "impact_raw", "variable_key"]);

  // 如果同时存在 foo 与 foo_str，只展示一次“foo”
  const baseNames = new Set<string>();
  for (const k of allKeys) {
    if (/_str$/.test(k)) baseNames.add(k.replace(/_str$/, ""));
    else if (!k.endsWith("_raw") && !k.endsWith("_key")) baseNames.add(k);
  }

  // 2) 友好列名映射
  const label = (k: string) => {
    const map: Record<string, string> = {
      company: "公司",
      metric: "指标",
      variable: "变量",
      variable_key: "变量键",
      current: "当前值",
      yoy_delta: "同比变动",
      qoq_delta: "环比变动",
      yoy_change: "同比变化",
      qoq_change: "环比变化",
      base: "基准值",
      new: "新值",
      impact: "贡献(估算)",
      impact_estimate: "贡献(估算)"
    };
    return map[k] ?? k;
  };


  // 3) 列顺序（尽量合理）
  const preferredOrder = ["company","metric","variable","variable_key",
                          "current","yoy_delta","qoq_delta","yoy_change","qoq_change",
                          "base","new","impact"];
  const cols = Array.from(baseNames).sort((a,b) => {
    const ia = preferredOrder.indexOf(a); const ib = preferredOrder.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  }).filter(c => !hide.has(c));

  // 4) 生成表格（优先 *_str；否则格式化数字）
  let md = `\n\n| ${cols.map(label).join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |\n`;
  for (const r of rows) {
    const cells = cols.map(c => {
      const strKey = `${c}_str`;
      if (strKey in r && r[strKey] != null && r[strKey] !== "") return String(r[strKey]);
      const val = (c in r) ? r[c] : "";
      if (typeof val === "number") return fmtNumberForTable(val);
      // impact_estimate -> impact（兼容后端旧字段）
      if (c === "impact" && r["impact_estimate"] != null) {
        return typeof r["impact_estimate"] === "number" ? fmtNumberForTable(r["impact_estimate"]) : String(r["impact_estimate"]);
      }
      return String(val ?? "");
    });
    md += `| ${cells.join(" | ")} |\n`;
  }
  return md;
}


/** 将 deepanalysis_agent 的 sections 渲染为 Markdown */
function deepSectionsToMarkdown(sections?: Array<Record<string, any>>): string {
  const sec = sections || [];
  if (!sec.length) return "";

  let md = "";
  for (const s of sec) {
    // 过滤“思考过程”类分节，只在加载进度里展示
    if ((s.type || "").toLowerCase() === "thinking") continue;

    const title = s.title || s.type || "分析";
    md += `\n### ${title}\n`;

    if (s.message) md += `${s.message}\n`;
        // [ADD] 维度下钻的轻量排查信息（折叠显示）
    if (s.debug && (s.debug.children_found || s.debug.data_calls)) {
      const all = Array.isArray(s.debug.data_calls) ? s.debug.data_calls : [];
      const ok = all.filter((x: any) => x.ok).map((x: any) => x.name);
      const fail = all
        .filter((x: any) => !x.ok)
        .map((x: any) => (x.reason ? `${x.name}（${x.reason}）` : x.name));
      const found = Array.isArray(s.debug.children_found) ? s.debug.children_found : [];
      // md += `\n<details><summary>排查：子公司取数</summary>\n\n` +
      //       `- 发现：${found.join("，") || "无"}\n` +
      //       `- 成功：${ok.join("，") || "无"}\n` +
      //       `- 未命中：${fail.join("，") || "无"}\n` +
      //       `</details>\n`;
    }

    // 维度下钻结论（TOP 列表）
    if (s.conclusion?.yoy_top?.length) {
      md += `\n**同比贡献 TOP**\n`;
      md += mdFromRows(s.conclusion.yoy_top);
    }
    if (s.conclusion?.qoq_top?.length) {
      md += `\n**环比贡献 TOP**\n`;
      md += mdFromRows(s.conclusion.qoq_top);
    }

    // 指标/业务下钻：公式 + 贡献估算
    if (s.formula?.compute_cn || s.formula?.compute) {
      const varsCN = (s.formula.variables_cn || s.formula.variables || []).join("，");
      if (s.formula.compute_cn) md += `\n**公式（中文）**：\`${s.formula.compute_cn}\`\n`;
      if (s.formula.compute)    md += `**公式（计算键）**：\`${s.formula.compute}\`\n`;
      if (varsCN) md += `**变量**：${varsCN}\n`;
    }
    if (s.contribution_yoy?.length) {
      md += `\n**同比贡献估算**\n`;
      md += mdFromRows(s.contribution_yoy);
    }

    // 异动分析 TOP
    if (s.top_yoy?.length) {
      md += `\n**同比变化 TOP**\n`;
      md += mdFromRows(s.top_yoy);
    }
    if (s.top_qoq?.length) {
      md += `\n**环比变化 TOP**\n`;
      md += mdFromRows(s.top_qoq);
    }

    // 通用表格
    if (s.table?.length) {
      md += mdFromRows(s.table);
    }
  }
  return md.trim();
}

// === 新增：聊天页专用的简化指标卡（无眼睛/问号，默认展开，显示环比&同比） ===
const ChatIndicatorCard: React.FC<{ data: NonNullable<DataQueryResp['indicator_card']> }> = ({ data }) => {
  // 轻度数值清洗
  const num = (v: any) => (v === null || v === undefined || v === '' ? null : Number(String(v).replace(/[%％,\s]/g, '')));
  const fmt = (v: number | null, unit?: string) => {
    if (v === null || v === undefined) return '-';
    // 千分位
    const s = Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
    return unit ? `${s}${unit}` : s;
  };
  const pct = (deltaBase: number | null, curr: number | null) => {
    if (deltaBase === null || deltaBase === 0 || curr === null) return null;
    return ((curr - deltaBase) / Math.abs(deltaBase)) * 100;
  };
  const fmtPct = (p: number | null) => (p === null ? '-' : `${p.toFixed(2)}%`);

  const curr = num(data.current);
  const prev = num(data.refs?.last_period_value);     // 上期值（环比基准）
  const yoyv = num(data.refs?.last_year_value);       // 去年同期值（同比基准）
  const tgt  = num(data.refs?.baseline_target);       // 目标值
  const unit = data.unit || '';

  const qoq = pct(prev, curr);                        // 环比变化（百分比）
  const yoy = pct(yoyv, curr);                        // 同比变化（百分比）
  const progress = tgt && curr !== null ? (curr / tgt) * 100 : null; // 目标达成度

  return (
    <div className="w-[420px] max-w-full rounded-xl border border-gray-200 bg-white shadow-sm p-5">
      {/* 标题（不显示分类） */}
      <div className="text-gray-900 text-lg font-semibold">{data.metric}</div>
      {/* 副标题：公司 + 期间 */}
      <div className="text-gray-500 text-sm mt-0.5">{data.company} · {data.time}</div>

      {/* 当前值 */}
      <div className="mt-3 text-3xl font-bold tracking-tight text-gray-900">
        {fmt(curr, unit)}
      </div>

      {/* 环比 & 同比 两个小徽标并排 */}
      <div className="mt-2 flex items-center gap-4 text-sm">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600">
          <span className="text-xs">↗</span> {fmtPct(qoq)} <span className="text-gray-500">较上期</span>
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
          <span className="text-xs">↗</span> {fmtPct(yoy)} <span className="text-gray-500">较去年同期</span>
        </span>
      </div>

      {/* 目标达成进度条（如有目标） */}
      {progress !== null && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>目标达成</span>
            <span>{progress.toFixed(2)}%</span>
          </div>
          <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-2 bg-amber-500"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-gray-500">目标：{fmt(tgt, unit)}</div>
        </div>
      )}

      {/* 明细（默认展开，无折叠按钮） */}
      <div className="mt-4 text-sm">
        <div className="flex justify-between py-1">
          <div className="text-gray-500">当前值</div>
          <div className="text-gray-900">{fmt(curr, unit)}</div>
        </div>
        <div className="flex justify-between py-1">
          <div className="text-gray-500">上期值</div>
          <div className="text-gray-900">{fmt(prev, unit)}</div>
        </div>
        <div className="flex justify-between py-1">
          <div className="text-gray-500">去年同期值</div>
          <div className="text-gray-900">{fmt(yoyv, unit)}</div>
        </div>
        <div className="flex justify-between py-1">
          <div className="text-gray-500">目标值</div>
          <div className="text-gray-900">{fmt(tgt, unit)}</div>
        </div>
        <div className="flex justify-between py-1">
          <div className="text-gray-500">变化幅度（环比）</div>
          <div className="text-red-600 font-medium">{fmtPct(qoq)}</div>
        </div>
        <div className="flex justify-between py-1">
          <div className="text-gray-500">变化幅度（同比）</div>
          <div className="text-blue-600 font-medium">{fmtPct(yoy)}</div>
        </div>
      </div>
    </div>
  );
};

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("已复制到剪贴板");
  } catch {
    toast.error("复制失败，请检查浏览器权限");
  }
};

// 将后端 indicator_card 转为概览页 IndicatorCard 需要的 indicator 结构
const icToOverviewIndicator = (c: NonNullable<DataQueryResp['indicator_card']>) => {
  // 做一次温和的数值清洗
  const num = (v: any) => (v === null || v === undefined || v === '') ? null : Number(String(v).replace(/[%％,\s]/g, ''));
  return {
    id: `${c.company}-${c.metric}-${c.time}`,
    code: c.metric,
    name: c.metric,
    category: '一利五率',            // 无分类时给个默认，不影响渲染
    value: num(c.current) ?? 0,
    previousValue: num(c.refs?.last_period_value) ?? undefined,
    lastYearValue: num(c.refs?.last_year_value) ?? undefined,
    baselineTarget: num(c.refs?.baseline_target) ?? undefined,
    unit: c.unit || undefined,
    source: '数据中台',
    // @ts-ignore：IndicatorCard 内部会读取
    companyName: c.company,
  } as any;
};



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
// 步骤类型


/** 步骤模板 */
const BASE_STEPS: Step[] = [
  { label: "分析问题中（意图识别）", status: "pending" },
  { label: "取数中",                 status: "pending" },
  { label: "调用分析agent大模型中",   status: "pending" },
  { label: "生成结果中",             status: "pending" },
];

/** 让“意图”决定需要的步骤（dataquery/政策 → 精简为两步；deep → 完整四步） */
const stepsForIntent = (intent?: string): Step[] => {
  const two = [
    { label: "分析问题中（意图识别）", status: "pending" } as Step,
    { label: "生成结果中",             status: "pending" } as Step,
  ];
  if (!intent) return [...BASE_STEPS];       // 未知时先按完整四步
  if (intent === "deep") return [...BASE_STEPS];
  if (intent === "dataquery" || intent === "policy" || intent === "other") return two;
  return two;
};





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
    if (!open) return;           // ← 关键：关闭时不触发任何查询
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
  const [selectedTabs, setSelectedTabs] = useState<Set<AnalysisMode>>(new Set());
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [fileProcessing, setFileProcessing] = useState(false);

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadDefaultMetric, setUploadDefaultMetric] = useState<string | undefined>(undefined);

  // 新增：添加指标 & 快速取数
  const [showAddMetric, setShowAddMetric] = useState(false);
  const [showQuickFetch, setShowQuickFetch] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const progressMsgIndexRef = useRef<number | null>(null); // ✅ 当前这次问答的进度消息在 messages 中的索引
  const [forcedPolicy, setForcedPolicy] = useState(false);
  type BizFormula = {
    method?: string | null;
    method_name?: string | null;   // 公式名（如：杜邦分解）
    metric_name: string;           // 对应指标（如：ROE）
    description?: string | null;
    variables?: string[] | null;   // 中文变量名
    compute?: string | null;       // 计算键表达式（原文）
    compute_cn?: string | null;    // ✅ 后端已映射为中文（来自 metric_alias_catalog）
  };


  const [bizFormulas, setBizFormulas] = useState<BizFormula[]>([]);
  const [selectedBizFormula, setSelectedBizFormula] = useState<string | null>(null);
  // ---------- 进度面板状态 ---------- // [ADD]
  const [steps, setSteps] = useState<Step[]>(stepsForIntent());  // 默认先给完整四步
  const [showSteps, setShowSteps] = useState<boolean>(false); // [ADD]
  const [backendProgress, setBackendProgress] = useState<any[] | null>(null); // [ADD]
  useEffect(() => {
  if (!backendProgress || !Array.isArray(backendProgress)) return;

  // 把后端进度合并到 steps
  let nextStepsSnapshot: Step[] | null = null;
  setSteps(prev => {
    const next = [...prev];

    const mapIdx = (txt: string) => {
      const s = (txt || "").toString();
      if (s.includes("意图") || s.includes("分析问题")) return 0;
      if (s.includes("取数")) return 1;
      if (s.includes("下钻") || s.includes("调用分析agent")) return 2;
      if (s.includes("最终") || s.includes("生成结果")) return 3;
      return -1;
    };

    for (const p of backendProgress) {
      const i = mapIdx(String(p.step || ""));
      if (i < 0) continue;
      const stRaw = String(p.status || "").toLowerCase();
      const status: Step["status"] =
        /error/.test(stRaw) ? "error" :
        /(done|ok|finish)/.test(stRaw) ? "done" :
        /(start|doing|progress)/.test(stRaw) ? "doing" :
        next[i].status;

      // 关键：把“业务可读的文字说明”写进 detail
      next[i] = { ...next[i], status, detail: (p.detail ?? next[i].detail) };
    }
    nextStepsSnapshot = next;        // 暂存一份，下面同步到聊天消息
    return next;
  });

  // 同步到对话里的“进度气泡”：progress（而不仅仅是原始日志）
  if (progressMsgIndexRef.current !== null) {
    setMessages((m) => {
      const arr = [...m];
      const idx = progressMsgIndexRef.current!;
      const msg = arr[idx];
      if (msg) {
        arr[idx] = {
          ...msg,
          progress: nextStepsSnapshot || msg.progress, // ← 同步步骤与详细文字
          progressRaw: backendProgress                  // 原始日志仍可留存但不会显示
        };
      }
      return arr;
    });
  }
}, [backendProgress]);


  useEffect(() => {
  if (progressMsgIndexRef.current === null) return;
  // 自动折叠：全部 done/error 后 1.2s 折叠
  const doneAll = steps.every(s => s.status === "done" || s.status === "error");
  if (doneAll) {
    const t = setTimeout(() => {
      setMessages((m) => {
        const arr = [...m];
        const idx = progressMsgIndexRef.current!;
        if (arr[idx]) arr[idx] = { ...arr[idx], collapsed: true };
        return arr;
      });
    }, 1200);
    return () => clearTimeout(t);
  }
}, [steps]);

  /** 强制顺序：当把第 idx 步设为 doing/done 时，自动把 0..idx-1 补成 done，避免乱序 */
  const setStepStatus = (idx: number, status: Step["status"], detail?: string) => {
    setSteps(prev => {
      const next = [...prev];
      // 先补齐前面的步骤
      for (let j = 0; j < idx && j < next.length; j++) {
        if (next[j].status === "pending" || next[j].status === "doing") {
          next[j] = { ...next[j], status: "done" };
        }
      }
      // 再更新当前步骤
      if (next[idx]) next[idx] = { ...next[idx], status, ...(detail ? { detail } : {}) };

      // 同步到对话中的“进度气泡”
      if (progressMsgIndexRef.current !== null) {
        setMessages(m => {
          const arr = [...m];
          const i = progressMsgIndexRef.current!;
          if (arr[i]) arr[i] = { ...arr[i], progress: next };
          return arr;
        });
      }
      return next;
    });
  };



  const handleAbort = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setLoading(false);
      toast.success("已终止当前查询");
    }
  };

  const loadBizFormulas = async () => {
    try {
      // 1) 先取指标别名映射：compute_key -> 中文名
      const { key2cn, cn2key } = await fetchAliasNameMap();

      // 2) 读取“业务公式”
      const { data, error } = await supabase
        .from("metric_formulas")
        .select("metric_name, method, method_name, description, variables, compute, enabled, formula_label")
        .eq("formula_label", "业务公式")
        .eq("enabled", true)
        .order("method_name", { ascending: true });

      if (error) throw error;

      const list: BizFormula[] = (data || []).map((row: any) => {
        const variablesObj: Record<string, string> =
          typeof row.variables === "string" ? JSON.parse(row.variables) : (row.variables || {});
        const computeObj: Record<string, string> =
          typeof row.compute === "string" ? JSON.parse(row.compute) : (row.compute || {});

        // metric_name 也做一次友好化（如果能反查到 compute_key）
        const metricKey = cn2key[row.metric_name] || row.metric_name;

        // 生成中文版 compute（多条时多行）
        const lines: string[] = [];
        Object.entries(computeObj).forEach(([k, v]) => {
          const leftCN = key2cn[k] || variablesObj[k] || k; // 左边先按别名/变量映射
          const rightCN = toCNExpr(String(v), key2cn, variablesObj);
          lines.push(`${leftCN} = ${rightCN}`);
        });
        const compute_cn = lines.join("\n");

      return {
        method: row.method || null,
        method_name: row.method_name || row.method || "业务公式",
        // metric_name 用中文展示
        metric_name: key2cn[metricKey] || row.metric_name,
        description: row.description || null,
        variables: Object.values(variablesObj || {}) as string[],
        compute: computeObj[metricKey] || Object.values(computeObj)[0] || null,
        compute_cn,
      };
      });

      setBizFormulas(list || []);
      if ((list || []).length === 1) setSelectedBizFormula(list[0].metric_name);
    } catch (e: any) {
      toast.error(`业务公式列表获取失败：${e?.message || "网络错误"}`);
    }
  };


  // 仅当选中“业务下钻”时加载一次
  useEffect(() => {
    if (selectedTabs.has("business")) loadBizFormulas();
  }, [selectedTabs]);

  // 仅在首次进入页面时生成欢迎语，不再因切换下钻模式而清空对话
  useEffect(() => { generateWelcomeMessage(); }, []);
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
    welcome += '- "分析 XX集团公司 2024 Q2 的 ROE"\n';
    welcome += '- "2024 年 Q4 XX地产公司的ROA是多少？"\n\n';
    setMessages([{ role: "assistant", content: welcome, timestamp: new Date().toISOString() }]);
  };

  useEffect(() => {
    const question = searchParams.get("question");
    const mode = searchParams.get("mode");
    const send = searchParams.get("send");

    if (mode && ["dimension", "metric", "business", "anomaly"].includes(mode)) {
      setSelectedTabs(new Set([mode as AnalysisMode]));
    }
    // 新增：识别政策模式（不改变 tabs，只给路由一个“提示”）
    setForcedPolicy(mode === "policy");

    if (question) {
      setInputQuery(question);
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

    /* =================== Deep agent base =================== */


  const handleTabClick = (tabId: AnalysisMode) => {
    const next = new Set(selectedTabs);
    const isSelected = next.has(tabId);

    if (isSelected) {
      next.delete(tabId);
    } else {
      // 互斥：metric 与 business 只能二选一
      if (tabId === "metric" && next.has("business")) {
        next.delete("business");
        toast("“指标下钻”和“业务下钻”不能同时选择，已切换为“指标下钻”。", { icon: "ℹ️" });
      }
      if (tabId === "business" && next.has("metric")) {
        next.delete("metric");
        toast("“指标下钻”和“业务下钻”不能同时选择，已切换为“业务下钻”。", { icon: "ℹ️" });
      }
      next.add(tabId);
    }
    setSelectedTabs(next);
  };

  const handleTabDoubleClick = (tabId: AnalysisMode) => {
    const next = new Set(selectedTabs);
    next.delete(tabId);
    setSelectedTabs(next);
  };

  const handleSendMessage = async (query?: string) => {
    const messageText = query || inputQuery.trim();
    if (selectedTabs.has("business") && !selectedBizFormula) {
      toast.error("请选择一条“业务公式”再开始分析下钻");
      setLoading(false);
      return;
    }
    if (!messageText) return toast.error("请输入问题");

    setMessages((m) => [...m, { role: "user", content: messageText, timestamp: new Date().toISOString() }]);
    setInputQuery("");
    setLoading(true);

    // ✅ 在对话里插入一个“进度气泡”消息（初始第0步 doing）
    const initStepsInChat: Step[] = stepsForIntent().map(
      (s, i): Step => ({ ...s, status: i === 0 ? "doing" : "pending" })
    );

    progressMsgIndexRef.current = (messages.length + 1); // 用户消息已经 push 1 条
    const progressMsg: ChatMessage = {
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      progress: initStepsInChat,
      collapsed: false,
    };
    setMessages((m): ChatMessage[] => [...m, progressMsg]);

    // ---------- 重置与开启步骤面板 ----------
    setShowSteps(false);                 // 展示步骤区域
    setSteps(stepsForIntent());          // 全部重置为 pending（按意图模板）
    setBackendProgress(null);            // 清空后端进度
    setStepStatus(0, "doing");           // Step0：意图识别 → doing

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      // ===== 1) 意图识别与路由 =====
      const modes = Array.from(selectedTabs) as ("dimension" | "metric" | "business" | "anomaly")[];
      const intentReq = {
        question: messageText,
        ui_tab: forcedPolicy ? "policy" : (modes.length ? "analysis" : undefined),
        force_deep: modes.length > 0,
        selected_modes: (forcedPolicy ? [...modes, "policy"] : modes) as any,
        business_formula_metric_name: selectedTabs.has("business") ? (selectedBizFormula || undefined) : undefined,
        auto_execute: modes.length === 0, // [MOD] 确保不由后端立即执行，前端可控进度
      };

      const routed = await routeIntent(intentReq);
      setStepStatus(0, "done"); // 意图识别完成

      const rr = routed?.routed_response ?? {};
      const r = (rr && rr.data) ? rr.data : rr;  // 兼容 { data: {...} } 包装
      const intent = routed?.intent as string;

      // ① 根据意图切换步骤模板（dataquery/政策 → 两步；deep → 四步）
      const tpl = stepsForIntent(intent);
      setSteps(tpl);
      if (progressMsgIndexRef.current !== null) {
        setMessages(m => {
          const arr = [...m];
          const idx = progressMsgIndexRef.current!;
          if (arr[idx]) arr[idx] = { ...arr[idx], progress: tpl };
          return arr;
        });
      }

      // ② 先把“意图识别”标记完成，再进行后续（避免你看到“取数先 done、意图还在 doing”）
      setStepStatus(0, "done", `intent=${intent || "N/A"}`);


    // === 新增：在对话里打印“意图识别结果”调试信息 ===
      try {
        const debugLines = [
          `intent: ${intent || "(empty)"}`,
          `auto_execute: ${String(intentReq.auto_execute)}`,
          `ui_tab: ${intentReq.ui_tab || "(none)"}`,
          `force_deep: ${String(intentReq.force_deep)}`,
          `selected_modes: ${JSON.stringify(intentReq.selected_modes || [])}`,
          `business_formula_metric_name: ${String(
            intentReq.business_formula_metric_name || ""
          )}`,
          `has_routed_payload: ${String(!!routed?.routed_payload)}`,
          `routed_response_keys: ${JSON.stringify(Object.keys(r || {}))}`,
          `has_indicator_card: ${String(!!(r as any)?.indicator_card)}`,
          `need_clarification: ${String(!!(r as any)?.need_clarification)}`,
          `ask: ${((r as any)?.ask || "")}`,
          `has_analysis_text: ${String(!!(r as any)?.analysis)}`,
        ];
        const rawPreview = (() => {
          try {
            return JSON.stringify(r || {}, null, 2).slice(0, 1200);
          } catch {
            return "[unserializable routed_response]";
          }
        })();

        
      } catch {
        // 打印失败不应影响后续逻辑
      }

      // 非 deep：关闭步骤条（仅 deep 需要详细阶段） // [ADD]
      if (intent !== "deep") setShowSteps(false);
      

      // A) indicator_card 直接展示
      const indicatorCard = r?.indicator_card ?? r?.indicator_card?.data;
if (indicatorCard) {
  const cardMsg: ChatMessage = {
    role: "assistant",
    content: "",
    indicatorCard,
    timestamp: new Date().toISOString(),
  };
  setMessages((m): ChatMessage[] => [...m, cardMsg]);

  /** [ADD] dataquery 的 3-Check 调试消息（如果后端带了 debug/steps） */
  if (intent === "dataquery") {
    const hasDebug = r && (r.debug || r.steps || r.value || r.formula || r.message);
      if (hasDebug) {
        const dbgMsg: ChatMessage = {
          role: "assistant",
          content: "",
          debug: r,                            // 传整个 dataquery 响应，DebugChecks 会用到 resp.debug/resp.message/resp.value 等
          timestamp: new Date().toISOString(),
        };
        setMessages((m): ChatMessage[] => [...m, dbgMsg]);
      }
      toast.success("完成");
      return;
    }
  }

      // A) indicator_card 直接展示（保持你现有逻辑）

      // B) dataquery 澄清
      if (r?.need_clarification && r?.ask) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: r.ask, timestamp: new Date().toISOString() },
        /** [ADD] 在澄清时也显示调试条（可看到 need_llm=true / llm解析失败 等） */
        r?.debug || r?.steps ? { role: "assistant", content: "", debug: r, timestamp: new Date().toISOString() } : undefined,
      ].filter(Boolean) as ChatMessage[]);
      toast.success("请补充信息后重试");
      return;
    }


      // C) deepanalysis：优先使用后端已执行的结果
      if (intent === "deep") {
      const routedPayload = routed?.routed_payload;
      const routedResponse = routed?.routed_response;
      let deepResp: any = routedResponse ?? null;

      // 先把 “取数中” 标记为进行中
      setStepStatus(1, "doing");

      // 一个小工具：把后端 progress 映射到 UI 的四步
      const mapIdx = (txt: string) => {
        const s = (txt || "").toString();
        if (s.includes("意图") || s.includes("分析问题")) return 0;
        if (s.includes("取数")) return 1;
        if (s.includes("下钻") || s.includes("调用分析agent")) return 2;
        if (s.includes("最终") || s.includes("生成结果")) return 3;
        return -1;
      };

      if (!deepResp) {
        try {
          if (!routedPayload) throw new Error("缺少 routed_payload，无法发起分析调用");

          // 优先尝试流式
          const resp = await runDeepAnalysisStream(
            routedPayload,
            ctrl,
            (ev) => {
              // 1) 记录后端进度（用于展开“原始日志”）
              setBackendProgress((prev) => [...(prev || []), ev]);

              // 2) 同步四步状态+文案
              const i = mapIdx(String(ev.step || ""));
              if (i >= 0) {
                const stRaw = String(ev.status || "").toLowerCase();
                const status: Step["status"] =
                  /error/.test(stRaw) ? "error" :
                  /(done|ok|finish)/.test(stRaw) ? "done" :
                  /(start|doing|progress)/.test(stRaw) ? "doing" :
                  undefined as any;

                if (status) setStepStatus(i, status, ev.detail);
              }
            }
          );

          // 流式完成后拿到最终结果
          deepResp = resp && resp.indicator_card ? resp : (resp || null);
        } catch (e) {
          // 流式不可用（如网关不支持 SSE）→ 回退非流式
          try {
            deepResp = await runDeepAnalysis(routedPayload, ctrl);
          } catch (err: any) {
            const msg = err?.message || "";
            const hint = msg.includes("Failed to fetch")
              ? `无法访问分析服务：${DEEP_API}/deepanalysis/analyze。请检查 VITE_DEEP_AGENT_URL 与网络。`
              : "";
            setStepStatus(2, "error", (msg || "调用分析服务失败") + (hint ? `\n${hint}` : ""));
            throw err;
          }
        }
      }

      // “取数中”完成、“调用分析agent”进行中
      setStepStatus(1, "done");
      setStepStatus(2, "doing");

      // 如果后端已自带 progress（非流式回退时），也合并一下
      if (deepResp?.progress && Array.isArray(deepResp.progress)) {
        setBackendProgress(deepResp.progress as any[]);
        // 同步一步到位
        deepResp.progress.forEach((p: any) => {
          const i = mapIdx(String(p.step || ""));
          if (i >= 0) {
            const stRaw = String(p.status || "").toLowerCase();
            const status: Step["status"] =
              /error/.test(stRaw) ? "error" :
              /(done|ok|finish)/.test(stRaw) ? "done" :
              /(start|doing|progress)/.test(stRaw) ? "doing" :
              undefined as any;
            if (status) setStepStatus(i, status, p.detail);
          }
        });
      }

      // 进入“生成结果中”
      setStepStatus(2, "done");
      setStepStatus(3, "doing");

      // === 渲染结果（保持你原有逻辑） ===
      let md = "## 🔎 分析下钻结果\n";
      if (deepResp?.resolved) {
        const { company, metric, year, quarter } = deepResp.resolved;
        if (company || metric || year || quarter) {
          md += `\n**对象**：${company ?? "-"} · ${year ?? "-"} ${quarter ?? "-"} · ${metric ?? "-"}\n`;
        }
      }
      if (deepResp?.summary) md += `\n> ${deepResp.summary}\n`;
      if (deepResp?.analysis_text) {
        md += `\n<details><summary>模型思考摘要（调试）</summary>\n\n${deepResp.analysis_text}\n\n</details>\n`;
      }
      if (deepResp?.debug) {
        md += `\n<details><summary>调试信息</summary>\n\n\`\`\`json\n${JSON.stringify(deepResp.debug, null, 2)}\n\`\`\`\n</details>\n`;
      }

      const secMd = deepSectionsToMarkdown(deepResp?.sections || []);
      if (secMd) {
        md += `\n${secMd}\n`;
      } else if (!deepResp?.summary) {
        md += "\n（已完成下钻，但没有可展示的分项；请检查是否缺少子公司关系或指标的标准/业务公式配置。）\n";
      }

      const charts = (deepResp?.sections || [])
        .filter((s: any) => s?.chart && s.chart.type && s.chart.data)
        .map((s: any) => s.chart);
      const mainChart = charts.find((c: any) => c?.type === "pie") || charts[0] || null;

      setMessages((prev): ChatMessage[] => {
        const first: ChatMessage = {
          role: "assistant",
          content: md,
          chart: (mainChart || undefined) as any,
          timestamp: new Date().toISOString(),
        };
        const rest: ChatMessage[] = (charts.length > 1)
          ? charts.slice(1).map((cfg: any): ChatMessage => ({
              role: "assistant",
              content: "",
              chart: cfg,
              timestamp: new Date().toISOString(),
            }))
          : [];
        return [...prev, first, ...rest];
      });

      setStepStatus(3, "done");
      toast.success("完成");
      return;
    }


      // D) policy：展示文本
      if (intent === "policy" && r?.analysis) {
        setMessages((m) => [...m, { role: "assistant", content: r.analysis, timestamp: new Date().toISOString() }]);
        toast.success("完成");
        return;
      }

      // E) other 或无匹配
      if (intent === "other" || !intent) {
        const msg = r?.message || "这似乎不是财务问题。请尝试明确公司、指标、年份、季度。";
        setMessages((m) => [...m, { role: "assistant", content: msg, timestamp: new Date().toISOString() }]);
        toast.success("完成");
        return;
      }

      // F) 兜底
      throw new Error("未识别的意图或空响应");
    } catch (e: any) {
      const msg = e?.message || "";
      if (/abort/i.test(msg) || e?.name === "AbortError") {
        // 用户主动终止
      } else {
        setMessages((m) => [...m, { role: "assistant", content: `出错：${msg || "未知错误"}`, timestamp: new Date().toISOString() }]);
        toast.error("失败");
        setStepStatus(3, "error", msg || "错误");
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
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
                  onClick={() => handleTabClick(tab.id as AnalysisMode)}
                  onDoubleClick={() => handleTabDoubleClick(tab.id as AnalysisMode)}
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
            {/* === 执行步骤面板（新增） === */}
      {showSteps && (
        <div className="px-6 mt-3">
          <div className="mx-0 p-3 rounded-lg border border-gray-200 bg-amber-50/40">
            <div className="text-xs font-medium text-gray-700 mb-2">执行进度</div>
            <ol className="space-y-1">
              {steps.map((s, i) => (
                <li key={i} className="text-sm">
                  <span className="inline-flex items-center gap-2">
                    {s.status === "pending" && <span className="w-2 h-2 rounded-full bg-gray-300" />}
                    {s.status === "doing"   && <RefreshCw className="w-3 h-3 animate-spin text-blue-500" />}
                    {s.status === "done"    && <Check className="w-3 h-3 text-green-600" />}
                    {s.status === "error"   && <AlertTriangle className="w-3 h-3 text-red-600" />}
                    <span className="font-medium">{s.label}</span>
                    <span className="text-xs text-gray-500">({s.status})</span>
                  </span>
                  {s.detail && (
                  <div className="ml-5 mt-1 text-xs text-gray-600 whitespace-pre-wrap">
                    {s.label.includes("生成结果") ? (s.detail.split(/\r?\n/)[0]) : s.detail}
                  </div>
                    )}

                </li>
              ))}
            </ol>

            {/* 后端返回的逐步日志（原始） */}
            {Array.isArray(backendProgress) && backendProgress.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs text-gray-600 cursor-pointer">展开后端进度原始日志</summary>
                <pre className="text-xs mt-1 bg-white border rounded p-2 overflow-auto max-h-64">
{JSON.stringify(backendProgress, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </div>
      )}

      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 pb-40">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`flex items-start space-x-3 max-w-4xl ${m.role === "user" ? "flex-row-reverse space-x-reverse" : ""}`}>
              <div className={`flex items-center justify-center w-8 h-8 rounded-full ${m.role === "user" ? "bg-blue-600" : "bg-gray-600"}`}>
                {m.role === "user" ? <User className="h-5 w-5 text-white" /> : <Bot className="h-5 w-5 text-white" />}
              </div>
              {/* 新：为右下角按钮腾出空间（多一点下/右内边距） */}
              <div className={`px-4 py-3 pb-8 pr-10 rounded-lg max-w-full relative group ${m.role === "user" ? "bg-blue-600 text-white" : "bg-gray-50 border border-gray-200 text-gray-900"}`}>

                {/* 新：复制按钮放在右下角，不遮住时间戳 */}
                <button
                  onClick={() => copyText(m.content)}
                  className={`absolute bottom-2 right-2 p-1 rounded-md transition-opacity ${
                    m.role === "user" ? "bg-white/15 hover:bg-white/25 text-white" : "bg-black/5 hover:bg-black/10 text-gray-600"
                  } opacity-0 group-hover:opacity-100`}
                  title="复制这条消息"
                  aria-label="复制这条消息"
                >
                  <Copy className="h-4 w-4" />
                </button>

                {/* 内容 */}
                {m.role === "user" ? (
                <p className="whitespace-pre-wrap">{m.content}</p>
              ) : m.indicatorCard ? (
                <ChatIndicatorCard data={m.indicatorCard} />
              ) : m.progress ? (  // ✅ 新增：进度气泡
                <ProgressBubble
                  steps={m.progress}
                  raw={m.progressRaw}
                  collapsed={m.collapsed}
                  onToggle={()=>{
                    const idx = i;
                    setMessages((arr)=> {
                      const cp = [...arr];
                      const msg = cp[idx];
                      if (msg) cp[idx] = { ...msg, collapsed: !msg.collapsed };
                      return cp;
                    });
                  }}
                />
              ) : (
                <div className="max-w-none">
                  {m.content && (
                    <div className="prose prose-sm prose-gray">
                      <Markdown_2 content={m.content} />
                    </div>
                  )}
                  {m.chart && <div className="mt-3"><AutoChart cfg={m.chart} /></div>}
                </div>
              )}

                {/* [ADD] dataquery 调试条（存在 debug 时显示） */}
                {m.debug && (
                  <div className="mt-3">
                    <DebugChecks resp={m.debug} />
                  </div>
                )}





                <p className={`text-xs mt-2 ${m.role === "user" ? "text-blue-100" : "text-gray-500"}`}>
                  {new Date(m.timestamp).toLocaleTimeString()}
                </p>
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
              onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) handleSendMessage();
              if (e.key === "Escape" && loading) {
                e.preventDefault();
                handleAbort();
              }
            }}

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
            {loading && (
              <button
                onClick={handleAbort}
                className="inline-flex items-center px-3 py-3 rounded-lg border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-colors"
                title="暂停当前查询"
              >
                <PauseCircle className="h-5 w-5 mr-1" />
                中止
              </button>
            )}

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
          <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">


            <div className="space-y-2 max-h-56 overflow-auto">
            {bizFormulas.length === 0 ? (
              <div className="text-xs text-gray-500">暂无可用“业务公式”。</div>
            ) : (
              bizFormulas.map((f) => {
                // info 面板是否展开：用“metric_name.__info__”做一个轻量状态
                const infoOpen = true;  // 总是展开

                // 单选是否选中：info 展开时也视为该项已选
                const isSelected =
                  selectedBizFormula === f.metric_name || infoOpen;

                return (
                  <div key={f.metric_name} className="p-2 rounded hover:bg-white">
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="biz-formula"
                        className="mt-1"
                        checked={!!isSelected}
                        onChange={() => setSelectedBizFormula(f.metric_name)}
                      />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <div className="font-medium">
                            {f.method_name || "业务公式"}
                          </div>
                          <button
                            type="button"
                            className="text-gray-400 hover:text-gray-600"
                            title="查看公式详情"
                            onClick={() =>
                              setSelectedBizFormula(
                                infoOpen
                                  ? f.metric_name
                                  : `${f.metric_name}.__info__`
                              )
                            }
                          >
                            <Info className="w-4 h-4" />
                          </button>
                        </div>

                        {f.description && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            {f.description}
                          </div>
                        )}
                      </div>
                    </div>

                    {infoOpen && (
                      <div className="mt-2 ml-7 text-xs text-gray-600 border rounded-lg bg-white p-2">
                        <div className="mb-1">
                          <span className="text-gray-500">对应指标：</span>
                          {f.metric_name || "-"}
                        </div>
                        <div className="mb-1">
                          <span className="text-gray-500">计算方法：</span>
                          <code className="bg-gray-50 px-1 py-0.5 rounded">
                            {f.compute_cn || f.compute || "-"}
                          </code>
                        </div>

                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          </div>
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
