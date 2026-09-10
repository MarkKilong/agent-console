'use client';

import type { PermissionDecision } from '@agent-console/contracts';
import { Shield } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toolActionLabel } from '@/lib/tool-label';
import type { PendingPermission } from '@/store/thread-state';
import { MiniDiff } from './mini-diff';
import { Button } from './ui/button';

export function PermissionCard({
  permission,
  onAnswer,
}: {
  permission: PendingPermission;
  onAnswer(requestId: string, decision: PermissionDecision): void;
}) {
  const card = useRef<HTMLDivElement>(null);

  // Focus the card so Enter/Esc answer it — unless the user is already typing somewhere.
  useEffect(() => {
    const focused = document.activeElement;
    if (!focused || focused === document.body) card.current?.focus();
  }, []);

  return (
    <div
      ref={card}
      tabIndex={-1}
      onKeyDown={(event) => {
        // The buttons answer their own key presses; only the card itself takes the shortcut.
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter') onAnswer(permission.requestId, 'allow');
        else if (event.key === 'Escape') onAnswer(permission.requestId, 'deny');
        else return;
        event.preventDefault();
      }}
      className="rounded-lg border border-warn/25 bg-warn/6 p-3 text-xs outline-none focus-visible:border-warn/50"
    >
      <div className="flex items-center gap-1.5 text-warn">
        <Shield className="size-3.5 shrink-0" />
        <span className="truncate font-medium">
          Allow {toolActionLabel(permission.toolName, permission.input)}?
        </span>
        <span className="ml-auto shrink-0 rounded-md bg-white/6 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {permission.toolName}
        </span>
      </div>

      <Preview toolName={permission.toolName} input={permission.input} />

      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => onAnswer(permission.requestId, 'allow')}>
          Allow
        </Button>
        <Button variant="outline" size="sm" onClick={() => onAnswer(permission.requestId, 'deny')}>
          Deny
        </Button>
      </div>
    </div>
  );
}

/** What the call would do, in the shape that reads fastest for the tool at hand. */
function Preview({ toolName, input }: { toolName: string; input: unknown }) {
  const fields = (input ?? {}) as Record<string, unknown>;
  const path = string(fields.file_path ?? fields.path ?? fields.notebook_path);

  if (toolName === 'Bash') {
    const command = string(fields.command);
    return command ? <Mono>{command}</Mono> : null;
  }

  const before = string(fields.old_string);
  const after = string(fields.new_string);
  if (before || after) {
    return (
      <div className="mt-2 space-y-1">
        {path ? <Path>{path}</Path> : null}
        <MiniDiff before={before ?? ''} after={after ?? ''} />
      </div>
    );
  }

  const content = string(fields.content);
  if (toolName === 'Write' && content) {
    return (
      <div className="mt-2 space-y-1">
        {path ? <Path>{path}</Path> : null}
        <Mono>{truncate(content, 12)}</Mono>
      </div>
    );
  }

  const rest = format(input);
  return rest ? <Mono>{truncate(rest, 8)}</Mono> : null;
}

function Mono({ children }: { children: string }) {
  return (
    <pre className="mt-2 max-h-52 overflow-auto rounded-md bg-black/30 px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-fg/80">
      {children}
    </pre>
  );
}

function Path({ children }: { children: string }) {
  return <div className="truncate font-mono text-[11px] text-muted-foreground">{children}</div>;
}

function truncate(value: string, lines: number): string {
  const all = value.split('\n');
  if (all.length <= lines) return value;
  return `${all.slice(0, lines).join('\n')}\n… ${all.length - lines} more lines`;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function format(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || Object.keys(value as object).length === 0) return '';
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return '';
  }
}
