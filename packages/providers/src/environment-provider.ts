import type { EnvEndpoint, EnvHandle, EnvSpec, EnvStatus } from '@agent-console/contracts';

/**
 * The control plane's view of an environment: somewhere a runner can live.
 * Phase 1 ships only the local adapter; the interface is what remote adapters
 * (Daytona, E2B, a VPS) will implement without the control plane changing.
 */
export interface EnvironmentProvider {
  create(spec: EnvSpec): Promise<EnvHandle>;
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  destroy(id: string): Promise<void>;
  endpoint(id: string): Promise<EnvEndpoint>;
  status(id: string): Promise<EnvStatus>;
}
