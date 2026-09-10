'use client';

import { PanelLeft, PanelRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { closeProject, openProject } from '@/lib/open-project';
import { RunnerClient } from '@/lib/runner-client';
import { useAuthStore } from '@/store/use-auth-store';
import { useComposerSettings } from '@/store/use-composer-settings';
import { useConsoleStore } from '@/store/use-console-store';
import { useLayoutStore } from '@/store/use-layout-store';
import { useActiveProject, useProjectsStore } from '@/store/use-projects-store';
import { AddProjectDialog } from './add-project-dialog';
import { ChatPane } from './chat-pane';
import { DiffPane } from './diff-pane';
import { ThreadsSidebar } from './threads-sidebar';
import { IconButton } from './ui';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export function AppShell() {
  const id = useConsoleStore((state) => state.environment?.id);
  const url = useConsoleStore((state) => state.environment?.url);
  const token = useConsoleStore((state) => state.environment?.token);
  const status = useConsoleStore((state) => state.environment?.status);
  const activeThreadId = useConsoleStore((state) => state.activeThreadId);
  const sidebarOpen = useLayoutStore((state) => state.sidebarOpen);
  const rightOpen = useLayoutStore((state) => state.rightOpen);

  const [addOpen, setAddOpen] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);

  // Tagged with its thread so switching threads drops the selection by derivation.
  const [selection, setSelection] = useState<{ threadId: string | null; turn: number } | null>(
    null,
  );
  const selectedTurn = selection && selection.threadId === activeThreadId ? selection.turn : null;

  // The persisted stores only load after mount, so the server render and the first
  // client render agree on the defaults.
  useEffect(() => {
    // Strict mode mounts twice; only the surviving run may open the project.
    let cancelled = false;
    // Claude's login is machine-level, so the composer can know about it with no project open.
    void useAuthStore.getState().ensure();
    void (async () => {
      await Promise.all([
        useProjectsStore.persist.rehydrate(),
        useComposerSettings.persist.rehydrate(),
        useLayoutStore.persist.rehydrate(),
      ]);

      // A reload restores the active project but not its runner, so open it again.
      const { projects, activeProjectId } = useProjectsStore.getState();
      const project = projects.find((candidate) => candidate.id === activeProjectId);
      if (cancelled || !project || useConsoleStore.getState().environment) return;
      try {
        await openProject(project);
      } catch (cause) {
        await closeProject();
        setReopenError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  // The runner survives the browser, so ask it for the threads it already has.
  useEffect(() => {
    if (!client || status !== 'open') return;
    let live = true;
    client
      .request({ type: 'list_threads' })
      .then((data) => {
        if (live && 'threads' in data) useConsoleStore.getState().hydrateThreads(data.threads);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [client, status]);

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
      {sidebarOpen ? (
        <>
          <Panel
            defaultSize={260}
            minSize={220}
            maxSize={340}
            className="min-w-0 border-r border-line"
          >
            <ThreadsSidebar
              client={client}
              error={reopenError}
              onAddProject={() => setAddOpen(true)}
            />
          </Panel>
          <Separator className="w-px" />
        </>
      ) : null}

      <Panel defaultSize="50" minSize="30" className="flex min-w-0 flex-col">
        <ShellHeader />
        <ChatPane
          client={client}
          threadId={activeThreadId}
          onShowFiles={selectTurn}
          onAddProject={() => setAddOpen(true)}
        />
      </Panel>

      {rightOpen && id ? (
        <>
          <Separator className="w-px" />
          <Panel defaultSize="32" minSize="20" className="min-w-0 border-l border-line">
            <DiffPane
              threadId={activeThreadId}
              selectedTurn={selectedTurn}
              onSelectTurn={selectTurn}
            />
          </Panel>
        </>
      ) : null}

      <AddProjectDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </Group>
  );
}

/** B's top bar: the collapsed-sidebar handle, the breadcrumb, and the two panel toggles. */
function ShellHeader() {
  const project = useActiveProject();
  const title = useConsoleStore((state) =>
    state.activeThreadId ? state.threadMeta[state.activeThreadId]?.title : undefined,
  );
  const environment = useConsoleStore((state) => state.environment);
  const { sidebarOpen, rightOpen, toggleSidebar, toggleRight } = useLayoutStore();

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3 text-xs text-muted-foreground">
      {sidebarOpen ? null : (
        <IconButton onClick={toggleSidebar} aria-label="Open sidebar" title="Open sidebar">
          <PanelLeft className="size-4" />
        </IconButton>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {project ? (
          <>
            <span className="shrink-0">{project.name}</span>
            <span className="text-muted-foreground/40">/</span>
          </>
        ) : null}
        <span className="min-w-0 truncate font-medium text-fg">{title ?? 'New thread'}</span>
      </div>

      <div className="flex shrink-0 items-center">
        <Tooltip>
          {/* A disabled button swallows pointer events, so the trigger is the wrapper. */}
          <TooltipTrigger asChild>
            <span>
              <IconButton
                onClick={toggleRight}
                disabled={!environment}
                aria-label={rightOpen ? 'Hide files' : 'Show files'}
              >
                <PanelRight className="size-4" />
              </IconButton>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {environment ? (rightOpen ? 'Hide files' : 'Show files') : 'Open a project first'}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
