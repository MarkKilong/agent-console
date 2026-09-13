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
