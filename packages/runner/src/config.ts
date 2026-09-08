import { accessSync, constants } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

export type AgentKind = 'claude' | 'fake';

export type Config = {
  port: number;
  token: string;
  cwd: string;
  agent: AgentKind;
  /** Undefined when the fake agent is used; the Claude adapter requires it. */
  claudeBinary: string | undefined;
  permissionMode: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = env.RUNNER_TOKEN?.trim();
  if (!token) {
    throw new Error('RUNNER_TOKEN is required');
  }

  const agent = env.RUNNER_AGENT === 'fake' ? 'fake' : 'claude';
  const claudeBinary =
    agent === 'fake' ? undefined : (env.CLAUDE_BINARY?.trim() || resolveClaudeBinary());
  if (agent === 'claude' && !claudeBinary) {
    throw new Error('Could not find the `claude` executable on PATH; set CLAUDE_BINARY');
  }

  return {
    port: Number(env.RUNNER_PORT ?? 4310),
    token,
    cwd: resolve(env.RUNNER_CWD?.trim() || process.cwd()),
    agent,
    claudeBinary,
    permissionMode: env.RUNNER_PERMISSION_MODE?.trim() || 'default',
  };
}

/**
 * The SDK spawns the binary without a shell, so a Windows `.cmd` shim would fail.
 * Look for the real executable only.
 */
function resolveClaudeBinary(): string | undefined {
  const names = process.platform === 'win32' ? ['claude.exe'] : ['claude'];
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = isAbsolute(dir) ? join(dir, name) : resolve(dir, name);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return undefined;
}
