import React, { useEffect, useRef, useState } from 'react';
import { Send, Bot, User, Paperclip, Trash2, UploadCloud } from 'lucide-react';
import {
  listReportUploads,
  uploadReportFile,
  deleteReportUpload,
  type ReportUploadRow,
} from '../../../lib/dataService';

interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ReportChatProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  /** 新增（可选）：如果提供，就用它触发“生成报告”，会带上选中文件ID；否则回退到 onSendMessage */
  onGenerate?: (payload: { message: string; selectedFileIds: string[] }) => void;
  inputMessage: string;
  setInputMessage: (message: string) => void;
  isGenerating: boolean;
}

const ReportChat: React.FC<ReportChatProps> = ({
  messages,
  onSendMessage,
  onGenerate,
  inputMessage,
  setInputMessage,
  isGenerating
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ===== 新增：上传/选择文件状态 =====
  const [uploads, setUploads] = useState<ReportUploadRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // 自动滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  useEffect(() => { scrollToBottom(); }, [messages, isGenerating]);

  // 初始化拉取“已上传文件”
  useEffect(() => { (async () => {
    try {
      const rows = await listReportUploads();
      setUploads(rows);
    } catch (e) {
      // 静默失败即可，避免影响主流程
      console.warn('listReportUploads failed', e);
    }
  })(); }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMessage.trim() && !isGenerating) {
      if (onGenerate) {
        onGenerate({ message: inputMessage.trim(), selectedFileIds: selectedIds });
      } else {
        // 兼容旧逻辑：只把文本交给父组件
        onSendMessage(inputMessage.trim());
      }
    }
  };

  // 快捷问题
  const quickQuestions = [
    '生成一份2024年度财务分析报告',
    '我需要一份风险评估报告，重点关注流动性风险',
    '制作一份子公司绩效对比报告',
    '生成投资分析报告，包含成本效益分析',
    '制作一份季度经营情况报告'
  ];

  // ===== 新增：上传逻辑 =====
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const openFilePicker = () => fileInputRef.current?.click();

  const handleFilesChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const row = await uploadReportFile(f);
        setUploads(prev => [row, ...prev]);
      }
    } catch (err: any) {
      alert(`上传失败：${err?.message || err}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.concat(id));
  };

  const removeUpload = async (id: string, fileName: string) => {
    const ok = confirm(`删除文件：${fileName} ?`);
    if (!ok) return;
    try {
      await deleteReportUpload(id);
      setUploads(prev => prev.filter(x => x.id !== id));
      setSelectedIds(prev => prev.filter(x => x !== id));
    } catch (err: any) {
      alert(`删除失败：${err?.message || err}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* 使用说明 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-blue-800 mb-2">对话生成报告</h3>
        <p className="text-sm text-blue-700">
          直接描述您的报告需求，AI将根据您的要求自动生成专业的财务分析报告。
          您可以指定报告类型、关注点、时间范围等要求。右侧可上传模板/样例/数据文件，勾选后参与生成。
        </p>
      </div>

      {/* 快捷问题 */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-3">快捷问题：</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {quickQuestions.map((question, index) => (
            <button
              key={index}
              onClick={() => {
                if (onGenerate) onGenerate({ message: question, selectedFileIds: selectedIds });
                else onSendMessage(question);
              }}
              disabled={isGenerating}
              className="text-left p-3 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-200 rounded-lg transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {question}
            </button>
          ))}
        </div>
      </div>

      {/* ===== 新增：已上传文件（勾选后参与生成） ===== */}
      <div className="border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-gray-700">已上传文件（勾选后参与生成）</h4>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFilesChosen}
            />
            <button
              onClick={openFilePicker}
              disabled={uploading || isGenerating}
              className="px-3 py-2 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1"
              title="上传文件"
            >
              <UploadCloud className="h-4 w-4" />
              {uploading ? '上传中…' : '上传文件'}
            </button>
          </div>
        </div>

        {uploads.length === 0 ? (
          <div className="text-sm text-gray-500">暂无文件，点击右上角“上传文件”添加 PDF/Word/Excel/CSV/HTML/文本。</div>
        ) : (
          <div className="space-y-2">
            {uploads.map(u => (
              <div key={u.id} className="flex items-center justify-between border rounded-md px-3 py-2">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(u.id)}
                    onChange={() => toggleSelect(u.id)}
                  />
                  <div>
                    <div className="text-sm">{u.file_name}</div>
                    <div className="text-xs text-gray-500">
                      {(u.mime_type || 'unknown')} · {Math.round((u.size_bytes || 0) / 1024)} KB
                    </div>
                  </div>
                </label>
                <div className="flex items-center gap-3">
                  {u.signedUrl && (
                    <a
                      href={u.signedUrl}
                      target="_blank"
                      className="text-xs text-blue-600 hover:underline"
                      rel="noreferrer"
                    >
                      预览/下载
                    </a>
                  )}
                  <button
                    onClick={() => removeUpload(u.id, u.file_name)}
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

        {!!selectedIds.length && (
          <div className="mt-2 text-xs text-gray-600">
            已选择 <span className="font-medium">{selectedIds.length}</span> 个文件
          </div>
        )}
      </div>

      {/* 对话区域 */}
      <div className="border border-gray-200 rounded-lg">
        {/* 对话历史 */}
        <div className="h-96 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div key={message.id} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] ${message.type === 'user' ? 'order-2' : 'order-1'}`}>
                {/* 头像和时间 */}
                <div className={`flex items-center space-x-2 mb-2 ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`flex items-center space-x-2 ${message.type === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                      message.type === 'user' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'
                    }`}>
                      {message.type === 'user' ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                    </div>
                    <span className="text-xs text-gray-500">
                      {message.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                </div>

                {/* 消息内容 */}
                <div className={`rounded-lg p-3 ${
                  message.type === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-gray-100 text-gray-900 rounded-bl-sm'
                }`}>
                  <div className="whitespace-pre-wrap text-sm">{message.content}</div>
                </div>
              </div>
            </div>
          ))}

          {/* 正在生成状态 */}
          {isGenerating && (
            <div className="flex justify-start">
              <div className="max-w-[80%]">
                <div className="flex items-center space-x-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-xs">
                    <Bot className="h-3 w-3" />
                  </div>
                  <span className="text-xs text-gray-500">正在生成...</span>
                </div>
                <div className="bg-gray-100 rounded-lg rounded-bl-sm p-3">
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-green-600"></div>
                    <span className="text-gray-600 text-sm">正在分析您的需求并生成报告...</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 输入区域 */}
        <div className="border-t border-gray-200 p-4">
          <form onSubmit={handleSubmit} className="flex items-center space-x-3">
            <div className="relative flex-1">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="描述您想要的报告，例如：'参考我上传的模板，生成2024年度经营分析报告'"
                className="w-full px-4 py-2 pr-12 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isGenerating}
              />
              {/* 右下角：上传按钮（紧贴输入框右侧） */}
              <button
                type="button"
                onClick={openFilePicker}
                disabled={uploading || isGenerating}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-gray-100 disabled:opacity-50"
                title="上传文件"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFilesChosen}
              />
            </div>

            <button
              type="submit"
              disabled={!inputMessage.trim() || isGenerating}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
            >
              <Send className="h-4 w-4" />
              <span>{onGenerate ? '生成' : '发送'}</span>
            </button>
          </form>
        </div>
      </div>

      {/* 提示信息 */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-700 mb-2">提示</h4>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• 先上传模板/样例/数据文件并勾选，再描述生成需求，效果更好</li>
          <li>• 指定报告类型、时间范围、关注指标，AI 会生成结构化内容与图表</li>
          <li>• 生成完成后可继续对话微调，或一键美化导出 PDF/Word/HTML</li>
        </ul>
      </div>
    </div>
  );
};

export default ReportChat;
