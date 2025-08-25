import React, { useState } from 'react';
import { Play, FileText, Upload } from 'lucide-react';

interface Template {
  id: string;
  name: string;
  description: string;
  sections: string[];
  icon: string;
}

interface ReportTemplatesProps {
  templates: Template[];
  onSelectTemplate: (templateId: string | null) => void;
  selectedTemplate: string | null;
  onGenerateReport: (templateId: string, customRequirements?: string) => void;
  isGenerating: boolean;
}

const ReportTemplates: React.FC<ReportTemplatesProps> = ({
  templates,
  onSelectTemplate,
  selectedTemplate,
  onGenerateReport,
  isGenerating
}) => {
  const [customRequirements, setCustomRequirements] = useState('');
  const [uploadedFramework, setUploadedFramework] = useState<string | null>(null);

  // 上传报告框架
  const handleFrameworkUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setUploadedFramework(content);
        setCustomRequirements(prev => prev + `\n\n上传的框架文件：\n${content}`);
      };
      reader.readAsText(file);
    }
  };

  const handleGenerate = () => {
    if (selectedTemplate) {
      const requirements = customRequirements.trim() || undefined;
      onGenerateReport(selectedTemplate, requirements);
    }
  };

  return (
    <div className="space-y-6">
      {/* 模板选择 */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">选择报告模板</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((template) => (
            <div
              key={template.id}
              className={`border rounded-lg p-4 cursor-pointer transition-all ${
                selectedTemplate === template.id
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                  : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
              }`}
              onClick={() => onSelectTemplate(
                selectedTemplate === template.id ? null : template.id
              )}
            >
              <div className="flex items-start space-x-3">
                <div className="text-2xl">{template.icon}</div>
                <div className="flex-1">
                  <h4 className="font-medium text-gray-900">{template.name}</h4>
                  <p className="text-sm text-gray-600 mt-1">{template.description}</p>
                  
                  {/* 章节预览 */}
                  <div className="mt-3">
                    <p className="text-xs text-gray-500 mb-2">主要章节：</p>
                    <div className="flex flex-wrap gap-1">
                      {template.sections.slice(0, 3).map((section, index) => (
                        <span key={index} className="inline-flex px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">
                          {section}
                        </span>
                      ))}
                      {template.sections.length > 3 && (
                        <span className="inline-flex px-2 py-1 text-xs bg-gray-100 text-gray-500 rounded">
                          +{template.sections.length - 3}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 选中模板的详细信息 */}
      {selectedTemplate && (
        <div className="bg-gray-50 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              {templates.find(t => t.id === selectedTemplate)?.name}
            </h3>
            <span className="text-2xl">
              {templates.find(t => t.id === selectedTemplate)?.icon}
            </span>
          </div>
          
          {/* 所有章节 */}
          <div className="mb-6">
            <h4 className="text-sm font-medium text-gray-700 mb-3">报告章节结构：</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {templates.find(t => t.id === selectedTemplate)?.sections.map((section, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <span className="text-sm text-gray-500">{index + 1}.</span>
                  <span className="text-sm text-gray-700">{section}</span>
                </div>
              ))}
            </div>
          </div>
          
          {/* 自定义要求 */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                自定义要求（可选）
              </label>
              <textarea
                value={customRequirements}
                onChange={(e) => setCustomRequirements(e.target.value)}
                className="w-full h-32 p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="请描述您的特殊需求，例如：\n- 重点关注某个指标\n- 增加特定分析维度\n- 对比特定时期数据\n- 上传自定义分析框架"
              />
            </div>
            
            {/* 上传框架 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                上传报告框架（可选）
              </label>
              <div className="flex items-center space-x-3">
                <label className="cursor-pointer px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center space-x-2">
                  <Upload className="h-4 w-4 text-gray-500" />
                  <span className="text-sm text-gray-700">选择文件</span>
                  <input
                    type="file"
                    accept=".txt,.doc,.docx,.md"
                    onChange={handleFrameworkUpload}
                    className="hidden"
                  />
                </label>
                {uploadedFramework && (
                  <span className="text-sm text-green-600">✓ 框架文件已上传</span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                支持 .txt, .doc, .docx, .md 格式的文件
              </p>
            </div>
          </div>
          
          {/* 生成按钮 */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
            >
              <Play className="h-4 w-4" />
              <span>{isGenerating ? '正在生成...' : '生成报告'}</span>
            </button>
          </div>
        </div>
      )}
      
      {/* 生成进度 */}
      {isGenerating && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center space-x-3">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
            <div>
              <p className="text-sm font-medium text-blue-800">正在生成报告...</p>
              <p className="text-xs text-blue-600">请稍等，正在分析财务数据并生成报告内容</p>
            </div>
          </div>
        </div>
      )}
      
      {/* 使用说明 */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-700 mb-2">使用说明</h4>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• 选择适合的报告模板，系统将根据模板结构生成报告</li>
          <li>• 可以在“自定义要求”中添加特殊需求和关注点</li>
          <li>• 支持上传自定义的报告框架文件，系统将按照您的框架生成报告</li>
          <li>• 生成的报告可以导出为 PDF、Word 或 Markdown 格式</li>
        </ul>
      </div>
    </div>
  );
};

export default ReportTemplates;