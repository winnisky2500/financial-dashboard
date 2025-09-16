// Budget.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Save, Download, Wand2, CheckCircle2, XCircle, ChevronDown, 
  Paperclip, ListChecks, FileDown, FileSpreadsheet, Database, Calculator 
} from 'lucide-react';

import { createClient } from '@supabase/supabase-js'; // 如果你已有 '@/lib/supabaseClient'，请替换为项目内路径
// import { supabase } from '@/lib/supabaseClient';
import * as XLSX from 'xlsx';
import { HyperFormula } from 'hyperformula';

// ====== 如果你已有全局 supabase 客户端，请用项目内的 ======
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

type Grid = (string | number | null)[][];
type Threshold = {
  id: string;
  canonical_name: string;
  compute_key: string;
  rule: string;
  scope_company: string | null;
  is_active: boolean;
  priority: number;
};

const DEFAULT_BUCKET = 'budget-templates';
const DEFAULT_TEMPLATE_PATH = 'default/xx_shipping.xlsx';

const Budget: React.FC = () => {
  const [company, setCompany] = useState<string>('XX轮船公司');
    const [grid, setGrid] = useState<Grid>([['指标名','2024Q3','2024Q4','2025Q1','2025Q2']]);
    const [quarters, setQuarters] = useState<string[]>([]);
    const hfRef = useRef<HyperFormula | null>(null);  // 单实例 HyperFormula
    const [activeTab, setActiveTab] = useState<'sheet'|'dashboard'>('sheet');
    const [loading, setLoading] = useState(false);
    const [templateName, setTemplateName] = useState<string>('（未加载模板）');
    const [templates, setTemplates] = useState<string[]>([]);
    const [aiLoading, setAiLoading] = useState<boolean>(false);
    const fileInputRef = useRef<HTMLInputElement>(null);   // 打开/导入模板
    const attachInputRef = useRef<HTMLInputElement>(null); // 读取附件数据
    
    // ↓↓↓ 阈值分析状态
    const [showFindings, setShowFindings] = useState(false);
    const [findings, setFindings] = useState<Array<{quarter:string, type:'eq'|'ineq', rule:string, expected?:number, actual?:number, detail:string}>>([]);
    // === Excel 风格：选中单元格 / 公式栏 / 是否显示小计算预览 ===
    const [selected, setSelected] = useState<{r:number,c:number}>({ r: 1, c: 1 }); // 默认选中第一个可编辑格
    const formulaInputRef = useRef<HTMLInputElement>(null);
    const [formulaValue, setFormulaValue] = useState<string>('');
    const [showCalcPreview, setShowCalcPreview] = useState<boolean>(true);
    const [openTplMenu, setOpenTplMenu] = useState(false);
    const [openDataMenu, setOpenDataMenu] = useState(false);
    const [openExportMenu, setOpenExportMenu] = useState(false);
    // 读取中状态（展示遮罩与“当前匹配指标”）
    const [aiBusy, setAiBusy] = useState(false);
    const [aiStage, setAiStage] = useState<'mapping'|'querying'|'parsing'|'idle'>('idle');
    const [aiItems, setAiItems] = useState<string[]>([]);
    const [aiIdx, setAiIdx] = useState(0);
    useEffect(() => {
    let t: any;
    if (aiBusy && aiItems.length > 0) {
        t = setInterval(() => setAiIdx(i => (i + 1) % aiItems.length), 500);
    } else {
        setAiIdx(0);
    }
    return () => { if (t) clearInterval(t); };
    }, [aiBusy, aiItems.length]);

    // 列号 -> A1 列字母
    const colToLabel = (c: number) => {
    let n = c + 1; // 1-based
    let s = '';
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
    };
    const a1 = (r: number, c: number) => `${colToLabel(c)}${r + 1}`; // r,c 都是0基

    // 选中单元格变化时，刷新公式栏
    useEffect(() => {
    const cell = grid[selected.r]?.[selected.c];
    setFormulaValue(cell == null ? '' : String(cell));
    }, [selected, grid]);

    // 当从公式栏回写到格子
    const commitFormulaBarToCell = () => {
    updateCell(selected.r, selected.c, formulaValue);
    };



  // === 从表头解析季度列 ===
  useEffect(() => {
    if (!grid || grid.length === 0) return;
    const header = grid[0] as (string | number | null)[];
    // 跳过第一列“指标名”
    const q = header.slice(1).map(v => (v ?? '') as string).map(s => s.replace(/\(e\)/gi,'').trim());
    setQuarters(q);
  }, [grid]);

  // === 构建 HyperFormula（支持公式重算） ===
  // === 构建/重建 HyperFormula（仅在需要时重建） ===
    const rebuildHFFromGrid = () => {
    const sheet = grid.map(row => row.map(v => (v === null || v === undefined) ? '' : v));
    if (hfRef.current) {
        try { hfRef.current.destroy(); } catch {}
        hfRef.current = null;
    }
    hfRef.current = HyperFormula.buildFromSheets({ Sheet1: sheet as any[] }, { licenseKey: 'gpl-v3' });
    };

    useEffect(() => { rebuildHFFromGrid(); }, [grid]);


  // === 读取默认模板（Supabase Storage） ===
  const loadDefaultTemplate = async () => {
  setLoading(true);
  try {
    const url = `${BUDGET_AGENT_URL}/storage/download?bucket=${encodeURIComponent(DEFAULT_BUCKET)}&path=${encodeURIComponent(DEFAULT_TEMPLATE_PATH)}`;
    const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${BUDGET_AGENT_TOKEN}` } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    const buf = await resp.arrayBuffer();
    await loadXlsxArrayBuffer(buf);
    setTemplateName('default/xx_shipping.xlsx');
  } catch (e:any) {
    console.error(e);
    alert(`加载默认模板失败: ${e?.message || e}`);
  } finally { setLoading(false); }
};




  // === 读取 Excel（含公式）到 grid ===
  const loadXlsxArrayBuffer = async (buf: ArrayBuffer) => {
    const wb = XLSX.read(buf, { type: 'array', cellFormula: true, cellNF: true, cellDates: true });
    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    const range = XLSX.utils.decode_range(ws['!ref']!);
    const rows: Grid = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: (string|number|null)[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell) { row.push(null); continue; }
        // 优先保留公式
        if (cell.f) row.push('=' + cell.f);
        else if (cell.v !== undefined && cell.v !== null) row.push(cell.v);
        else row.push(null);
      }
      rows.push(row);
    }
    // 过滤尾部全空行
    while (rows.length && rows[rows.length-1].every(v => v===null || v==='')) rows.pop();
    setGrid(rows);
  };

const BUDGET_AGENT_URL = import.meta.env.VITE_BUDGET_AGENT_URL;
const BUDGET_AGENT_TOKEN = import.meta.env.VITE_BUDGET_AGENT_TOKEN || '';

// 确保后端已创建 storage 桶（需要 service role）
const ensureBucket = async () => {
  const resp = await fetch(`${BUDGET_AGENT_URL}/storage/ensure`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${BUDGET_AGENT_TOKEN}`,
    },
    body: JSON.stringify({ bucket: DEFAULT_BUCKET }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`ensure-bucket ${resp.status}: ${txt}`);
  }
  return await resp.json();
};


const readDbViaAI = async () => {
  // 前端展示匹配队列（循环滚动）
  const metricNames = grid.slice(1).map(r => (r[0] ?? '').toString()).filter(Boolean);
  setAiItems(metricNames);
  setAiStage('mapping');
  setAiBusy(true);
  setAiLoading(true);
  try {
    const body = { company, quarters, sheet: grid };
    const resp = await fetch(`${BUDGET_AGENT_URL}/ai/read-db`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BUDGET_AGENT_TOKEN}` },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const txt = await resp.text();
      // 后端已做“部分成功”，一般不会 422；若有其他错误才提示
      throw new Error(`HTTP ${resp.status}: ${txt}`);
    }
    setAiStage('querying');
    const { filledSheet } = await resp.json();
    setGrid(filledSheet);
  } catch (e:any) {
    console.error(e);
    alert(`读取数据库数据失败: ${e?.message || e}`);
  } finally {
    setAiLoading(false);
    setAiBusy(false);
    setAiItems([]);
    setAiStage('idle');
  }
};



const onUploadAttachmentForAI = async (file: File) => {
  setAiItems(grid.slice(1).map(r => (r[0] ?? '').toString()).filter(Boolean));
  setAiStage('parsing');
  setAiBusy(true);
  try {
    const form = new FormData();
    form.append('company', company);
    form.append('quarters', JSON.stringify(quarters));
    form.append('sheet', JSON.stringify(grid));
    form.append('file', file);
    const resp = await fetch(`${BUDGET_AGENT_URL}/ai/read-attachment`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${BUDGET_AGENT_TOKEN}` },
    body: form
  });
  if (!resp.ok) throw new Error(await resp.text());
  setAiStage('mapping');
  const { filledSheet } = await resp.json();
  setGrid(filledSheet);
} catch (e:any) {
    console.error(e);
    alert(`读取附件数据失败: ${e?.message || e}`);
}   finally {
    setAiBusy(false);
    setAiItems([]);
    setAiStage('idle');
    setAiLoading(false);
    if (attachInputRef.current) attachInputRef.current.value = '';
  }
};


  // === 处理文件上传 ===
  const onUploadFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    await loadXlsxArrayBuffer(buf);
    setTemplateName(file.name);
    if (fileInputRef.current) fileInputRef.current.value = '';
    };


  // === 保存为模板（上传到 Storage） ===
  const arrayBufferToBase64 = (buf: ArrayBuffer) => {
    let binary = '';
    const bytes = new Uint8Array(buf);
    const len = bytes.length;
    for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
    };

