'use client';

import type { PermissionDecision } from '@agent-console/contracts';
import { useState } from 'react';
import type { RunnerClient } from '@/lib/runner-client';
import { useConsoleStore, useThread } from '@/store/use-console-store';
import { Composer } from './composer';
import { MessageList } from './message-list';
import { EmptyState, PaneHeader } from './ui';

type Props = {
  client: RunnerClient | null;
  threadId: string | null;
  onShowFiles(turnIndex: number): void;
};

export function ChatPane({ client, threadId, onShowFiles }: Props) {
  const environment = useConsoleStore((state) => state.environment);
  const title = useConsoleStore((state) => (threadId ? state.threadMeta[threadId]?.title : null));
  const addUserMessage = useConsoleStore((state) => state.addUserMessage);
  const thread = useThread(threadId);
  const [error, setError] = useState<string | null>(null);

  const connected = Boolean(client && threadId);

  function guard(action: () => void) {
    try {
      setError(null);
      action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function send(text: string) {
    if (!client || !threadId) return;
    guard(() => {
      client.send({ type: 'send_prompt', threadId, text });
      addUserMessage(threadId, text);
    });
  }

  function answer(requestId: string, decision: PermissionDecision) {
    if (!client || !threadId) return;
    guard(() => client.send({ type: 'answer_permission', threadId, requestId, decision }));
  }

  return (
    <div className="flex h-full flex-col">
      <PaneHeader>
        {environment ? (
          <>
            <span className="shrink-0">{repoName(environment.repoPath)}</span>
            <span className="text-muted/40">/</span>
            <span className="min-w-0 truncate font-medium text-fg">{title}</span>
          </>
        ) : (
          <span>No environment</span>
        )}
      </PaneHeader>

      {threadId ? (
        <MessageList
          items={thread.items}
          permissions={thread.permissions}
          connected={connected}
          onAnswer={answer}
          onShowFiles={onShowFiles}
        />
      ) : (
        <div className="min-h-0 flex-1">
          <EmptyState>Open a repository to start chatting.</EmptyState>
        </div>
      )}

      {error ? <div className="px-4 pb-1 text-xs text-danger">{error}</div> : null}

      <Composer
        disabled={!connected}
        turnActive={thread.turnActive}
        onSend={send}
        onStop={() =>
          client && threadId && guard(() => client.send({ type: 'stop_turn', threadId }))
        }
      />
    </div>
  );
}

function repoName(repoPath: string): string {
  return repoPath.split(/[\\/]/).filter(Boolean).pop() ?? repoPath;
}
