import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, Tag } from 'lucide-react';
import { PolicyNewsItem, getPolicyNews } from '@/lib/dataService';
import { Markdown } from '@/components/ui/Markdown';

/** 清理摘要里的裸链接，避免视觉噪音 */
const cleanSummary = (s: string) =>
  (s ?? '')
    .toString()
    .split(/\n+/)
    .filter(line => !/https?:\/\/\S+/i.test(line))
    .join('\n')
    .trim();

/** 判断是否像 Markdown */
const looksMarkdown = (raw: string) =>
  /(^|\n)\s*#{1,6}\s+|(^|\n)[*-]\s+|`{1,3}|\[.+\]\(.+\)|!\[.*\]\(.+\)|^>\s+/m.test(raw);

/** 纯文本 -> 段落数组（段落之间空一行渲染） */
const toParagraphs = (text: string) => {
  const t = (text ?? '').toString().replace(/\r\n/g, '\n').trim();
  if (!t) return [] as string[];
  // 先按空行切段，再把单段里的换行合并为空格
  return t
    .split(/\n{2,}/)
    .map(seg => seg.replace(/\n+/g, ' ').trim())
    .filter(Boolean);
};

const PolicyDetail: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [policy, setPolicy] = useState<(PolicyNewsItem & { detail?: string; publisher?: string }) | null>(null);
  const [relatedPolicies, setRelatedPolicies] = useState<PolicyNewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  const searchParams = new URLSearchParams(location.search);
  const policyId = searchParams.get('id');

  useEffect(() => {
    const loadPolicyData = async () => {
      if (!policyId) {
        navigate('/dashboard/overview');
        return;
      }

      setLoading(true);
      try {
        const allPolicies = await getPolicyNews();
        const currentPolicy = allPolicies.find(p => p.id === policyId) as any;
        if (!currentPolicy) {
          navigate('/dashboard/overview');
          return;
        }
        setPolicy(currentPolicy);

        const related = allPolicies
          .filter(p => p.category === currentPolicy.category && p.id !== policyId)
          .slice(0, 3);
        setRelatedPolicies(related);
      } catch (error) {
        console.error('加载政策数据失败:', error);
      } finally {
        setLoading(false);
      }
    };

    loadPolicyData();
  }, [policyId, navigate]);

  const handleBackToOverview = () => navigate('/dashboard/overview');
  const openUrl = (u?: string) => { if (u) window.open(u, '_blank'); };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex items-center space-x-2">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
          <span>加载政策详情...</span>
        </div>
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="text-center py-12">
        <h3 className="text-lg font-semibold">未找到政策信息</h3>
        <button
          onClick={handleBackToOverview}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          返回概览
        </button>
      </div>
    );
  }

  // 字段：publisher（机构名，标题下显示）；来源=URL（摘要上方展示并可点击）
  const publisher = (policy.publisher ?? '').trim() || '—';
  const primaryUrl = (policy.url ?? '').trim() || undefined;
  const summary = cleanSummary((policy.content ?? policy.summary ?? '').toString());
  const rawDetail = (policy.detail ?? '').toString();

  const detailIsMd = looksMarkdown(rawDetail);
  const detailParas = detailIsMd ? [] : toParagraphs(rawDetail);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <button
        onClick={handleBackToOverview}
        className="flex items-center text-blue-600 hover:text-blue-800 mb-6"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        返回概览
      </button>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* 主内容区 */}
        <div className="flex-1 bg-white rounded-lg shadow p-6">
          {/* 头部 */}
          <div className="border-b pb-4 mb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{policy.title}</h1>

            <div className="flex flex-wrap items-center text-sm text-gray-600 gap-3 mb-2">
              {policy.publishDate && (
                <div className="flex items-center">
                  <Calendar className="h-4 w-4 mr-1" />
                  <span>{policy.publishDate}</span>
                </div>
              )}
              <>
                <span>•</span>
                <span>{publisher}</span>
              </>
              {policy.category && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                  <Tag className="h-3 w-3 mr-1" /> {policy.category}
                </span>
              )}
            </div>
          </div>

          {/* ✅ 来源（显示 URL，位于摘要上方） */}
          <div className="mb-3 text-sm text-gray-700">
            来源：
            {primaryUrl ? (
              <a
                href={primaryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-600 hover:text-purple-800 underline break-all align-middle"
                title={primaryUrl}
                onClick={(e) => { e.preventDefault(); openUrl(primaryUrl); }}
              >
                {primaryUrl}
              </a>
            ) : (
              <span className="text-gray-500">—</span>
            )}
          </div>

          {/* 摘要（content） */}
          {summary && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-2">摘要</h2>
              <p className="text-gray-800 whitespace-pre-wrap">{summary}</p>
            </div>
          )}

          {/* 详细内容（detail）—— Markdown 或纯文本段落（段落之间空一行） */}
          <div className="prose max-w-none">
            <h2 className="text-lg font-semibold mb-2">详细内容</h2>
            {rawDetail ? (
              detailIsMd ? (
                <Markdown content={rawDetail} />
              ) : (
                <>
                  {detailParas.map((p, i) => (
                    <p key={i} className="mb-4 whitespace-pre-wrap">{p}</p>
                  ))}
                </>
              )
            ) : (
              <p className="text-gray-500">暂无详细内容。</p>
            )}
          </div>
        </div>

        {/* 右侧边栏：相关政策 */}
        <div className="lg:w-80 bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold border-b pb-3 mb-4">相关政策</h2>

          {relatedPolicies.length > 0 ? (
            <div className="space-y-4">
              {relatedPolicies.map((item) => (
                <div
                  key={item.id}
                  className="border border-gray-200 rounded-lg p-3 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => navigate(`/dashboard/policy-detail?id=${item.id}`)}
                >
                  <h3 className="font-medium text-gray-900 text-sm mb-2">{item.title}</h3>
                  <p className="text-xs text-gray-600 line-clamp-2 mb-2">
                    {(item as any).content || (item as any).summary || ''}
                  </p>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{(item as any).publishDate}</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                      {item.category}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-6">暂无相关政策</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default PolicyDetail;
