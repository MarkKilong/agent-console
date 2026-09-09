'use client';

import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type ButtonVariant = 'primary' | 'ghost' | 'muted' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:brightness-110',
  ghost: 'border border-line bg-raised text-fg hover:border-muted',
  muted: 'text-muted hover:bg-white/8 hover:text-fg',
  danger: 'border border-line bg-raised text-danger hover:border-danger',
};

export function Button({
  variant = 'ghost',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={cn(
        'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        VARIANTS[variant],
        className,
      )}
    />
  );
}

/** Square ghost icon button, T3's `size="icon-sm" variant="ghost"`. */
export function IconButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { 'aria-label': string }) {
  return (
    <button
      {...props}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors',
        'hover:bg-white/8 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
    />
  );
}

export function PaneHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3 text-xs text-muted">
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-5 py-6 text-center text-xs text-muted/70">{children}</div>;
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

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn('size-3.5 shrink-0 animate-spin', className)} />;
}

const STATUS_COLORS = {
  idle: 'bg-muted/50',
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
