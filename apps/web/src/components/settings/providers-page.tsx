'use client';

import type { AuthStatusData } from '@agent-console/contracts';
import { ExternalLink, Plus, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { mergeModels, type ModelRow } from '@/lib/models';
import { isClaudeConnected, useAuthStore } from '@/store/use-auth-store';
import { useCodexAuthStore } from '@/store/use-codex-auth-store';
import { useModelSettings } from '@/store/use-model-settings';
import { ClaudeMark } from '../claude-mark';
import { CodexMark } from '../codex-mark';
import { Dot, IconButton, Spinner } from '../ui';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { CodexCard } from './codex-card';

type Run = (action: () => Promise<void>) => void;

/**
 * The providers section: one folder tab per agent CLI, the selected one deciding the
 * card. Everything they drive runs in the auth environment — a runner at the shared
 * data root — so no project has to be open to connect either.
 */
export function ProvidersPage() {
  const openStatus = useAuthStore((state) => state.status);
  const openError = useAuthStore((state) => state.error);
  const auth = useAuthStore((state) => state.auth);
  const claudeConnected = useAuthStore(isClaudeConnected);
  const codex = useCodexAuthStore((state) => state.status);

  const [tab, setTab] = useState<'claude' | 'codex'>('claude');

  // A hard reload on this route has no shell to have opened the environment.
  useEffect(() => {
    void useAuthStore.getState().ensure();
    void useModelSettings.persist.rehydrate();
    return () => useCodexAuthStore.getState().stop();
  }, []);

  // The first status has to wait for the socket; a queued request would just time out.
  useEffect(() => {
    if (openStatus === 'open') void useCodexAuthStore.getState().refresh();
  }, [openStatus]);

  const problem = problemOf(openStatus, openError, auth);
  const runnerProblem = openStatus === 'error';

  return (
    <div className="mx-auto w-full max-w-xl">
      {/* The selected tab's shoulder sweeps into the gap, so the two read as one shape. */}
      <div role="tablist" aria-label="Providers" className="flex items-end gap-3">
        <Tab selected={tab === 'claude'} onSelect={() => setTab('claude')}>
          <ClaudeMark />
          <span className="text-sm font-medium">Claude</span>
          <Dot status={problem ? 'closed' : claudeConnected ? 'open' : 'idle'} />
        </Tab>
        <Tab selected={tab === 'codex'} onSelect={() => setTab('codex')}>
          <CodexMark />
          <span className="text-sm font-medium">Codex</span>
          <Dot status={runnerProblem ? 'closed' : codex?.loggedIn ? 'open' : 'idle'} />
        </Tab>
      </div>

      <div className="flex min-w-0 flex-col rounded-xl rounded-tl-none border border-line bg-panel">
        {tab === 'claude' ? <ClaudeCard /> : <CodexCard />}
      </div>
    </div>
  );
}

function Tab({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect(): void;
  children: ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'relative inline-flex h-10 items-center gap-2 rounded-t-xl border px-4',
        selected
          ? 'folder-tab z-10 -mb-px border-b-0 border-line bg-panel'
          : 'border-transparent text-muted-foreground transition-colors hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

/** The Claude card: the CLI login, the stored API key, and the model catalogue. */
function ClaudeCard() {
  const status = useAuthStore((state) => state.status);
  const openError = useAuthStore((state) => state.error);
  const auth = useAuthStore((state) => state.auth);
  const login = useAuthStore((state) => state.login);
  const connected = useAuthStore(isClaudeConnected);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      {problem ? null : <Models />}

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
  );
}

/** The CLI's catalogue plus hand-added ids; a switch per row decides what the picker offers. */
function Models() {
  const models = useAuthStore((state) => state.models);
  const loaded = useAuthStore((state) => state.modelsLoaded);
  const disabled = useModelSettings((state) => state.disabled);
  const custom = useModelSettings((state) => state.custom);
  const toggle = useModelSettings((state) => state.toggle);
  const removeCustom = useModelSettings((state) => state.removeCustom);

  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);

  const rows = mergeModels(models, custom);
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? rows.filter((row) =>
        `${row.name} ${row.id} ${row.description}`.toLowerCase().includes(needle),
      )
    : rows;

  return (
    <div className="space-y-2 border-t border-line pt-4">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm font-medium text-fg">Models</p>
        {rows.length ? (
          <span className="font-mono text-[11px] text-muted-foreground">
            {rows.length} {rows.length === 1 ? 'model' : 'models'}
          </span>
        ) : null}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setFilter('');
            }}
            placeholder="Filter models"
            aria-label="Filter models"
            className="h-7 w-36 pl-7 text-xs md:text-xs"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={() => setAdding((open) => !open)}>
          <Plus />
          Add model
        </Button>
      </div>

      {adding ? <AddCustom rows={rows} onClose={() => setAdding(false)} /> : null}

      {rows.length === 0 ? (
        loaded ? (
          <p className="text-muted-foreground">No models reported. Connect Claude first.</p>
        ) : (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Spinner />
            Loading models…
          </p>
        )
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground">No models match</p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((model) => (
            <li key={model.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-fg">{model.name}</span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {model.id}
                  </span>
                </p>
                <p className="truncate text-muted-foreground">{model.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-muted-foreground">
                {model.custom ? <span>Custom</span> : null}
                {model.effortLevels?.length ? <span>Effort</span> : null}
                {model.fastMode ? <span>Fast mode</span> : null}
              </div>
              <Switch
                checked={!disabled.includes(model.id)}
                onCheckedChange={() => toggle(model.id)}
                aria-label={`Enable ${model.name}`}
              />
              {/* The empty slot keeps every switch on the same column. */}
              {model.custom ? (
                <IconButton
                  onClick={() => removeCustom(model.id)}
                  aria-label={`Remove ${model.name}`}
                  title="Remove"
                  className="size-6"
                >
                  <X className="size-3" />
                </IconButton>
              ) : (
                <span className="size-6 shrink-0" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Inline form for an id the CLI does not report, e.g. an older `claude-opus-4-8`. */
function AddCustom({ rows, onClose }: { rows: ModelRow[]; onClose(): void }) {
  const addCustom = useModelSettings((state) => state.addCustom);
  const [id, setId] = useState('');
  const [name, setName] = useState('');

  const trimmed = id.trim();
  const duplicate = rows.some((row) => row.id === trimmed);

  const submit = () => {
    if (!trimmed || duplicate) return;
    addCustom(trimmed, name.trim() || undefined);
    onClose();
  };

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <Input
          value={id}
          onChange={(event) => setId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          placeholder="claude-opus-4-8"
          aria-label="Model id"
          className="font-mono"
        />
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          placeholder="Display name (optional)"
          aria-label="Display name"
        />
        <Button size="sm" disabled={!trimmed || duplicate} onClick={submit}>
          Add
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {duplicate ? <p className="text-danger">Already listed</p> : null}
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
