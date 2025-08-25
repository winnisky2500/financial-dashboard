import React from 'react';
import { HelpCircle, Zap } from 'lucide-react';

interface QuickQuestionsProps {
  questions: string[];
  onQuestionClick: (question: string) => void;
}

const QuickQuestions: React.FC<QuickQuestionsProps> = ({ questions, onQuestionClick }) => {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center space-x-2 mb-4">
        <Zap className="h-5 w-5 text-yellow-500" />
        <h2 className="text-lg font-semibold text-gray-900">快捷问题</h2>
      </div>
      
      <div className="space-y-2">
        {questions.map((question, index) => (
          <button
            key={index}
            onClick={() => onQuestionClick(question)}
            className="w-full text-left p-3 bg-gray-50 hover:bg-blue-50 hover:border-blue-200 border border-gray-200 rounded-lg transition-colors group"
          >
            <div className="flex items-start space-x-2">
              <HelpCircle className="h-4 w-4 text-gray-400 group-hover:text-blue-500 mt-0.5 flex-shrink-0" />
              <span className="text-sm text-gray-700 group-hover:text-blue-700 leading-relaxed">
                {question}
              </span>
            </div>
          </button>
        ))}
      </div>
      
      <div className="mt-4 p-3 bg-blue-50 rounded-lg">
        <div className="flex items-start space-x-2">
          <Zap className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-blue-700">
            <p className="font-medium mb-1">提示</p>
            <p>点击以上问题可快速开始分析，也可以在下方输入框中提出自定义问题。</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuickQuestions;