import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

const Markdown_2: React.FC<{ content: string }> = ({ content }) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={{
        table: ({ children }) => (
          <table className="w-full border-collapse my-2 text-sm">{children}</table>
        ),
        thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
        th: (props) => (
          <th className="border px-2 py-1 text-gray-700 font-medium" {...props} />
        ),
        td: (props) => <td className="border px-2 py-1 align-top" {...props} />,
        code: ({ children }) => (
          <code className="px-1.5 py-0.5 rounded bg-gray-100 text-[12px]">
            {children}
          </code>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
};

export default Markdown_2;
