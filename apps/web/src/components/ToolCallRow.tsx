'use client';

import {
  ChevronDown,
  ChevronRight,
  FilePen,
  FileText,
  Globe,
  Search,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { toolLabel } from '@/lib/toolLabel';
import type { ChatItem } from '@/store/threadState';
import { Spinner } from './ui';

type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

const ICONS: Record<string, LucideIcon> = {
  Write: FilePen,
  Edit: FilePen,
  MultiEdit: FilePen,
  NotebookEdit: FilePen,
  Read: FileText,
  Bash: Terminal,
  Glob: Search,
  Grep: Search,
  WebFetch: Globe,
};

export function ToolCallRow({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[item.name] ?? Wrench;

  return (
    <div>
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-6 w-full cursor-pointer items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left transition-colors hover:bg-white/5"
      >
        <span className="flex size-6 shrink-0 items-center justify-center">
          {item.done ? (
            <Icon
              className={cn('size-4 shrink-0', item.isError ? 'text-danger' : 'text-muted')}
              strokeWidth={1.8}
            />
          ) : (
            <Spinner className="text-muted" />
          )}
        </span>
        <span className={cn('min-w-0 flex-1 truncate', item.isError ? 'text-danger' : 'text-muted')}>
          {toolLabel(item.name, item.input)}
        </span>
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted" />
        )}
      </button>

      {open ? (
        <div className="mt-1 ml-6 space-y-2 rounded-lg border border-line bg-raised px-2.5 py-2 text-xs">
          <Section label={item.name}>{format(item.input)}</Section>
          {item.done ? <Section label="output">{item.output ?? '(no output)'}</Section> : null}
        </div>
      ) : null}
    </div>
  );
}

function Section({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <div className="mb-0.5 text-[10px] tracking-wide text-muted uppercase">{label}</div>
      <pre className="max-h-64 overflow-auto text-[11px] break-all whitespace-pre-wrap text-fg">
        {children}
      </pre>
    </div>
  );
}

function format(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
