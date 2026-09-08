import type { EnvironmentProvider } from '@agent-console/providers';

// The provider spawns the runner with `require.resolve`, which bundlers try to
// follow into tsx/esbuild. Next only externalises packages that resolve inside
// node_modules, and pnpm links this workspace package to packages/providers, so
// the import is kept out of the bundle by hand and resolved by Node at runtime.
const loadProviders = () =>
  import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */
    '@agent-console/providers'
  ) as Promise<typeof import('@agent-console/providers')>;

// Route handler modules are re-evaluated on every edit in dev; keeping the
// provider on globalThis stops each reload from orphaning its running runners.
const globalForProvider = globalThis as typeof globalThis & {
  agentConsoleProvider?: Promise<EnvironmentProvider>;
};

export function getProvider(): Promise<EnvironmentProvider> {
  globalForProvider.agentConsoleProvider ??= loadProviders().then((m) => m.createProvider('local'));
  return globalForProvider.agentConsoleProvider;
}

/** Runner settings this process is allowed to forward into the environment. */
export function runnerEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const agent = process.env.RUNNER_AGENT?.trim();
  const claudeBinary = process.env.CLAUDE_BINARY?.trim();
  if (agent) env.RUNNER_AGENT = agent;
  if (claudeBinary) env.CLAUDE_BINARY = claudeBinary;
  return env;
}
