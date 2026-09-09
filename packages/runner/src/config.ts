import { createHash } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

export type AgentKind = 'claude' | 'codex' | 'fake';

export type Config = {
  port: number;
  token: string;
  cwd: string;
  agent: AgentKind;
  /** Set only for the agent in use; each adapter requires its own binary. */
  claudeBinary: string | undefined;
  codexBinary: string | undefined;
  codexModel: string | undefined;
  permissionMode: string;
  /** Where this workspace's thread logs live. */
  threadsDir: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = env.RUNNER_TOKEN?.trim();
  if (!token) {
    throw new Error('RUNNER_TOKEN is required');
  }

  const agent = agentKind(env.RUNNER_AGENT);
  const claudeOverride = env.CLAUDE_BINARY?.trim();
  const claudeBinary = agent === 'claude' ? claudeOverride || resolveClaudeBinary() : undefined;
  if (agent === 'claude') {
    if (!claudeBinary) {
      throw new Error('Could not find the `claude` executable on PATH; set CLAUDE_BINARY');
    }
    // An override is never probed by resolveClaudeBinary, so check it here rather
    // than letting a bad path surface as a spawn failure on the first turn.
    if (claudeOverride && !isExecutable(claudeOverride)) {
      throw new Error(`CLAUDE_BINARY is not an executable file: ${claudeOverride}`);
    }
  }

  const codexOverride = env.CODEX_BINARY?.trim();
  const codexBinary = agent === 'codex' ? codexOverride || resolveCodexBinary() : undefined;
  if (agent === 'codex') {
    if (!codexBinary) {
      throw new Error('Could not find the `codex` executable on PATH; set CODEX_BINARY');
    }
    if (codexOverride && !isExecutable(codexOverride)) {
      throw new Error(`CODEX_BINARY is not an executable file: ${codexOverride}`);
    }
  }

  const cwd = resolve(env.RUNNER_CWD?.trim() || process.cwd());
  return {
    port: Number(env.RUNNER_PORT ?? 4310),
    token,
    cwd,
    agent,
    claudeBinary,
    codexBinary,
    codexModel: env.CODEX_MODEL?.trim() || undefined,
    permissionMode: env.RUNNER_PERMISSION_MODE?.trim() || 'default',
    threadsDir: threadsDir(env, cwd),
  };
}

function threadsDir(env: NodeJS.ProcessEnv, cwd: string): string {
  const root = env.AGENT_CONSOLE_DATA_DIR?.trim() || join(homedir(), '.agent-console');
  // Windows paths are case-insensitive, so fold case before hashing the workspace.
  const normalized = process.platform === 'win32' ? cwd.toLowerCase() : cwd;
  return join(root, createHash('sha1').update(normalized).digest('hex').slice(0, 12), 'threads');
}

function agentKind(value: string | undefined): AgentKind {
  const name = value?.trim();
  return name === 'fake' || name === 'codex' ? name : 'claude';
}

/**
 * The SDK spawns the binary without a shell, so a Windows `.cmd` shim would fail.
 * Look for the real executable only.
 */
function resolveClaudeBinary(): string | undefined {
  return resolveOnPath(process.platform === 'win32' ? ['claude.exe'] : ['claude']);
}

/** The adapter runs a `.cmd` shim through a shell, so npm's global install works too. */
function resolveCodexBinary(): string | undefined {
  return resolveOnPath(
    process.platform === 'win32' ? ['codex.cmd', 'codex.exe', 'codex'] : ['codex'],
  );
}

function resolveOnPath(names: string[]): string | undefined {
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
