'use client';

import type { CodexAuthStatusData } from '@agent-console/contracts';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/store/use-auth-store';
import { useCodexAuthStore } from '@/store/use-codex-auth-store';
import { IconButton, Spinner } from '../ui';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

type Run = (action: () => Promise<void>) => void;

/**
 * Codex under Settings → Providers. Everything it drives is the `codex` CLI running in
 * the auth environment; the sign-in is its device flow, so nothing is pasted back.
 */
export function CodexCard() {
  const openStatus = useAuthStore((state) => state.status);
  const openError = useAuthStore((state) => state.error);
  const status = useCodexAuthStore((state) => state.status);
  const storeError = useCodexAuthStore((state) => state.error);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="space-y-4 p-4 text-xs">
      {problem ? (
        <p className="text-danger">{problem}</p>
      ) : !status ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          Checking Codex…
        </p>
      ) : !status.installed ? (
        <NotInstalled />
      ) : status.pending ? (
        <SigningIn pending={status.pending} busy={busy} run={run} />
      ) : status.loggedIn ? (
        <Connected status={status} busy={busy} run={run} />
      ) : (
        <NotConnected busy={busy} run={run} />
      )}

      {shown ? <p className="text-danger">{shown}</p> : null}

      <div className="flex items-center justify-end gap-1 font-mono text-[11px] text-muted-foreground">
        {status?.version}
        <IconButton
          onClick={() => run(() => useCodexAuthStore.getState().refresh())}
          disabled={busy || openStatus !== 'open'}
          aria-label="Refresh status"
          title="Refresh status"
          className="size-6"
        >
          <RefreshCw className={cn('size-3', busy && 'animate-spin')} />
        </IconButton>
      </div>
    </div>
  );
}

function NotInstalled() {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-fg">No Codex CLI on this machine</p>
      <p className="text-muted-foreground">
        Install it, then refresh:{' '}
        <span className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[11px]">
          npm install -g @openai/codex
        </span>
      </p>
    </div>
  );
}

function NotConnected({ busy, run }: { busy: boolean; run: Run }) {
  const [key, setKey] = useState('');

  return (
    <>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-fg">ChatGPT account</p>
        <p className="text-muted-foreground">
          Use your ChatGPT plan. Sign in in the browser with a one-time code.
        </p>
        <Button
          className="w-full"
          disabled={busy}
          onClick={() => run(() => useCodexAuthStore.getState().startLogin())}
        >
          Sign in with ChatGPT
        </Button>
      </div>

      <div className="flex items-center gap-3 text-muted-foreground">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-fg">API key</p>
        <p className="text-muted-foreground">
          Pay per use with an OpenAI API key. Stored by the Codex CLI on this machine only.
        </p>
        <div className="flex gap-1.5">
          <Input
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="sk-…"
            aria-label="OpenAI API key"
          />
          <Button
            size="sm"
            disabled={busy || !key.trim()}
            onClick={() =>
              run(async () => {
                await useCodexAuthStore.getState().setApiKey(key.trim());
                setKey('');
              })
            }
          >
            Save
          </Button>
        </div>
      </div>
    </>
  );
}

function SigningIn({
  pending,
  busy,
  run,
}: {
  pending: NonNullable<CodexAuthStatusData['pending']>;
  busy: boolean;
  run: Run;
}) {
  return (
    <>
      <p className="text-muted-foreground">1. Copy this code</p>
      <p className="text-center font-mono text-2xl tracking-[0.2em] text-fg select-all">
        {pending.userCode}
      </p>

      <p className="text-muted-foreground">2. Open ChatGPT and enter it</p>
      <Button asChild size="sm" className="w-full">
        <a href={pending.verificationUrl} target="_blank" rel="noreferrer">
          <ExternalLink />
          Open ChatGPT
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
        onClick={() => run(() => useCodexAuthStore.getState().cancel())}
      >
        Cancel
      </Button>
    </>
  );
}

function Connected({
  status,
  busy,
  run,
}: {
  status: CodexAuthStatusData;
  busy: boolean;
  run: Run;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-fg">{authLabel(status.authMethod)}</span>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => run(() => useCodexAuthStore.getState().logout())}
      >
        Disconnect
      </Button>
    </div>
  );
}

function authLabel(authMethod: CodexAuthStatusData['authMethod']): string {
  if (authMethod === 'chatgpt') return 'Signed in with ChatGPT';
  if (authMethod === 'api_key') return 'API key set';
  return 'Signed in with an access token';
}
