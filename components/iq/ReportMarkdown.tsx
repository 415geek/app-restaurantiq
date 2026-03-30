'use client';

import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const mdComponents: Partial<Components> = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-3 text-[15px] leading-relaxed text-zinc-300 last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-3 list-disc space-y-1 pl-5 text-[15px] text-zinc-300">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-5 text-[15px] text-zinc-300">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-zinc-100">{children}</strong>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="mb-4 overflow-x-auto rounded-lg border border-zinc-700/80">
      <table className="w-full min-w-[520px] border-collapse text-left text-sm text-zinc-300">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-zinc-800/80">{children}</thead>,
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border-b border-zinc-700 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border-b border-zinc-800 px-3 py-2 align-top text-zinc-300">{children}</td>
  ),
  tr: ({ children }: { children?: React.ReactNode }) => <tr className="hover:bg-zinc-800/40">{children}</tr>,
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-2 mt-4 text-lg font-semibold text-zinc-100 first:mt-0">{children}</h3>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-2 mt-4 text-base font-semibold text-zinc-100 first:mt-0">{children}</h3>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h4 className="mb-2 mt-3 text-sm font-semibold text-zinc-200">{children}</h4>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[13px] text-emerald-200/90">{children}</code>
  ),
};

type Props = {
  children: string;
  className?: string;
};

export function ReportMarkdown({ children, className = '' }: Props) {
  if (!children?.trim()) return null;
  return (
    <div className={`iq-md ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
