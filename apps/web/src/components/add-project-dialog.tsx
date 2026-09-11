'use client';

import { ArrowLeft, CircleAlert, FolderPlus, Link as LinkIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { openProject } from '@/lib/open-project';
import {
  cloneRepository,
  defaultCloneParent,
  folderNameOf,
  inspectFolder,
  listCloneFolders,
  repoNameFromUrl,
  SourceError,
} from '@/lib/project-source';
import { useProjectsStore } from '@/store/use-projects-store';
import { FolderBrowser } from './folder-browser';
import { IconButton, Spinner } from './ui';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';

type Props = {
  open: boolean;
  onClose(): void;
};

type Step = 'sources' | 'local' | 'git';

const SOURCES = [
  { id: 'local', title: 'Local folder', subtitle: 'Browse a folder on disk', icon: FolderPlus },
  { id: 'git', title: 'Git URL', subtitle: 'Clone from a remote URL', icon: LinkIcon },
] as const;

/** Pick a source, then fill it in: a folder already here, or one cloned from a URL. */
export function AddProjectDialog({ open, onClose }: Props) {
  const [step, setStep] = useState<Step>('sources');
  const [prefill, setPrefill] = useState('');

  function close() {
    setStep('sources');
    setPrefill('');
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="gap-0 p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Add project</DialogTitle>
        {step === 'sources' ? <SourceList onPick={setStep} onClose={close} /> : null}
        {step === 'local' ? (
          <LocalForm start={prefill} onBack={() => setStep('sources')} onDone={close} />
        ) : null}
        {step === 'git' ? (
          <GitForm
            onBack={() => setStep('sources')}
            onDone={close}
            onLocalInstead={(path) => {
              setPrefill(path);
              setStep('local');
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SourceList({ onPick, onClose }: { onPick(step: Step): void; onClose(): void }) {
  const [search, setSearch] = useState('');
  const [index, setIndex] = useState(0);

  const query = search.trim().toLowerCase();
  const rows = SOURCES.filter(
    (source) =>
      !query ||
      source.title.toLowerCase().includes(query) ||
      source.subtitle.toLowerCase().includes(query),
  );
  const active = Math.min(index, Math.max(rows.length - 1, 0));

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!rows.length) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setIndex((active + delta + rows.length) % rows.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[active];
      if (row) onPick(row.id);
    } else if (event.key === 'Backspace' && !search) {
      // An empty search box is the top of the list: Backspace leaves it.
      onClose();
    }
  }

  return (
    <div onKeyDown={keyDown}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <IconButton onClick={onClose} aria-label="Back" title="Back">
          <ArrowLeft className="size-4" />
        </IconButton>
        <input
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search…"
          className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="p-2">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">Sources</p>
        {rows.map((source, row) => (
          <button
            key={source.id}
            onClick={() => onPick(source.id)}
            onMouseEnter={() => setIndex(row)}
            className={cn(
              'flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left',
              'transition-colors',
              row === active && 'bg-white/[0.09]',
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-muted-foreground">
              <source.icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm">{source.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {source.subtitle}
              </span>
            </span>
          </button>
        ))}
        {rows.length ? null : (
          <p className="px-2 py-3 text-xs text-muted-foreground/70">No sources match</p>
        )}
      </div>

      <Footer>
        <Hint keys={['↑', '↓']} label="Navigate" />
        <Hint keys={['Enter']} label="Select" />
        <Hint keys={['Backspace']} label="Back" />
        <Hint keys={['Esc']} label="Close" />
      </Footer>
    </div>
  );
}

function LocalForm({ start, onBack, onDone }: { start: string; onBack(): void; onDone(): void }) {
  const [path, setPath] = useState(start);
  const [name, setName] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!path.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const folder = await inspectFolder(path);
      await addAndOpen(folder.path, name);
      onDone();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <StepHeader title="Local folder" subtitle="Browse a folder on disk" onBack={onBack} />

      <div className="space-y-3 p-3">
        <Field label="Folder path">
          <div className="flex gap-2">
            <Input
              autoFocus
              value={path}
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit();
              }}
              placeholder="C:/code/my-app"
            />
            <Button variant="outline" onClick={() => setBrowsing(!browsing)}>
              Browse
            </Button>
          </div>
        </Field>

        {browsing ? (
          <FolderBrowser
            start={path}
            onPick={(picked) => {
              setPath(picked);
              setBrowsing(false);
            }}
          />
        ) : null}

        <Field label="Name">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={(path.trim() && folderNameOf(path.trim())) || 'Project name'}
          />
        </Field>

        {error ? (
          <ErrorLine>
            <p>{error}</p>
          </ErrorLine>
        ) : null}
      </div>

      <Footer>
        <Hint keys={['Esc']} label="Close" />
        <Button className="ml-auto" disabled={busy || !path.trim()} onClick={() => void submit()}>
          {busy ? <Spinner /> : null}
          {busy ? 'Adding…' : 'Add project'}
        </Button>
      </Footer>
    </div>
  );
}

function GitForm({
  onBack,
  onDone,
  onLocalInstead,
}: {
  onBack(): void;
  onDone(): void;
  onLocalInstead(path: string): void;
}) {
  const stored = useProjectsStore((state) => state.cloneParent);
  const setCloneParent = useProjectsStore((state) => state.setCloneParent);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [root, setRoot] = useState('');
  const [parent, setParent] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const base = await defaultCloneParent().catch(() => '');
      if (cancelled || !base) return;
      setRoot(base);
      // A remembered folder that has left the root, or been deleted, is no longer offerable.
      const usable = stored
        ? await listCloneFolders(stored)
            .then(() => true)
            .catch(() => false)
        : false;
      if (!cancelled) setParent(usable && stored ? stored : base);
    })();
    return () => {
      cancelled = true;
    };
  }, [stored]);

  const folder = name.trim() || repoNameFromUrl(url);
  const code = error instanceof SourceError ? error.code : null;
  const showGitHubLink = code === 'auth' || (code === 'not_found' && isGitHubUrl(url));

  async function submit() {
    if (!url.trim() || !parent || busy) return;
    setBusy(true);
    setError(null);
    try {
      const cloned = await cloneRepository({ url, parent, name: name.trim() || undefined });
      setCloneParent(parent);
      await addAndOpen(cloned.path, name);
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <StepHeader title="Git URL" subtitle="Clone from a remote URL" onBack={onBack} />

      <div className="space-y-3 p-3">
        <Field label="Repository URL">
          <Input
            autoFocus
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
            }}
            placeholder="https://github.com/owner/repo.git"
          />
        </Field>

        <Field label="Name">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={repoNameFromUrl(url) || 'Project name'}
          />
        </Field>

        <Field label="Clone into">
          <div className="flex gap-2">
            <div className="flex h-8 min-w-0 flex-1 items-center rounded-lg border border-input px-2.5 font-mono text-xs">
              <span className="truncate text-muted-foreground">{root}</span>
              <span className="shrink-0">{subfolderOf(root, parent)}</span>
            </div>
            <Button variant="outline" disabled={!parent} onClick={() => setBrowsing(!browsing)}>
              Browse
            </Button>
          </div>
        </Field>

        {browsing ? (
          <FolderBrowser
            start={parent}
            scope="clone"
            onPick={(picked) => {
              setParent(picked);
              setBrowsing(false);
            }}
          />
        ) : null}

        {parent && folder ? (
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {joinPath(parent, folder)}
          </p>
        ) : null}

        {error ? (
          <ErrorLine>
            <p>{error.message}</p>
            {showGitHubLink ? (
              <Link
                href="/settings/configuration"
                className="inline-block underline underline-offset-2"
              >
                Open GitHub settings
              </Link>
            ) : null}
            {code === 'exists' ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => onLocalInstead(joinPath(parent, folder))}
              >
                Add as local folder instead
              </Button>
            ) : null}
          </ErrorLine>
        ) : null}
      </div>

      <Footer>
        <Hint keys={['Esc']} label="Close" />
        <Button
          className="ml-auto"
          disabled={busy || !url.trim() || !parent}
          onClick={() => void submit()}
        >
          {busy ? <Spinner /> : null}
          {busy ? 'Cloning…' : 'Clone'}
        </Button>
      </Footer>
    </div>
  );
}

function StepHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle: string;
  onBack(): void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
      <IconButton onClick={onBack} aria-label="Back" title="Back">
        <ArrowLeft className="size-4" />
      </IconButton>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="block text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 text-xs text-danger">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 space-y-1.5">{children}</div>
    </div>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-3 border-t border-line px-3 py-2">{children}</div>;
}

function Hint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
      {label}
    </span>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-white/6 px-1 font-sans text-[10px] text-muted-foreground">
      {children}
    </kbd>
  );
}

/** Adds the project and opens it, undoing the add when the folder will not open. */
async function addAndOpen(repoPath: string, name: string): Promise<void> {
  const { addProject, removeProject } = useProjectsStore.getState();
  const project = addProject(repoPath, name);
  try {
    await openProject(project);
  } catch (cause) {
    // The folder never opened, so it does not belong in the list.
    removeProject(project.id);
    throw cause;
  }
}

function joinPath(parent: string, child: string): string {
  const separator = parent.includes('\\') ? '\\' : '/';
  return `${parent.replace(/[\\/]+$/, '')}${separator}${child}`;
}

/** What the user picked under the clone root, which is shown as a fixed prefix beside it. */
function subfolderOf(root: string, parent: string): string {
  return parent.toLowerCase().startsWith(root.toLowerCase()) ? parent.slice(root.length) : '';
}

function isGitHubUrl(url: string): boolean {
  return /(^|@|\/\/)github\.com[/:]/i.test(url.trim());
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
