import React, { useEffect, useRef } from 'react';
import { User, Bot, Copy, Download } from 'lucide-react';
import toast from 'react-hot-toast';

interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  context?: any;
}

interface AnalysisChatProps {
  messages: ChatMessage[];
  isAnalyzing: boolean;
}

const AnalysisChat: React.FC<AnalysisChatProps> = ({ messages, isAnalyzing }) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isAnalyzing]);

  // 复制消息
  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
    toast.success('已复制到剪贴板');
  };

  // 导出对话
  const exportChat = () => {
    const chatContent = messages.map(msg => 
      `${msg.type === 'user' ? '用户' : 'AI助手'} [${msg.timestamp.toLocaleString()}]:\n${msg.content}\n\n`
    ).join('');
    
    const blob = new Blob([chatContent], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `financial_analysis_${Date.now()}.txt`;
    link.click();
    
    toast.success('对话已导出！');
  };

  return (
    <div className="flex flex-col h-full">
      {/* 对话列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] ${message.type === 'user' ? 'order-2' : 'order-1'}`}>
              {/* 头像和时间 */}
              <div className={`flex items-center space-x-2 mb-2 ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex items-center space-x-2 ${message.type === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    message.type === 'user' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'
                  }`}>
                    {message.type === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </div>
                  <span className="text-xs text-gray-500">
                    {message.timestamp.toLocaleTimeString()}
                  </span>
                </div>
              </div>
              
              {/* 消息内容 */}
              <div className={`relative group ${
                message.type === 'user' 
                  ? 'bg-blue-600 text-white rounded-lg rounded-br-sm' 
                  : 'bg-gray-100 text-gray-900 rounded-lg rounded-bl-sm'
              } p-4 shadow-sm`}>
                {/* 复制按钮 */}
                <button
                  onClick={() => copyMessage(message.content)}
                  className={`absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded ${
                    message.type === 'user' 
                      ? 'hover:bg-blue-700 text-blue-200' 
                      : 'hover:bg-gray-200 text-gray-500'
                  }`}
                  title="复制消息"
                >
                  <Copy className="h-3 w-3" />
                </button>
                
                {/* 消息文本 */}
                <div className="pr-8">
                  {message.type === 'assistant' ? (
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown content={message.content} />
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap">{message.content}</div>
                  )}
                </div>
                
                {/* 上下文信息 */}
                {message.context && message.type === 'assistant' && (
                  <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">
                    <div className="flex flex-wrap gap-2">
                      {message.context.analysisType?.map((type: string, index: number) => (
                        <span key={index} className="px-2 py-1 bg-blue-50 text-blue-600 rounded">
                          {type}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        
        {/* 分析中状态 */}
        {isAnalyzing && (
          <div className="flex justify-start">
            <div className="max-w-[80%]">
              <div className="flex items-center space-x-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                  <Bot className="h-4 w-4" />
                </div>
                <span className="text-xs text-gray-500">正在分析...</span>
              </div>
              <div className="bg-gray-100 rounded-lg rounded-bl-sm p-4 shadow-sm">
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"></div>
                  <span className="text-gray-600">正在进行财务数据分析，请稍等...</span>
                </div>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>
      
      {/* 操作栏 */}
      {messages.length > 0 && (
        <div className="border-t border-gray-200 p-2">
          <div className="flex justify-end">
            <button
              onClick={exportChat}
              className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors flex items-center space-x-1"
            >
              <Download className="h-3 w-3" />
              <span>导出对话</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// 简单的 Markdown 渲染组件
const ReactMarkdown: React.FC<{ content: string }> = ({ content }) => {
  // 将 Markdown 格式转换为 HTML
  const formatContent = (text: string) => {
    return text
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold text-gray-900 mt-4 mb-2">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 class="text-xl font-bold text-gray-900 mt-6 mb-3">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold text-gray-900 mt-6 mb-4">$1</h1>')
      .replace(/\*\*(.*?)\*\*/gim, '<strong class="font-semibold">$1</strong>')
      .replace(/\*(.*?)\*/gim, '<em class="italic">$1</em>')
      .replace(/^- (.*$)/gim, '<li class="ml-4 list-disc">$1</li>')
      .replace(/^\d+\. (.*$)/gim, '<li class="ml-4 list-decimal">$1</li>')
      .replace(/\n/g, '<br />');
  };

  return (
    <div 
      className="prose prose-sm max-w-none"
      dangerouslySetInnerHTML={{ __html: formatContent(content) }}
    />
  );
};

export default AnalysisChat;