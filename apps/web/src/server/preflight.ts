import { accessSync, constants, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

export type AgentKind = 'claude' | 'codex' | 'fake';

export type AgentPreflight = {
  binary: string | null;
  /** null when it cannot be told: no binary, or credentials that could not be read. */
  loggedIn: boolean | null;
};

export type Preflight = {
  /** What a runner uses when the request does not pick an agent. */
  defaultAgent: AgentKind;
  claude: AgentPreflight;
  codex: AgentPreflight;
};

export function preflight(env: NodeJS.ProcessEnv = process.env): Preflight {
  const claudeBinary = resolveClaudeBinary(env);
  const codexBinary = resolveCodexBinary(env);
  const agent = env.RUNNER_AGENT?.trim();
  return {
    defaultAgent: agent === 'fake' || agent === 'codex' ? agent : 'claude',
    claude: { binary: claudeBinary, loggedIn: claudeBinary ? isLoggedIn(env) : null },
    codex: { binary: codexBinary, loggedIn: codexBinary ? isCodexLoggedIn(env) : null },
  };
}

/** Mirrors the runner's resolution: the real executable only, never a Windows shim. */
export function resolveClaudeBinary(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env.CLAUDE_BINARY?.trim();
  if (override) return isExecutable(override) ? override : null;
  return search(env, process.platform === 'win32' ? ['claude.exe'] : ['claude']);
}

/** The codex adapter runs a `.cmd` shim through a shell, so npm's global install counts. */
export function resolveCodexBinary(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env.CODEX_BINARY?.trim();
  if (override) return isExecutable(override) ? override : null;
  const names = process.platform === 'win32' ? ['codex.cmd', 'codex.exe', 'codex'] : ['codex'];
  return search(env, names);
}

/** Reads only the shape of the credentials file; token contents never leave this function. */
export function isLoggedIn(env: NodeJS.ProcessEnv = process.env): boolean | null {
  const dir = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
  return checkCredentials(join(dir, '.credentials.json'), (parsed) => {
    const oauth = (parsed as { claudeAiOauth?: { accessToken?: unknown } }).claudeAiOauth;
    return Boolean(oauth && typeof oauth.accessToken === 'string' && oauth.accessToken.length > 0);
  });
}

/** Same idea for Codex: `codex login` writes auth.json under CODEX_HOME. */
export function isCodexLoggedIn(env: NodeJS.ProcessEnv = process.env): boolean | null {
  const dir = env.CODEX_HOME?.trim() || join(homedir(), '.codex');
  return checkCredentials(join(dir, 'auth.json'), (parsed) => {
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  });
}

function checkCredentials(path: string, valid: (parsed: unknown) => boolean): boolean | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    // Absent means never logged in, except on macOS where a credential store may be used.
    const absent = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return absent && process.platform !== 'darwin' ? false : null;
  }
  try {
    return valid(JSON.parse(raw));
  } catch {
    return null;
  }
}

function search(env: NodeJS.ProcessEnv, names: string[]): string | null {
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = isAbsolute(dir) ? join(dir, name) : resolve(dir, name);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
