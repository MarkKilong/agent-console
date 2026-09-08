'use client';

import type { PermissionDecision } from '@agent-console/contracts';
import { Shield } from 'lucide-react';
import type { PendingPermission } from '@/store/threadState';
import { Button } from './ui';

export function PermissionCard({
  permission,
  onAnswer,
}: {
  permission: PendingPermission;
  onAnswer(requestId: string, decision: PermissionDecision): void;
}) {
  const preview = previewOf(permission.toolName, permission.input);

  return (
    <div className="rounded-lg border border-warn/25 bg-warn/6 p-3 text-xs">
      <div className="flex items-center gap-1.5 text-warn">
        <Shield className="size-3.5 shrink-0" />
        <span className="font-medium">Permission requested</span>
        <span className="ml-auto rounded-md bg-white/6 px-1.5 py-0.5 font-mono text-[11px] text-muted">
          {permission.toolName}
        </span>
      </div>

      <p className="mt-2 text-fg">
        {permission.description ?? `Run ${permission.toolName}`}
      </p>

      {preview ? (
        <div className="mt-2 rounded-md bg-black/30 px-2 py-1.5 font-mono text-[11px]">
          {preview.path ? <div className="truncate text-fg/80">{preview.path}</div> : null}
          {preview.body ? (
            <pre className="mt-0.5 overflow-hidden whitespace-pre-wrap text-muted">
              {preview.body}
            </pre>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex gap-2">
        <Button variant="primary" onClick={() => onAnswer(permission.requestId, 'allow')}>
          Allow
        </Button>
        <Button variant="muted" onClick={() => onAnswer(permission.requestId, 'deny')}>
          Deny
        </Button>
      </div>
    </div>
  );
}

type Preview = { path: string | undefined; body: string | undefined };

/** File tools preview their target and content; Bash previews the command. */
function previewOf(toolName: string, input: unknown): Preview | null {
  const fields = (input ?? {}) as Record<string, unknown>;
  const path = string(fields.file_path ?? fields.path ?? fields.notebook_path);

  if (toolName === 'Bash') {
    const command = string(fields.command);
    return command ? { path: undefined, body: truncate(command) } : null;
  }

  const content = string(fields.content ?? fields.new_string);
  if (path || content) return { path, body: content ? truncate(content) : undefined };

  return null;
}

function truncate(value: string, lines = 6, chars = 400): string {
  const clipped = value.split('\n').slice(0, lines).join('\n').slice(0, chars);
  return clipped.length < value.length ? `${clipped}…` : clipped;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
