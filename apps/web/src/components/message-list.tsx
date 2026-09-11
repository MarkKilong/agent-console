'use client';

import type { Commit, PermissionDecision } from '@agent-console/contracts';
import {
  ArrowDown,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileDiff,
  GitCommitHorizontal,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCost, formatTokens } from '@/lib/format';
import {
  groupTurns,
  nestTools,
  splitCommits,
  type ErrorItem,
  type SummaryItem,
  type TurnGroup,
} from '@/lib/turn-groups';
import type { ChatItem, PendingPermission, Turn } from '@/store/thread-state';
import { AssistantMessage } from './assistant-message';
import { PermissionCard } from './permission-card';
import { TurnWork } from './turn-work';
import { DiffStat, EmptyState } from './ui';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

type Props = {
  items: ChatItem[];
  turns: Turn[];
  permissions: PendingPermission[];
  connected: boolean;
  turnActive: boolean;
  /** The user pressed Stop and the turn has not ended yet. */
  stopping: boolean;
  onAnswer(requestId: string, decision: PermissionDecision): void;
  onShowFiles(turnIndex: number): void;
};

/** Below this many pixels from the foot, new content should keep scrolling itself into view. */
const STICK_THRESHOLD = 80;

export function MessageList({
  items,
  turns,
  permissions,
  connected,
  turnActive,
  stopping,
  onAnswer,
  onShowFiles,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const groups = useMemo(() => groupTurns(items, turns), [items, turns]);

  useEffect(() => {
    const element = scroller.current;
    if (element && pinned) element.scrollTop = element.scrollHeight;
  }, [items, permissions, pinned]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={() => {
          const element = scroller.current;
          if (!element) return;
          const gap = element.scrollHeight - element.scrollTop - element.clientHeight;
          setPinned(gap < STICK_THRESHOLD);
        }}
        className="min-h-0 flex-1 overflow-auto px-4 py-4"
      >
        {/* Same column width as the composer below it. */}
        <div className="mx-auto max-w-3xl space-y-6">
          {items.length === 0 ? (
            <EmptyState>
              {connected
                ? 'Send a prompt to start a turn.'
                : 'Open a repository to start chatting.'}
            </EmptyState>
          ) : null}

          {groups.map((group, index) => (
            <TurnGroupView
              key={group.prompt?.id ?? `legacy-${index}`}
              group={group}
              active={turnActive && index === groups.length - 1}
              stopping={stopping}
              onShowFiles={onShowFiles}
            />
          ))}

          {permissions.map((permission) => (
            <PermissionCard
              key={permission.requestId}
              permission={permission}
              onAnswer={onAnswer}
            />
          ))}
        </div>
      </div>

      {pinned ? null : (
        <button
          onClick={() => setPinned(true)}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-raised px-3 py-1.5 text-xs text-muted-foreground shadow-lg transition-colors hover:text-fg"
        >
          <ArrowDown className="size-3.5" />
          Jump to latest
        </button>
      )}
    </div>
  );
}

function TurnGroupView({
  group,
  active,
  stopping,
  onShowFiles,
}: {
  group: TurnGroup;
  active: boolean;
  stopping: boolean;
  onShowFiles(turnIndex: number): void;
}) {
  const rows = useMemo(() => nestTools(group.work), [group.work]);
  // A turn that never called a tool has no fold; while it runs, the header is the progress.
  const showFold = rows.length > 0 || (active && !group.answer);

  return (
    <div className="space-y-3">
      {group.prompt ? <UserBubble text={group.prompt.text} ts={group.prompt.ts} /> : null}

      {showFold ? (
        <TurnWork rows={rows} turn={group.turn} active={active} stopping={stopping} />
      ) : null}

      {group.answer ? <AssistantMessage item={group.answer} /> : null}

      {group.summary ? <SummaryRow summary={group.summary} onShowFiles={onShowFiles} /> : null}

      {group.errors.map((error) => (
        <ErrorRow key={error.id} item={error} />
      ))}

      {active ? null : <TurnFooter turn={group.turn} />}
    </div>
  );
}

function UserBubble({ text, ts }: { text: string; ts: number }) {
  return (
    <div className="flex justify-end">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="max-w-[80%] rounded-2xl bg-raised p-3 whitespace-pre-wrap">{text}</div>
        </TooltipTrigger>
        <TooltipContent side="left">{clockTime(ts)}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function SummaryRow({
  summary,
  onShowFiles,
}: {
  summary: SummaryItem;
  onShowFiles(turnIndex: number): void;
}) {
  const { made, pulled, pulledTotal, pulledHidden } = splitCommits(summary);

  return (
    <div className="space-y-1 px-0.5 text-xs text-muted-foreground">
      {summary.files > 0 ? (
        <div className="flex items-center gap-2">
          <span>
            {summary.files} file{summary.files === 1 ? '' : 's'} changed
          </span>
          <DiffStat added={summary.added} removed={summary.removed} className="text-xs" />
          <span className="text-muted-foreground/50">·</span>
          <button
            onClick={() => onShowFiles(summary.turnIndex)}
            className="flex cursor-pointer items-center gap-1 transition-colors hover:text-fg"
          >
            <FileDiff className="size-3" />
            Show files
          </button>
        </div>
      ) : null}
      {made.map((commit) => (
        <CommitLine key={`${commit.repo}/${commit.sha}`} commit={commit} />
      ))}
      {pulledTotal > 0 ? (
        <PulledCommits pulled={pulled} total={pulledTotal} hidden={pulledHidden} />
      ) : null}
    </div>
  );
}

function CommitLine({ commit }: { commit: Commit }) {
  return (
    <div className="flex items-center gap-1.5">
      <GitCommitHorizontal className="size-3 shrink-0" />
      <span>
        {commit.made ? 'Committed' : 'Pulled in'} <span className="text-fg">{commit.subject}</span>
      </span>
      {commit.repo ? <span className="text-muted-foreground/70">in {commit.repo}</span> : null}
      <span className="font-mono text-muted-foreground/70">{commit.sha.slice(0, 7)}</span>
    </div>
  );
}

/** Commits the turn only pulled in are noise next to the ones it made, so they fold away. */
function PulledCommits({
  pulled,
  total,
  hidden,
}: {
  pulled: Commit[];
  total: number;
  hidden: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="-mx-1 flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-white/5"
      >
        <GitCommitHorizontal className="size-3 shrink-0" />
        <span>
          Pulled in {total} commit{total === 1 ? '' : 's'}
        </span>
        <span className="flex-1" />
        {open ? (
          <ChevronDown className="size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" />
        )}
      </button>
      {open ? (
        <div className="mt-1 space-y-1">
          {pulled.map((commit) => (
            <CommitLine key={`${commit.repo}/${commit.sha}`} commit={commit} />
          ))}
          {hidden > 0 ? <div className="text-muted-foreground/70">and {hidden} more</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Tokens and cost for the turn, plus why it ended when that was not "it finished". */
function TurnFooter({ turn }: { turn: Turn | undefined }) {
  const usage = turn?.usage;
  const ending = endingOf(turn?.stopReason);
  if (!usage && !ending) return null;

  const parts = [
    usage?.inputTokens === undefined ? null : `${formatTokens(usage.inputTokens)} in`,
    usage?.outputTokens === undefined ? null : `${formatTokens(usage.outputTokens)} out`,
    usage?.costUsd === undefined ? null : formatCost(usage.costUsd),
    ending,
  ].filter(Boolean);

  return <div className="text-right text-[11px] text-muted-foreground/70">{parts.join(' · ')}</div>;
}

function ErrorRow({ item }: { item: ErrorItem }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/6 px-3 py-2 text-xs text-danger">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {item.message}
        {item.code ? <span className="text-muted-foreground"> ({item.code})</span> : null}
      </span>
    </div>
  );
}

function endingOf(stopReason: string | undefined): string | null {
  if (!stopReason || stopReason === 'end_turn') return null;
  return stopReason === 'stopped' ? 'Stopped' : 'Error';
}

function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