const saveTemplateSkeleton = async () => {
  setLoading(true);
  try {
    // 组装“仅指标+公式”的工作簿
    const wb = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = {};
    const rowCount = grid.length;
    const colCount = grid[0]?.length ?? 0;
    const range = { s: { r:0, c:0 }, e: { r: Math.max(0,rowCount-1), c: Math.max(0,colCount-1) } };

    for (let r=0; r<rowCount; r++) {
      for (let c=0; c<colCount; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (r === 0 || c === 0) {
          const v = grid[r][c] ?? '';
          if (v !== '') (ws as any)[addr] = { t: 's', v: String(v) };
          continue;
        }
        const cell = grid[r][c];
        if (typeof cell === 'string' && cell.startsWith('=')) {
          (ws as any)[addr] = { t: 'n', f: cell.slice(1) }; // 仅保存公式
        }
      }
    }
    (ws as any)['!ref'] = XLSX.utils.encode_range(range);
    XLSX.utils.book_append_sheet(wb, ws, 'template');

    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const base = templateName.replace(/\.[^.]+$/, '') || 'xx_shipping';
    const fileName = `templates/${base}_skeleton.xlsx`;

    // 直接走后端 service_role 上传（自动创建 bucket + upsert）
    const b64 = arrayBufferToBase64(out);
    const resp = await fetch(`${BUDGET_AGENT_URL}/storage/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BUDGET_AGENT_TOKEN}`,
      },
      body: JSON.stringify({ bucket: DEFAULT_BUCKET, path: fileName, b64 }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${txt}`);
    }
    alert(`已保存模板（仅指标与公式）：${fileName}`);
  } catch (e:any) {
    console.error(e);
    alert(`保存模板失败: ${e?.message || e}`);
  } finally {
    setLoading(false);
  }
};


    // === 导出：Excel（保留公式） ===
    const exportAsXlsx = async () => {
    const wb = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = {};
    const rowCount = grid.length;
    const colCount = grid[0]?.length ?? 0;
    const range = { s:{r:0,c:0}, e:{r:Math.max(0,rowCount-1), c:Math.max(0,colCount-1)} };

    for (let r=0; r<rowCount; r++) {
        for (let c=0; c<colCount; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const v = grid[r][c];
        if (v === null || v === undefined || v === '') continue;
        if (typeof v === 'string' && v.startsWith('=')) {
            (ws as any)[addr] = { t:'n', f: v.slice(1) }; // Excel 公式
        } else if (typeof v === 'number') {
            (ws as any)[addr] = { t:'n', v };
        } else {
            (ws as any)[addr] = { t:'s', v: String(v) };
        }
        }
    }
    (ws as any)['!ref'] = XLSX.utils.encode_range(range);
    XLSX.utils.book_append_sheet(wb, ws, 'budget');
    const out = XLSX.write(wb, { type:'array', bookType:'xlsx' });
    const blob = new Blob([out], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (templateName || 'budget') + '.xlsx';
    a.click();
    URL.revokeObjectURL(url);
    };

    // === 导出：CSV（不支持公式计算，仅文本导出当前表） ===
    const exportAsCsv = () => {
    const lines = grid.map(row => row.map(v => v==null ? '' : String(v)).join(','));
    const blob = new Blob([lines.join('\n')], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (templateName || 'budget') + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    };
    
    // === 计算并固化所有公式为数值 ===
    const computeAndFreeze = () => {
    if (!hfRef.current) return;
    const next = grid.map(row => [...row]);
    for (let r = 0; r < next.length; r++) {
        for (let c = 0; c < (next[0]?.length ?? 0); c++) {
        const cell = next[r][c];
        if (typeof cell === 'string' && cell.startsWith('=')) {
            try {
            const v = hfRef.current.getCellValue({ sheet:0, row:r, col:c });
            const num = Number(v);
            if (!Number.isNaN(num)) next[r][c] = num;
            } catch {}
        }
        }
    }
    setShowCalcPreview(false);
    setGrid(next);
    };


  // === 查询 actual（financial_metrics）并更新工作簿 ===
  const pullActualsAndAutoUpdate = async () => {
    if (!quarters.length || grid.length < 2) return;
    setLoading(true);
    try {
      // 收集需要对齐的指标（第一列）
      const metricNames = grid.slice(1).map(r => (r[0] ?? '').toString()).filter(Boolean);
      // 解析季度（如 2025Q2）
      const qInfos = quarters.map(q => {
        const m = q.match(/^(\d{4})Q([1-4])$/i);
        return m ? { year: Number(m[1]), quarter: Number(m[2]), label: q } : null;
      });

      // 批量取数
      const { data, error } = await supabase
        .from('financial_metrics')
        .select('metric_name,company_name,year,quarter,metric_value')
        .in('company_name', [company])
        .in('metric_name', metricNames)
        .in('year', qInfos.filter(Boolean)!.map(x => x!.year));
      if (error) throw error;

      const map = new Map<string, number>();
      for (const row of (data || [])) {
        const label = `${row.year}Q${row.quarter}`;
        if (!quarters.includes(label)) continue;
        map.set(`${row.metric_name}__${label}`, Number(row.metric_value));
      }

      // 用 actual 覆盖对应单元格
      const newGrid = grid.map(r => [...r]);
      for (let i = 1; i < newGrid.length; i++) {
        const metric = (newGrid[i][0] ?? '').toString();
        for (let j = 1; j < newGrid[0].length; j++) {
          const qLabel = quarters[j - 1];
          const key = `${metric}__${qLabel}`;
          if (map.has(key)) {
            const v = map.get(key)!;
            // 仅当该格不是公式时才覆盖（避免直接覆写规则公式）
            if (!(typeof newGrid[i][j] === 'string' && (newGrid[i][j] as string).startsWith('='))) {
              newGrid[i][j] = v;
            }
          }
        }
      }
      setGrid(newGrid);

      // 覆盖后应用阈值聚合回填
      await applyThresholdRules(newGrid, setGrid);
    } catch (e) {
      console.error(e);
      alert('自动更新失败');
    } finally {
      setLoading(false);
    }
  };
  const refreshTemplateList = async () => {
    try {
        const resp = await fetch(`${BUDGET_AGENT_URL}/storage/list?bucket=${encodeURIComponent(DEFAULT_BUCKET)}&prefix=${encodeURIComponent('templates/')}`, {
        headers: { 'Authorization': `Bearer ${BUDGET_AGENT_TOKEN}` }
        });
        if (!resp.ok) {
        console.warn('模板列表获取失败', resp.status, await resp.text());
        setTemplates([]); // 静默清空，避免残留旧数据
        return;
        }
        const { objects } = await resp.json();
        const names: string[] = (objects || []).filter((p: string) => p.endsWith('.xlsx'));
        setTemplates(names.map(p => `templates/${p.split('/').pop()}`));
    } catch (e:any) {
        console.warn('模板列表获取失败（异常）', e);
        setTemplates([]); // 静默处理
    }
    };




const openTemplateFromStorage = async (path: string) => {
  setLoading(true);
  try {
    const url = `${BUDGET_AGENT_URL}/storage/download?bucket=${encodeURIComponent(DEFAULT_BUCKET)}&path=${encodeURIComponent(path)}`;
    const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${BUDGET_AGENT_TOKEN}` } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    const buf = await resp.arrayBuffer();
    await loadXlsxArrayBuffer(buf);
    setTemplateName(path);
  } catch (e:any) {
    console.error(e);
    alert(`打开模板失败: ${e?.message || e}`);
  } finally {
    setLoading(false);
  }
};




  // === 应用阈值规则（等式回填 + 约束检查） ===
  const applyThresholdRules = async (current: Grid, setter: (g: Grid)=>void) => {
    // 读取阈值（当前公司 + 全局）
    const { data, error } = await supabase
      .from('budget_thresholds')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: true });
    if (error) {
      console.error(error);
      return;
    }
    const rules: Threshold[] = (data || []).filter(r => !r.scope_company || r.scope_company === company);

    // 建立 compute_key -> canonical_name 对照
    const ck2cn = new Map<string, string>();
    for (const r of rules) ck2cn.set(r.compute_key, r.canonical_name);

    // 建立 行名 -> 行索引
    const name2row = new Map<string, number>();
    for (let i = 1; i < current.length; i++) {
      const name = (current[i][0] ?? '').toString();
      if (name) name2row.set(name, i);
    }

    const header = current[0];

    // 仅处理 "a=b+c+..." 的等式规则；">0" 规则做校验提示
    const newGrid = current.map(r => [...r]);

    for (const r of rules) {
      const expr = r.rule.replace(/\s+/g, '');
      if (expr.includes('=')) {
        const [lhs, rhs] = expr.split('=');
        if (!lhs || !rhs) continue;
        const lhsName = ck2cn.get(lhs) ?? lhs; // 优先映射成中文行名
        const lhsRow = name2row.get(lhsName);
        if (lhsRow == null) continue;
        const parts = rhs.split('+').filter(Boolean);
        const rhsRows = parts.map(p => name2row.get(ck2cn.get(p) ?? p)).filter(i => i != null) as number[];

        // 按列求和回填（跳过第一列标题）
        for (let c = 1; c < header.length; c++) {
          let sum = 0;
          for (const rr of rhsRows) {
            const v = newGrid[rr][c];
            const num = typeof v === 'number' ? v : Number(v);
            sum += Number.isFinite(num) ? num : 0;
          }
          // 把 LHS 写成数值（不写成公式，避免相互递归）
          newGrid[lhsRow][c] = sum;
        }
      } else {
        // 简单检查 “x>0”
        // 不等式：x>=k | x>k | x<=k | x<k
            const m = expr.match(/^([a-zA-Z0-9_]+)\s*(>=|>|<=|<)\s*(-?\d+(?:\.\d+)?)$/);
            if (m) {
            const ck = m[1];
            const op = m[2] as '>=' | '>' | '<=' | '<';
            const bound = Number(m[3]);
            const rowName = ck2cn.get(ck) ?? ck;
            const row = name2row.get(rowName);
            if (row != null) {
                for (let c = 1; c < header.length; c++) {
                // 仅校验，不写回
                // 若你希望基于 HF 计算值校验，可用 hfRef 取值
                const v = newGrid[row][c];
                const num = (() => {
                    if (typeof v === 'number') return v;
                    if (typeof v === 'string' && v.startsWith('=')) {
                    try { return Number(hfRef.current?.getCellValue({ sheet: 0, row, col: c })); } catch { return NaN; }
                    }
                    const n = Number(v);
                    return Number.isFinite(n) ? n : NaN;
                })();
                if (Number.isNaN(num)) continue;
                const ok =
                    (op === '>=' && num >= bound) ||
                    (op === '>'  && num >  bound) ||
                    (op === '<=' && num <= bound) ||
                    (op === '<'  && num <  bound);
                // 不在这里提示，交给“阈值匹配分析”统一出报告
                }
            }
            }

      }
    }

    setter(newGrid);
  };
  const runThresholdAnalysis = async () => {
    // 拉取阈值（当前公司 + 全局）
    const { data, error } = await supabase
        .from('budget_thresholds')
        .select('*')
        .eq('is_active', true)
        .order('priority', { ascending: true });
    if (error) { console.error(error); alert('获取阈值失败'); return; }

    const rules: Threshold[] = (data || []).filter(r => !r.scope_company || r.scope_company === company);

    // 映射
    const ck2cn = new Map<string, string>();
    for (const r of rules) ck2cn.set(r.compute_key, r.canonical_name);

    const name2row = new Map<string, number>();
    for (let i = 1; i < grid.length; i++) {
        const name = (grid[i][0] ?? '').toString();
        if (name) name2row.set(name, i);
    }

    const header = grid[0] as (string|number|null)[];
    const out: Array<{quarter:string, type:'eq'|'ineq', rule:string, expected?:number, actual?:number, detail:string}> = [];
    const EPS = 1e-6;

    // 工具：取单元格实时值（优先 HF 结果）
    const getVal = (row: number, col: number): number | null => {
        const cell = grid[row]?.[col];
        try {
        const v = hfRef.current?.getCellValue({ sheet: 0, row, col });
        const num = Number(v);
        if (!Number.isNaN(num)) return num;
        } catch {}
        if (typeof cell === 'number') return cell;
        const n = Number(cell);
        return Number.isFinite(n) ? n : null;
    };

    for (const r of rules) {
        const expr = r.rule.replace(/\s+/g, '');
        // 等式 a=b+c+...
        if (expr.includes('=')) {
        const [lhs, rhs] = expr.split('=');
        if (!lhs || !rhs) continue;
        const lhsName = ck2cn.get(lhs) ?? lhs;
        const lhsRow = name2row.get(lhsName);
        if (lhsRow == null) continue;
        const parts = rhs.split('+').filter(Boolean);
        const rhsRows = parts.map(p => name2row.get(ck2cn.get(p) ?? p)).filter(i => i != null) as number[];

        for (let c = 1; c < header.length; c++) {
            const qLabel = (header[c] ?? '').toString().replace(/\(e\)/i,'').trim();
            let expect = 0;
            let missing = false;
            for (const rr of rhsRows) {
            const v = getVal(rr, c);
            if (v == null) { missing = true; break; }
            expect += v;
            }
            const actual = getVal(lhsRow, c);
            if (missing || actual == null) continue; // 空值不参与匹配
            if (Math.abs(actual - expect) > EPS) {
            out.push({
                quarter: qLabel,
                type: 'eq',
                rule: r.rule,
                expected: Number(expect.toFixed(6)),
                actual: Number(actual.toFixed(6)),
                detail: `${lhsName} != ${parts.map(p => ck2cn.get(p) ?? p).join('+')}`
            });
            }
        }
        continue;
        }

        // 不等式 x>=k | x>k | x<=k | x<k
        const m = expr.match(/^([a-zA-Z0-9_]+)\s*(>=|>|<=|<)\s*(-?\d+(?:\.\d+)?)$/);
        if (m) {
        const ck = m[1];
        const op = m[2] as '>=' | '>' | '<=' | '<';
        const bound = Number(m[3]);
        const rowName = ck2cn.get(ck) ?? ck;
        const row = name2row.get(rowName);
        if (row == null) continue;

        for (let c = 1; c < header.length; c++) {
            const qLabel = (header[c] ?? '').toString().replace(/\(e\)/i,'').trim();
            const v = getVal(row, c);
            if (v == null) continue;
            const ok =
            (op === '>=' && v >= bound) ||
            (op === '>'  && v >  bound) ||
            (op === '<=' && v <= bound) ||
            (op === '<'  && v <  bound);
            if (!ok) {
            out.push({
                quarter: qLabel,
                type: 'ineq',
                rule: r.rule,
                expected: bound,
                actual: Number(v.toFixed(6)),
                detail: `${rowName} ${op} ${bound} 未满足`
            });
            }
        }
        continue;
        }
    }

    setFindings(out);
    setShowFindings(true);
    if (out.length === 0) {
        alert('阈值匹配分析通过：未发现不匹配项');
    }
    };

  // === 输入单元格（简单可编辑网格） ===
  const updateCell = (r: number, c: number, val: string) => {
  const next = grid.map(row => [...row]);
  const content = (val === '' ? null : (val.startsWith('=') ? val : (isNaN(Number(val)) ? val : Number(val))));
  next[r][c] = content;
  setGrid(next);

  // 写入 HyperFormula（保持与 grid 同步）
  if (hfRef.current) {
    const hfVal: any = (content === null) ? '' : (typeof content === 'string' && content.startsWith('=') ? content : content);
    try {
      hfRef.current.setCellContents({ sheet: 0, row: r, col: c }, hfVal as any);
    } catch (e) {
      console.warn('公式/数值写入失败', e);
    }
  }
};


  // === Dashboard 视图：计算是否达标（actual >= budget） ===
  const [selectedQuarterIdx, setSelectedQuarterIdx] = useState<number>(Math.max(0, (quarters.length - 1)));
  const [cards, setCards] = useState<{name:string, budget?:number, actual?:number, ok?:boolean}[]>([]);
    // quarters 变化时，把选择自动对齐到最后一个有效季度（避免固定在 0 或越界）
    useEffect(() => {
    if (!quarters.length) { setSelectedQuarterIdx(0); return; }
    setSelectedQuarterIdx(i => {
        const last = Math.max(0, quarters.length - 1);
        return Math.min(i, last);
    });
    }, [quarters]);

  const buildDashboard = async () => {
    if (!quarters.length || grid.length < 2) return;
    const qLabel = quarters[selectedQuarterIdx] ?? quarters[0];
    const idxCol = selectedQuarterIdx + 1; // grid 中列（+1 跳过“指标名”）

    // 预算行：形如 “预算-营业收入”
    const budgets = new Map<string, number>(); // key = 基础名（去掉“预算-”）
    for (let i = 1; i < grid.length; i++) {
        const raw = (grid[i][0] ?? '').toString();
        const base = raw.replace(/^预算[-_－]?/, ''); // 去掉预算前缀
        if (base !== raw) {
        const v = grid[i][idxCol];
        const num = typeof v === 'number' ? v : Number(v);
        if (Number.isFinite(num)) budgets.set(base, num);
        }
    }

    // 实际：取 DB 中当季的 “基础名”
    const { data, error } = await supabase
        .from('financial_metrics')
        .select('metric_name,company_name,year,quarter,metric_value')
        .eq('company_name', company)
        .eq('year', Number(qLabel.slice(0,4)))
        .eq('quarter', Number(qLabel.slice(-1)));
    if (error) { console.error(error); return; }

    const actuals = new Map<string, number>();
    for (const row of (data || [])) {
        actuals.set(row.metric_name, Number(row.metric_value));
    }

    // 卡片：以“基础名”为主；若预算或实际之一缺失，则显示“-”，不算达成
    const names = new Set<string>([...budgets.keys(), ...actuals.keys()]);
    const list: {name:string, budget?:number, actual?:number, ok?:boolean}[] = [];
    for (const base of names) {
        const b = budgets.get(base);
        const a = actuals.get(base);
        const ok = (b != null && a != null) ? (a / b >= 1) : undefined;
        list.push({ name: base, budget: b, actual: a, ok });
    }
    setCards(list);
    };


  useEffect(() => { buildDashboard(); }, [grid, company, selectedQuarterIdx]);

  return (
    <div className="space-y-6">
      {/* 顶部操作栏 */}
    <div className="flex flex-wrap items-center gap-3">
    {/* 公司选择 + 计算 */}
    <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">公司：</span>
        <select className="border rounded px-2 py-1" value={company} onChange={e=>setCompany(e.target.value)}>
        <option>XX轮船公司</option>
        </select>
        <button
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded border hover:bg-gray-50"
        onClick={computeAndFreeze}
        title="把所有公式计算并固化为数值"
        >
        <Calculator size={16}/> 计算
        </button>
    </div>

    {/* 模板 下拉 */}
    <div className="relative">
        <button
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded border hover:bg-gray-50"
        onClick={async ()=>{ await refreshTemplateList(); setOpenTplMenu(v=>!v); }}
        >
        <FileSpreadsheet size={16}/> 模板 <ChevronDown size={14}/>
        </button>
        {/* 下拉 */}
        <div className="absolute z-10 mt-1 w-56 rounded border bg-white shadow-sm" style={{display: openTplMenu ? 'block':'none'}}>
        <div className="px-3 py-2 text-xs text-gray-500">打开</div>
        <div className="px-3 pb-2">
            <select className="w-full border rounded px-2 py-1"
            onChange={async e => { if (e.target.value) { await openTemplateFromStorage(e.target.value); setOpenTplMenu(false); }}}>
            <option value="">选择存储中的模板</option>
            {templates.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
        </div>
        <button className="w-full text-left px-3 py-2 hover:bg-gray-50"
            onClick={()=>{ fileInputRef.current?.click(); }}>
            <Upload className="inline-block mr-2" size={14}/> 导入模板（本地）
        </button>
        <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden"
            onChange={async e => {
            if (e.target.files?.[0]) {
                await onUploadFile(e.target.files[0]);
                await refreshTemplateList();
                setOpenTplMenu(false);
            }
            }}/>
        <button className="w-full text-left px-3 py-2 hover:bg-gray-50"
            onClick={async ()=>{ await saveTemplateSkeleton(); setOpenTplMenu(false); }}>
            <Save className="inline-block mr-2" size={14}/> 保存模板（仅指标+公式）
        </button>
        </div>
    </div>

    {/* 读取数据 下拉 */}
    <div className="relative">
        <button
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded border hover:bg-gray-50"
        onClick={()=>setOpenDataMenu(v=>!v)}
        >
        <Database size={16}/> 读取数据 <ChevronDown size={14}/>
        </button>
        <div className="absolute z-10 mt-1 w-48 rounded border bg-white shadow-sm" style={{display: openDataMenu ? 'block':'none'}}>
        <button className="w-full text-left px-3 py-2 hover:bg-gray-50"
            onClick={async ()=>{ await readDbViaAI(); setOpenDataMenu(false); }}>
            <Wand2 className="inline-block mr-2" size={14}/> 读取数据库
        </button>
        <button className="w-full text-left px-3 py-2 hover:bg-gray-50"
            onClick={()=>{ attachInputRef.current?.click(); }}>
            <Paperclip className="inline-block mr-2" size={14}/> 读取附件
        </button>
        <input ref={attachInputRef} type="file" accept=".xlsx,.csv" className="hidden"
            onChange={async e => { if (e.target.files?.[0]) { await onUploadAttachmentForAI(e.target.files[0]); setOpenDataMenu(false); }}} />
        </div>
    </div>

    {/* 阈值匹配分析 */}
    <button className="inline-flex items-center gap-2 px-3 py-1.5 rounded border hover:bg-gray-50"
        onClick={runThresholdAnalysis}>
        <ListChecks size={16}/> 阈值匹配分析
    </button>

    {/* 导出 下拉 */}
    <div className="relative">
        <button
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded border hover:bg-gray-50"
        onClick={()=>setOpenExportMenu(v=>!v)}
        >
        <FileDown size={16}/> 导出 <ChevronDown size={14}/>
        </button>
        <div className="absolute z-10 mt-1 w-40 rounded border bg-white shadow-sm" style={{display: openExportMenu ? 'block':'none'}}>
        <button className="w-full text-left px-3 py-2 hover:bg-gray-50" onClick={()=>{ exportAsXlsx(); setOpenExportMenu(false); }}>
            Excel（含公式）
        </button>
        <button className="w-full text-left px-3 py-2 hover:bg-gray-50" onClick={()=>{ exportAsCsv(); setOpenExportMenu(false); }}>
            CSV
        </button>
        </div>
    </div>

    <div className="ml-auto flex items-center gap-2">
        <div className="text-sm text-gray-600">模板：<span className="font-medium">{templateName}</span></div>
        <span className="text-sm text-gray-600">季度：</span>
        <select className="border rounded px-2 py-1"
        value={selectedQuarterIdx}
        onChange={e=>setSelectedQuarterIdx(Number(e.target.value))}>
        {quarters.map((q, idx) => <option key={q} value={idx}>{q}</option>)}
        </select>
        <div className="flex gap-1 ml-2">
        <button className={`px-3 py-1.5 rounded border ${activeTab==='sheet'?'bg-gray-100':''}`} onClick={()=>setActiveTab('sheet')}>工作簿</button>
        <button className={`px-3 py-1.5 rounded border ${activeTab==='dashboard'?'bg-gray-100':''}`} onClick={()=>setActiveTab('dashboard')}>Dashboard</button>
        </div>
    </div>
    </div>



      {/* Sheet 视图 */}
    {activeTab==='sheet' && (
    <div className="space-y-2">
        {/* 公式编辑栏 */}
        <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">单元格：</span>
        <span className="px-2 py-1 border rounded bg-gray-50 text-xs">
            {a1(selected.r, selected.c)}
        </span>
        <input
            ref={formulaInputRef}
            className="flex-1 border rounded px-2 py-1"
            value={formulaValue}
            onChange={e=>setFormulaValue(e.target.value)}
            onBlur={commitFormulaBarToCell}
            onKeyDown={e=>{ if (e.key==='Enter') { commitFormulaBarToCell(); (e.target as HTMLInputElement).blur(); }}}
            placeholder="请输入公式或数值"
        />
        </div>

        {/* 表格 */}
        <div className="overflow-auto border rounded">
        <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
            {/* 第一行：A/B/C... */}
            <tr>
                <th className="px-2 py-1 border-b w-12 text-center">↘</th>
                {grid[0]?.map((_, cIdx) => (
                <th key={cIdx} className="px-2 py-1 border-b text-center">{colToLabel(cIdx)}</th>
                ))}
            </tr>
            {/* 第二行：grid 原表头，同时加行号 1 */}
            <tr>
                <th className="px-2 py-1 border-b w-12 text-center">1</th>
                {grid[0]?.map((h, idx) => (
                <th key={idx} className="px-3 py-2 text-left whitespace-nowrap border-b">{(h ?? '').toString()}</th>
                ))}
            </tr>
            </thead>
            <tbody>
            {grid.slice(1).map((row, rIdx0) => {
                const r = rIdx0 + 1; // 真正行号
                return (
                <tr key={rIdx0} className="odd:bg-white even:bg-gray-50">
                    {/* 行号 */}
                    <td className="px-2 py-1 border-b text-center w-12">{r+1}</td>
                    {row.map((cell, cIdx) => {
                    const isSelected = selected.r===r && selected.c===cIdx;
                    return (
                        <td
                        key={cIdx}
                        className={`px-2 py-1 border-b align-middle ${isSelected ? 'ring-2 ring-blue-400 ring-inset' : ''}`}
                        onMouseDown={(e) => {
                            // 公式栏以 '=' 开头时，点击单元格插入 A1 地址
                            if (document.activeElement === formulaInputRef.current && formulaValue.trim().startsWith('=')) {
                            e.preventDefault();
                            const addr = a1(r, cIdx);
                            const next = formulaValue + addr;
                            setFormulaValue(next);
                            // 保持焦点在公式栏
                            setTimeout(()=>formulaInputRef.current?.focus(), 0);
                            } else {
                            setSelected({ r, c:cIdx });
                            }
                        }}
                        >
                        {cIdx===0 ? (
                            <input
                            className="w-56 border rounded px-2 py-1"
                            value={(cell ?? '').toString()}
                            onFocus={()=>setSelected({ r, c:cIdx })}
                            onChange={e=>updateCell(r, cIdx, e.target.value)}
                            />
                        ) : (
                            <div className="flex flex-col">
                            <input
                                className="w-32 border rounded px-2 py-1 text-right"
                                value={(cell ?? '').toString()}
                                onFocus={()=>setSelected({ r, c:cIdx })}
                                onChange={e=>updateCell(r, cIdx, e.target.value)}
                            />
                            {showCalcPreview && (
                                <div className="text-[11px] text-gray-500 mt-0.5">
                                {(() => {
                                    try {
                                    const v = hfRef.current?.getCellValue({ sheet: 0, row: r, col: cIdx });
                                    return (v === null || v === undefined) ? '' : String(v);
                                    } catch { return ''; }
                                })()}
                                </div>
                            )}
                            </div>
                        )}
                        </td>
                    );
                    })}
                </tr>
                );
            })}
            </tbody>
        </table>
        </div>
    </div>
    )}


      {/* Dashboard 视图 */}
      {activeTab==='dashboard' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cards.map(card => (
            <div key={card.name} className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-500">{company} · {(quarters[selectedQuarterIdx] || '')}</div>
                {card.ok===true && <CheckCircle2 className="text-green-500" size={18}/>}
                {card.ok===false && <XCircle className="text-red-500" size={18}/>}
              </div>
              <div className="mt-1 text-base font-semibold">{card.name}</div>
              <div className="mt-3 flex items-end gap-6">
                <div>
                  <div className="text-xs text-gray-500">预算</div>
                  <div className="text-lg">{card.budget ?? '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">实际</div>
                  <div className="text-lg">{card.actual ?? '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">达成</div>
                  <div className={`text-lg ${card.ok===true ? 'text-green-600' : card.ok===false ? 'text-red-600' : ''}`}>
                    {card.ok===true ? '已达成' : card.ok===false ? '未达成' : '-'}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {cards.length===0 && (
            <div className="text-sm text-gray-500">未找到可展示的指标。请先加载模板或检查 financial_metrics 是否有对应指标。</div>
          )}
        </div>
      )}
    {/* 阈值匹配结果面板 */}
    {showFindings && (
    <div className="border rounded p-4">
        <div className="flex items-center justify-between mb-3">
        <div className="text-base font-semibold">阈值匹配分析结果（公司：{company}）</div>
        <button className="text-sm text-gray-600 underline" onClick={()=>setShowFindings(false)}>收起</button>
        </div>
        {findings.length === 0 ? (
        <div className="text-sm text-green-600">全部通过，未发现不匹配项。</div>
        ) : (
        <div className="overflow-auto">
            <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
                <tr>
                <th className="px-3 py-2 text-left border-b">季度</th>
                <th className="px-3 py-2 text-left border-b">类型</th>
                <th className="px-3 py-2 text-left border-b">规则</th>
                <th className="px-3 py-2 text-right border-b">期望</th>
                <th className="px-3 py-2 text-right border-b">实际</th>
                <th className="px-3 py-2 text-left border-b">说明</th>
                </tr>
            </thead>
            <tbody>
                {findings.map((f, i) => (
                <tr key={i} className="odd:bg-white even:bg-gray-50">
                    <td className="px-3 py-2 border-b">{f.quarter}</td>
                    <td className="px-3 py-2 border-b">{f.type==='eq'?'等式':'不等式'}</td>
                    <td className="px-3 py-2 border-b">{f.rule}</td>
                    <td className="px-3 py-2 border-b text-right">{f.expected ?? '-'}</td>
                    <td className="px-3 py-2 border-b text-right">{f.actual ?? '-'}</td>
                    <td className="px-3 py-2 border-b">{f.detail}</td>
                </tr>
                ))}
            </tbody>
            </table>
        </div>
        )}
    </div>
    )}  {/* 这里是阈值匹配结果面板的收尾 */}

    {/* 读取中遮罩 */}
    {aiBusy && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
        <div className="bg-white shadow-lg rounded-lg p-4 min-w-[280px]">
          <div className="text-sm font-medium text-gray-800">正在读取数据…</div>
          <div className="text-xs text-gray-500 mt-1">
            阶段：{aiStage === 'mapping' ? '匹配指标' : aiStage === 'querying' ? '拉取数值' : aiStage === 'parsing' ? '解析附件' : '处理中'}
          </div>
          {aiItems.length > 0 && (
            <div className="text-xs mt-1">
              当前：<span className="font-medium">{aiItems[aiIdx]}</span>（{aiIdx + 1}/{aiItems.length}）
            </div>
          )}
        </div>
      </div>
    )}

    </div>
  );
};

export default Budget;
