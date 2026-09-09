'use client';

import { useEffect, useMemo, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { RunnerClient } from '@/lib/runner-client';
import { useConsoleStore } from '@/store/use-console-store';
import { ChatPane } from './chat-pane';
import { DiffPane } from './diff-pane';
import { ThreadsSidebar } from './threads-sidebar';

export function Console() {
  const id = useConsoleStore((state) => state.environment?.id);
  const url = useConsoleStore((state) => state.environment?.url);
  const token = useConsoleStore((state) => state.environment?.token);
  const activeThreadId = useConsoleStore((state) => state.activeThreadId);

  // Tagged with its thread so switching threads drops the selection by derivation.
  const [selection, setSelection] = useState<{ threadId: string | null; turn: number } | null>(
    null,
  );
  const selectedTurn = selection && selection.threadId === activeThreadId ? selection.turn : null;

  // Derived from the environment so no render is spent adopting it; the effect
  // below owns only the socket's lifetime.
  const client = useMemo(() => {
    if (!id || !url || !token) return null;
    const { applyEvent, setStatus } = useConsoleStore.getState();
    return new RunnerClient({ url, token, onEvent: applyEvent, onStatus: setStatus });
  }, [id, url, token]);

  useEffect(() => {
    client?.connect();
    return () => client?.dispose();
  }, [client]);

  // Every thread the user visits gets its own subscription, replayed from its cursor.
  useEffect(() => {
    if (client && activeThreadId) client.subscribe(activeThreadId);
  }, [client, activeThreadId]);

  const selectTurn = (turn: number) => setSelection({ threadId: activeThreadId, turn });

  return (
    <Group orientation="horizontal" className="h-screen bg-bg">
      {/* Numeric sizes are pixels in react-resizable-panels v4, strings are percent.
          The three defaults add up to ~100% of a laptop window, so the group has
          nothing to normalise away, and the px max keeps the sidebar narrow. */}
      <Panel defaultSize={260} minSize={220} maxSize={340} className="min-w-0 border-r border-line">
        <ThreadsSidebar />
      </Panel>
      <Separator className="w-px" />
      <Panel defaultSize="50" minSize="30" className="min-w-0">
        <ChatPane client={client} threadId={activeThreadId} onShowFiles={selectTurn} />
      </Panel>
      <Separator className="w-px" />
      <Panel defaultSize="32" minSize="20" className="min-w-0 border-l border-line">
        <DiffPane threadId={activeThreadId} selectedTurn={selectedTurn} onSelectTurn={selectTurn} />
      </Panel>
    </Group>
  );
}
