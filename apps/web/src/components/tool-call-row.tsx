'use client';

import {
  Bot,
  ChevronDown,
  ChevronRight,
  FilePen,
  FileText,
  Globe,
  ListTodo,
  Search,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { toolLabel } from '@/lib/tool-label';
import { countNodes, type ToolItem, type ToolNode } from '@/lib/turn-groups';
import { useNow } from '@/lib/use-now';
import { MiniDiff } from './mini-diff';
import { CopyButton, Spinner } from './ui';

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
  WebSearch: Globe,
  Task: Bot,
  Agent: Bot,
  TodoWrite: ListTodo,
};

export function ToolCallRow({ node }: { node: ToolNode }) {
  const [open, setOpen] = useState(false);
  const { item, children } = node;
  const Icon = ICONS[item.name] ?? Wrench;
  const now = useNow(!item.done);
  // Threads logged before tools were timed have no `finishedAt`, so they show no time at all.
  const elapsed = item.done ? item.finishedAt && item.finishedAt - item.ts : now - item.ts;
  const nested = countNodes(children);

  return (
    <div>
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-6 w-full cursor-pointer items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left transition-colors hover:bg-white/5"
      >
        <span className="flex size-6 shrink-0 items-center justify-center">
          <Icon
            className={cn(
              'size-4 shrink-0',
              item.isError ? 'text-danger' : 'text-muted-foreground',
            )}
            strokeWidth={1.8}
          />
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            item.isError ? 'text-danger' : 'text-muted-foreground',
          )}
        >
          {toolLabel(item.name, item.input)}
        </span>

        {nested > 0 && !open ? (
          <span className="shrink-0 text-xs text-muted-foreground/70">
            · {nested} call{nested === 1 ? '' : 's'}
          </span>
        ) : null}
        {item.done ? null : <Spinner className="text-muted-foreground" />}
        {elapsed === undefined ? null : (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70 tabular-nums">
            {formatDuration(elapsed)}
          </span>
        )}
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open ? (
        <div className="mt-1 ml-6 space-y-2">
          <div className="space-y-2 rounded-lg border border-line bg-raised px-2.5 py-2 text-xs">
            <ToolInput item={item} />
            {item.done ? <ToolOutput item={item} /> : null}
          </div>

          {children.length > 0 ? (
            <div className="space-y-1 border-l border-line pl-3">
              {children.map((child) => (
                <ToolCallRow key={child.item.id} node={child} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ToolInput({ item }: { item: ToolItem }) {
  const fields = (item.input ?? {}) as Record<string, unknown>;
  const path = string(fields.file_path ?? fields.path ?? fields.notebook_path);
  const command = string(fields.command);
  const edits = editsOf(fields);

  if (item.name === 'Bash' && command) {
    return (
      <Section label="command">
        <Mono>{command}</Mono>
      </Section>
    );
  }

  if (edits.length > 0) {
    return (
      <Section label={path ?? 'edit'}>
        <div className="space-y-1">
          {edits.map((edit, index) => (
            <MiniDiff key={index} before={edit.before} after={edit.after} />
          ))}
        </div>
      </Section>
    );
  }

  const content = string(fields.content);
  if (item.name === 'Write' && content) {
    return (
      <Section label={path ?? 'content'}>
        <Mono>{content}</Mono>
      </Section>
    );
  }

  return (
    <Section label={item.name}>
      <Mono>{format(item.input)}</Mono>
    </Section>
  );
}

function ToolOutput({ item }: { item: ToolItem }) {
  return (
    <Section label="output" action={<CopyButton text={item.output ?? ''} />}>
      <pre className="max-h-72 overflow-auto text-[11px] whitespace-pre-wrap text-fg">
        {item.output ?? '(no output)'}
      </pre>
      {item.outputTruncated ? (
        <p className="mt-1 text-[10px] text-muted-foreground">Output truncated to 64 KB</p>
      ) : null}
    </Section>
  );
}

function Section({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-0.5 flex h-4 items-center justify-between gap-2">
        <span className="truncate text-[10px] tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}

function Mono({ children }: { children: string }) {
  return (
    <pre className="max-h-64 overflow-auto font-mono text-[11px] break-all whitespace-pre-wrap text-fg">
      {children}
    </pre>
  );
}

type MiniEdit = { before: string; after: string };

/** `Edit` carries one replacement; `MultiEdit` carries a list of them. */
function editsOf(fields: Record<string, unknown>): MiniEdit[] {
  const before = string(fields.old_string);
  const after = string(fields.new_string);
  if (before || after) return [{ before: before ?? '', after: after ?? '' }];

  if (!Array.isArray(fields.edits)) return [];
  return fields.edits.flatMap((entry) => {
    const edit = (entry ?? {}) as Record<string, unknown>;
    const from = string(edit.old_string);
    const to = string(edit.new_string);
    return from || to ? [{ before: from ?? '', after: to ?? '' }] : [];
  });
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function format(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
