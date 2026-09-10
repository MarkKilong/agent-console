'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/cn';
import { CodeBlock } from './code-block';

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('prose-chat leading-relaxed text-fg/85', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

const COMPONENTS: Components = {
  a: ({ href, title, children }) => (
    <a href={href} title={title} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  pre: ({ node, children, ...props }) => {
    const fence = fenceOf(node);
    return fence ? (
      <CodeBlock code={fence.code} language={fence.language} />
    ) : (
      <pre {...props}>{children}</pre>
    );
  },
};

/** The shape of the hast nodes react-markdown hands the renderer, narrowed to what we read. */
type HastNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/** A `<pre>` wrapping a single `<code>` is a fence; anything else keeps the default rendering. */
function fenceOf(node: unknown): { code: string; language: string } | null {
  const child = (node as HastNode | undefined)?.children?.[0];
  if (child?.type !== 'element' || child.tagName !== 'code') return null;

  const text = (child.children ?? []).map((part) => part.value ?? '').join('');
  const classes = child.properties?.className;
  const language = (Array.isArray(classes) ? classes : [])
    .map((entry) => /^language-([\w+#.-]+)$/.exec(String(entry))?.[1])
    .find(Boolean);

  return { code: text.replace(/\n$/, ''), language: language ?? 'text' };
}
