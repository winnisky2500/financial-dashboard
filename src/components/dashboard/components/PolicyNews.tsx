import React from 'react';
import { ExternalLink, HelpCircle, Calendar, Tag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export interface PolicyNewsItem {
  id: string;
  title: string;
  category?: string;
  publishDate?: string;   // YYYY-MM-DD
  publisher?: string;     // ✅ 发布机构（唯一来源字段）
  url?: string;           // 原文链接
  content?: string;       // 摘要
  detail?: string;        // 详细内容（Markdown）
  // 兼容旧数据
  summary?: string;
  [k: string]: any;
}

interface PolicyNewsProps {
  news: PolicyNewsItem[];
  onQuestionClick?: (title: string) => void; // 兼容旧签名（内部不直接使用）
}

/* ---------- 工具：清理摘要中的裸链接行 ---------- */
const cleanSummary = (s: string) =>
  s
    .split(/\n+/)
    .filter(line => !/https?:\/\/\S+/i.test(line))
    .join('\n')
    .trim();

const PolicyNews: React.FC<PolicyNewsProps> = ({ news }) => {
  const navigate = useNavigate();
  const [previewId, setPreviewId] = React.useState<string | null>(null); // 只允许一张卡片展开

  const handleViewFullContent = (id: string) => {
    navigate(`/dashboard/policy-detail?id=${id}`);
  };

  const buildQuestion = (item: PolicyNewsItem) => `分析一下《${item.title}》的影响`;

  const goAsk = async (item: PolicyNewsItem) => {
    const q = buildQuestion(item);
    try { await navigator.clipboard?.writeText(q); } catch {}
    const params = new URLSearchParams();
    params.set('question', q);
    params.set('send', '0'); // ✅ 仅预填，不自动发送（Analysis.tsx 已按 send=0 不发送）
    window.location.href = `/dashboard/analysis?${params.toString()}`;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {(news || []).map((item) => {
        const summary = cleanSummary((item.content ?? item.summary ?? '').toString());
        const publisher = (item.publisher ?? '').trim() || '—';

        return (
          <div key={item.id} className="border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow bg-white">
            {/* 标题区 */}
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1 pr-2">
                <h3 className="font-semibold text-gray-900 text-base leading-snug">
                  {item.title}
                </h3>
                {item.category && (
                  <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-700">
                    <Tag className="h-3 w-3 mr-1" /> {item.category}
                  </span>
                )}
              </div>
              <button
                onClick={() => setPreviewId(prev => (prev === item.id ? null : item.id))}
                className="flex-shrink-0 p-1.5 text-purple-600 hover:text-purple-800 transition-colors ml-2 rounded-full hover:bg-purple-50"
                title="分析影响"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </div>

            {/* 摘要（仅两行） */}
            {summary && (
              <p className="text-sm text-gray-700 mb-3 line-clamp-2">{summary}</p>
            )}

            {/* 问题预览 */}
            {previewId === item.id && (
              <div className="mt-2 p-2 rounded-md bg-purple-50 border border-purple-200">
                <div className="text-sm text-purple-900">
                  预览问题：{buildQuestion(item)}
                </div>
                <div className="mt-1">
                  <button
                    onClick={() => goAsk(item)}
                    className="text-sm underline text-purple-700 hover:text-purple-900"
                  >
                    提问
                  </button>
                </div>
              </div>
            )}

            {/* 底部信息（只显示发布机构，不显示 URL） */}
            <div className="flex items-center justify-between text-xs text-gray-600 mt-3">
              <div className="flex items-center space-x-2">
                {item.publishDate && (
                  <>
                    <Calendar className="h-3 w-3" />
                    <span>{item.publishDate}</span>
                    <span>•</span>
                  </>
                )}
                <span className="truncate max-w-[160px]" title={publisher}>{publisher}</span>
              </div>
              <button
                onClick={() => handleViewFullContent(item.id)}
                className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 transition-colors"
              >
                <span>查看全文</span>
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PolicyNews;
