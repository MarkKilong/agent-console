'use client';

import { Folder, Search, SquarePen, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Preflight } from '@/server/preflight';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relativeTime';
import { threadStatus, type ThreadStatus } from '@/store/threadState';
import { useConsoleStore } from '@/store/useConsoleStore';
import { Button, Dot, IconButton, Spinner } from './ui';

export function ThreadsSidebar() {
  const [search, setSearch] = useState('');

  const environment = useConsoleStore((state) => state.environment);
  const threadOrder = useConsoleStore((state) => state.threadOrder);
  const threadMeta = useConsoleStore((state) => state.threadMeta);
  const activeThreadId = useConsoleStore((state) => state.activeThreadId);
  const selectThread = useConsoleStore((state) => state.selectThread);
  const newThread = useConsoleStore((state) => state.newThread);

  const needle = search.trim().toLowerCase();
  const visible = threadOrder.filter(
    (id) => !needle || (threadMeta[id]?.title ?? '').toLowerCase().includes(needle),
  );

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-11 shrink-0 items-center px-3">
        <span className="text-sm font-medium tracking-tight">agent console</span>
      </div>

      <ProjectHeader />

      {environment ? (
        <>
          <div className="flex shrink-0 items-center gap-1 px-2 pb-1">
            <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-muted focus-within:bg-white/5 hover:bg-white/5">
              <Search className="size-4 shrink-0 opacity-80" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search"
                aria-label="Search threads"
                className="min-w-0 flex-1 bg-transparent text-sm font-medium text-fg placeholder:text-muted focus:outline-none"
              />
              {search ? (
                <button
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="shrink-0 rounded p-0.5 hover:text-fg"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </label>
            <IconButton onClick={newThread} aria-label="New thread" title="New thread">
              <SquarePen className="size-4" />
            </IconButton>
          </div>

          <div className="min-h-0 flex-1 space-y-px overflow-auto px-2 pb-2">
            {visible.map((id) => (
              <ThreadRow
                key={id}
                threadId={id}
                repoName={repoName(environment.repoPath)}
                active={id === activeThreadId}
                onSelect={() => selectThread(id)}
              />
            ))}
            {visible.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted">No threads found</p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

const STATUS_LABELS: Record<ThreadStatus, string | null> = {
  idle: null,
  working: 'Working',
  'needs-permission': 'Approval',
};

const STATUS_TEXT: Record<ThreadStatus, string> = {
  idle: 'text-muted',
  working: 'text-sky-400',
  'needs-permission': 'text-amber-300',
};

function ThreadRow({
  threadId,
  repoName,
  active,
  onSelect,
}: {
  threadId: string;
  repoName: string;
  active: boolean;
  onSelect(): void;
}) {
  const meta = useConsoleStore((state) => state.threadMeta[threadId]);
  const status = useConsoleStore((state) => threadStatus(state.threads[threadId]));
  if (!meta) return null;

  const label = STATUS_LABELS[status];

  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full cursor-pointer rounded-lg px-2.5 py-2 text-left transition-colors',
        active ? 'bg-white/[0.09]' : 'hover:bg-white/[0.055]',
      )}
    >
      <div className="flex h-5 min-w-0 items-center gap-1.5">
        {status === 'working' ? (
          <Spinner className="size-3.5 text-sky-400" />
        ) : (
          <Dot status={status} />
        )}
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            active ? 'font-medium text-fg' : 'text-fg/90',
          )}
        >
          {meta.title}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted">
          {relativeTime(meta.createdAt)}
        </span>
      </div>

      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
        <Folder className="size-3 shrink-0 text-muted/60" />
        <span className="min-w-0 flex-1 truncate text-muted/70">{repoName}</span>
        {label ? (
          <span className={cn('shrink-0 font-medium', STATUS_TEXT[status])}>{label}</span>
        ) : null}
      </div>
    </button>
  );
}

/** Compact project card: folder name as the title, full path underneath. */
function ProjectHeader() {
  const environment = useConsoleStore((state) => state.environment);
  const openEnvironment = useConsoleStore((state) => state.openEnvironment);
  const closeEnvironment = useConsoleStore((state) => state.closeEnvironment);

  const [repoPath, setRepoPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/environments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoPath }),
      });
      const body = (await response.json()) as
        | { id: string; url: string; token: string }
        | { error: string };
      if (!response.ok || !('id' in body)) {
        throw new Error('error' in body ? body.error : 'Could not open the environment');
      }
      openEnvironment({ ...body, repoPath: repoPath.trim() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (!environment) return;
    setBusy(true);
    try {
      await fetch(`/api/environments/${environment.id}`, { method: 'DELETE' });
    } finally {
      closeEnvironment();
      setBusy(false);
    }
  }

  if (environment) {
    return (
      <div className="mx-2 mb-1 flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5">
        <Dot status={environment.status === 'idle' ? 'connecting' : environment.status} />
        <span className="min-w-0 flex-1" title={environment.repoPath}>
          <span className="block truncate text-sm font-medium text-fg">
            {repoName(environment.repoPath)}
          </span>
          <span className="block truncate text-[11px] text-muted/70">{environment.repoPath}</span>
        </span>
        <IconButton
          onClick={() => void close()}
          disabled={busy}
          aria-label="Close project"
          title="Close project"
          className="size-6"
        >
          <X className="size-3.5" />
        </IconButton>
      </div>
    );
  }

  return (
    <div className="shrink-0 space-y-2 px-3 py-2">
      <PreflightNotice />
      <input
        value={repoPath}
        onChange={(event) => setRepoPath(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && repoPath.trim() && !busy) void open();
        }}
        placeholder="Repository path"
        className="h-8 w-full rounded-lg border border-line bg-raised px-2 text-xs placeholder:text-muted focus:border-accent focus:outline-none"
      />
      <Button
        variant="primary"
        className="w-full"
        onClick={() => void open()}
        disabled={busy || !repoPath.trim()}
      >
        {busy ? 'Opening…' : 'Open'}
      </Button>
      {error ? <p className="text-[11px] text-danger">{error}</p> : null}
    </div>
  );
}

/** Tells the user Claude Code is missing or logged out before they try to open a project. */
function PreflightNotice() {
  const [state, setState] = useState<Preflight | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/preflight')
      .then((response) => response.json() as Promise<Preflight>)
      .then((body) => {
        if (live) setState(body);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!state || state.agent !== 'claude') return null;

  if (!state.claudeBinary) {
    return (
      <div className="space-y-1 rounded-lg border border-line bg-raised p-2 text-[11px]">
        <p className="text-danger">Claude Code is not installed.</p>
        <p className="text-muted">Windows:</p>
        <code className="block break-all text-fg/80">irm https://claude.ai/install.ps1 | iex</code>
        <p className="text-muted">macOS/Linux:</p>
        <code className="block break-all text-fg/80">
          curl -fsSL https://claude.ai/install.sh | bash
        </code>
        <p className="text-muted">
          then run <code className="text-fg/80">claude</code> once to log in
        </p>
      </div>
    );
  }

  if (state.loggedIn === false) {
    return (
      <div className="space-y-1 rounded-lg border border-line bg-raised p-2 text-[11px]">
        <p className="text-danger">Claude Code is not logged in.</p>
        <p className="text-muted">
          Run <code className="text-fg/80">claude</code> in a terminal and complete the login.
        </p>
      </div>
    );
  }

  return null;
}

function repoName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
