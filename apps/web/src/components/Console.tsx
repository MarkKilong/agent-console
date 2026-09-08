'use client';

import { useEffect, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { RunnerClient } from '@/lib/runnerClient';
import { useConsoleStore } from '@/store/useConsoleStore';
import { ChatPane } from './ChatPane';
import { DiffPane } from './DiffPane';
import { ThreadsSidebar } from './ThreadsSidebar';

export function Console() {
  const id = useConsoleStore((state) => state.environment?.id);
  const url = useConsoleStore((state) => state.environment?.url);
  const token = useConsoleStore((state) => state.environment?.token);
  const activeThreadId = useConsoleStore((state) => state.activeThreadId);

  const [client, setClient] = useState<RunnerClient | null>(null);
  const [selectedTurn, setSelectedTurn] = useState<number | null>(null);

  useEffect(() => {
    if (!url || !token) {
      setClient(null);
      return;
    }
    const { applyEvent, setStatus } = useConsoleStore.getState();
    const runner = new RunnerClient({ url, token, onEvent: applyEvent, onStatus: setStatus });
    runner.connect();
    setClient(runner);

    return () => {
      runner.dispose();
      setClient(null);
    };
  }, [id, url, token]);

  // Every thread the user visits gets its own subscription, replayed from its cursor.
  useEffect(() => {
    if (client && activeThreadId) client.subscribe(activeThreadId);
    setSelectedTurn(null);
  }, [client, activeThreadId]);

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
        <ChatPane client={client} threadId={activeThreadId} onShowFiles={setSelectedTurn} />
      </Panel>
      <Separator className="w-px" />
      <Panel defaultSize="32" minSize="20" className="min-w-0 border-l border-line">
        <DiffPane
          threadId={activeThreadId}
          selectedTurn={selectedTurn}
          onSelectTurn={setSelectedTurn}
        />
      </Panel>
    </Group>
  );
}
