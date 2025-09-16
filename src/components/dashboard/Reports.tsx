import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  FileText, Upload, Download, Save, Settings, Eye, Edit3, RefreshCw,
  ChevronRight, FolderOpen, File, Trash2, Plus, X, Check,
  AlertCircle, Sparkles, Calendar, Clock, User, Tag, Layers,
  Monitor, Smartphone, Code, Image, Type, Send, MessageSquare,
  Zap, Lightbulb, Bot, Copy, Info, BookOpen, CheckCircle2
} from 'lucide-react';
import {
  generateIntelligentReport,
  uploadTemplate,
  listTemplates,
  // getTemplate,
  deleteTemplate,
  exportDocument,
  getReportTypes,
  listReportUploads,
  uploadReportFile,
  deleteReportUpload,
  generateFreeReport,
  type ReportUploadRow,
  type ReportGenerationParams,
  type ReportGenerationResult,
  type ReportTemplateRow
} from '@/lib/dataService';


import { Markdown } from '@/components/ui/Markdown';
import { supabase } from '@/lib/supabase';
import toast from 'react-hot-toast';

// === 生成阶段 Stepper ===
const GenStep: React.FC<{ status: 'thinking'|'generating'|'done' }> = ({ status }) => {
  const Item: React.FC<{on:boolean; label:string; icon:React.ReactNode}> = ({on,label,icon}) => (
    <div className="flex items-center space-x-2">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] ${on?'bg-blue-600':'bg-gray-300'}`}>
        {icon}
      </div>
      <span className={`text-sm ${on?'text-blue-700 font-medium':'text-gray-500'}`}>{label}</span>
    </div>
  );
  return (
    <div className="flex items-center space-x-4 p-2 bg-gray-50 border border-gray-200 rounded-lg">
      <Item on={status!=='thinking'} label="思考中" icon={<span>🤔</span>} />
      <div className="h-px w-8 bg-gray-300" />
      <Item on={status==='generating' || status==='done'} label="生成中" icon={<span>⚙️</span>} />
      <div className="h-px w-8 bg-gray-300" />
      <Item on={status==='done'} label="生成完毕" icon={<span>✅</span>} />
    </div>
  );
};

const loadEchartsOnce = (() => {
  let loading: Promise<void> | null = null;
  return () => {
    if ((window as any).echarts) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('echarts cdn load failed'));
      document.head.appendChild(s);
    });
    return loading;
  };
})();

const EChartsBlock: React.FC<{ option: any, height?: number }> = ({ option, height = 320 }) => {
  const ref = useRef<HTMLDivElement>(null);

  function ensureLegendAndTooltip(opt: any) {
    const o = JSON.parse(JSON.stringify(opt || {}));
    if (!o.tooltip) o.tooltip = { trigger: 'axis' };
    const series = Array.isArray(o.series) ? o.series : [];
    const names = series.map((s: any, i: number) => {
      if (!s || typeof s !== 'object') return `系列${i + 1}`;
      if (!s.name) s.name = `系列${i + 1}`;
      return s.name;
    });
    if (!o.legend) o.legend = {};
    if (o.legend.show === undefined) o.legend.show = true;
    if (!o.legend.data || !Array.isArray(o.legend.data) || o.legend.data.length === 0) {
      o.legend.data = names;
    }
    return o;
  }

  useEffect(() => {
    let chart: any;
    let disposed = false;
    (async () => {
      try {
        await loadEchartsOnce();
        if (disposed || !ref.current) return;
        const echarts = (window as any).echarts;
        chart = echarts.init(ref.current);
        const patched = ensureLegendAndTooltip(option || {});
        chart.setOption(patched || {});
        const resize = () => chart && chart.resize();
        window.addEventListener('resize', resize);
        return () => {
          window.removeEventListener('resize', resize);
          if (!disposed && chart) chart.dispose();
        };
      } catch {
        // ignore
      }
    })();
    return () => { disposed = true; if (chart) chart.dispose(); };
  }, [option]);

  return <div ref={ref} style={{ width: '100%', height }} />;
};


const SmartMarkdown: React.FC<{ content: string }> = ({ content }) => {
  // 用正则切分出 ```echarts ...``` 代码块
  const parts: React.ReactNode[] = [];
  const re = /```echarts\s*([\s\S]*?)```/g;
  let last = 0, m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(content))) {
    const before = content.slice(last, m.index);
    if (before) parts.push(<div key={`md-${idx++}`} className="prose prose-gray max-w-none"><Markdown content={before} /></div>);
    const jsonRaw = m[1].trim();
    try {
      const opt = JSON.parse(jsonRaw);
      parts.push(<div key={`chart-${idx++}`} className="my-4 border border-gray-200 rounded"><EChartsBlock option={opt} /></div>);
    } catch {
      parts.push(<div key={`code-${idx++}`} className="prose prose-gray max-w-none"><Markdown content={`\`\`\`echarts\n${jsonRaw}\n\`\`\``} /></div>);
    }
    last = m.index + m[0].length;
  }
  const tail = content.slice(last);
  if (tail) parts.push(<div key={`md-${idx++}`} className="prose prose-gray max-w-none"><Markdown content={tail} /></div>);
  return <>{parts}</>;
};

type TabType = 'template' | 'natural_language';
interface Tab { id: TabType; name: string; description: string; icon: React.ComponentType<any>; }

const reportTabs: Tab[] = [
  { id: 'template', name: '按模板生成', description: '使用预设模板和参数生成标准化报告', icon: FileText },
  { id: 'natural_language', name: '按自然语言生成', description: '通过自然语言描述需求，AI智能生成报告', icon: MessageSquare }
];

const QUARTERS = ['Q1','Q2','Q3','Q4'] as const;

// 从 Vite 环境拿 Agent 网关与 Token
const AGENT_BASE = (
  ((import.meta as any).env?.VITE_REPORT_AGENT_URL as string) || ''
).replace(/\/$/, '');

const AGENT_TOKEN = (
  (import.meta as any).env?.VITE_REPORT_AGENT_TOKEN ||
  'dev-secret-01'
);
// —— 把 DB 模板结构转换为 Markdown 模板文本，便于喂给后端（template_text）
function buildTemplateTextFromDBTemplate(tpl: ReportTemplateRow | null | undefined): string {
  if (!tpl || !tpl.template_data) return '';
  const td: any = tpl.template_data || {};
  const name = tpl.name || td.name || '报告模板';
  const sections = Array.isArray(td.sections) ? td.sections : [];
  let out = `# ${name}\n\n`;
  sections.forEach((s: any, i: number) => {
    const title = (s?.title || `第${i + 1}部分`).toString();
    out += `## ${title}\n`;
    if (s?.hint) out += `> ${String(s.hint).trim()}\n\n`;
    const kms = Array.isArray(s?.keyMetrics)
      ? s.keyMetrics
      : (typeof s?.keyMetrics === 'string'
          ? s.keyMetrics.split(',').map((x: string) => x.trim()).filter(Boolean)
          : []);
    if (kms.length) out += `**重点指标：** ${kms.join('、')}\n\n`;
    if (s?.requireCharts) out += `（此处需要图表）\n\n`;
    out += '\n';
  });
  return out.trim();
}


