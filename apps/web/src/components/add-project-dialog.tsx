'use client';

import { useState } from 'react';
import { openProject } from '@/lib/open-project';
import { useProjectsStore } from '@/store/use-projects-store';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';

type Props = {
  open: boolean;
  onClose(): void;
};

/** Folder only: Claude's login lives in Settings and covers every project. */
export function AddProjectDialog({ open, onClose }: Props) {
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
      setName('');
      setRepoPath('');
      onClose();
    } catch (cause) {
      // The folder never opened, so it does not belong in the list.
      removeProject(project.id);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add project</DialogTitle>
          <DialogDescription>A folder on this machine.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
