import { DaytonaProvider } from './daytona/daytona-provider.js';
import type { EnvironmentProvider } from './environment-provider.js';

export type { EnvironmentProvider } from './environment-provider.js';
export { DaytonaProvider, DAYTONA_WORKSPACE } from './daytona/daytona-provider.js';

export type ProviderKind = 'local' | 'daytona';

/** Future `e2b` and `vps` adapters register here alongside these. */
const providers: Record<ProviderKind, () => Promise<EnvironmentProvider>> = {
  // The local provider resolves the runner and tsx with `require.resolve` at runtime, which a
  // bundler cannot follow, so its import is hidden from the bundler and Node resolves this
  // package's own `./local` export instead.
  local: () =>
    import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */
      '@agent-console/providers/local'
    ).then((m) => new m.LocalProvider()),
  daytona: async () => new DaytonaProvider({ snapshot: requireEnv('DAYTONA_SNAPSHOT') }),
};

export function createProvider(kind: ProviderKind): Promise<EnvironmentProvider> {
  const factory = providers[kind];
  if (!factory) throw new Error(`Unknown environment provider: ${kind}`);
  return factory();
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set to use the daytona provider`);
  return value;
}
