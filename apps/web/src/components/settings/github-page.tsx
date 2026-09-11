'use client';

import type { GithubStatusData } from '@agent-console/contracts';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/store/use-auth-store';
import { useGithubStore } from '@/store/use-github-store';
import { GithubMark } from '../github-mark';
import { Dot, IconButton, Spinner } from '../ui';
import { Button } from '../ui/button';

type Run = (action: () => Promise<void>) => void;

/** First section of Settings → Configuration: one GitHub sign-in for the machine, inherited by the agent and the terminal. */
export function GithubSection() {
  const openStatus = useAuthStore((state) => state.status);
  const openError = useAuthStore((state) => state.error);
  const status = useGithubStore((state) => state.status);
  const storeError = useGithubStore((state) => state.error);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A hard reload on this route has no shell to have opened the environment.
  useEffect(() => {
    void useAuthStore.getState().ensure();
    return () => useGithubStore.getState().stop();
  }, []);

  // The first status has to wait for the socket; a queued request would just time out.
  useEffect(() => {
    if (openStatus === 'open') void useGithubStore.getState().refresh();
  }, [openStatus]);

  const run: Run = (action) => {
    setBusy(true);
    setError(null);
    action()
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  const problem =
    openStatus === 'error' ? (openError ?? 'The settings runner could not start') : null;
  const shown = error ?? storeError;

  return (
    <div className="mx-auto w-full max-w-xl">
      {/* Folder tab: it sits a pixel over the card so the two read as one shape. */}
      <div className="folder-tab relative z-10 -mb-px inline-flex h-10 items-center gap-2 rounded-t-xl border border-b-0 border-line bg-panel px-4">
        <GithubMark />
        <span className="text-sm font-medium">GitHub</span>
        <Dot status={problem ? 'closed' : status?.connected ? 'open' : 'idle'} />
      </div>

      <div className="flex min-w-0 flex-col rounded-xl rounded-tl-none border border-line bg-panel">
        <div className="space-y-4 p-4 text-xs">
          {problem ? (
            <p className="text-danger">{problem}</p>
          ) : !status ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Spinner />
              Checking GitHub…
            </p>
          ) : status.pending ? (
            <SigningIn pending={status.pending} busy={busy} run={run} />
          ) : status.connected ? (
            <Connected status={status} busy={busy} run={run} />
          ) : (
            <NotConnected busy={busy} run={run} />
          )}

          {shown ? <p className="text-danger">{shown}</p> : null}

          <div className="flex items-center justify-end">
            <IconButton
              onClick={() => run(() => useGithubStore.getState().refresh())}
              disabled={busy || openStatus !== 'open'}
              aria-label="Refresh status"
              title="Refresh status"
              className="size-6"
            >
              <RefreshCw className={cn('size-3', busy && 'animate-spin')} />
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function NotConnected({ busy, run }: { busy: boolean; run: Run }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-fg">GitHub account</p>
      <p className="text-muted-foreground">
        Lets the agent and the terminal clone, fetch and push your private repositories. Nothing to
        install.
      </p>
      <Button
        className="w-full"
        disabled={busy}
        onClick={() => run(() => useGithubStore.getState().startLogin())}
      >
        Sign in with GitHub
      </Button>
    </div>
  );
}

function SigningIn({
  pending,
  busy,
  run,
}: {
  pending: NonNullable<GithubStatusData['pending']>;
  busy: boolean;
  run: Run;
}) {
  return (
    <>
      <p className="text-muted-foreground">1. Copy this code</p>
      <p className="text-center font-mono text-2xl tracking-[0.2em] text-fg select-all">
        {pending.userCode}
      </p>

      <p className="text-muted-foreground">2. Open GitHub and enter it</p>
      <Button asChild size="sm" className="w-full">
        <a href={pending.verificationUri} target="_blank" rel="noreferrer">
          <ExternalLink />
          Open GitHub
        </a>
      </Button>

      <p className="flex items-center gap-2 text-muted-foreground">
        <Spinner />
        Waiting for approval…
      </p>

      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => run(() => useGithubStore.getState().cancel())}
      >
        Cancel
      </Button>
    </>
  );
}

function Connected({ status, busy, run }: { status: GithubStatusData; busy: boolean; run: Run }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-fg">Signed in as {status.login ?? 'GitHub'}</p>
          {status.scopes?.length ? (
            <p className="flex flex-wrap gap-1">
              {status.scopes.map((scope) => (
                <span
                  key={scope}
                  className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                >
                  {scope}
                </span>
              ))}
            </p>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => run(() => useGithubStore.getState().logout())}
        >
          Sign out
        </Button>
      </div>

      <p className="text-muted-foreground">
        Organisations with SSO may ask you to authorise agent-console once on GitHub. Signing out
        deletes the token from this machine. To revoke it on GitHub, see Settings → Applications.
      </p>
    </>
  );
}
