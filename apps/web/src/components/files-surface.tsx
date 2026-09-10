'use client';

import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  File,
  FileCode,
  Folder,
  FolderOpen,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { cn } from '@/lib/cn';
import { buildTree, filterTree, folderPaths, type FileNode } from '@/lib/file-tree';
import { highlightLines, languageForPath, type Token } from '@/lib/highlight';
import type { RunnerClient } from '@/lib/runner-client';
import { useConsoleStore } from '@/store/use-console-store';
import { usePanelStore } from '@/store/use-panel-store';
import { CopyButton, EmptyState, IconButton, PaneHeader, Spinner } from './ui';
import { Input } from './ui/input';

/** A very long file would freeze the viewer, and nobody reads past this anyway. */
const MAX_LINES = 5000;

/** The Files tab: the repo tree on top, a read-only view of the chosen file below. */
export function FilesSurface({ client }: { client: RunnerClient | null }) {
  const envId = useConsoleStore((state) => state.environment?.id);
  const connected = useConsoleStore((state) => state.environment?.status === 'open');
  const files = usePanelStore((state) => state.files);
  const loading = usePanelStore((state) => state.filesLoading);
  const filesPath = usePanelStore((state) => state.filesPath);
  const error = usePanelStore((state) => state.filesError);
  const { openFile, startFilesLoad, finishFilesLoad } = usePanelStore.getState();

  const [needle, setNeedle] = useState('');
  const [open, setOpen] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!client || !envId) return;
    startFilesLoad(envId);
    try {
      const data = await client.request({ type: 'list_files' });
      finishFilesLoad('path' in data && 'files' in data ? data.files : []);
    } catch (cause) {
      finishFilesLoad(null, cause instanceof Error ? cause.message : String(cause));
    }
  }, [client, envId, startFilesLoad, finishFilesLoad]);

  // Once per environment, and only over an open socket: a request fired while the socket is
  // still connecting fails, so wait for it and try again after a reconnect if nothing loaded.
  useEffect(() => {
    if (!envId || !connected) return;
    const { filesEnvId, files: loaded } = usePanelStore.getState();
    if (filesEnvId === envId && loaded !== null) return;
    void load();
  }, [envId, connected, load]);

  const tree = useMemo(() => buildTree(files ?? []), [files]);
  const shown = useMemo(() => filterTree(tree, needle), [tree, needle]);
  // A filter is only useful with its matches in view, so it opens everything it kept.
  const expanded = useMemo(
    () => new Set(needle.trim() ? folderPaths(shown) : open),
    [needle, shown, open],
  );
  const allOpen = useMemo(() => {
    const folders = folderPaths(tree);
    return folders.length > 0 && folders.every((path) => open.includes(path));
  }, [tree, open]);

  const toggleFolder = useCallback((path: string) => {
    setOpen((paths) =>
      paths.includes(path) ? paths.filter((value) => value !== path) : [...paths, path],
    );
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PaneHeader>
        <span className="relative flex min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
          <Input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setNeedle('');
            }}
            placeholder="Filter files"
            aria-label="Filter files"
            className="h-7 pl-7 text-xs"
          />
        </span>
        <IconButton onClick={() => void load()} aria-label="Refresh the file list" title="Refresh">
          <RefreshCw className="size-3.5" />
        </IconButton>
        <IconButton
          onClick={() => setOpen(allOpen ? [] : folderPaths(tree))}
          aria-label={allOpen ? 'Collapse all folders' : 'Expand all folders'}
          title={allOpen ? 'Collapse all' : 'Expand all'}
        >
          {allOpen ? (
            <ChevronsDownUp className="size-3.5" />
          ) : (
            <ChevronsUpDown className="size-3.5" />
          )}
        </IconButton>
      </PaneHeader>

      <Group orientation="vertical" className="min-h-0 flex-1">
        <Panel defaultSize="45" minSize="20" className="min-h-0 overflow-auto py-1">
          <Placeholder
            envId={envId}
            loading={loading}
            error={error}
            files={files}
            matches={shown.length}
          />
          <Nodes
            nodes={shown}
            depth={0}
            expanded={expanded}
            selected={filesPath}
            onToggle={toggleFolder}
            onSelect={openFile}
          />
        </Panel>
        <Separator className="h-px bg-line" />
        <Panel defaultSize="55" minSize="20" className="min-h-0">
          <Viewer client={client} path={filesPath} />
        </Panel>
      </Group>
    </div>
  );
}

function Placeholder({
  envId,
  loading,
  error,
  files,
  matches,
}: {
  envId: string | undefined;
  loading: boolean;
  error: string | null;
  files: string[] | null;
  matches: number;
}) {
  if (!envId) return <EmptyState>Open a project to browse its files.</EmptyState>;
  if (error) return <EmptyState>{error}</EmptyState>;
  if (loading && !files) {
    return (
      <div className="flex justify-center py-6 text-muted-foreground">
        <Spinner />
      </div>
    );
  }
  if (!files || files.length === 0) return <EmptyState>This project has no files.</EmptyState>;
  if (matches === 0) return <EmptyState>No files match.</EmptyState>;
  return null;
}

