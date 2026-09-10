'use client';

import { Check, ChevronDown, ChevronRight, CircleAlert, Square } from 'lucide-react';
import { useState } from 'react';
import { formatClock, formatDuration } from '@/lib/format';
import { countTools, type WorkRow } from '@/lib/turn-groups';
import { useNow } from '@/lib/use-now';
import type { Turn } from '@/store/thread-state';
import { AssistantMessage } from './assistant-message';
import { ToolCallRow } from './tool-call-row';
import { Spinner } from './ui';

type Props = {
  rows: WorkRow[];
  turn: Turn | undefined;
  active: boolean;
  stopping: boolean;
};

/** The one "Worked for …" fold per turn: open while the work runs, collapsed once it is done. */
export function TurnWork({ rows, turn, active, stopping }: Props) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? active;
  const now = useNow(active);
  const calls = countTools(rows);

  const startedAt = turn?.startedAt ?? 0;
  const elapsed = active ? now - startedAt : (turn?.finishedAt ?? startedAt) - startedAt;

  return (
    <div>
      <button
        onClick={() => setOverride(!open)}
        className="flex min-h-6 w-full cursor-pointer items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:bg-white/5"
      >
        <span className="flex size-6 shrink-0 items-center justify-center">
          {active ? <Spinner /> : <StateIcon stopReason={turn?.stopReason} />}
        </span>
        {active ? (
          <>
            <span className="animate-pulse">{stopping ? 'Stopping…' : 'Working…'}</span>
            <span className="font-mono tabular-nums">{formatClock(elapsed)}</span>
          </>
        ) : (
          <span className="truncate">
            {turn ? `Worked for ${formatDuration(elapsed)}` : 'Work'}
            {calls > 0 ? (
              <span className="text-muted-foreground/70">
                {' · '}
                {calls} tool call{calls === 1 ? '' : 's'}
              </span>
            ) : null}
          </span>
        )}
        <span className="flex-1" />
        {open ? (
          <ChevronDown className="size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" />
        )}
      </button>

      {open ? (
        <div className="mt-1 space-y-1.5">
          {rows.map((row) =>
            row.kind === 'tool' ? (
              <ToolCallRow key={row.node.item.id} node={row.node} turn={turn} />
            ) : row.item.kind === 'assistant' ? (
              <AssistantMessage key={row.item.id} item={row.item} />
            ) : null,
          )}
        </div>
      ) : null}
    </div>
  );
}

function StateIcon({ stopReason }: { stopReason: string | undefined }) {
  if (stopReason === 'stopped') return <Square className="size-3.5 shrink-0" />;
  if (stopReason && stopReason !== 'end_turn') {
    return <CircleAlert className="size-3.5 shrink-0 text-warn" />;
  }
  return <Check className="size-3.5 shrink-0" />;
}
