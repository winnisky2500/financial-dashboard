import React, { useState, useEffect, useRef } from 'react';
import { 
  FileText, Upload, Download, Save, Settings, Eye, Edit3, RefreshCw, 
  ChevronRight, FolderOpen, File, Trash2, Plus, X, Check, 
  AlertCircle, Sparkles, Calendar, Clock, User, Tag, Layers,
  Monitor, Smartphone, Code, Image, Type, Send, MessageSquare, 
  Zap, Lightbulb, Bot, Copy
} from 'lucide-react';
import { 
  generateIntelligentReport, 
  uploadTemplate, 
  listTemplates, 
  getTemplate, 
  deleteTemplate, 
  updateTemplate,
  exportDocument,
  getReportTypes,
  type ReportGenerationParams, 
  type ReportGenerationResult,
  type TemplateInfo,
  type DocumentExportParams
} from '@/lib/dataService';
import { Markdown } from '@/components/ui/Markdown';
import { supabase } from '@/lib/supabase';
import toast from 'react-hot-toast';

// Tab定义
type TabType = 'template' | 'natural_language';

interface Tab {
  id: TabType;
  name: string;
  description: string;
  icon: React.ComponentType<any>;
}

const reportTabs: Tab[] = [
  {
    id: 'template',
    name: '按模板生成',
    description: '使用预设模板和参数生成标准化报告',
    icon: FileText
  },
  {
    id: 'natural_language',
    name: '按自然语言生成',
    description: '通过自然语言描述需求，AI智能生成报告',
    icon: MessageSquare
  }
];

