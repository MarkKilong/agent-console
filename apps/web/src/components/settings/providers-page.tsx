'use client';

import type { AuthStatusData } from '@agent-console/contracts';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { isClaudeConnected, useAuthStore } from '@/store/use-auth-store';
import { ClaudeMark } from '../claude-mark';
import { Dot, IconButton, Spinner } from '../ui';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

type Run = (action: () => Promise<void>) => void;

/**
 * The only settings section so far. Everything it drives runs in the auth environment —
 * a runner at the shared data root — so no project has to be open to connect Claude.
 */
export function ProvidersPage() {
  const status = useAuthStore((state) => state.status);
  const openError = useAuthStore((state) => state.error);
  const auth = useAuthStore((state) => state.auth);
  const login = useAuthStore((state) => state.login);
  const connected = useAuthStore(isClaudeConnected);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A hard reload on this route has no shell to have opened the environment.
  useEffect(() => {
    void useAuthStore.getState().ensure();
  }, []);

  const run: Run = (action) => {
    setBusy(true);
    setError(null);
    action()
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  const problem = problemOf(status, openError, auth);
  const version = auth?.version;

  return (
    <div className="mx-auto w-full max-w-xl">
      {/* Folder tab: it sits a pixel over the card so the two read as one shape. */}
      <div className="folder-tab relative z-10 -mb-px inline-flex h-10 items-center gap-2 rounded-t-xl border border-b-0 border-line bg-panel px-4">
        <ClaudeMark />
        <span className="text-sm font-medium">Claude</span>
        <Dot status={problem ? 'closed' : connected ? 'open' : 'idle'} />
      </div>

      <div className="flex min-w-0 flex-col rounded-xl rounded-tl-none border border-line bg-panel">
        <div className="space-y-4 p-4 text-xs">
          {problem ? (
            <p className="text-danger">{problem}</p>
          ) : !auth ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Spinner />
              Checking Claude…
            </p>
          ) : login ? (
            <SigningIn authUrl={login.authUrl} busy={busy} run={run} />
          ) : connected ? (
            <Connected auth={auth} busy={busy} run={run} />
          ) : (
            <NotConnected busy={busy} run={run} />
          )}

          {error ? <p className="text-danger">{error}</p> : null}

          <div className="flex items-center justify-end gap-1 font-mono text-[11px] text-muted-foreground">
            {version}
            <IconButton
              onClick={() => run(() => useAuthStore.getState().refresh())}
              disabled={busy || status !== 'open'}
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
  const [key, setKey] = useState('');

  return (
    <>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-fg">Claude account</p>
        <p className="text-muted-foreground">
          Use your Pro, Max, Team or Enterprise plan. Approve in the browser, then paste the code.
        </p>
        <Button
          className="w-full"
          disabled={busy}
          onClick={() => run(() => useAuthStore.getState().startLogin())}
        >
          Sign in with Claude
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
          Pay per use with a key from the Anthropic Console. Stored on this machine only.
        </p>
        <div className="flex gap-1.5">
          <Input
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="sk-ant-…"
            aria-label="Anthropic API key"
          />
          <Button
            size="sm"
            disabled={busy || !key.trim()}
            onClick={() =>
              run(async () => {
                await useAuthStore.getState().setApiKey(key.trim());
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

function SigningIn({ authUrl, busy, run }: { authUrl: string; busy: boolean; run: Run }) {
  const [code, setCode] = useState('');

  const submit = () =>
    run(async () => {
      await useAuthStore.getState().submitCode(code.trim());
      setCode('');
    });

  return (
    <>
      <p className="text-muted-foreground">1. Open Claude and approve</p>
      <Button asChild size="sm" className="w-full">
        <a href={authUrl} target="_blank" rel="noreferrer">
          <ExternalLink />
          Open Claude
        </a>
      </Button>

      <p className="text-muted-foreground">2. Paste the code</p>
      <div className="flex gap-1.5">
        <Input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && code.trim() && !busy) submit();
          }}
          placeholder="Code"
          aria-label="Authorization code"
        />
        <Button size="sm" disabled={busy || !code.trim()} onClick={submit}>
          Submit
        </Button>
      </div>

      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => run(() => useAuthStore.getState().cancelLogin())}
      >
        Cancel
      </Button>
    </>
  );
}

function Connected({ auth, busy, run }: { auth: AuthStatusData; busy: boolean; run: Run }) {
  return (
    <>
      {auth.loggedIn && auth.authMethod !== 'none' ? (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-fg">{authLabel(auth)}</p>
            {auth.orgName ? <p className="truncate text-muted-foreground">{auth.orgName}</p> : null}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => run(() => useAuthStore.getState().logout())}
          >
            Disconnect
          </Button>
        </div>
      ) : null}

      {auth.apiKey ? (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-fg">API key set</span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => run(() => useAuthStore.getState().clearApiKey())}
          >
            Clear
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** "Authenticated as me@example.com · Max", with whatever parts the CLI reported. */
function authLabel(auth: AuthStatusData | undefined): string {
  if (!auth) return 'Not connected';
  if (!auth.loggedIn || auth.authMethod === 'none') return 'API key set';
  const plan = auth.subscriptionType ? capitalize(auth.subscriptionType) : undefined;
  const who = auth.email ? `Authenticated as ${auth.email}` : 'Authenticated';
  return plan ? `${who} · ${plan}` : who;
}

/** What keeps the card from offering a login at all, if anything. */
function problemOf(
  status: 'idle' | 'opening' | 'open' | 'error',
  openError: string | undefined,
  auth: AuthStatusData | undefined,
): string | null {
  if (status === 'error') return openError ?? 'The settings runner could not start';
  // `authMethod: 'none'` while logged in is the runner saying it found no Claude CLI.
  if (auth?.loggedIn && auth.authMethod === 'none') return 'No Claude CLI on this machine';
  return null;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
