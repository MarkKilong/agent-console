import { accessSync, constants, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

export type Preflight = {
  agent: 'claude' | 'fake';
  claudeBinary: string | null;
  /** null when it cannot be told: no binary, or credentials that could not be read. */
  loggedIn: boolean | null;
};

export function preflight(env: NodeJS.ProcessEnv = process.env): Preflight {
  if (env.RUNNER_AGENT?.trim() === 'fake') {
    return { agent: 'fake', claudeBinary: null, loggedIn: null };
  }
  const claudeBinary = resolveClaudeBinary(env);
  return {
    agent: 'claude',
    claudeBinary,
    loggedIn: claudeBinary ? isLoggedIn(env) : null,
  };
}

/** Mirrors the runner's resolution: the real executable only, never a Windows shim. */
export function resolveClaudeBinary(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env.CLAUDE_BINARY?.trim();
  if (override) return isExecutable(override) ? override : null;

  const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = isAbsolute(dir) ? join(dir, name) : resolve(dir, name);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

/** Reads only the shape of the credentials file; token contents never leave this function. */
export function isLoggedIn(env: NodeJS.ProcessEnv = process.env): boolean | null {
  const dir = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
  let raw: string;
  try {
    raw = readFileSync(join(dir, '.credentials.json'), 'utf8');
  } catch (error) {
    // Absent means never logged in, except on macOS where Claude Code may use the Keychain.
    const absent = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return absent && process.platform !== 'darwin' ? false : null;
  }
  try {
    const oauth = (JSON.parse(raw) as { claudeAiOauth?: { accessToken?: unknown } }).claudeAiOauth;
    return Boolean(oauth && typeof oauth.accessToken === 'string' && oauth.accessToken.length > 0);
  } catch {
    return null;
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
