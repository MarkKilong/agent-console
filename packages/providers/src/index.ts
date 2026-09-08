import type { EnvironmentProvider } from './EnvironmentProvider.js';
import { LocalProvider } from './local/LocalProvider.js';

export type { EnvironmentProvider } from './EnvironmentProvider.js';
export { LocalProvider } from './local/LocalProvider.js';

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