const Reports: React.FC = () => {
  // 主要状态
  const [activeTab, setActiveTab] = useState<TabType>('template');
  const [selectedReportType, setSelectedReportType] = useState<string>('');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateInfo | null>(null);
  const [reportContent, setReportContent] = useState<string>('');
  const [generatedReport, setGeneratedReport] = useState<ReportGenerationResult | null>(null);
  
  // 界面状态
  const [currentView, setCurrentView] = useState<'setup' | 'editor' | 'preview'>('setup');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  
  // 模板相关状态
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [isUploadingTemplate, setIsUploadingTemplate] = useState(false);
  const [showTemplateUpload, setShowTemplateUpload] = useState(false);
  
  // 自然语言生成状态
  const [naturalLanguageInput, setNaturalLanguageInput] = useState('');
  const [isNaturalGenerating, setIsNaturalGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  
  // 表单状态
  const [reportParams, setReportParams] = useState<ReportGenerationParams>({
    reportType: '',
    dataRange: '',
    language: 'zh-CN',
    customRequirements: '',
    parameters: {}
  });
  
  // 引用
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const naturalInputRef = useRef<HTMLTextAreaElement>(null);
  
  // 获取报告类型
  const reportTypes = getReportTypes();
  
  // 快捷建议
  const quickSuggestions = [
    '生成2024年Q3季度财务业绩报告，重点分析营收增长和盈利能力变化',
    '分析公司风险状况并生成风险评估报告，包含市场风险和运营风险',
    '创建年度ESG可持续发展报告，涵盖环境保护和社会责任实践',
    '生成投资者关系季度报告，展示公司业务进展和未来规划',
    '制作月度财务分析报告，对比同期数据并提供趋势预测'
  ];

  useEffect(() => {
    loadTemplates();
  }, []);
  
  const loadTemplates = async () => {
    try {
      const templateList = await listTemplates();
      setTemplates(templateList);
    } catch (error) {
      console.error('加载模板列表失败:', error);
    }
  };
  
  const handleReportTypeSelect = (reportType: any) => {
    setSelectedReportType(reportType.id);
    setReportParams(prev => ({
      ...prev,
      reportType: reportType.id
    }));
  };
  
  const handleTemplateSelect = async (template: TemplateInfo) => {
    try {
      if (!template.content) {
        const fullTemplate = await getTemplate(template.templateId);
        setSelectedTemplate(fullTemplate);
        if (fullTemplate.content) {
          setReportContent(fullTemplate.content);
        }
      } else {
        setSelectedTemplate(template);
        setReportContent(template.content);
      }
    } catch (error) {
      console.error('获取模板内容失败:', error);
      toast.error('获取模板内容失败');
    }
  };
  
  const handleTemplateUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setIsUploadingTemplate(true);
    
    try {
      const content = await file.text();
      const templateInfo = await uploadTemplate({
        fileName: file.name,
        content: content,
        metadata: {
          uploadedAt: new Date().toISOString(),
          originalName: file.name
        }
      }, selectedReportType || 'general');
      
      toast.success('模板上传成功');
      await loadTemplates();
      setShowTemplateUpload(false);
      
    } catch (error) {
      console.error('模板上传失败:', error);
      toast.error('模板上传失败');
    } finally {
      setIsUploadingTemplate(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };
  
  const handleGenerateReport = async () => {
    if (!selectedReportType) {
      toast.error('请先选择报告类型');
      return;
    }
    
    setIsGenerating(true);
    
    try {
      const params: ReportGenerationParams = {
        ...reportParams,
        reportType: selectedReportType,
        templateStructure: selectedTemplate?.content || undefined
      };
      
      const result = await generateIntelligentReport(params);
      setGeneratedReport(result);
      setReportContent(result.content);
      setCurrentView('editor');
      toast.success('报告生成成功');
      
    } catch (error) {
      console.error('报告生成失败:', error);
      toast.error('报告生成失败');
    } finally {
      setIsGenerating(false);
    }
  };
  
  const handleNaturalLanguageGenerate = async () => {
    if (!naturalLanguageInput.trim()) {
      toast.error('请输入报告需求描述');
      return;
    }
    
    if (naturalLanguageInput.trim().length < 10) {
      toast.error('请提供更详细的需求描述（至少10个字符）');
      return;
    }
    
    setIsNaturalGenerating(true);
    setGenerationProgress(0);
    
    try {
      // 模拟进度更新
      const progressInterval = setInterval(() => {
        setGenerationProgress(prev => {
          if (prev < 90) return prev + 10;
          return prev;
        });
      }, 200);
      
      const { data, error } = await supabase.functions.invoke('natural-language-report-generator', {
        body: {
          naturalLanguageDescription: naturalLanguageInput,
          reportContext: {
            timestamp: new Date().toISOString(),
            language: 'zh-CN'
          },
          userPreferences: {
            format: 'markdown',
            style: 'comprehensive'
          }
        }
      });
      
      clearInterval(progressInterval);
      setGenerationProgress(100);
      
      if (error) {
        throw error;
      }
      
      if (data?.reportContent) {
        setReportContent(data.reportContent);
        setGeneratedReport({
          success: true,
          content: data.reportContent,
          generatedAt: data.metadata.generatedAt,
          metadata: data.metadata,
          reportId: 'nl-' + Date.now(),
          downloadUrl: '',
          fileName: 'natural-language-report.md'
        } as ReportGenerationResult);
        setCurrentView('editor');
        toast.success('AI报告生成成功');
      } else {
        throw new Error('生成的报告内容为空');
      }
      
    } catch (error) {
      console.error('自然语言报告生成失败:', error);
      toast.error('报告生成失败，请重试');
    } finally {
      setIsNaturalGenerating(false);
      setGenerationProgress(0);
    }
  };
  
  const handleExport = async (format: string) => {
    if (!reportContent) {
      toast.error('没有可导出的内容');
      return;
    }
    
    setIsExporting(true);
    
    try {
      const exportParams: DocumentExportParams = {
        content: reportContent,
        format: format as any,
        fileName: `report-${Date.now()}`,
        metadata: {
          title: reportTypes.find(rt => rt.id === selectedReportType)?.name || '财务报告',
          author: 'AI报告生成系统',
          createdAt: new Date().toISOString()
        },
        options: {
          isMarkdown: true,
          reportType: reportTypes.find(rt => rt.id === selectedReportType)?.name
        }
      };
      
      const result = await exportDocument(exportParams);
      
      // 下载文件
      const link = document.createElement('a');
      link.href = result.downloadUrl;
      link.download = result.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast.success(`${format.toUpperCase()}导出成功`);
      
    } catch (error) {
      console.error('导出失败:', error);
      toast.error('导出失败');
    } finally {
      setIsExporting(false);
    }
  };
  
  const handleDeleteTemplate = async (templateId: string) => {
    try {
      await deleteTemplate(templateId);
      toast.success('模板删除成功');
      await loadTemplates();
      if (selectedTemplate?.templateId === templateId) {
        setSelectedTemplate(null);
      }
    } catch (error) {
      console.error('删除模板失败:', error);
      toast.error('删除模板失败');
    }
  };
  
  const handleQuickSuggestionClick = (suggestion: string) => {
    setNaturalLanguageInput(suggestion);
    if (naturalInputRef.current) {
      naturalInputRef.current.focus();
    }
  };
  
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('已复制到剪贴板');
  };
  
  function renderCurrentView() {
    switch (currentView) {
      case 'setup':
        return renderSetupView();
      case 'editor':
        return renderEditorView();
      case 'preview':
        return renderPreviewView();
      default:
        return renderSetupView();
    }
  }
  
  function renderTemplateTab() {
    return (
      <div className="flex w-full h-full">
        {/* 左侧面板 - 报告类型选择 */}
        <div className="w-1/3 bg-gray-50 border-r border-gray-200 p-6 overflow-y-auto">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center space-x-2">
            <Tag className="w-5 h-5 text-blue-600" />
            <span>报告类型</span>
          </h2>
          
          <div className="space-y-3">
            {reportTypes.map((reportType) => (
              <div
                key={reportType.id}
                onClick={() => handleReportTypeSelect(reportType)}
                className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                  selectedReportType === reportType.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className={`font-semibold ${
                    selectedReportType === reportType.id ? 'text-blue-700' : 'text-gray-900'
                  }`}>
                    {reportType.name}
                  </h3>
                  <span className={`px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-700`}>
                    {reportType.sections}章节
                  </span>
                </div>
                <p className="text-gray-600 text-sm mb-3">
                  {reportType.description}
                </p>
                <div className="flex items-center space-x-4 text-xs text-gray-500">
                  <span className="flex items-center space-x-1">
                    <FileText className="w-3 h-3" />
                    <span>{reportType.estimatedPages}页</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        {/* 中间面板 - 参数配置 */}
        <div className="flex-1 p-6 overflow-y-auto bg-white">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center space-x-2">
            <Settings className="w-5 h-5 text-blue-600" />
            <span>生成配置</span>
          </h2>
          
          {selectedReportType ? (
            <div className="space-y-6">
              {/* 数据期间 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  数据期间
                </label>
                <div className="flex items-center space-x-2">
                  <Calendar className="w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={reportParams.dataRange}
                    onChange={(e) => setReportParams(prev => ({ ...prev, dataRange: e.target.value }))}
                    placeholder="例如：2024年Q3、2024年1-9月"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>
              
              {/* 语言选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  报告语言
                </label>
                <select
                  value={reportParams.language}
                  onChange={(e) => setReportParams(prev => ({ ...prev, language: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="zh-CN">中文（简体）</option>
                  <option value="en-US">English</option>
                </select>
              </div>
              
              {/* 特殊要求 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  特殊要求（可选）
                </label>
                <textarea
                  value={reportParams.customRequirements}
                  onChange={(e) => setReportParams(prev => ({ ...prev, customRequirements: e.target.value }))}
                  placeholder="请描述任何特殊要求或关注点..."
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none resize-none"
                />
              </div>
              
              {/* 生成按钮 */}
              <div className="pt-4">
                <button
                  onClick={handleGenerateReport}
                  disabled={isGenerating}
                  className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center space-x-2"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span>生成中...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      <span>智能生成报告</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">请先选择报告类型</p>
            </div>
          )}
        </div>
        
        {/* 右侧面板 - 模板管理 */}
        <div className="w-1/3 bg-gray-50 border-l border-gray-200 p-6 overflow-y-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center space-x-2">
              <FolderOpen className="w-5 h-5 text-blue-600" />
              <span>模板库</span>
            </h2>
            <button
              onClick={() => setShowTemplateUpload(true)}
              className="p-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors"
              title="上传模板"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          
          <div className="space-y-3">
            {templates.length > 0 ? templates.map((template) => (
              <div
                key={template.templateId}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedTemplate?.templateId === template.templateId
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                }`}
                onClick={() => handleTemplateSelect(template)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <h4 className={`font-medium text-sm ${
                      selectedTemplate?.templateId === template.templateId ? 'text-blue-700' : 'text-gray-900'
                    }`}>
                      {template.fileName}
                    </h4>
                    <p className="text-xs text-gray-500 mt-1">
                      {template.templateType} • {template.fileType?.toUpperCase()}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteTemplate(template.templateId);
                    }}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                
                {template.structure && (
                  <div className="mt-2">
                    {template.structure.sections.length > 0 && (
                      <div className="flex items-center space-x-1 mb-1">
                        <Layers className="w-3 h-3 text-gray-400" />
                        <span className="text-xs text-gray-500">
                          {template.structure.sections.length}个章节
                        </span>
                      </div>
                    )}
                    {template.structure.variables.length > 0 && (
                      <div className="flex items-center space-x-1">
                        <Type className="w-3 h-3 text-gray-400" />
                        <span className="text-xs text-gray-500">
                          {template.structure.variables.length}个变量
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )) : (
              <div className="text-center py-8">
                <FolderOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">暂无模板</p>
                <button
                  onClick={() => setShowTemplateUpload(true)}
                  className="mt-2 text-blue-600 hover:text-blue-700 text-sm underline"
                >
                  上传第一个模板
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
        {/* 主要内容区域 */}
        <div className="flex-1 p-6 bg-white flex flex-col">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center space-x-2">
              <Bot className="w-5 h-5 text-blue-600" />
              <span>自然语言报告生成</span>
            </h2>
            <p className="text-gray-600">用自然语言描述您的报告需求，AI将为您智能生成专业报告</p>
          </div>
          
          {/* 输入区域 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              报告需求描述
            </label>
            <textarea
              ref={naturalInputRef}
              value={naturalLanguageInput}
              onChange={(e) => setNaturalLanguageInput(e.target.value)}
              placeholder="例如：请生成一份2024年第三季度的综合财务分析报告，重点关注营收增长、盈利能力变化和现金流状况。报告应该包含同比分析、环比分析，以及对第四季度的预测。请使用图表展示关键指标趋势。"
              rows={6}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none resize-none"
              disabled={isNaturalGenerating}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-500">
                {naturalLanguageInput.length}/1000 字符 • 建议至少50字符
              </span>
              {naturalLanguageInput && (
                <button
                  onClick={() => copyToClipboard(naturalLanguageInput)}
                  className="text-xs text-blue-600 hover:text-blue-700 flex items-center space-x-1"
                >
                  <Copy className="w-3 h-3" />
                  <span>复制</span>
                </button>
              )}
            </div>
          </div>
          
          {/* 生成进度 */}
          {isNaturalGenerating && (
            <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center mb-2">
                <Bot className="w-5 h-5 text-blue-600 mr-2 animate-pulse" />
                <span className="text-sm font-medium text-blue-700">AI正在生成报告...</span>
              </div>
              <div className="w-full bg-blue-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${generationProgress}%` }}
                ></div>
              </div>
              <p className="text-xs text-blue-600 mt-1">正在分析需求并生成报告结构...</p>
            </div>
          )}
          
          {/* 生成按钮 */}
          <div className="mb-6">
            <button
              onClick={handleNaturalLanguageGenerate}
              disabled={isNaturalGenerating || naturalLanguageInput.trim().length < 10}
              className="bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center space-x-2"
            >
              {isNaturalGenerating ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>AI生成中...</span>
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5" />
                  <span>智能生成报告</span>
                </>
              )}
            </button>
          </div>
          
          {/* 快捷建议 */}
          <div className="flex-1">
            <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center space-x-2">
              <Lightbulb className="w-4 h-4 text-yellow-500" />
              <span>快捷建议</span>
            </h3>
            <div className="space-y-2">
              {quickSuggestions.map((suggestion, index) => (
                <button
                  key={index}
                  onClick={() => handleQuickSuggestionClick(suggestion)}
                  disabled={isNaturalGenerating}
                  className="w-full text-left p-3 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-all text-sm text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {suggestion}
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
                详细描述您需要的报告类型、时间范围、关注重点等信息。描述越详细，AI生成的报告越准确。
              </p>
            </div>
            
            <div>
              <h4 className="font-medium text-gray-800 mb-2">2. 包含关键信息</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• 报告类型（季度、年度、风险评估等）</li>
                <li>• 时间范围（Q3、2024年等）</li>
                <li>• 分析重点（收入、利润、现金流等）</li>
                <li>• 对比要求（同比、环比等）</li>
                <li>• 输出要求（图表、预测等）</li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-medium text-gray-800 mb-2">3. 示例描述</h4>
              <div className="bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-600">
                "生成2024年Q3财务分析报告，重点分析营收同比增长、毛利率变化和运营效率。包含与Q2环比对比，并对Q4进行预测。"
              </div>
            </div>
            
            <div>
              <h4 className="font-medium text-gray-800 mb-2">4. AI优势</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• 智能理解需求并生成结构</li>
                <li>• 自动填充行业标准内容</li>
                <li>• 提供专业的分析框架</li>
                <li>• 支持多种报告格式导出</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  function renderSetupView() {
    return (
      <div className="h-full">
        {activeTab === 'template' ? renderTemplateTab() : renderNaturalLanguageTab()}
      </div>
    );
  }
  
  function renderEditorView() {
    return (
      <div className="flex w-full h-full">
        {/* 编辑器 */}
        <div className="flex-1 flex flex-col">
          <div className="bg-white border-b border-gray-200 px-6 py-3">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
              <Edit3 className="w-5 h-5 text-blue-600" />
              <span>报告编辑器</span>
            </h2>
          </div>
          
          <div className="flex-1 p-6 bg-gray-50">
            <textarea
              ref={editorRef}
              value={reportContent}
              onChange={(e) => setReportContent(e.target.value)}
              className="w-full h-full bg-white border border-gray-300 rounded-lg p-4 text-gray-900 font-mono text-sm resize-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
              placeholder="开始编辑您的报告内容..."
            />
          </div>
        </div>
        
        {/* 实时预览 */}
        <div className="w-1/2 flex flex-col border-l border-gray-200">
          <div className="bg-white border-b border-gray-200 px-6 py-3">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
              <Eye className="w-5 h-5 text-blue-600" />
              <span>实时预览</span>
            </h2>
          </div>
          
          <div className="flex-1 p-6 overflow-y-auto bg-gray-50">
            <div className="bg-white rounded-lg p-6 min-h-full border border-gray-200">
              {reportContent ? (
                <div className="prose prose-gray max-w-none">
                  <Markdown content={reportContent} />
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <FileText className="w-12 h-12 mx-auto mb-4" />
                  <p>开始编辑以查看预览</p>
                </div>
              )}
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
              <Eye className="w-5 h-5 text-blue-600" />
              <span>报告预览</span>
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
              {reportContent ? (
                <div className="prose prose-gray prose-lg max-w-none">
                  <Markdown content={reportContent} />
                </div>
              ) : (
                <div className="text-center py-16 text-gray-500">
                  <FileText className="w-16 h-16 mx-auto mb-6" />
                  <h3 className="text-xl font-semibold mb-2">暂无内容</h3>
                  <p>请先生成或编辑报告内容</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-white">
      {/* 顶部操作栏 */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            {/* Tab切换 */}
            <div className="flex items-center space-x-1 bg-gray-100 p-1 rounded-lg">
              {reportTabs.map((tab) => {
                const IconComponent = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id);
                      setCurrentView('setup');
                    }}
                    className={`
                      flex items-center px-4 py-2 rounded-md text-sm font-medium transition-all
                      ${activeTab === tab.id 
                        ? 'bg-white text-blue-600 shadow-sm' 
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }
                    `}
                    title={tab.description}
                  >
                    <IconComponent className="h-4 w-4 mr-2" />
                    {tab.name}
                  </button>
                );
              })}
            </div>
            
            {/* 视图切换 */}
            {(reportContent || currentView !== 'setup') && (
              <>
                <div className="h-6 w-px bg-gray-200"></div>
                <button
                  onClick={() => setCurrentView('setup')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    currentView === 'setup' 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  设置
                </button>
                <button
                  onClick={() => setCurrentView('editor')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    currentView === 'editor' 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  编辑
                </button>
                <button
                  onClick={() => setCurrentView('preview')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    currentView === 'preview' 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  预览
                </button>
              </>
            )}
          </div>
          
          {/* 导出按钮 */}
          {reportContent && (
            <div className="relative group">
              <button
                disabled={isExporting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                <Download className="w-4 h-4" />
                <span>导出</span>
              </button>
              
              <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-50">
                {[
                  { format: 'pdf', label: 'PDF文档', icon: FileText },
                  { format: 'docx', label: 'Word文档', icon: File },
                  { format: 'md', label: 'Markdown', icon: Code },
                  { format: 'html', label: 'HTML页面', icon: Monitor }
                ].map(({ format, label, icon: Icon }) => (
                  <button
                    key={format}
                    onClick={() => handleExport(format)}
                    disabled={isExporting}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg transition-colors flex items-center space-x-2 disabled:opacity-50"
                  >
                    <Icon className="w-4 h-4" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* 主要内容区域 */}
      <div className="h-[calc(100vh-5rem)]">
        {renderCurrentView()}
      </div>
      
      {/* 模板上传弹窗 */}
      {showTemplateUpload && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white border border-gray-200 rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">上传模板</h3>
              <button
                onClick={() => setShowTemplateUpload(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  选择文件
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.txt,.html,.docx"
                  onChange={handleTemplateUpload}
                  disabled={isUploadingTemplate}
                  className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-600 file:text-white hover:file:bg-blue-700 file:transition-colors"
                />
                <p className="mt-1 text-xs text-gray-500">
                  支持 .md, .txt, .html, .docx 格式
                </p>
              </div>
              
              {isUploadingTemplate && (
                <div className="flex items-center space-x-2 text-blue-600">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span className="text-sm">上传中...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reports;