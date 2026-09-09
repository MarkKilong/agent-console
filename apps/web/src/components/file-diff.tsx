'use client';

import type { DiffFile, DiffStatus } from '@agent-console/contracts';
import { Check, ChevronDown, ChevronRight, Copy, FileText } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { highlightLines, languageForPath, type Token } from '@/lib/highlight';
import { collapseContext, parseUnifiedDiff, type DiffLine } from '@/lib/parse-unified-diff';
import { DiffStat } from './ui';

type Row =
  | { kind: 'hunk'; key: string; header: string }
  | { kind: 'gap'; key: string; count: number }
  | { kind: 'line'; key: string; line: DiffLine; index: number };

const STATUS_COLORS: Record<DiffStatus, string> = {
  added: 'text-success',
  deleted: 'text-danger',
  modified: 'text-muted-foreground',
  renamed: 'text-muted-foreground',
};

export function FileDiff({
  file,
  open,
  onToggle,
}: {
  file: DiffFile;
  open: boolean;
  onToggle(): void;
}) {
  const { rows, added, removed } = useMemo(() => toRows(file.patch), [file.patch]);
  const code = useMemo(
    () =>
      rows
        .filter((row) => row.kind === 'line')
        .map((row) => row.line.text)
        .join('\n'),
    [rows],
  );
  const tokens = useHighlight(code, languageForPath(file.path), open);

  const slash = file.path.lastIndexOf('/');

  return (
    <div className="border-b border-line">
      <div className="sticky top-0 z-10 flex h-8 items-center gap-1.5 bg-panel px-2 pr-3 text-xs">
        <button
          onClick={onToggle}
          aria-label={open ? 'Collapse diff' : 'Expand diff'}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
        >
          {open ? (
            <ChevronDown className={cn('size-4 shrink-0', STATUS_COLORS[file.status])} />
          ) : (
            <ChevronRight className={cn('size-4 shrink-0', STATUS_COLORS[file.status])} />
          )}
          <FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
          <span className="min-w-0 truncate">
            {file.oldPath ? <span className="text-muted-foreground">{file.oldPath} → </span> : null}
            <span className="text-muted-foreground">{file.path.slice(0, slash + 1)}</span>
            <span className="text-fg">{file.path.slice(slash + 1)}</span>
          </span>
        </button>
        <CopyPathButton path={file.path} />
        <DiffStat added={added} removed={removed} className="text-[11px]" />
      </div>

      {open ? (
        <div className="overflow-x-auto pb-2 font-mono text-[11px] leading-[1.6]">
          {rows.map((row) => {
            if (row.kind === 'hunk') {
              return <Separator key={row.key}>{row.header}</Separator>;
            }
            if (row.kind === 'gap') {
              return (
                <Separator key={row.key}>
                  {row.count} unmodified line{row.count === 1 ? '' : 's'}
                </Separator>
              );
            }
            return <LineRow key={row.key} line={row.line} tokens={tokens?.[row.index]} />;
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Centred label between two hairlines, as T3 renders its hunk separators. */
function Separator({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-6 items-center gap-2 px-3 font-sans text-[11px] text-muted-foreground/70 select-none">
      <span className="h-px flex-1 bg-line" />
      <span className="shrink-0 truncate">{children}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

const ROW_STYLES = {
  add: 'border-success/70 bg-success/16',
  remove: 'border-danger/70 bg-danger/16',
  context: 'border-transparent',
} as const;

// The number columns carry a stronger tint than the row, as T3's diff surface does.
const GUTTER_STYLES = {
  add: 'bg-success/30',
  remove: 'bg-danger/30',
  context: '',
} as const;

const MARKER_STYLES = {
  add: 'text-success',
  remove: 'text-danger',
  context: 'text-muted-foreground',
} as const;

function LineRow({ line, tokens }: { line: DiffLine; tokens: Token[] | undefined }) {
  return (
    // w-max lets a long line widen the row so the body scrolls it into view instead
    // of the text spilling out of a container-width row.
    <div className={cn('flex w-max min-w-full border-l-2', ROW_STYLES[line.kind])}>
      <Gutter value={line.oldNumber} className={GUTTER_STYLES[line.kind]} />
      <Gutter value={line.newNumber} className={GUTTER_STYLES[line.kind]} />
      <span className={cn('w-4 shrink-0 pl-1 text-center select-none', MARKER_STYLES[line.kind])}>
        {line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}
      </span>
      <pre className="shrink-0 pr-3 whitespace-pre">
        {tokens ? (
          tokens.map((token, index) => (
            <span key={index} style={{ color: token.color }}>
              {token.content}
            </span>
          ))
        ) : (
          <span>{line.text}</span>
        )}
      </pre>
    </div>
  );
}

function Gutter({ value, className }: { value: number | undefined; className: string }) {
  return (
    <span
      className={cn(
        'w-10 shrink-0 pr-2 text-right tabular-nums text-muted-foreground/60 select-none',
        className,
      )}
    >
      {value ?? ''}
    </span>
  );
}

function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={() => {
        void navigator.clipboard?.writeText(path);
        setCopied(true);
      }}
      onMouseLeave={() => setCopied(false)}
      aria-label="Copy file path"
      title={copied ? 'Copied' : 'Copy path'}
      className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-fg"
    >
      {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
    </button>
  );
}

function toRows(patch: string): { rows: Row[]; added: number; removed: number } {
  const { hunks, added, removed } = parseUnifiedDiff(patch);
  const rows: Row[] = [];
  let index = -1;

  hunks.forEach((hunk, hunkIndex) => {
    rows.push({ kind: 'hunk', key: `h${hunkIndex}`, header: hunk.header });
    collapseContext(hunk.lines).forEach((row, rowIndex) => {
      const key = `h${hunkIndex}-${rowIndex}`;
      if (row.kind === 'gap') rows.push({ kind: 'gap', key, count: row.count });
      else rows.push({ kind: 'line', key, line: row.line, index: ++index });
    });
  });

  return { rows, added, removed };
}

function useHighlight(code: string, language: string, enabled: boolean): Token[][] | null {
  const [tokens, setTokens] = useState<Token[][] | null>(null);
  const active = enabled && language !== 'text';

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
