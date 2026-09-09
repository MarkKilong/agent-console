'use client';

import type { PermissionDecision } from '@agent-console/contracts';
import { CircleAlert, FileDiff } from 'lucide-react';
import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatItem, PendingPermission } from '@/store/thread-state';
import { PermissionCard } from './permission-card';
import { ToolCallRow } from './tool-call-row';
import { DiffStat, EmptyState } from './ui';

type Props = {
  items: ChatItem[];
  permissions: PendingPermission[];
  connected: boolean;
  onAnswer(requestId: string, decision: PermissionDecision): void;
  onShowFiles(turnIndex: number): void;
};

export function MessageList({ items, permissions, connected, onAnswer, onShowFiles }: Props) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [items, permissions]);

  return (
    <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-4">
      {items.length === 0 ? (
        <EmptyState>
          {connected ? 'Send a prompt to start a turn.' : 'Open a repository to start chatting.'}
        </EmptyState>
      ) : null}

      {items.map((item) => (
        <Message key={item.id} item={item} onShowFiles={onShowFiles} />
      ))}

      {permissions.map((permission) => (
        <PermissionCard key={permission.requestId} permission={permission} onAnswer={onAnswer} />
      ))}
    </div>
  );
}

function Message({ item, onShowFiles }: { item: ChatItem; onShowFiles(turn: number): void }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl bg-raised p-3 whitespace-pre-wrap">
            {item.text}
          </div>
        </div>
      );

    case 'assistant':
      return (
        <div className="prose-chat w-full min-w-0 leading-relaxed text-fg/85">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
          {item.streaming ? <span className="ml-0.5 animate-pulse text-muted">▍</span> : null}
        </div>
      );

    case 'tool':
      return <ToolCallRow item={item} />;

    case 'summary':
      return (
        <div className="rounded-lg bg-white/4">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <div className="flex min-w-0 items-center gap-x-3 text-xs font-medium">
              <span>
                {item.files} changed file{item.files === 1 ? '' : 's'}
              </span>
              <DiffStat added={item.added} removed={item.removed} className="text-xs" />
            </div>
            <button
              onClick={() => onShowFiles(item.turnIndex)}
              className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-xs text-muted transition-colors hover:bg-white/8 hover:text-fg"
            >
              <FileDiff className="size-3" />
              Show files
            </button>
          </div>
        </div>
      );

    case 'error':
      return (
        <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/6 px-3 py-2 text-xs text-danger">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {item.message}
            {item.code ? <span className="text-muted"> ({item.code})</span> : null}
          </span>
        </div>
      );
  }
}
