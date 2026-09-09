'use client';

import type { AuthLoginMode } from '@agent-console/contracts';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { RunnerClient } from '@/lib/runner-client';
import { useConsoleStore } from '@/store/use-console-store';
import { Dot } from './ui';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

type Tab = AuthLoginMode | 'apikey';

const TAB_LABELS: Record<Tab, string> = {
  claudeai: 'Subscription',
  console: 'Console',
  apikey: 'API key',
};

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

  if (!client || !status) {
    return <p className="text-xs text-muted-foreground">Checking the environment…</p>;
  }
  // `authMethod: 'none'` while logged in means this environment has no Claude to connect.
  if (status.loggedIn && status.authMethod === 'none') {
    return (
      <p className="text-xs text-muted-foreground">This environment has no Claude to log in.</p>
    );
  }

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
    <div className="space-y-3 text-xs">
      {status.loggedIn ? (
        <div className="flex items-center gap-2">
          <Dot status="open" />
          <span className="min-w-0 flex-1 truncate text-fg">
            {`Connected${status.email ? ` · ${status.email}` : ''} · ${
              status.subscriptionType ?? 'Console'
            }`}
          </span>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => run(store.logout)}>
            Disconnect
          </Button>
        </div>
      ) : (
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as Tab);
            setError(null);
          }}
        >
          <TabsList className="w-full">
            {(Object.keys(TAB_LABELS) as Tab[]).map((candidate) => (
              <TabsTrigger key={candidate} value={candidate}>
                {TAB_LABELS[candidate]}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="apikey" className="flex gap-1.5">
            <Input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk-ant-…"
              aria-label="Anthropic API key"
            />
            <Button
              size="sm"
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
          </TabsContent>

          {(['claudeai', 'console'] as AuthLoginMode[]).map((mode) => (
            <TabsContent key={mode} value={mode} className="space-y-2">
              {login?.mode === mode ? (
                <>
                  <p className="text-muted-foreground">1. Open Claude and approve</p>
                  <Button asChild size="sm" className="w-full">
                    <a href={login.authUrl} target="_blank" rel="noreferrer">
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
                </>
              ) : (
                <Button
                  size="sm"
                  className="w-full"
                  disabled={busy}
                  onClick={() => run((target) => store.startLogin(target, mode))}
                >
                  {busy ? 'Starting…' : 'Connect'}
                </Button>
              )}
            </TabsContent>
          ))}
        </Tabs>
      )}

      {status.apiKey ? (
        <div className="flex items-center gap-2 border-t border-line pt-2">
          <span className="min-w-0 flex-1 text-muted-foreground">API key set</span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => run(store.clearApiKey)}
          >
            Clear
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-danger">{error}</p> : null}
    </div>
  );
}
