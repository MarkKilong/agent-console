'use client';

import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';
import { useThread } from '@/store/use-console-store';
import { FileDiff } from './file-diff';
import { DiffStat, EmptyState, IconButton, PaneHeader } from './ui';

type Props = {
  threadId: string | null;
  /** Index of the turn to show; falls back to the latest one. */
  selectedTurn: number | null;
  onSelectTurn(turnIndex: number): void;
};

export function DiffPane({ threadId, selectedTurn, onSelectTurn }: Props) {
  const { turns } = useThread(threadId);
  const [collapsed, setCollapsed] = useState<string[]>([]);

  const withDiff = turns.filter((turn) => turn.files.length > 0);
  const turn = withDiff.find((candidate) => candidate.index === selectedTurn) ?? withDiff.at(-1);
  const allCollapsed = Boolean(turn?.files.every((file) => collapsed.includes(file.path)));

  function toggleAll() {
    setCollapsed(allCollapsed ? [] : (turn?.files.map((file) => file.path) ?? []));
  }

  function toggleFile(path: string) {
    setCollapsed((paths) =>
      paths.includes(path) ? paths.filter((value) => value !== path) : [...paths, path],
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PaneHeader>
        <span className="shrink-0 font-medium text-fg">Diff</span>

        {withDiff.length > 0 ? (
          <span className="relative inline-flex h-6 items-center rounded-md bg-white/6 text-xs font-medium text-fg hover:bg-white/10">
            <select
              value={turn?.index ?? ''}
              onChange={(event) => onSelectTurn(Number(event.target.value))}
              aria-label="Turn"
              className="h-6 cursor-pointer appearance-none bg-transparent pr-6 pl-2 focus:outline-none"
            >
              {withDiff.map((candidate) => (
                <option key={candidate.index} value={candidate.index} className="bg-panel">
                  Turn {candidate.index + 1}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-1.5 size-3.5 opacity-70" />
          </span>
        ) : null}

        {turn ? (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <DiffStat added={turn.added} removed={turn.removed} className="mr-1 text-[11px]" />
            <IconButton
              onClick={toggleAll}
              aria-label={allCollapsed ? 'Expand all files' : 'Collapse all files'}
              title={allCollapsed ? 'Expand all files' : 'Collapse all files'}
            >
              {allCollapsed ? (
                <ChevronsUpDown className="size-3.5" />
              ) : (
                <ChevronsDownUp className="size-3.5" />
              )}
            </IconButton>
          </span>
        ) : null}
      </PaneHeader>

      <div className="min-h-0 flex-1 overflow-auto">
        {turn ? (
          turn.files.map((file) => (
            <FileDiff
              key={file.path}
              file={file}
              open={!collapsed.includes(file.path)}
              onToggle={() => toggleFile(file.path)}
            />
          ))
        ) : (
          <EmptyState>No changes yet. Run a turn to see a diff.</EmptyState>
        )}
      </div>
    </div>
  );
}