function Nodes({
  nodes,
  depth,
  expanded,
  selected,
  onToggle,
  onSelect,
}: {
  nodes: FileNode[];
  depth: number;
  expanded: Set<string>;
  selected: string | null;
  onToggle(path: string): void;
  onSelect(path: string): void;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === 'file') {
          const Icon = languageForPath(node.path) === 'text' ? File : FileCode;
          return (
            <Row
              key={node.path}
              depth={depth}
              selected={selected === node.path}
              onClick={() => onSelect(node.path)}
            >
              <span className="size-3.5 shrink-0" />
              <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
              <span className="min-w-0 truncate">{node.name}</span>
            </Row>
          );
        }

        const isOpen = expanded.has(node.path);
        return (
          <div key={node.path}>
            <Row depth={depth} selected={false} onClick={() => onToggle(node.path)}>
              {isOpen ? (
                <ChevronDown className="size-3.5 shrink-0" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0" />
              )}
              {isOpen ? (
                <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
              ) : (
                <Folder className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
              )}
              <span className="min-w-0 truncate">{node.name}</span>
            </Row>
            {isOpen ? (
              <Nodes
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                selected={selected}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function Row({
  depth,
  selected,
  onClick,
  children,
}: {
  depth: number;
  selected: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{ paddingLeft: 8 + depth * 12 }}
      className={cn(
        'flex h-6 w-full cursor-pointer items-center gap-1.5 pr-2 text-left text-xs',
        selected ? 'bg-white/[0.09] text-fg' : 'text-muted-foreground hover:bg-white/5',
      )}
    >
      {children}
    </button>
  );
}

/** Tagged with its path so "still loading" is derived, not a second piece of state. */
type ViewerState = { path: string; content?: string; error?: string };

function Viewer({ client, path }: { client: RunnerClient | null; path: string | null }) {
  const [read, setRead] = useState<ViewerState | null>(null);

  useEffect(() => {
    if (!client || !path) return;
    let live = true;
    void client
      .request({ type: 'read_file', path })
      .then((data) => {
        if (live) setRead({ path, content: 'content' in data ? data.content : '' });
      })
      .catch((cause: unknown) => {
        if (live) setRead({ path, error: cause instanceof Error ? cause.message : String(cause) });
      });
    return () => {
      live = false;
    };
  }, [client, path]);

  const state = read?.path === path ? read : undefined;
  const loading = Boolean(path) && !state;
  const lines = useMemo(() => (state?.content ?? '').split('\n'), [state?.content]);
  const capped = lines.length > MAX_LINES;
  const body = useMemo(() => (capped ? lines.slice(0, MAX_LINES) : lines), [capped, lines]);
  const tokens = useHighlight(body, path);

  if (!path) return <EmptyState>Pick a file to read it here.</EmptyState>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2.5 text-xs">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg">{path}</span>
        <CopyButton text={path} />
        {state?.content === undefined ? null : (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {lines.length} line{lines.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-[1.6]">
        {loading ? (
          <div className="flex justify-center py-6 text-muted-foreground">
            <Spinner />
          </div>
        ) : state?.error ? (
          <EmptyState>{state.error}</EmptyState>
        ) : (
          <>
            {body.map((line, index) => (
              <div key={index} className="flex w-max min-w-full">
                <span className="w-10 shrink-0 pr-2 text-right tabular-nums text-muted-foreground/60 select-none">
                  {index + 1}
                </span>
                <pre className="shrink-0 pr-3 whitespace-pre">
                  {tokens?.[index] ? (
                    tokens[index].map((token, key) => (
                      <span key={key} style={{ color: token.color }}>
                        {token.content}
                      </span>
                    ))
                  ) : (
                    <span>{line}</span>
                  )}
                </pre>
              </div>
            ))}
            {capped ? (
              <p className="px-3 py-2 font-sans text-[11px] text-muted-foreground">
                Showing the first {MAX_LINES.toLocaleString()} lines.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** Tokens are tagged with the code they came from, so the previous file cannot colour this one. */
function useHighlight(lines: string[], path: string | null): Token[][] | null {
  const [result, setResult] = useState<{ code: string; tokens: Token[][] } | null>(null);
  const language = path ? languageForPath(path) : 'text';
  const code = useMemo(() => lines.join('\n'), [lines]);

  useEffect(() => {
    if (language === 'text' || !code) return;
    let cancelled = false;
    void highlightLines(code, language).then((tokens) => {
      if (!cancelled) setResult({ code, tokens });
    });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  return result?.code === code ? result.tokens : null;
}
