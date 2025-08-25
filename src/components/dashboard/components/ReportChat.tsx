import React, { useEffect, useRef } from 'react';
import { Send, Bot, User } from 'lucide-react';

interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ReportChatProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  inputMessage: string;
  setInputMessage: (message: string) => void;
  isGenerating: boolean;
}

const ReportChat: React.FC<ReportChatProps> = ({
  messages,
  onSendMessage,
  inputMessage,
  setInputMessage,
  isGenerating
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // 自动滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isGenerating]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMessage.trim() && !isGenerating) {
      onSendMessage(inputMessage.trim());
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

  return (
    <div className="space-y-6">
      {/* 使用说明 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-blue-800 mb-2">对话生成报告</h3>
        <p className="text-sm text-blue-700">
          直接描述您的报告需求，AI将根据您的要求自动生成专业的财务分析报告。
          您可以指定报告类型、关注点、时间范围等要求。
        </p>
      </div>
      
      {/* 快捷问题 */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-3">快捷问题：</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {quickQuestions.map((question, index) => (
            <button
              key={index}
              onClick={() => onSendMessage(question)}
              disabled={isGenerating}
              className="text-left p-3 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-200 rounded-lg transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {question}
            </button>
          ))}
        </div>
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
          <form onSubmit={handleSubmit} className="flex space-x-3">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="描述您想要生成的报告，例如：'生成一份2024年度财务分析报告，重点关注盈利能力'"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isGenerating}
            />
            <button
              type="submit"
              disabled={!inputMessage.trim() || isGenerating}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
            >
              <Send className="h-4 w-4" />
              <span>发送</span>
            </button>
          </form>
        </div>
      </div>
      
      {/* 提示信息 */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-700 mb-2">提示</h4>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• 请尽量详细描述您的报告需求，包括报告类型、关注的指标和时间范围</li>
          <li>• 可以指定特定的分析维度，如子公司对比、同比环比分析等</li>
          <li>• AI将根据您的要求生成结构化的专业报告，包含图表和数据分析</li>
          <li>• 生成的报告可以进一步编辑和定制</li>
        </ul>
      </div>
    </div>
  );
};

export default ReportChat;