/**
 * Markdown — renders the Analyst's answers as rich text (GFM: bold, lists,
 * tables, code, links), styled to the Headroom UI Kit rather than the prose
 * plugin. Memoised so token-by-token streaming doesn't re-parse needlessly per
 * keystroke beyond what the growing string requires.
 */

import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-violet-600 underline underline-offset-2 hover:text-violet-700"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="mb-2 last:mb-0 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 last:mb-0 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed marker:text-slate-400">{children}</li>,
  h1: ({ children }) => <h1 className="mb-2 mt-1 text-[15px] font-semibold text-slate-900">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-1 text-[14px] font-semibold text-slate-900">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 mt-1 text-[13px] font-semibold text-slate-800">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-violet-200 pl-3 text-slate-600">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-slate-100" />,
  code: ({ className, children }) => {
    const isBlock = (className ?? '').includes('language-')
    if (isBlock) {
      return (
        <code className="num block whitespace-pre-wrap break-words text-[12px] leading-relaxed text-slate-800">
          {children}
        </code>
      )
    }
    return (
      <code className="num rounded bg-slate-100 px-1 py-0.5 text-[12px] text-slate-800">{children}</code>
    )
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3">{children}</pre>
  ),
  // GFM tables — styled to mirror the app's data tables.
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-slate-50">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-slate-100 last:border-0">{children}</tr>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-semibold text-slate-600">{children}</th>
  ),
  td: ({ children }) => <td className="px-3 py-2 align-top text-slate-700">{children}</td>,
}

function MarkdownImpl({ content }: { content: string }) {
  return (
    <div className="text-[13px] text-slate-700">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

export const Markdown = memo(MarkdownImpl)
