'use client';

import { useState } from 'react';
import { openProject } from '@/lib/open-project';
import type { RunnerClient } from '@/lib/runner-client';
import { useConsoleStore } from '@/store/use-console-store';
import { useProjectsStore, type Project } from '@/store/use-projects-store';
import { ConnectClaudeCard } from './connect-claude-card';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';

/** `connection` hides the folder column: the sidebar gear only manages the Claude login. */
export type DialogMode = 'project' | 'connection';

type Props = {
  client: RunnerClient | null;
  mode: DialogMode | null;
  onClose(): void;
};

export function AddProjectDialog({ client, mode, onClose }: Props) {
  const environment = useConsoleStore((state) => state.environment);

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === 'connection' ? 'Claude connection' : 'Add project'}</DialogTitle>
          <DialogDescription>
            {mode === 'connection'
              ? 'Log Claude Code in inside the open project.'
              : 'A project is a folder on this machine. Point at it, then connect Claude.'}
          </DialogDescription>
        </DialogHeader>

        <div className={mode === 'project' ? 'grid gap-6 sm:grid-cols-2' : ''}>
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-fg">Connect Claude</h3>
            {environment ? (
              <ConnectClaudeCard client={client} />
            ) : (
              <p className="text-xs text-muted-foreground">Add a folder first</p>
            )}
          </section>

          {mode === 'project' ? <ProjectColumn /> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The dialog stays open after a successful add so the left column can show the Claude
 * connection; closing it unmounts this column, so the next visit starts on the form again.
 */
function ProjectColumn() {
  const [added, setAdded] = useState<Project | null>(null);

  if (!added) return <AddProjectForm onAdded={setAdded} />;

  return (
    <section className="space-y-1">
      <h3 className="text-sm font-medium text-fg">Added {added.name}</h3>
      <p className="break-all text-xs text-muted-foreground">{added.repoPath}</p>
    </section>
  );
}

function AddProjectForm({ onAdded }: { onAdded(project: Project): void }) {
  const addProject = useProjectsStore((state) => state.addProject);
  const removeProject = useProjectsStore((state) => state.removeProject);
  const [name, setName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    const project = addProject(repoPath, name);
    try {
      await openProject(project);
      onAdded(project);
    } catch (cause) {
      // The folder never opened, so it does not belong in the list.
      removeProject(project.id);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-fg">Folder</h3>
      <label className="block space-y-1 text-xs text-muted-foreground">
        Name (optional)
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="my-app"
        />
      </label>
      <label className="block space-y-1 text-xs text-muted-foreground">
        Folder path
        <Input
          value={repoPath}
          onChange={(event) => setRepoPath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && repoPath.trim() && !busy) void add();
          }}
          placeholder="C:/code/my-app"
        />
      </label>
      <Button className="w-full" disabled={busy || !repoPath.trim()} onClick={() => void add()}>
        {busy ? 'Adding…' : 'Add project'}
      </Button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </section>
  );
}
