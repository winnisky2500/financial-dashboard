import React from 'react';
import { Download, Eye, FileText } from 'lucide-react';

interface Report {
  id: string;
  title: string;
  type: string;
  content: string;
  metadata: any;
  createdAt: Date;
  status: 'draft' | 'completed' | 'generating';
}

interface ReportPreviewProps {
  report: Report;
  onExport: (report: Report, format: 'pdf' | 'word' | 'markdown') => void;
}

const ReportPreview: React.FC<ReportPreviewProps> = ({ report, onExport }) => {
  // 简单的 Markdown 渲染
  const renderMarkdown = (content: string) => {
    return content
      .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold text-gray-900 mb-4">$1</h1>')
      .replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold text-gray-900 mb-3 mt-6">$1</h2>')
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-medium text-gray-900 mb-2 mt-4">$1</h3>')
      .replace(/\*\*(.*?)\*\*/gim, '<strong class="font-semibold">$1</strong>')
      .replace(/\*(.*?)\*/gim, '<em class="italic">$1</em>')
      .replace(/^- (.*$)/gim, '<li class="ml-4 list-disc mb-1">$1</li>')
      .replace(/^\d+\. (.*$)/gim, '<li class="ml-4 list-decimal mb-1">$1</li>')
      .replace(/\n/g, '<br />')
      .replace(/\|(.*?)\|/g, (match, content) => {
        // 简单表格处理
        const cells = content.split('|').map((cell: string) => `<td class="border border-gray-300 px-3 py-2">${cell.trim()}</td>`).join('');
        return `<tr>${cells}</tr>`;
      });
  };

  return (
    <div className="space-y-4">
      {/* 报告标题和操作 */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">报告预览</h3>
        <div className="flex space-x-2">
          <button
            onClick={() => onExport(report, 'markdown')}
            className="px-3 py-1 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center space-x-1 text-sm"
            title="导出MD"
          >
            <Download className="h-3 w-3" />
            <span>MD</span>
          </button>
          <button
            onClick={() => onExport(report, 'word')}
            className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors flex items-center space-x-1 text-sm"
            title="导出Word"
          >
            <Download className="h-3 w-3" />
            <span>Word</span>
          </button>
          <button
            onClick={() => onExport(report, 'pdf')}
            className="px-3 py-1 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors flex items-center space-x-1 text-sm"
            title="导出PDF"
          >
            <Download className="h-3 w-3" />
            <span>PDF</span>
          </button>
        </div>
      </div>
      
      {/* 报告信息 */}
      <div className="bg-gray-50 rounded-lg p-3">
        <div className="flex items-center space-x-4 text-sm text-gray-600">
          <div className="flex items-center space-x-1">
            <FileText className="h-4 w-4" />
            <span>{report.title}</span>
          </div>
          <div>生成时间: {report.createdAt.toLocaleString()}</div>
          <div className={`px-2 py-1 rounded-full text-xs ${
            report.status === 'completed' ? 'bg-green-100 text-green-700' :
            report.status === 'generating' ? 'bg-yellow-100 text-yellow-700' :
            'bg-gray-100 text-gray-700'
          }`}>
            {report.status === 'completed' ? '已完成' :
             report.status === 'generating' ? '生成中' : '草稿'}
          </div>
        </div>
      </div>
      
      {/* 报告内容 */}
      <div className="border border-gray-200 rounded-lg">
        <div className="max-h-[600px] overflow-y-auto p-6 bg-white">
          <div 
            className="prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(report.content) }}
          />
        </div>
      </div>
      
      {/* 报告统计 */}
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-lg font-semibold text-gray-900">
            {report.content.split('\n').length}
          </div>
          <div className="text-sm text-gray-600">总行数</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-lg font-semibold text-gray-900">
            {Math.round(report.content.length / 500)}
          </div>
          <div className="text-sm text-gray-600">预计页数</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-lg font-semibold text-gray-900">
            {report.content.length}
          </div>
          <div className="text-sm text-gray-600">字符数</div>
        </div>
      </div>
      
      {/* 报告元数据 */}
      {report.metadata && (
        <div className="bg-gray-50 rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-700 mb-2">报告元数据</h4>
          <div className="text-xs text-gray-600 space-y-1">
            <div>模板: {report.metadata.template || '自定义'}</div>
            <div>生成时间: {new Date(report.metadata.generatedAt).toLocaleString()}</div>
            {report.metadata.customRequirements && (
              <div>自定义要求: {report.metadata.customRequirements.substring(0, 100)}...</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportPreview;