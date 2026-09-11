'use client';

import { ChevronRight, CornerLeftUp, Folder, FolderPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  createCloneFolder,
  listCloneFolders,
  listFolders,
  type FolderEntry,
  type FolderListing,
} from '@/lib/project-source';
import { Spinner } from './ui';
import { Button } from './ui/button';
import { Input } from './ui/input';

const ROW_CLASS =
  'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-white/[0.09]';

const CHIP_CLASS =
  'cursor-pointer rounded-md bg-white/6 px-2 py-0.5 text-[11px] transition-colors hover:bg-white/10';

type Props = { start: string; scope?: 'any' | 'clone'; onPick(path: string): void };

/**
 * Walks the machine's folders so a path can be picked instead of typed. In `clone` scope it
 * walks only the clone root, and can make a subfolder of it.
 */
export function FolderBrowser({ start, scope = 'any', onPick }: Props) {
  const rooted = scope === 'clone';
  const [at, setAt] = useState(start);
  const [listing, setListing] = useState<FolderListing | null>(null);
  // Outlives a failed listing, so the chips are still a way out of a folder that vanished.
  const [roots, setRoots] = useState<FolderEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const list = rooted ? listCloneFolders : listFolders;
    void (async () => {
      setLoading(true);
      try {
        const next = await list(at);
        if (cancelled) return;
        setListing(next);
        setRoots(next.roots);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setListing(null);
        setError(cause instanceof Error ? cause.message : String(cause));
        const fallback = await list().catch(() => null);
        if (!cancelled && fallback) setRoots(fallback.roots);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [at, rooted]);

  // Without a listing there is no parent to read, so the path itself has to give one up.
  const up = listing ? listing.parent : rooted ? null : parentOf(at);

  return (
    <div className="rounded-lg border border-line bg-raised/40">
      <div className="flex items-center gap-2 border-b border-line px-2 py-1.5">
        <span
          className="truncate font-mono text-[11px] text-muted-foreground"
          title={listing?.path}
        >
          {listing?.path ?? at}
        </span>
        {loading ? <Spinner className="ml-auto text-muted-foreground" /> : null}
      </div>

      {roots.length ? (
        <div className="flex flex-wrap gap-1 border-b border-line px-2 py-1.5">
          {roots.map((root) => (
            <button key={root.path} onClick={() => setAt(root.path)} className={CHIP_CLASS}>
              {root.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="max-h-52 overflow-y-auto p-1">
        {up ? (
          <button onClick={() => setAt(up)} className={ROW_CLASS}>
            <CornerLeftUp className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">Up one level</span>
          </button>
        ) : null}

        {/* Keyed by folder, so moving on leaves no half-typed name behind. */}
        {rooted && listing ? (
          <NewFolderRow
            key={listing.path}
            parent={listing.path}
            onCreated={(entry) => setAt(entry.path)}
          />
        ) : null}

        {listing?.entries.map((entry) => (
          <button key={entry.path} onClick={() => setAt(entry.path)} className={ROW_CLASS}>
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{entry.name}</span>
            <ChevronRight className="ml-auto size-3.5 shrink-0 text-muted-foreground/60" />
          </button>
        ))}

        {listing && !listing.entries.length && !up ? (
          <p className="px-2 py-2 text-xs text-muted-foreground/70">No folders here</p>
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-2 py-1.5">
        {error ? <span className="truncate text-xs text-danger">{error}</span> : null}
        <Button
          size="xs"
          variant="secondary"
          className="ml-auto"
          disabled={!listing}
          onClick={() => listing && onPick(listing.path)}
        >
          Use this folder
        </Button>
      </div>
    </div>
  );
}

function NewFolderRow({ parent, onCreated }: { parent: string; onCreated(e: FolderEntry): void }) {
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name?.trim()) return;
    try {
      onCreated(await createCloneFolder(parent, name));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  if (name === null) {
    return (
      <button onClick={() => setName('')} className={ROW_CLASS}>
        <FolderPlus className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">New folder</span>
      </button>
    );
  }

  return (
    <div className="space-y-1 px-2 py-1">
      <Input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void create();
          if (event.key !== 'Escape') return;
          // Escape here cancels the input; the dialog's own handler would close the dialog.
          event.nativeEvent.stopImmediatePropagation();
          setName(null);
          setError(null);
        }}
        placeholder="New folder name"
        className="h-6 text-xs"
      />
      {error ? <p className="truncate text-[11px] text-danger">{error}</p> : null}
    </div>
  );
}

/** The folder above one that could not be opened, so a bad path is never a dead end. */
function parentOf(path: string): string | null {
  const trimmed = path.trim().replace(/[\\/]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return cut > 0 ? trimmed.slice(0, cut) : null;
}