const Reports: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('template');
  const [selectedReportType, setSelectedReportType] = useState<string>('');

  // ✅ 用 DB 模板类型
  const [templates, setTemplates] = useState<ReportTemplateRow[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<ReportTemplateRow | null>(null);

  const [reportContent, setReportContent] = useState<string>('');
  const [generatedReport, setGeneratedReport] = useState<ReportGenerationResult | null>(null);

  const [currentView, setCurrentView] = useState<'setup' | 'editor' | 'preview'>('setup');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // ====== 模板查看 / 编辑（新增） ======
  const [showTemplateViewer, setShowTemplateViewer] = useState(false);
  const [viewTemplate, setViewTemplate] = useState<any | null>(null);

  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [editorState, setEditorState] = useState<{
    id?: string;
    name: string;
    category: string;
    description: string;
    sections: { title: string; hint: string; keyMetrics: string; requireCharts: boolean }[];
  }>({
    name: '',
    category: 'general',
    description: '',
    sections: [
      { title: '概述', hint: '', keyMetrics: '', requireCharts: false },
      { title: '第一部分', hint: '', keyMetrics: '', requireCharts: true },
      { title: '第二部分', hint: '', keyMetrics: '', requireCharts: true },
      { title: '总结', hint: '', keyMetrics: '', requireCharts: false }
    ]
  });

  const [naturalLanguageInput, setNaturalLanguageInput] = useState('');
  const [isNaturalGenerating, setIsNaturalGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  // 折叠面板：已上传文件
  const [openUploads, setOpenUploads] = useState(true);

  // 首次进入时拉取“已上传文件”列表
  useEffect(() => {
    (async () => {
      try {
        const rows = await listReportUploads();
        setUploads(rows);
        if (rows && rows.length > 0) setOpenUploads(true);
      } catch (e) {
        console.warn('listReportUploads failed', e);
      }
    })();
  }, []);

  // === Beautify Agent base ===
  const BEAUTIFY_BASE = (
    (import.meta as any).env?.VITE_BEAUTIFY_AGENT_URL
  ) ? ((import.meta as any).env?.VITE_BEAUTIFY_AGENT_URL as string).replace(/\/$/, '') : AGENT_BASE;

  // === 美化弹窗/状态 ===
  const [showBeautify, setShowBeautify] = useState(false);
  const [isBeautifying, setIsBeautifying] = useState(false);
  const [beautifyOptions, setBeautifyOptions] = useState({
    instructions: '',
    font_family: 'Inter, "Microsoft YaHei", system-ui, sans-serif',
    base_font_size: 13,
    line_height: 1.75,
    paragraph_spacing_px: 8,
    content_width_px: 1920,
    theme: 'light' as 'light'|'dark',
    palette: '#2563eb,#10b981,#f59e0b,#ef4444,#8b5cf6',
  });
const [beautifyResult, setBeautifyResult] = useState<{
  html?: string,
  html_url?: string,
  html_download_url?: string,
  docx_url?: string,
  docx_download_url?: string,
  pdf_url?: string,
  pdf_download_url?: string,
  pptx_url?: string,                // ✅ 新增
  pptx_download_url?: string        // ✅ 新增
} | null>(null);

  const [streamStage, setStreamStage] = useState<string>('');  // 阶段进度文案

  // 生成配置：公司 + 起止 年-季 + 语言 + 特殊要求
  const [companies, setCompanies] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [startYear, setStartYear] = useState<number | ''>('');
  const [startQuarter, setStartQuarter] = useState<typeof QUARTERS[number] | ''>('');
  const [endYear, setEndYear] = useState<number | ''>('');
  const [endQuarter, setEndQuarter] = useState<typeof QUARTERS[number] | ''>('');
  const [language, setLanguage] = useState<'zh-CN'|'en-US'>('zh-CN');
  const [specialRequirements, setSpecialRequirements] = useState<string>('');
  const [uploads, setUploads] = useState<ReportUploadRow[]>([]);
  const [selectedUploadIds, setSelectedUploadIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const naturalInputRef = useRef<HTMLTextAreaElement>(null);

  const reportTypes = getReportTypes();

  const yearOptions = useMemo(() => {
    const cur = new Date().getFullYear();
    return Array.from({length: cur - 2011}, (_,i)=>cur - i);
  }, []);
  const pickUpload = () => uploadInputRef.current?.click();

  const onUploadsChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const row = await uploadReportFile(f);
        setUploads(prev => [row, ...prev]);
        setOpenUploads(true); 
      }
    } catch (err: any) {
      alert(`上传失败：${err?.message || err}`);
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  const toggleSelectUpload = (id: string) => {
    setSelectedUploadIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const removeUploadFile = async (id: string, name: string) => {
    const ok = confirm(`删除文件：${name} ?`);
    if (!ok) return;
    try {
      await deleteReportUpload(id);
      setUploads(prev => prev.filter(x => x.id !== id));
      setSelectedUploadIds(prev => prev.filter(x => x !== id));
    } catch (err: any) {
      alert(`删除失败：${err?.message || err}`);
    }
  };



  const quickSuggestions = [
    '生成2024年Q3季度财务业绩报告，重点分析营收增长和盈利能力变化',
    '分析公司风险状况并生成风险评估报告，包含市场风险和运营风险',
    '创建年度ESG可持续发展报告，涵盖环境保护和社会责任实践',
    '生成投资者关系季度报告，展示公司业务进展和未来规划',
    '制作月度财务分析报告，对比同期数据并提供趋势预测'
  ];

  useEffect(() => { loadTemplates(); }, []);
  useEffect(() => {
    const fetchCompanies = async () => {
      try {
        const { data, error } = await supabase.from('financial_metrics').select('company_name');
        if (error) throw error;
        const names = Array.from(new Set((data || []).map((r:any)=>r.company_name).filter(Boolean))).sort();
        setCompanies(names);
      } catch (e) { console.error(e); toast.error('加载公司列表失败'); }
    };
    fetchCompanies();
  }, []);

  const loadTemplates = async () => {
    try {
      const list = await listTemplates();
      setTemplates(list);
    } catch (err) {
      console.error('加载模板失败', err);
    }
  };

  const handleReportTypeSelect = (rt: any) => setSelectedReportType(rt.id);

  // 选择模板
  const handleTemplateSelect = async (tpl: ReportTemplateRow) => {
    setSelectedTemplate(tpl);
    setReportContent('');
  };

  // —— 新增：查看模板
  const openViewTemplate = (tpl: any) => {
    setViewTemplate(tpl);
    setShowTemplateViewer(true);
  };

  // —— 新增：编辑/新增模板（打开弹窗 & 预填）
  const openCreateTemplate = () => {
    setEditorState({
      name: '',
      category: 'general',
      description: '',
      sections: [
        { title: '概述', hint: '', keyMetrics: '', requireCharts: false },
        { title: '第一部分', hint: '', keyMetrics: '', requireCharts: true },
        { title: '第二部分', hint: '', keyMetrics: '', requireCharts: true },
        { title: '总结', hint: '', keyMetrics: '', requireCharts: false }
      ]
    });
    setShowTemplateEditor(true);
  };
  const openEditTemplate = (tpl: any) => {
    const td = tpl?.template_data || {};
    const sections = (td.sections || []).map((s:any)=>({
      title: s.title || '',
      hint: s.hint || '',
      keyMetrics: Array.isArray(s.keyMetrics) ? s.keyMetrics.join(',') : (s.keyMetrics || ''),
      requireCharts: !!s.requireCharts
    }));
    setEditorState({
      id: tpl.id,
      name: tpl.name || td.name || '',
      category: tpl.category || 'general',
      description: tpl.description || '',
      sections: sections.length ? sections : [
        { title: '概述', hint: '', keyMetrics: '', requireCharts: false },
        { title: '第一部分', hint: '', keyMetrics: '', requireCharts: true },
        { title: '第二部分', hint: '', keyMetrics: '', requireCharts: true },
        { title: '总结', hint: '', keyMetrics: '', requireCharts: false }
      ]
    });
    setShowTemplateEditor(true);
  };

  const dedup = (arr: string[]) => Array.from(new Set(arr.map(s=>s.trim()).filter(Boolean)));

  // —— 新增：保存模板（新增/更新）
  const saveTemplate = async () => {
    if (!editorState.name.trim()) return toast.error('请填写模板名称');
    setSavingTemplate(true);
    try {
      // 章节 -> template_data
      const sectionsPayload = editorState.sections.map(s=>({
        title: s.title?.trim() || '',
        hint: s.hint?.trim() || '',
        requireCharts: !!s.requireCharts,
        keyMetrics: dedup((s.keyMetrics || '').split(','))
      }));
      const allMetrics = dedup(sectionsPayload.flatMap((s:any)=>s.keyMetrics || []));
      const template_data = {
        name: editorState.name.trim(),
        sections: sectionsPayload,
        variables: [],
        required_metrics: allMetrics
      };
      const rowPayload = {
        name: editorState.name.trim(),
        category: editorState.category || 'general',
        description: editorState.description || '',
        template_data
      };
      if (editorState.id) {
        const { error } = await supabase.from('report_templates')
          .update(rowPayload).eq('id', editorState.id);
        if (error) throw error;
        toast.success('模板已更新');
      } else {
        const { error } = await supabase.from('report_templates')
          .insert([rowPayload]);
        if (error) throw error;
        toast.success('模板已新增');
      }
      setShowTemplateEditor(false);
      await loadTemplates();
    } catch (err:any) {
      console.error(err);
      toast.error(`保存失败：${err?.message || err}`);
    } finally {
      setSavingTemplate(false);
    }
  };

  // ------------------ 流式生成 ------------------
  async function streamGenerateReport(params: ReportGenerationParams) {
  const url = (AGENT_BASE ? `${AGENT_BASE}/report/stream` : `/report/stream`);

  setIsGenerating(true);
  setStreamStage('准备中…');
  setReportContent('');
  setGeneratedReport(null);
  setCurrentView('editor');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AGENT_TOKEN}`,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(params),
    });

    if (!res.ok || !res.body) {
      throw new Error(`请求失败：${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    const pushChunk = (txt: string) => {
      if (txt) setReportContent(prev => prev + txt);
    };

    // 逐块读取 + 解析 SSE
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 按空行分割事件
      let sepIndex: number;
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sepIndex).trim();
        buffer = buffer.slice(sepIndex + 2);

        if (!raw) continue;

        // 解析 event / data
        const lines = raw.split('\n').map(l => l.replace(/\r$/, ''));
        const event =
          lines.find(l => l.startsWith('event:'))?.slice(6).trim() || 'message';
        const dataStr = lines
          .filter(l => l.startsWith('data:'))
          .map(l => l.slice(5))
          .join('\n')
          .trim();

        if (!dataStr) continue;

        // 按类型处理
        if (event === 'progress') {
          try {
            const p = JSON.parse(dataStr);
            if (p?.stage) setStreamStage(String(p.stage));
          } catch {/* ignore */}
          continue;
        }

        if (event === 'chunk' || event === 'message') {
          let text = dataStr;
          try {
            const p = JSON.parse(dataStr);
            if (p && typeof p === 'object' && typeof p.text === 'string') {
              text = p.text;
            }
          } catch {/* 不是 JSON 就按纯文本 */}
          pushChunk(text);
          continue;
        }

        if (event === 'result') {
          try {
            const r = JSON.parse(dataStr);
            if (r?.content_md) {
              setReportContent(prev => prev || r.content_md);
              setGeneratedReport({
                success: true,
                content: r.content_md,
                generatedAt: r.generated_at || new Date().toISOString(),
                metadata: r.metadata || {},
                reportId: r.job_id || ('job-' + Date.now()),
                downloadUrl: r.pdf_url || '',
                fileName: r.file_name || 'report.md',
                pdfUrl: r.pdf_url,
                docxUrl: r.docx_url,
              } as any);
              setCurrentView('editor');
            }
          } catch {/* ignore */}
          continue;
        }

        if (event === 'error') {
          let msg = dataStr;
          try {
            const p = JSON.parse(dataStr);
            msg = p?.message || msg;
          } catch {/* ignore */}
          throw new Error(msg || '生成出错');
        }

        // 其它 event 忽略
      }
    }

    // 收尾：残留缓冲当作最后一块 message 处理
    if (buffer.trim()) {
      let tail = buffer.trim();
      try {
        const p = JSON.parse(tail);
        if (p && typeof p === 'object' && typeof p.text === 'string') {
          tail = p.text;
        }
      } catch {/* ignore */}
      pushChunk(tail);
    }

    setStreamStage('');
    setIsGenerating(false);
    toast.success('报告生成完成');
  } catch (err: any) {
    setIsGenerating(false);
    setStreamStage('');
    toast.error(`报告生成失败：${err?.message || err}`);
  }
}
  // ------------------ 流式生成结束 ------------------

  const handleGenerateReport = async () => {
    if (!selectedReportType) return toast.error('请先选择报告类型');
    if (!selectedCompany)    return toast.error('请选择公司');
    if (!startYear || !startQuarter || !endYear || !endQuarter)
      return toast.error('请完整选择起止时间（年-季）');

    const startKey = Number(`${startYear}${String(startQuarter).replace('Q','')}`);
    const endKey   = Number(`${endYear}${String(endQuarter).replace('Q','')}`);
    if (startKey > endKey) return toast.error('起始时间不能晚于终止时间');

    const templateData = selectedTemplate?.template_data;
    const params: ReportGenerationParams = {
      reportType: selectedReportType,
      language: language === 'zh-CN' ? 'zh' : 'en',
      specialRequirements,
      templateId: selectedTemplate?.id,
      templateData,
      parameters: {
        company_name: selectedCompany,
        start: { year: Number(startYear), quarter: String(startQuarter) as any },
        end:   { year: Number(endYear),   quarter: String(endQuarter) as any }
      }
    } as any;

    await streamGenerateReport(params);
  };

  const handleNaturalLanguageGenerate = async () => {
    const prompt = naturalLanguageInput.trim();
    if (!prompt) return toast.error('请输入报告需求描述');
    if (prompt.length < 10) return toast.error('请提供更详细的需求描述（至少10个字符）');

    setIsNaturalGenerating(true);
    setGenerationProgress(0);
    const tick = setInterval(()=>setGenerationProgress(p => p < 95 ? p + 5 : p), 200);

    try {
        // —— 仅按用户输入 + 附件 + 可选检索生成（不套模板）
        // —— 计算一个简易 period 标签（可选）
      const periodLabel =
        (startYear && startQuarter && endYear && endQuarter)
          ? `${startYear}${String(startQuarter)}–${endYear}${String(endQuarter)}`
          : undefined;

      // —— 传给后端的元信息（自由生成用来定语气/口径，可按需增减）
      const meta = {
        company_name: selectedCompany || undefined,
        period: periodLabel,
        locale: (language === 'zh-CN' ? 'zh-CN' : 'en-US'),
        tone: 'formal',
        chart_style: 'minimal',
      };
      const res = await generateFreeReport({
        prompt,
        selected_file_ids: selectedUploadIds,
        allow_web_search: true,
        language: (language === 'zh-CN' ? 'zh' : 'en'),
        meta
      });



      clearInterval(tick);
      setGenerationProgress(100);

      if (!res?.content_md) throw new Error('生成内容为空');

      setReportContent(res.content_md);
      setGeneratedReport({
        success: true,
        content: res.content_md,
        generatedAt: res.generated_at || new Date().toISOString(),
        metadata: { attachments_used: res.attachments_used, web_refs: res.web_refs },
        reportId: res.job_id || ('nl-' + Date.now()),
        fileName: 'natural-language-report.md',
      } as any);

      setCurrentView('preview');
      toast.success('AI 报告生成成功');
    } catch (err: any) {
      clearInterval(tick);
      setGenerationProgress(0);
      console.error(err);
      toast.error(`报告生成失败：${err?.message || err}`);
    } finally {
      setIsNaturalGenerating(false);
    }
  };


  const handleExport = async (format: string) => {
    if (!reportContent) return toast.error('没有可导出的内容');
    if (generatedReport) {
      if (format === 'pdf' && (generatedReport as any).pdfUrl) {
        window.open((generatedReport as any).pdfUrl, '_blank'); return;
      }
      if (format === 'docx' && (generatedReport as any).docxUrl) {
        window.open((generatedReport as any).docxUrl, '_blank'); return;
      }
    }
    setIsExporting(true);
    try {
      const rt = reportTypes.find(rt => rt.id === selectedReportType)?.name || '财务报告';
      const res = await exportDocument({
        content: reportContent, format: format as any, fileName: `report-${Date.now()}`,
        metadata: { title: rt, author: 'AI报告生成系统', createdAt: new Date().toISOString() },
        options: { isMarkdown: true, reportType: rt }
      });
      const a = document.createElement('a'); a.href = res.downloadUrl; a.download = res.fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      toast.success(`${format.toUpperCase()}导出成功`);
    } catch (err) { console.error(err); toast.error('导出失败'); }
    finally { setIsExporting(false); }
  };

  async function runBeautify() {
    if (!reportContent?.trim()) { toast.error('请先生成或编辑报告'); return; }
    setIsBeautifying(true); setBeautifyResult(null);
    try {
      const paletteArr = (beautifyOptions.palette || '').split(',').map(s=>s.trim()).filter(Boolean);
      const payload = {
        markdown: reportContent,
        language: (language==='zh-CN'?'zh':'en'),
        instructions: beautifyOptions.instructions || '',
        style: {
          font_family: beautifyOptions.font_family,
          base_font_size: Number(beautifyOptions.base_font_size) || 16,
          line_height: Number(beautifyOptions.line_height) || 1.75,
          paragraph_spacing_px: Number(beautifyOptions.paragraph_spacing_px) || 8,
          content_width_px: Number(beautifyOptions.content_width_px) || 920,
          theme: beautifyOptions.theme,
          palette: paletteArr.length ? paletteArr : undefined,
        }
      };
      const url = (BEAUTIFY_BASE ? `${BEAUTIFY_BASE}/beautify/run` : `/beautify/run`);
      const res = await fetch(url, {
        method:'POST',
        headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${AGENT_TOKEN}` },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setBeautifyResult({
        html: data.html,
        html_url: data.html_url,
        html_download_url: data.html_download_url,
        docx_url: data.docx_url,
        docx_download_url: data.docx_download_url,
        pdf_url: data.pdf_url,
        pdf_download_url: data.pdf_download_url,
        pptx_url: data.pptx_url,                         // ✅ 新增
        pptx_download_url: data.pptx_download_url       // ✅ 新增（后端若没返回会自动走兜底）
      });

      toast.success('美化完成');
    } catch (e:any) {
      console.error(e);
      toast.error(`美化失败：${e?.message||e}`);
    } finally {
      setIsBeautifying(false);
    }
  }

  const handleDeleteTemplate = async (id: string) => {
    try {
      await deleteTemplate(id);
      toast.success('模板删除成功');
      await loadTemplates();
      if (selectedTemplate?.id === id) setSelectedTemplate(null);
    } catch (err) { console.error(err); toast.error('删除模板失败'); }
  };
  // —— 生成下一个可用的复制名：原名 (1) / (2) / ...
const getNextCopyName = (base: string, existing: string[]) => {
  const names = new Set(existing.map(n => (n || '').trim()));
  let i = 1;
  let candidate = `${base} (${i})`;
  while (names.has(candidate)) {
    i += 1;
    candidate = `${base} (${i})`;
  }
  return candidate;
};

// —— 复制模板
  const handleDuplicateTemplate = async (tpl: ReportTemplateRow) => {
    try {
      const baseName =
        (tpl.name || (tpl as any)?.template_data?.name || '未命名模板').trim();

      // 计算下一个可用名称
      const existingNames = templates.map(t => t.name || (t as any)?.template_data?.name || '');
      const copyName = getNextCopyName(baseName, existingNames);

      // 拷贝 template_data，并同步内部 name
      const template_data = {
        ...(tpl as any).template_data,
        name: copyName,
      };

      const rowPayload = {
        name: copyName,
        category: tpl.category || 'general',
        description: tpl.description || '',
        template_data,
      };

      const { error } = await supabase
        .from('report_templates')
        .insert([rowPayload]);

      if (error) throw error;

      toast.success('模板已复制');
      await loadTemplates();
    } catch (err: any) {
      console.error(err);
      toast.error(`复制模板失败：${err?.message || err}`);
    }
  };


  const handleQuickSuggestionClick = (s: string) => { setNaturalLanguageInput(s); if (naturalInputRef.current) naturalInputRef.current.focus(); };
  const copyToClipboard = (t: string) => { navigator.clipboard.writeText(t); toast.success('已复制到剪贴板'); };

  function renderCurrentView() {
    // ✅ 自然语言页：setup 用引导面板；editor/preview 复用现有编辑/预览
    if (activeTab === 'natural_language') {
      if (currentView === 'preview') return renderPreviewView();
      if (currentView === 'editor')  return renderEditorView();
      return renderNaturalLanguageTab(); // setup/default
    }
    // 模板页维持原逻辑
    switch (currentView) {
      case 'setup': return renderTemplateTab();
      case 'editor': return renderEditorView();
      case 'preview': return renderPreviewView();
      default: return renderTemplateTab();
    }
  }


  function renderTemplateTab() {
    return (
      <div className="flex w-full h-full">
        {/* 左侧：报告类型 */}
        <div className="w-1/3 bg-gray-50 border-r border-gray-200 p-6 overflow-y-auto">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center space-x-2">
            <Tag className="w-5 h-5 text-blue-600" /><span>报告类型</span>
          </h2>
          <div className="space-y-3">
            {getReportTypes().map(rt => (
              <div key={rt.id}
                onClick={()=>setSelectedReportType(rt.id)}
                className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${selectedReportType===rt.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'}`}>
                <div className="flex items-start justify-between mb-2">
                  <h3 className={`font-semibold ${selectedReportType===rt.id?'text-blue-700':'text-gray-900'}`}>{rt.name}</h3>
                  <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-700">{rt.sections}章节</span>
                </div>
                <p className="text-gray-600 text-sm mb-3">{rt.description}</p>
                <div className="flex items-center space-x-4 text-xs text-gray-500">
                  <span className="flex items-center space-x-1"><FileText className="w-3 h-3" /><span>{rt.estimatedPages}页</span></span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 中间：生成配置 */}
        <div className="flex-1 p-6 overflow-y-auto bg-white">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center space-x-2">
            <Settings className="w-5 h-5 text-blue-600" /><span>生成配置</span>
          </h2>

          {selectedReportType ? (
            <div className="space-y-6">
              {/* 公司 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">公司</label>
                <select value={selectedCompany} onChange={e=>setSelectedCompany(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
                  <option value="">请选择公司</option>
                  {companies.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>

              {/* 起始时间 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">起始时间</label>
                <div className="grid grid-cols-2 gap-3">
                  <select value={startYear} onChange={e=>setStartYear(e.target.value?Number(e.target.value):'')}
                    className="border border-gray-300 rounded-lg px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
                    <option value="">选择年份</option>
                    {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <select value={startQuarter} onChange={e=>setStartQuarter(e.target.value as any)}
                    className="border border-gray-300 rounded-lg px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
                    <option value="">选择季度</option>
                    {QUARTERS.map(q => <option key={q} value={q}>{q}</option>)}
                  </select>
                </div>
              </div>

              {/* 终止时间 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">终止时间</label>
                <div className="grid grid-cols-2 gap-3">
                  <select value={endYear} onChange={e=>setEndYear(e.target.value?Number(e.target.value):'')}
                    className="border border-gray-300 rounded-lg px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
                    <option value="">选择年份</option>
                    {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <select value={endQuarter} onChange={e=>setEndQuarter(e.target.value as any)}
                    className="border border-gray-300 rounded-lg px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
                    <option value="">选择季度</option>
                    {QUARTERS.map(q => <option key={q} value={q}>{q}</option>)}
                  </select>
                </div>
              </div>

              {/* 语言 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">报告语言</label>
                <select value={language} onChange={e=>setLanguage(e.target.value as any)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
                  <option value="zh-CN">中文（简体）</option>
                  <option value="en-US">English</option>
                </select>
              </div>

              {/* 特殊要求 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">特殊要求（可选）</label>
                <textarea value={specialRequirements} onChange={e=>setSpecialRequirements(e.target.value)} rows={3}
                  placeholder="请描述任何特殊要求或关注点..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 resize-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
              </div>

              {/* 生成 */}
              <div className="pt-2 space-y-3">
                <button onClick={handleGenerateReport} disabled={isGenerating}
                  className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center space-x-2">
                  {isGenerating ? (<><RefreshCw className="w-5 h-5 animate-spin" /><span>生成中...</span></>) :
                    (<><Sparkles className="w-5 h-5" /><span>智能生成报告</span></>)}
                </button>

                {isGenerating && streamStage && (
                  <div className="p-3 text-sm bg-blue-50 border border-blue-200 text-blue-700 rounded-lg">
                    阶段：{streamStage}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">请先选择报告类型</p>
            </div>
          )}
        </div>

        {/* 右侧：模板库 */}
        <div className="w-1/3 bg-gray-50 border-l border-gray-200 p-6 overflow-y-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center space-x-2">
              <FolderOpen className="w-5 h-5 text-blue-600" /><span>模板库</span>
            </h2>
            <button onClick={openCreateTemplate}
              className="p-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200" title="增加或修改模板">
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            {templates.length ? templates.map(tpl => (
              <div key={tpl.id}
                   className={`p-3 rounded-lg border transition-all ${selectedTemplate?.id===tpl.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 cursor-pointer" onClick={()=>setSelectedTemplate(tpl)}>
                    <h4 className={`font-medium text-sm ${selectedTemplate?.id===tpl.id?'text-blue-700':'text-gray-900'}`}>
                      {tpl.name || '未命名模板'}
                    </h4>
                    <p className="text-xs text-gray-500 mt-1">
                      {tpl.category || '未归类'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 pl-2">
                    <button onClick={()=>openViewTemplate(tpl)} className="text-gray-500 hover:text-blue-600" title="查看">
                      <Eye className="w-4 h-4" />
                    </button>
                    <button onClick={()=>openEditTemplate(tpl)} className="text-gray-500 hover:text-emerald-600" title="编辑">
                      <Edit3 className="w-4 h-4" />
                    </button>
                      {/* ✅ 新增：复制模板 */}
                    <button
                      onClick={()=>handleDuplicateTemplate(tpl)}
                      className="text-gray-500 hover:text-indigo-600"
                      title="复制模板"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button onClick={()=>handleDeleteTemplate((tpl as any).id)} className="text-gray-400 hover:text-red-500" title="删除">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {tpl.template_data?.sections?.length ? (
                  <div className="mt-2">
                    <div className="flex items-center space-x-1 mb-1">
                      <Layers className="w-3 h-3 text-gray-400" />
                      <span className="text-xs text-gray-500">
                        {tpl.template_data.sections.length} 个章节
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            )) : (
              <div className="text-center py-8">
                <FolderOpen className="w-12 h-12 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">暂无模板</p>
                <button onClick={openCreateTemplate} className="mt-2 text-blue-600 hover:text-blue-700 text-sm underline">
                  增加第一个模板
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderNaturalLanguageTab() {
    return (
      <div className="flex w-full h-full">
        {/* 左侧主体：自然语言提问 */}
        <div className="flex-1 p-6 bg-white flex flex-col">
          <div className="mb-6 space-y-2">
            <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center space-x-2">
              <Bot className="w-5 h-5 text-blue-600" />
              <span>自然语言报告生成</span>
            </h2>
            <p className="text-gray-600">
              用自然语言描述您的报告需求，AI 将为您智能生成专业报告
            </p>


          </div>


          {/* 提问输入框（主体） */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">报告需求描述</label>
            <textarea
              ref={naturalInputRef}
              value={naturalLanguageInput}
              onChange={(e) => setNaturalLanguageInput(e.target.value)}
              placeholder="例如：请生成一份 2024 年第三季度的综合财务分析报告..."
              rows={6}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-900 placeholder-gray-400
                        focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none resize-none"
              disabled={isNaturalGenerating}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-500">
                {naturalLanguageInput.length}/1000 字符 • 建议至少 50 字
              </span>
              {naturalLanguageInput && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(naturalLanguageInput);
                    toast.success('已复制到剪贴板');
                  }}
                  className="text-xs text-blue-600 hover:text-blue-700 flex items-center space-x-1"
                >
                  <Copy className="w-3 h-3" />
                  <span>复制</span>
                </button>
              )}
            </div>
          </div>

          {/* 生成按钮 + 进度 */}
          <div className="mb-6">
            <button
              onClick={handleNaturalLanguageGenerate}
              disabled={isNaturalGenerating || naturalLanguageInput.trim().length < 10}
              className="bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700
                        disabled:opacity-50 flex items-center justify-center space-x-2 w-full md:w-auto"
            >
              {isNaturalGenerating ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>AI 生成中...</span>
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5" />
                  <span>智能生成报告</span>
                </>
              )}
            </button>

            {isNaturalGenerating && (
              <div className="mt-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-center mb-2">
                  <Bot className="w-5 h-5 text-blue-600 mr-2 animate-pulse" />
                  <span className="text-sm font-medium text-blue-700">AI 正在生成报告...</span>
                </div>
                <div className="w-full bg-blue-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${generationProgress}%` }}
                  />
                </div>
                <p className="text-xs text-blue-600 mt-1">正在分析需求并生成报告结构...</p>
              </div>
            )}
          </div>

          {/* 折叠的「已上传文件」面板（默认折叠） */}
          <div className="mb-6 border border-gray-200 rounded-lg overflow-hidden">
            <div
              role="button"
              tabIndex={0}
              onClick={() => setOpenUploads((v) => !v)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpenUploads(v => !v); }}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <ChevronRight
                  className={`w-4 h-4 text-gray-600 transition-transform ${openUploads ? 'rotate-90' : ''}`}
                />
                <span className="text-sm font-medium text-gray-700">附加文件（勾选后参与生成）</span>
                {selectedUploadIds.length > 0 && (
                  <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                    已选 {selectedUploadIds.length}
                  </span>
                )}
                <span className="ml-2 text-xs text-gray-500">
                  {uploads.length ? `${uploads.length} 个文件` : '暂无文件'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  ref={uploadInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={onUploadsChosen}
                />
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); pickUpload(); }}
                  disabled={uploading || isNaturalGenerating}
                  className="px-3 py-1.5 text-xs border rounded-md hover:bg-white disabled:opacity-50"
                >
                  {uploading ? '上传中…' : '上传文件'}
                </button>
              </div>
            </div>

            {openUploads && (
              <div className="p-3">
                {uploads.length === 0 ? (
                  <div className="text-sm text-gray-500">
                    暂无文件，点击右上角「上传文件」添加 PDF/Word/Excel/CSV/HTML/文本。
                  </div>
                ) : (
                  <div className="space-y-2">
                    {uploads.map((u) => (
                      <div
                        key={u.id}
                        className="flex items-center justify-between p-2 bg-white rounded-lg border"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedUploadIds.includes(u.id)}
                            onChange={(e) => {
                              setSelectedUploadIds(prev =>
                                e.target.checked ? [...prev, u.id] : prev.filter(id => id !== u.id)
                              );
                            }}
                          />
                          <div className="flex items-center gap-2">
                            <File className="h-4 w-4 text-gray-500" />
                            <div>
                              <div className="text-sm font-medium">{u.file_name}</div>
                              <div className="text-xs text-gray-500">{(u.size_bytes / 1024).toFixed(1)} KB</div>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {/* 先去掉签名阶段：没有链接就不渲染按钮，仅列文件名 */}
                            {u.signedUrl ? (
                              <a
                                href={u.signedUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-600 hover:underline text-sm"
                              >
                                预览/下载
                              </a>
                            ) : null}

                          <button
                            onClick={() => removeUploadFile(u.id, u.file_name)}
                            className="text-red-600 hover:text-red-700"
                            title="删除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {selectedUploadIds.length > 0 && (
                  <div className="mt-2 text-xs text-gray-600">
                    已选择 <span className="font-medium">{selectedUploadIds.length}</span> 个文件
                    <button
                      onClick={() => setSelectedUploadIds([])}
                      className="ml-3 text-blue-600 hover:underline"
                    >
                      清空选择
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>


          {/* 快捷建议 */}
          <div className="flex-1">
            <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center space-x-2">
              <Lightbulb className="w-4 h-4 text-yellow-500" />
              <span>快捷建议</span>
            </h3>
            <div className="space-y-2">
              {[
                '请按照附件模板生成 XX集团公司 2025年 Q1的报告',
                '请生成 2025 年上半年 XX港口公司 综合经营分析报告，重点关注 盈利能力和营运能力',
                '分析港口业务板块 2024Q4 同比与环比，输出关键驱动与建议',
              ].map((s, i) => (
                <button
                  key={i}
                  onClick={() => setNaturalLanguageInput(s)}
                  disabled={isNaturalGenerating}
                  className="w-full text-left p-3 border border-gray-200 rounded-lg hover:border-blue-300
                            hover:bg-blue-50 transition-all text-sm text-gray-700 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 右侧帮助面板 */}
        <div className="w-1/3 bg-gray-50 border-l border-gray-200 p-6 overflow-y-auto">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">使用指南</h3>
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-gray-800 mb-2">1. 描述报告需求</h4>
              <p className="text-sm text-gray-600">
                详细描述您需要的报告类型、时间范围、关注重点等信息。
              </p>
            </div>
            <div>
              <h4 className="font-medium text-gray-800 mb-2">2. 包含关键信息</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• 报告类型（季度、年度、风险评估等）</li>
                <li>• 时间范围（Q3、2024 年等）</li>
                <li>• 分析重点（收入、利润、现金流等）</li>
                <li>• 对比要求（同比、环比等）</li>
                <li>• 输出要求（图表、预测等）</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }


  function renderSetupView() { return <div className="h-full">{activeTab==='template'?renderTemplateTab():renderNaturalLanguageTab()}</div>; }

  function renderEditorView() {
    return (
      <div className="flex w-full h-full">
        <div className="flex-1 flex flex-col">
          <div className="bg-white border-b border-gray-200 px-6 py-3">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
              <Edit3 className="w-5 h-5 text-blue-600" /><span>报告编辑器</span>
            </h2>
          </div>
          {/* 生成阶段 Stepper */}
          <div className="px-6 py-2 bg-white border-b border-gray-200">
            <GenStep
              status={
                (isGenerating
                  ? (reportContent ? 'generating' : 'thinking')
                  : (reportContent ? 'done' : 'thinking')) as 'thinking' | 'generating' | 'done'
              }
            />
          </div>

          <div className="flex-1 p-6 bg-gray-50">
            <textarea ref={editorRef} value={reportContent} onChange={e=>setReportContent(e.target.value)}
              className="w-full h-full bg-white border border-gray-300 rounded-lg p-4 text-gray-900 font-mono text-sm resize-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="生成后可继续编辑..." />
          </div>
        </div>

        <div className="w-1/2 flex flex-col border-l border-gray-200">
          <div className="bg-white border-b border-gray-200 px-6 py-3">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
              <Eye className="w-5 h-5 text-blue-600" /><span>实时预览</span>
            </h2>
          </div>
          <div className="flex-1 p-6 overflow-y-auto bg-gray-50">
            <div className="bg-white rounded-lg p-6 min-h-full border border-gray-200">
              {reportContent ? <div className="prose prose-gray max-w-none"><SmartMarkdown content={reportContent} /></div> :
                <div className="text-center py-12 text-gray-500"><FileText className="w-12 h-12 mx-auto mb-4"/><p>生成或编辑后查看预览</p></div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderPreviewView() {
    return (
      <div className="w-full flex flex-col h-full">
        <div className="bg-white border-b border-gray-200 px-6 py-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
              <Eye className="w-5 h-5 text-blue-600" /><span>报告预览</span>
            </h2>
            <div className="flex items-center space-x-3">
              <div className="text-sm text-gray-500">
                {generatedReport && (
                  <span className="flex items-center space-x-1">
                    <Clock className="w-4 h-4" />
                    <span>生成于 {new Date(generatedReport.generatedAt).toLocaleString()}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex-1 p-6 overflow-y-auto bg-gray-50">
          <div className="max-w-4xl mx-auto">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 min-h-full">
              {reportContent ? <div className="prose prose-gray prose-lg max-w-none"><SmartMarkdown content={reportContent} /></div> :
                <div className="text-center py-16 text-gray-500"><FileText className="w-16 h-16 mx-auto mb-6"/><h3 className="text-xl font-semibold mb-2">暂无内容</h3><p>请先生成或编辑报告内容</p></div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-1 bg-gray-100 p-1 rounded-lg">
              {reportTabs.map(tab=>{
                const Icon = tab.icon;
                return (
                  <button key={tab.id} onClick={()=>{ setActiveTab(tab.id); setCurrentView('setup'); }}
                          className={`flex items-center px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab===tab.id?'bg-white text-blue-600 shadow-sm':'text-gray-600 hover:text-gray-900 hover:bg-gray-50'}`}
                          title={tab.description}>
                    <Icon className="h-4 w-4 mr-2" />{tab.name}
                  </button>
                );
              })}
            </div>
            {(reportContent || currentView!=='setup') && (
              <>
                <div className="h-6 w-px bg-gray-200"></div>
                <button onClick={()=>setCurrentView('setup')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium ${currentView==='setup'?'bg-blue-600 text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>设置</button>
                <button onClick={()=>setCurrentView('editor')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium ${currentView==='editor'?'bg-blue-600 text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>编辑</button>
                <button onClick={()=>setCurrentView('preview')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium ${currentView==='preview'?'bg-blue-600 text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>预览</button>
              </>
            )}
          </div>

          {/* 右上角：确认并进行美化 */}
          {reportContent && (
            <div className="relative">
              <button
                onClick={()=>setShowBeautify(true)}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center space-x-2"
                title="确认并进行美化"
              >
                <Sparkles className="w-4 h-4" /><span>确认并进行美化</span>
              </button>
            </div>
          )}

        </div>
      </div>

      <div className="h-[calc(100vh-5rem)]">
      {renderCurrentView()}
      </div>

      {/* ========= 查看模板 弹窗 ========= */}
      {showTemplateViewer && viewTemplate && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white border border-gray-200 rounded-xl w-full max-w-3xl shadow-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold text-gray-900">查看模板</h3>
              </div>
              <button onClick={()=>setShowTemplateViewer(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-xs text-gray-500 mb-1">模板名称</div>
                  <div className="text-gray-900 font-medium">{viewTemplate.name || viewTemplate.template_data?.name}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">分类</div>
                  <div className="text-gray-900">{viewTemplate.category || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">描述</div>
                  <div className="text-gray-900">{viewTemplate.description || '—'}</div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-sm font-semibold text-gray-800">章节</div>
                {(viewTemplate.template_data?.sections || []).map((s:any, i:number)=>(
                  <div key={i} className="p-3 border border-gray-200 rounded-lg bg-white">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-gray-900">{i+1}. {s.title || '未命名章节'}</div>
                      {s.requireCharts ? (
                        <span className="px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700">需要图表</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">无图表</span>
                      )}
                    </div>
                    {s.hint && <div className="text-sm text-gray-600 mt-1">概述：{s.hint}</div>}
                    <div className="text-sm text-gray-700 mt-1">
                      重点指标：{Array.isArray(s.keyMetrics) ? s.keyMetrics.join('、') : (s.keyMetrics || '—')}
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-2">
                <div className="text-sm font-semibold text-gray-800 mb-1">全部重点指标</div>
                <div className="text-sm text-gray-700">
                  {(viewTemplate.template_data?.required_metrics || []).join('、') || '—'}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t">
              <button onClick={()=>setShowTemplateViewer(false)} className="px-4 py-2 text-gray-600 hover:text-gray-800">关闭</button>
              <button onClick={()=>{ setShowTemplateViewer(false); openEditTemplate(viewTemplate); }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                编辑此模板
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========= 增加/修改模板 弹窗 ========= */}
      {showTemplateEditor && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white border border-gray-200 rounded-xl w-full max-w-3xl shadow-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-emerald-600" />
                <h3 className="text-lg font-semibold text-gray-900">{editorState.id ? '修改模板' : '增加模板'}</h3>
              </div>
              <button onClick={()=>setShowTemplateEditor(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
              {/* 基本信息 */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">模板名称</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2"
                         value={editorState.name}
                         onChange={e=>setEditorState({...editorState, name:e.target.value})}/>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">模板分类</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2"
                         value={editorState.category}
                         onChange={e=>setEditorState({...editorState, category:e.target.value})}/>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">模板描述</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2"
                         value={editorState.description}
                         onChange={e=>setEditorState({...editorState, description:e.target.value})}/>
                </div>
              </div>

              {/* 章节编辑 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-800">章节设置</div>
                  <button onClick={()=>setEditorState({
                    ...editorState,
                    sections: [...editorState.sections, { title:'新章节', hint:'', keyMetrics:'', requireCharts:false }]
                  })} className="text-blue-600 hover:text-blue-700 text-sm">+ 新增章节</button>
                </div>

                {editorState.sections.map((s, idx)=>(
                  <div key={idx} className="p-3 border border-gray-200 rounded-lg bg-white">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium text-gray-900">{idx+1}. 章节</div>
                      <button onClick={()=>{
                        const arr = [...editorState.sections]; arr.splice(idx,1);
                        setEditorState({...editorState, sections: arr.length?arr:[{ title:'新章节', hint:'', keyMetrics:'', requireCharts:false }]});
                      }} className="text-gray-400 hover:text-red-500 text-sm">删除</button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">标题</label>
                        <input className="w-full border border-gray-300 rounded-lg px-3 py-2"
                               value={s.title}
                               onChange={e=>{
                                 const arr=[...editorState.sections]; arr[idx]={...s, title:e.target.value};
                                 setEditorState({...editorState, sections:arr});
                               }}/>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">是否需要图表</label>
                        <select className="w-full border border-gray-300 rounded-lg px-3 py-2"
                                value={s.requireCharts ? '1' : '0'}
                                onChange={e=>{
                                  const arr=[...editorState.sections]; arr[idx]={...s, requireCharts:e.target.value==='1'};
                                  setEditorState({...editorState, sections:arr});
                                }}>
                          <option value="0">否</option>
                          <option value="1">是</option>
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-700 mb-1">概述</label>
                        <input className="w-full border border-gray-300 rounded-lg px-3 py-2"
                               value={s.hint}
                               onChange={e=>{
                                 const arr=[...editorState.sections]; arr[idx]={...s, hint:e.target.value};
                                 setEditorState({...editorState, sections:arr});
                               }}/>
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-700 mb-1">重点指标（用逗号分隔）</label>
                        <input className="w-full border border-gray-300 rounded-lg px-3 py-2"
                               placeholder="如：营业收入,净利润,ROE,ROA"
                               value={s.keyMetrics}
                               onChange={e=>{
                                 const arr=[...editorState.sections]; arr[idx]={...s, keyMetrics:e.target.value};
                                 setEditorState({...editorState, sections:arr});
                               }}/>
                      </div>
                    </div>
                  </div>
                ))}
              </div>


            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t">
              <button onClick={()=>setShowTemplateEditor(false)} className="px-4 py-2 text-gray-600 hover:text-gray-800">取消</button>
              <button onClick={saveTemplate} disabled={savingTemplate}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50">
                {savingTemplate ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========= 美化弹窗 ========= */}
      {showBeautify && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white border border-gray-200 rounded-xl w-full max-w-2xl shadow-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">确认并进行美化</h3>
              <button onClick={()=>setShowBeautify(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">（可选）特殊美化要求</label>
                <textarea
                  value={beautifyOptions.instructions}
                  onChange={e=>setBeautifyOptions({...beautifyOptions, instructions:e.target.value})}
                  rows={4}
                  placeholder="例：标题层级统一；正文字号13px、行距1.8；图表统一蓝绿配色；表格加条纹底色；保留原始数据不改动。"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 resize-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 placeholder-gray-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">字体族</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    value={beautifyOptions.font_family}
                    onChange={e=>setBeautifyOptions({...beautifyOptions, font_family:e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">正文字号(px)</label>
                  <input
                    type="number"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    value={beautifyOptions.base_font_size}
                    onChange={e=>setBeautifyOptions({...beautifyOptions, base_font_size:Number(e.target.value) || 13})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">行距</label>
                  <input
                    type="number" step="0.05"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    value={beautifyOptions.line_height}
                    onChange={e=>setBeautifyOptions({...beautifyOptions, line_height:Number(e.target.value) || 1.75})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">段后间距(px)</label>
                  <input
                    type="number"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    value={beautifyOptions.paragraph_spacing_px}
                    onChange={e=>setBeautifyOptions({...beautifyOptions, paragraph_spacing_px:Number(e.target.value) || 8})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">内容宽度(px)</label>
                  <input
                    type="number"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    value={beautifyOptions.content_width_px}
                    onChange={e=>setBeautifyOptions({...beautifyOptions, content_width_px:Number(e.target.value) || 920})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">主题</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    value={beautifyOptions.theme}
                    onChange={e=>setBeautifyOptions({...beautifyOptions, theme: e.target.value as 'light'|'dark'})}
                  >
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1">图表配色（逗号分隔）</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    value={beautifyOptions.palette}
                    onChange={e=>setBeautifyOptions({...beautifyOptions, palette:e.target.value})}
                    placeholder="#2563eb,#10b981,#f59e0b,#ef4444,#8b5cf6"
                  />
                  <p className="text-xs text-gray-500 mt-1">示例：#2563eb,#10b981,#f59e0b,#ef4444,#8b5cf6</p>
                </div>
              </div>

              {isBeautifying && (
                <div className="p-3 bg-purple-50 border border-purple-200 text-purple-700 rounded-lg text-sm">
                  正在美化并准备导出，请稍候…
                </div>
              )}

              {!isBeautifying && beautifyResult && (
                <div className="flex items-center flex-wrap gap-2">
                  {beautifyResult.html_url && (
                    <>
                      <a className="px-3 py-2 bg-gray-800 text-white rounded-lg text-sm"
                        href={beautifyResult.html_download_url || `${beautifyResult.html_url}?download=beautified.html`}>
                        下载 HTML
                      </a>
                    </>
                  )}

                  {beautifyResult.docx_url && (
                    <a className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm"
                      href={beautifyResult.docx_download_url || `${beautifyResult.docx_url}?download=beautified.docx`}>
                      下载 Word
                    </a>
                  )}
                  {beautifyResult.pdf_url && (
                    <a className="px-3 py-2 bg-red-600 text-white rounded-lg text-sm"
                      href={beautifyResult.pdf_download_url || `${beautifyResult.pdf_url}?download=beautified.pdf`}>
                      下载 PDF
                    </a>
                  )}
                  {beautifyResult.pptx_url && (   /* ✅ 新增 */
                    <a className="px-3 py-2 bg-orange-600 text-white rounded-lg text-sm"
                      href={beautifyResult.pptx_download_url || `${beautifyResult.pptx_url}?download=beautified.pptx`}>
                      下载 PPT
                    </a>
                  )}


                  {!beautifyResult.html_url && beautifyResult.html && (
                    <button
                      className="px-3 py-2 bg-gray-800 text-white rounded-lg text-sm"
                      onClick={()=>{
                        const blob = new Blob([beautifyResult.html!], {type:'text/html'});
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url; a.download = 'beautified.html';
                        document.body.appendChild(a); a.click(); document.body.removeChild(a);
                        setTimeout(()=>URL.revokeObjectURL(url), 500);
                      }}
                    >下载 HTML</button>
                  )}
                </div>
              )}


            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t">
              <button onClick={()=>setShowBeautify(false)} className="px-4 py-2 text-gray-600 hover:text-gray-800">取消</button>
              <button
                onClick={runBeautify}
                disabled={isBeautifying}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50"
              >
                {isBeautifying ? '美化中…' : '开始美化'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Reports;
