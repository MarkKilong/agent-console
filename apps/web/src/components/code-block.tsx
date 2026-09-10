'use client';

import { useEffect, useState } from 'react';
import { highlightLines, type Token } from '@/lib/highlight';
import { CopyButton } from './ui';

/** A fenced block from an answer: language header, copy button, highlighted body. */
export function CodeBlock({ code, language }: { code: string; language: string }) {
  const lines = useHighlight(code, language);

  return (
    <div className="code-block my-2 overflow-hidden rounded-lg border border-line bg-raised">
      <div className="flex h-7 items-center justify-between gap-2 border-b border-line pr-1.5 pl-2.5">
        <span className="truncate font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
          {language}
        </span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto font-mono text-[12px] leading-[1.6]">
        <code>
          {lines
            ? lines.map((tokens, index) => (
                <span key={index}>
                  {tokens.map((token, position) => (
                    <span key={position} style={{ color: token.color }}>
                      {token.content}
                    </span>
                  ))}
                  {index < lines.length - 1 ? '\n' : ''}
                </span>
              ))
            : code}
        </code>
      </pre>
    </div>
  );
}

/** Renders plain first and swaps in tokens, so shiki never blocks the answer. */
function useHighlight(code: string, language: string): Token[][] | null {
  const [tokens, setTokens] = useState<Token[][] | null>(null);
  const active = language !== 'text';

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void highlightLines(code, language).then((result) => {
      if (!cancelled) setTokens(result);
    });
    return () => {
      cancelled = true;
    };
  }, [code, language, active]);

  return active ? tokens : null;
}
