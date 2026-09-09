'use client';

import type { AuthLoginMode } from '@agent-console/contracts';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { RunnerClient } from '@/lib/runner-client';
import { useConsoleStore } from '@/store/use-console-store';
import { Button } from './ui';

type Tab = AuthLoginMode | 'apikey';

const TAB_LABELS: Record<Tab, string> = {
  claudeai: 'Subscription',
  console: 'Console',
  apikey: 'API key',
};

const FIELD =
  'h-7 min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 placeholder:text-muted focus:border-accent focus:outline-none';

/**
 * Logs Claude Code in inside the environment. The runner runs `claude auth login` and
 * only ever hands the browser the authorization URL, so no token passes through here;
 * the code the user pastes goes straight back to the CLI waiting on its stdin.
 */
export function ConnectClaudeCard({ client }: { client: RunnerClient | null }) {
  const status = useConsoleStore((state) => state.auth.status);
  const login = useConsoleStore((state) => state.auth.login);
  const [tab, setTab] = useState<Tab>('claudeai');
  const [code, setCode] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The actions never change identity, so there is nothing to subscribe to.
  const store = useConsoleStore.getState();

  // `authMethod: 'none'` while logged in means this environment has no Claude to connect.
  if (!client || !status || (status.loggedIn && status.authMethod === 'none')) return null;

  const run = (action: (client: RunnerClient) => Promise<void>) => {
    setBusy(true);
    setError(null);
    action(client)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  const submit = () =>
    run(async (target) => {
      await store.submitCode(target, code.trim());
      setCode('');
    });

  return (
    <div className="mx-2 mb-2 shrink-0 space-y-2 rounded-lg border border-line bg-raised p-2 text-[11px]">
      {status.loggedIn ? (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-fg">
            {`Connected${status.email ? ` · ${status.email}` : ''} · ${
              status.subscriptionType ?? 'Console'
            }`}
          </span>
          <Button disabled={busy} onClick={() => run(store.logout)}>
            Disconnect
          </Button>
        </div>
      ) : (
        <>
          <p className="font-medium text-fg">Connect Claude</p>

          <div className="flex gap-1" role="group" aria-label="Connection method">
            {(Object.keys(TAB_LABELS) as Tab[]).map((candidate) => (
              <Button
                key={candidate}
                variant={candidate === tab ? 'primary' : 'ghost'}
                className="flex-1 px-1"
                aria-pressed={candidate === tab}
                onClick={() => {
                  setTab(candidate);
                  setError(null);
                }}
              >
                {TAB_LABELS[candidate]}
              </Button>
            ))}
          </div>

          {tab === 'apikey' ? (
            <div className="flex gap-1">
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-ant-…"
                aria-label="Anthropic API key"
                className={FIELD}
              />
              <Button
                variant="primary"
                disabled={busy || !apiKey.trim()}
                onClick={() =>
                  run(async (target) => {
                    await store.setApiKey(target, apiKey.trim());
                    setApiKey('');
                  })
                }
              >
                Save
              </Button>
            </div>
          ) : login?.mode === tab ? (
            <div className="space-y-1.5">
              <p className="text-muted">1. Open Claude and approve</p>
              <a
                href={login.authUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 font-medium text-white hover:brightness-110"
              >
                <ExternalLink className="size-3" />
                Open Claude
              </a>
              <p className="text-muted">2. Paste the code</p>
              <div className="flex gap-1">
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && code.trim() && !busy) submit();
                  }}
                  placeholder="Code"
                  aria-label="Authorization code"
                  className={FIELD}
                />
                <Button variant="primary" disabled={busy || !code.trim()} onClick={submit}>
                  Submit
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="primary"
              className="w-full"
              disabled={busy}
              onClick={() => run((target) => store.startLogin(target, tab))}
            >
              {busy ? 'Starting…' : 'Connect'}
            </Button>
          )}
        </>
      )}

      {status.apiKey ? (
        <div className="flex items-center gap-2 border-t border-line pt-2">
          <span className="min-w-0 flex-1 text-muted">API key set</span>
          <Button disabled={busy} onClick={() => run(store.clearApiKey)}>
            Clear
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-danger">{error}</p> : null}
    </div>
  );
}
