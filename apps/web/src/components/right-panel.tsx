'use client';

import { FileDiff, FolderTree, Plus, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { RunnerClient } from '@/lib/runner-client';
import { useLayoutStore, type Surface } from '@/store/use-layout-store';
import { DiffSurface } from './diff-surface';
import { FilesSurface } from './files-surface';
import { IconButton } from './ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

const SURFACES = {
  files: { label: 'Files', icon: FolderTree },
  diff: { label: 'Diff', icon: FileDiff },
} as const;

const ORDER: Surface[] = ['files', 'diff'];

/** Section C: a tab strip over one surface at a time. The hidden surface unmounts. */
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2">
        {tabs.map((tab) => (
          <Tab
            key={tab}
            surface={tab}
            active={tab === activeTab}
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
            {ORDER.map((surface) => {
              const { label, icon: Icon } = SURFACES[surface];
              return (
                <DropdownMenuItem key={surface} onSelect={() => openTab(surface)}>
                  <Icon className="size-3.5" strokeWidth={1.8} />
                  {label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="min-h-0 flex-1">
        {activeTab === 'files' ? <FilesSurface client={client} /> : null}
        {activeTab === 'diff' ? <DiffSurface client={client} threadId={threadId} /> : null}
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
  const { label, icon: Icon } = SURFACES[surface];

  return (
    <div
      className={cn(
        'group flex h-7 shrink-0 items-center gap-1 rounded-md pr-1 pl-2 text-xs transition-colors',
        active ? 'bg-white/[0.09] text-fg' : 'text-muted-foreground hover:bg-white/5',
      )}
    >
      <button onClick={onActivate} className="flex cursor-pointer items-center gap-1.5">
        <Icon className="size-3.5" strokeWidth={1.8} />
        {label}
      </button>
      <button
        onClick={onClose}
        aria-label={`Close ${label}`}
        title={`Close ${label}`}
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
