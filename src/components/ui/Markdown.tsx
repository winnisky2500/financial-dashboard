import React from 'react';

interface MarkdownProps {
  content: string;
}

export const Markdown: React.FC<MarkdownProps> = ({ content }) => {
  return (
    <div dangerouslySetInnerHTML={{ __html: formatMarkdown(content) }} />
  );
};

// 简单的Markdown格式化函数
function formatMarkdown(markdown: string): string {
  // 这是一个非常简单的Markdown转HTML的实现
  // 在实际项目中，你可能想使用更成熟的库如marked或react-markdown
  
  let html = markdown
    // 标题
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/^#### (.*$)/gm, '<h4>$1</h4>')
    
    // 粗体和斜体
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    
    // 列表
    .replace(/^\s*\- (.*$)/gm, '<li>$1</li>')
    .replace(/(<\/li>\n<li>)/g, '</li>\n<li>')
    .replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>')
    
    // 分隔线
    .replace(/^\-\-\-$/gm, '<hr />')
    
    // 简单表格处理 (有限支持)
    .replace(/^\|(.+)\|$/gm, '<tr><td>$1</td></tr>')
    .replace(/\|/g, '</td><td>')
    .replace(/<tr>(<td>[-\s]+<\/td>)+<\/tr>/g, '<tr><th>$1</th></tr>')
    .replace(/<\/td><\/tr>\n<tr><td>/g, '</td></tr>\n<tr><td>')
    .replace(/(<tr>.*<\/tr>)/g, '<table>$1</table>')
    
    // 段落
    .replace(/\n\s*\n/g, '</p><p>')
    .replace(/^([^<].*)/gm, '<p>$1</p>');
  
  return html;
}
