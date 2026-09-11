'use client';

import { FileDiff, FolderTree, Plus, Terminal as TerminalIcon, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { RunnerClient } from '@/lib/runner-client';
import { nextTitle, surfaceKey, useLayoutStore, type Surface } from '@/store/use-layout-store';
import { DiffSurface } from './diff-surface';
import { FilesSurface } from './files-surface';
import { TerminalSurface } from './terminal-surface';
import { IconButton } from './ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

const ICONS = {
  files: FolderTree,
  diff: FileDiff,
  terminal: TerminalIcon,
} as const;

const SINGLETONS: Surface[] = [{ kind: 'files' }, { kind: 'diff' }];

/**
 * Section C: a tab strip over one surface at a time. Files and Diff unmount when hidden;
 * terminals stay mounted, because disposing an xterm would take its shell down with it.
 */
export function RightPanel({
  client,
  threadId,
}: {
  client: RunnerClient | null;
  threadId: string | null;
}) {
  const tabs = useLayoutStore((state) => state.tabs);
  const activeTab = useLayoutStore((state) => state.activeTab);
  const openTab = useLayoutStore((state) => state.openTab);
  const closeTab = useLayoutStore((state) => state.closeTab);
  const defaultShell = useLayoutStore((state) => state.defaultShell);

  const activeKey = activeTab ? surfaceKey(activeTab) : null;
  const terminals = tabs.filter((tab) => tab.kind === 'terminal');

  // The shell the user set as default, unless this machine has no such shell installed.
  const openTerminal = () => {
    const shells = client?.shells ?? [];
    const chosen = shells.find((option) => option.kind === defaultShell) ?? shells[0];
    const shell = chosen?.kind ?? 'default';
    openTab({
      kind: 'terminal',
      id: tabId(),
      title: nextTitle(tabs, shell, chosen?.title),
      shell,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2">
        {tabs.map((tab) => (
          <Tab
            key={surfaceKey(tab)}
            surface={tab}
            active={surfaceKey(tab) === activeKey}
            onActivate={() => openTab(tab)}
            onClose={() => closeTab(tab)}
          />
        ))}

        <span className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label="Add a surface" title="Add a surface">
              <Plus className="size-4" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto">
            {SINGLETONS.map((surface) => {
              const Icon = ICONS[surface.kind];
              return (
                <DropdownMenuItem key={surface.kind} onSelect={() => openTab(surface)}>
                  <Icon className="size-3.5" strokeWidth={1.8} />
                  {label(surface)}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuItem onSelect={openTerminal}>
              <TerminalIcon className="size-3.5" strokeWidth={1.8} />
              Terminal
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="min-h-0 flex-1">
        {activeKey === 'files' ? <FilesSurface client={client} /> : null}
        {activeKey === 'diff' ? <DiffSurface client={client} threadId={threadId} /> : null}
        {terminals.map((tab) => (
          <TerminalSurface
            key={tab.id}
            client={client}
            tabId={tab.id}
            shell={tab.shell}
            hidden={surfaceKey(tab) !== activeKey}
          />
        ))}
      </div>
    </div>
  );
}

function Tab({
  surface,
  active,
  onActivate,
  onClose,
}: {
  surface: Surface;
  active: boolean;
  onActivate(): void;
  onClose(): void;
}) {
  const Icon = ICONS[surface.kind];
  const text = label(surface);

  return (
    <div
      className={cn(
        'group flex h-7 shrink-0 items-center gap-1 rounded-md pr-1 pl-2 text-xs transition-colors',
        active ? 'bg-white/[0.09] text-fg' : 'text-muted-foreground hover:bg-white/5',
      )}
    >
      <button onClick={onActivate} className="flex cursor-pointer items-center gap-1.5">
        <Icon className="size-3.5" strokeWidth={1.8} />
        {text}
      </button>
      <button
        onClick={onClose}
        aria-label={`Close ${text}`}
        title={`Close ${text}`}
        className={cn(
          'flex size-4 cursor-pointer items-center justify-center rounded text-muted-foreground transition-opacity hover:text-fg group-hover:opacity-100',
          active ? 'opacity-100' : 'opacity-0',
        )}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function label(surface: Surface): string {
  if (surface.kind === 'terminal') return surface.title;
  return surface.kind === 'files' ? 'Files' : 'Diff';
}

function tabId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `terminal-${Math.random().toString(36).slice(2)}`;
}
