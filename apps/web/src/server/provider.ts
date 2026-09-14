import type { EnvironmentProvider } from '@agent-console/providers';
import { PROVIDER_KIND } from '@/lib/deployment';

// Route handler modules are re-evaluated on every edit in dev; keeping the
// provider on globalThis stops each reload from orphaning its running runners.
const globalForProvider = globalThis as typeof globalThis & {
  agentConsoleProvider?: Promise<EnvironmentProvider>;
};

// The registry owns whatever each provider needs from the bundler, so this is a plain import.
export function getProvider(): Promise<EnvironmentProvider> {
  globalForProvider.agentConsoleProvider ??= import('@agent-console/providers').then((m) =>
    m.createProvider(PROVIDER_KIND),
  );
  return globalForProvider.agentConsoleProvider;
}

/** The capability the credential routes need: only a provider that injects files has any to read. */
type FileReadingProvider = {
  readFiles(id: string, paths: readonly string[]): Promise<Record<string, string>>;
};

export async function getFileReadingProvider(): Promise<FileReadingProvider> {
  const provider = await getProvider();
  if (!('readFiles' in provider)) {
    throw new Error('This deployment cannot read credentials out of an environment');
  }
  return provider as EnvironmentProvider & FileReadingProvider;
}

/** How long an auth sandbox may live before the sweep treats it as abandoned. */
const AUTH_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * Deletes auth sandboxes no browser ever closed. Every exit path in the app deletes its own,
 * so this only catches the ones that got away — and it must never fail a create.
 */
export async function sweepStaleAuthEnvironments(): Promise<void> {
  const provider = await getProvider();
  if (!('sweepStaleAuth' in provider)) return;
  const sweeper = provider as EnvironmentProvider & {
    sweepStaleAuth(maxAgeMs: number): Promise<string[]>;
  };
  await sweeper.sweepStaleAuth(AUTH_MAX_AGE_MS).catch(() => {});
}

/**
 * Runner settings this process is allowed to forward into the environment.
 * `agent`, when the request picked one, wins over the process-level default.
 */
export function runnerEnv(agent?: 'claude' | 'codex'): Record<string, string> {
  const env: Record<string, string> = {};
  const chosen = agent ?? process.env.RUNNER_AGENT?.trim();
  const claudeBinary = process.env.CLAUDE_BINARY?.trim();
  const codexBinary = process.env.CODEX_BINARY?.trim();
  const codexModel = process.env.CODEX_MODEL?.trim();
  // Where the runner's `claude auth` writes credentials; unset means the machine default.
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (chosen) env.RUNNER_AGENT = chosen;
  if (claudeBinary) env.CLAUDE_BINARY = claudeBinary;
  if (codexBinary) env.CODEX_BINARY = codexBinary;
  if (codexModel) env.CODEX_MODEL = codexModel;
  if (claudeConfigDir) env.CLAUDE_CONFIG_DIR = claudeConfigDir;
  return env;
}
