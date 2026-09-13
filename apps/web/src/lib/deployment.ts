import type { ProviderKind } from '@agent-console/providers';

/**
 * Which provider this deployment runs: `local` spawns runners on this machine, `daytona`
 * creates a sandbox per environment. NEXT_PUBLIC_ so the Add-project dialog can offer the
 * right sources; the server reads the same variable.
 */
export const PROVIDER_KIND: ProviderKind =
  process.env.NEXT_PUBLIC_ENV_PROVIDER?.trim() === 'daytona' ? 'daytona' : 'local';

/** A sandbox cannot reach folders on this machine, so only URL sources remain there. */
export const canOpenLocalFolders = PROVIDER_KIND === 'local';
