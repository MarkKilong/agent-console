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
  const override = env.CLAUDE_BINARY?.trim();
  const claudeBinary = agent === 'fake' ? undefined : override || resolveClaudeBinary();
  if (agent === 'claude') {
    if (!claudeBinary) {
      throw new Error('Could not find the `claude` executable on PATH; set CLAUDE_BINARY');
    }
    // An override is never probed by resolveClaudeBinary, so check it here rather
    // than letting a bad path surface as a spawn failure on the first turn.
    if (override && !isExecutable(override)) {
      throw new Error(`CLAUDE_BINARY is not an executable file: ${override}`);
    }
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
      if (isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
