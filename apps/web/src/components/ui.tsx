'use client';

import { Check, Copy, LoaderCircle } from 'lucide-react';
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Shared with the links that have to look like an IconButton. */
export const ICON_BUTTON_CLASS = cn(
  'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors',
  'hover:bg-white/8 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40',
);

/** Square ghost icon button, T3's `size="icon-sm" variant="ghost"`. */
export function IconButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { 'aria-label': string }) {
  return <button {...props} className={cn(ICON_BUTTON_CLASS, className)} />;
}

export function PaneHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3 text-xs text-muted-foreground">
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-5 py-6 text-center text-xs text-muted-foreground/70">{children}</div>;
}

/** `+A −D` in the diff green/red, as T3's DiffStatLabel renders it. */
export function DiffStat({
  added,
  removed,
  className,
}: {
  added: number;
  removed: number;
  className?: string;
}) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1.5 font-mono tabular-nums', className)}
    >
      <span className="text-success">+{added}</span>
      <span className="text-danger">−{removed}</span>
    </span>
  );
}

/** Copies `text` and shows a tick for a moment, as the code block and tool output both need. */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
      }}
      aria-label="Copy"
      title={copied ? 'Copied' : 'Copy'}
      className={cn(
        'flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:text-fg',
        className,
      )}
    >
      {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn('size-3.5 shrink-0 animate-spin', className)} />;
}

const STATUS_COLORS = {
  idle: 'bg-muted-foreground/50',
  working: 'bg-sky-400/90',
  'needs-permission': 'bg-amber-300/90',
  open: 'bg-success',
  connecting: 'bg-warn',
  closed: 'bg-danger',
} as const;

/** 9px dot in a 14px box, so it lines up with the 14px icons beside it. */
export function Dot({ status }: { status: keyof typeof STATUS_COLORS }) {
  return (
    <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
      <span className={cn('size-[9px] rounded-full', STATUS_COLORS[status])} />
    </span>
  );
}
