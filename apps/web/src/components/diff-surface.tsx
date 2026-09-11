'use client';

import type { DiffFile, ResponseData } from '@agent-console/contracts';
import { ChevronsDownUp, ChevronsUpDown, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseUnifiedDiff } from '@/lib/parse-unified-diff';
import type { RunnerClient } from '@/lib/runner-client';
import { useThread } from '@/store/use-console-store';
import { usePanelStore } from '@/store/use-panel-store';
import { FileDiff } from './file-diff';
import { DiffStat, EmptyState, IconButton, PaneHeader, Picker, Spinner } from './ui';

type Props = {
  client: RunnerClient | null;
  threadId: string | null;
};

const SCOPES = [
  { id: 'turn', label: 'This turn' },
  { id: 'tree', label: 'Working tree' },
];

/** One stable empty list, so the memos below do not see a new array every render. */
const NONE: DiffFile[] = [];

type TreeDiff = { nonce: number; files: DiffFile[]; error?: string };

/** The Diff tab: a frozen turn diff from the thread state, or the live working tree. */
export function DiffSurface({ client, threadId }: Props) {
  const { turns } = useThread(threadId);
  const scope = usePanelStore((state) => state.diffScope);
  const diffTurn = usePanelStore((state) => state.diffTurn);
  const focusPath = usePanelStore((state) => state.focusPath);
  const { setDiffScope, setDiffTurn, clearFocus } = usePanelStore.getState();

  const [collapsed, setCollapsed] = useState<string[]>([]);
  // Bumped by Refresh; the load effect keys off it, and the answer carries it back so
  // "still loading" is derived rather than a second piece of state.
  const [nonce, setNonce] = useState(0);
  const [tree, setTree] = useState<TreeDiff | null>(null);

  const withDiff = useMemo(() => turns.filter((candidate) => candidate.files.length > 0), [turns]);
  const turn = useMemo(
    () => withDiff.find((candidate) => candidate.index === diffTurn) ?? withDiff.at(-1),
    [withDiff, diffTurn],
  );
  const files = useMemo(
    () => (scope === 'tree' ? (tree?.files ?? NONE) : (turn?.files ?? NONE)),
    [scope, tree, turn],
  );
  const stat = useMemo(() => totals(files), [files]);
  const loading = scope === 'tree' && tree?.nonce !== nonce;
  const error = scope === 'tree' ? tree?.error : undefined;

  // The working tree drifts, so it is read on activation and on Refresh; the previous
  // list stays on screen while the new one loads.
  useEffect(() => {
    if (scope !== 'tree' || !client) return;
    let live = true;
    void client
      .request({ type: 'get_diff' })
      .then((data) => {
        if (live) setTree({ nonce, files: diffFiles(data) });
      })
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        // Keep whatever was on screen; only the message is new.
        if (live) setTree((current) => ({ nonce, files: current?.files ?? NONE, error: message }));
      });
    return () => {
      live = false;
    };
  }, [scope, client, nonce]);

  const rows = useRef(new Map<string, HTMLDivElement | null>());
  useEffect(() => {
    if (!focusPath) return;
    const row = rows.current.get(focusPath);
    // Not in this scope's list (yet); the effect runs again when the files change.
    if (!row) return;
    setCollapsed((paths) => paths.filter((path) => path !== focusPath));
    row.scrollIntoView({ block: 'start' });
    clearFocus();
  }, [focusPath, files, clearFocus]);

  const allCollapsed = files.length > 0 && files.every((file) => collapsed.includes(file.path));

  const toggleFile = useCallback((path: string) => {
    setCollapsed((paths) =>
      paths.includes(path) ? paths.filter((value) => value !== path) : [...paths, path],
    );
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PaneHeader>
        <Picker
          label="Diff scope"
          value={scope}
          options={SCOPES}
          onChange={(id) => setDiffScope(id === 'tree' ? 'tree' : 'turn')}
        />

        {scope === 'turn' && withDiff.length > 0 ? (
          <Picker
            label="Turn"
            value={String(turn?.index ?? '')}
            options={withDiff.map((candidate) => ({
              id: String(candidate.index),
              label: `Turn ${candidate.index + 1}`,
            }))}
            onChange={(id) => setDiffTurn(Number(id))}
          />
        ) : null}

        <span className="ml-auto flex shrink-0 items-center gap-1">
          {loading ? <Spinner className="mr-1 text-muted-foreground" /> : null}
          {files.length > 0 ? (
            <DiffStat added={stat.added} removed={stat.removed} className="mr-1 text-[11px]" />
          ) : null}
          {scope === 'tree' ? (
            <IconButton
              onClick={() => setNonce((value) => value + 1)}
              aria-label="Refresh the diff"
              title="Refresh"
            >
              <RefreshCw className="size-3.5" />
            </IconButton>
          ) : null}
          {files.length > 0 ? (
            <IconButton
              onClick={() => setCollapsed(allCollapsed ? [] : files.map((file) => file.path))}
              aria-label={allCollapsed ? 'Expand all files' : 'Collapse all files'}
              title={allCollapsed ? 'Expand all files' : 'Collapse all files'}
            >
              {allCollapsed ? (
                <ChevronsUpDown className="size-3.5" />
              ) : (
                <ChevronsDownUp className="size-3.5" />
              )}
            </IconButton>
          ) : null}
        </span>
      </PaneHeader>

      <div className="min-h-0 flex-1 overflow-auto">
        {files.map((file) => (
          <div
            key={file.path}
            ref={(element) => {
              rows.current.set(file.path, element);
            }}
          >
            <FileDiff
              file={file}
              open={!collapsed.includes(file.path)}
              onToggle={() => toggleFile(file.path)}
            />
          </div>
        ))}

        {files.length > 0 || loading ? null : (
          <EmptyState>
            {error ??
              (scope === 'tree'
                ? 'Working tree is clean.'
                : 'No changes yet. Run a turn to see a diff.')}
          </EmptyState>
        )}
      </div>
    </div>
  );
}

/** `get_diff` is the only response with files that carries no path. */
function diffFiles(data: ResponseData): DiffFile[] {
  return 'files' in data && !('path' in data) ? data.files : [];
}

function totals(files: DiffFile[]): { added: number; removed: number } {
  return files.reduce(
    (stat, file) => {
      const { added, removed } = parseUnifiedDiff(file.patch);
      return { added: stat.added + added, removed: stat.removed + removed };
    },
    { added: 0, removed: 0 },
  );
}
