'use client';

import {
  Bot,
  Check,
  ChevronDown,
  Folder,
  FolderPlus,
  GitBranch,
  PanelLeft,
  Plus,
  Search,
  Settings,
  SquarePen,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useState, type SyntheticEvent } from 'react';
import { cn } from '@/lib/cn';
import { closeProject, openProject } from '@/lib/open-project';
import { relativeTime } from '@/lib/relative-time';
import type { RunnerClient } from '@/lib/runner-client';
import { threadStatus, type ThreadStatus } from '@/store/thread-state';
import { useConsoleStore } from '@/store/use-console-store';
import { useLayoutStore } from '@/store/use-layout-store';
import { useActiveProject, useProjectsStore, type Project } from '@/store/use-projects-store';
import { ClaudeMark } from './claude-mark';
import { ICON_BUTTON_CLASS, IconButton, Spinner } from './ui';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

type Props = {
  client: RunnerClient | null;
  /** Reported by the shell when the persisted project could not be reopened. */
  error: string | null;
  onAddProject(): void;
};

export function ThreadsSidebar({ client, error, onAddProject }: Props) {
  const [search, setSearch] = useState('');

  const toggleSidebar = useLayoutStore((state) => state.toggleSidebar);
  const projects = useProjectsStore((state) => state.projects);
  const newThread = useConsoleStore((state) => state.newThread);

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-11 shrink-0 items-center gap-1 px-2">
        <IconButton onClick={toggleSidebar} aria-label="Hide sidebar" title="Hide sidebar">
          <PanelLeft className="size-4" />
        </IconButton>
        <span className="text-sm font-medium tracking-tight">agent console</span>
      </div>

      <div className="flex shrink-0 items-center gap-1 px-2 pb-1">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-muted-foreground focus-within:bg-white/5 hover:bg-white/5">
          <Search className="size-4 shrink-0 opacity-80" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search"
            aria-label="Search threads"
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-fg placeholder:text-muted-foreground focus:outline-none"
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
        <IconButton
          onClick={newThread}
          disabled={!client}
          aria-label="New thread"
          title="New thread"
        >
          <SquarePen className="size-4" />
        </IconButton>
        <IconButton onClick={onAddProject} aria-label="Add project" title="Add project">
          <FolderPlus className="size-4" />
        </IconButton>
      </div>

      {projects.length > 0 ? (
        <div className="shrink-0 px-2 pb-1">
          <ProjectSelector onAddProject={onAddProject} />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {error ? <p className="px-2.5 py-2 text-[11px] text-danger">{error}</p> : null}
        {projects.length === 0 ? (
          <div className="space-y-2 px-2 py-6 text-center">
            <p className="text-xs text-muted-foreground/70">No projects yet</p>
            <Button variant="ghost" size="sm" onClick={onAddProject}>
              <Plus />
              Add project
            </Button>
          </div>
        ) : (
          <ThreadList search={search} />
        )}
      </div>

      <div className="flex h-11 shrink-0 items-center border-t border-line px-2">
        <Link
          href="/settings/providers"
          aria-label="Settings"
          title="Settings"
          className={ICON_BUTTON_CLASS}
        >
          <Settings className="size-4" />
        </Link>
      </div>
    </div>
  );
}

const stopEvent = (event: SyntheticEvent) => event.stopPropagation();

/** The open project, with switching, removing and adding all living in its menu. */
function ProjectSelector({ onAddProject }: { onAddProject(): void }) {
  const projects = useProjectsStore((state) => state.projects);
  const removeProject = useProjectsStore((state) => state.removeProject);
  const active = useActiveProject();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function select(project: Project) {
    if (project.id === active?.id || busy) return;
    setBusy(true);
    setError(null);
    try {
      await openProject(project);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(project: Project) {
    if (project.id === active?.id) await closeProject();
    removeProject(project.id);
  }

  return (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-8 w-full justify-between px-2 text-left"
            aria-label="Switch project"
          >
            <span className="flex min-w-0 items-center gap-2">
              {busy ? (
                <Spinner className="size-4 text-sky-400" />
              ) : (
                <Folder className="size-4 text-muted-foreground/60" />
              )}
              <span className="min-w-0 truncate" title={active?.repoPath}>
                {active?.name ?? 'No project'}
              </span>
            </span>
            <ChevronDown className="size-4 text-muted-foreground/60" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent>
          {projects.map((project) => (
            <DropdownMenuItem key={project.id} onSelect={() => void select(project)}>
              <Folder className="size-3.5 text-muted-foreground/60" />
              <span className="min-w-0 flex-1 truncate" title={project.repoPath}>
                {project.name}
              </span>
              {project.id === active?.id ? <Check className="size-3.5" /> : null}
              <IconButton
                onPointerDown={stopEvent}
                onPointerUp={stopEvent}
                onClick={(event) => {
                  event.stopPropagation();
                  void remove(project);
                }}
                aria-label={`Remove ${project.name}`}
                title="Remove from the list"
                className="size-5 opacity-0 group-focus/dropdown-menu-item:opacity-100 group-hover/dropdown-menu-item:opacity-100"
              >
                <X className="size-3" />
              </IconButton>
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onAddProject}>
            <Plus className="size-3.5" />
            Add project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {error ? <p className="px-2.5 pt-1 text-[11px] text-danger">{error}</p> : null}
    </div>
  );
}

function ThreadList({ search }: { search: string }) {
  // Every listed thread belongs to the open project, so its name is the same on each card.
  const project = useActiveProject();
  const threadOrder = useConsoleStore((state) => state.threadOrder);
  const threadMeta = useConsoleStore((state) => state.threadMeta);
  const activeThreadId = useConsoleStore((state) => state.activeThreadId);
  const selectThread = useConsoleStore((state) => state.selectThread);

  const needle = search.trim().toLowerCase();
  const visible = threadOrder.filter(
    (id) => !needle || (threadMeta[id]?.title ?? '').toLowerCase().includes(needle),
  );

  if (visible.length === 0) {
    return (
      <p className="px-2 py-3 text-center text-xs text-muted-foreground">
        {needle ? 'No threads found' : 'No threads yet'}
      </p>
    );
  }

  return (
    <div className="mt-1 space-y-1">
      {visible.map((id) => (
        <ThreadCard
          key={id}
          threadId={id}
          projectName={project?.name ?? ''}
          active={id === activeThreadId}
          onSelect={() => selectThread(id)}
        />
      ))}
    </div>
  );
}

const STATUS_LABELS: Record<ThreadStatus, string | null> = {
  idle: null,
  working: 'Working',
  'needs-permission': 'Approval',
};

const STATUS_TEXT: Record<ThreadStatus, string> = {
  idle: 'text-muted-foreground',
  working: 'text-sky-400',
  'needs-permission': 'text-amber-300',
};

function ThreadCard({
  threadId,
  projectName,
  active,
  onSelect,
}: {
  threadId: string;
  projectName: string;
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
        'flex w-full cursor-pointer flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors',
        active ? 'bg-white/[0.09]' : 'hover:bg-white/[0.055]',
      )}
    >
      <div className="flex w-full min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Folder className="size-3 shrink-0" />
          <span className="truncate">{projectName}</span>
        </span>
        {label ? (
          <span
            className={cn(
              'flex shrink-0 items-center gap-1 text-xs font-medium',
              STATUS_TEXT[status],
            )}
          >
            {status === 'working' ? <Spinner className="size-3 text-sky-400" /> : null}
            {label}
          </span>
        ) : (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {relativeTime(meta.createdAt)}
          </span>
        )}
      </div>

      <span className={cn('w-full truncate text-sm text-fg', active && 'font-medium')}>
        {meta.title}
      </span>

      <div className="flex w-full min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {meta.branch ? (
            <>
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate">{meta.branch}</span>
            </>
          ) : null}
        </span>
        {meta.agent === 'claude' ? (
          <ClaudeMark className="size-3.5" />
        ) : (
          <Bot className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </div>
    </button>
  );
}
