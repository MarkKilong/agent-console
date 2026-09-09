import type { EnvironmentProvider } from './environment-provider.js';
import { LocalProvider } from './local/local-provider.js';

export type { EnvironmentProvider } from './environment-provider.js';
export { LocalProvider } from './local/local-provider.js';

export type ProviderKind = 'local';

/** Future `daytona`, `e2b` and `vps` adapters register here alongside `local`. */
const providers: Record<ProviderKind, () => EnvironmentProvider> = {
  local: () => new LocalProvider(),
};

export function createProvider(kind: ProviderKind): EnvironmentProvider {
  const factory = providers[kind];
  if (!factory) throw new Error(`Unknown environment provider: ${kind}`);
  return factory();
}
