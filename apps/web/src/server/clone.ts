import { execFile } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  repoNameFromUrl,
  SourceError,
  type ClonedRepository,
  type SourceErrorCode,
} from '@/lib/project-source';
import { assertInside, ensureCloneRoot, expandHome } from '@/server/folders';
import { githubToken, gitEnv } from '@/server/github-token';

/** What git can clone from: a scheme, scp-like `git@host:owner/repo`, or a local path. */
const SCHEME_URL = /^(https?|ssh|git|file):\/\/.+/i;
const SCP_LIKE = /^[^\s@/]+@[^\s:/]+:.+/;
const LOCAL_PATH = /^([A-Za-z]:[\\/]|[\\/])/;

const AUTH = [
  /authentication failed/i,
  /could not read username/i,
  /terminal prompts disabled/i,
  /permission denied \(publickey\)/i,
  /invalid username or password/i,
  /http (401|403)/i,
  /returned error: (401|403)/i,
  /password authentication is not supported/i,
];

const NOT_FOUND = [
  /repository not found/i,
  /does not appear to be a git repository/i,
  /does not exist/i,
  /not found/i,
];

const NETWORK = [
  /could not resolve host/i,
  /unable to access/i,
  /connection refused/i,
  /timed out/i,
  /connection reset/i,
];

/** Clones into `<parent>/<name>` under the clone root, leaving nothing behind when git fails. */
export async function cloneRepository(input: {
  url: string;
  parent?: string;
  name?: string;
  root?: string;
}): Promise<ClonedRepository> {
  const url = input.url.trim();
  // A leading dash would reach git as a flag whatever `--` says.
  if (!url || url.startsWith('-') || !isCloneUrl(url)) {
    throw new SourceError(`${url || 'That'} is not a repository URL`, 'invalid_url');
  }

  const name = input.name?.trim() || repoNameFromUrl(url);
  if (!name || /[\\/]/.test(name) || name.includes('..')) {
    throw new SourceError(`${name || 'That'} is not a folder name`, 'invalid_url');
  }

  const root = await ensureCloneRoot(input.root);
  const parent = input.parent?.trim() ? resolve(expandHome(input.parent)) : root;
  assertInside(root, parent);

  const dest = join(parent, name);
  if (await exists(dest)) {
    throw new SourceError(
      `${dest} already exists. Choose another name, or add it as a local folder.`,
      'exists',
    );
  }
  await mkdir(parent, { recursive: true });

  const token = githubToken();
  const stderr = await runClone(url, dest, gitEnv(token));
  if (stderr !== null) {
    // Nothing was there before the clone, so half of one is only in the way.
    await rm(dest, { recursive: true, force: true }).catch(() => {});
    const failure = classifyGitFailure(stderr, { url, hadToken: Boolean(token) });
    throw new SourceError(failure.message, failure.code);
  }

  return { path: dest, name };
}

/**
 * Turns git's stderr into something the dialog can act on. GitHub answers "not found" for
 * a private repository it was shown no token for, so that case has to read as both.
 */
export function classifyGitFailure(
  stderr: string,
  { url, hadToken }: { url: string; hadToken: boolean },
): { code: SourceErrorCode; message: string } {
  const host = hostOf(url);
  const isGitHub = host === 'github.com';

  if (AUTH.some((pattern) => pattern.test(stderr))) {
    const how = isGitHub
      ? 'sign in to your account under Settings → Configuration, or ask for access'
      : 'sign in or use a URL with credentials git can read';
    return {
      code: 'auth',
      message: `Access to ${url} was refused. If this is a private repository, ${how}.`,
    };
  }

  if (NOT_FOUND.some((pattern) => pattern.test(stderr))) {
    if (!isGitHub) return { code: 'not_found', message: `Could not find a repository at ${url}.` };
    return {
      code: 'not_found',
      message: hadToken
        ? `GitHub could not find ${url}, or your account has no access to it.`
        : `GitHub could not find ${url}. Either the URL is wrong or the repository is private:` +
          ' sign in under Settings → Configuration to clone private repositories.',
    };
  }

  if (NETWORK.some((pattern) => pattern.test(stderr))) {
    return {
      code: 'network',
      message: `Could not reach ${host || url}. Check the URL and your connection.`,
    };
  }

  return { code: 'failed', message: lastLine(stderr) || `Could not clone ${url}.` };
}

function isCloneUrl(url: string): boolean {
  return SCHEME_URL.test(url) || SCP_LIKE.test(url) || LOCAL_PATH.test(url);
}

function hostOf(url: string): string {
  const scp = /^[^\s@/]+@([^\s:/]+):/.exec(url);
  if (scp) return (scp[1] ?? '').toLowerCase();
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function lastLine(stderr: string): string {
  return (
    stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .pop() ?? ''
  );
}

/** Resolves to git's stderr when the clone failed, and to null when it worked. */
function runClone(url: string, dest: string, env: Record<string, string>): Promise<string | null> {
  return new Promise((settle) => {
    execFile(
      'git',
      ['clone', '--', url, dest],
      { maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: { ...process.env, ...env } },
      (error, _stdout, stderr) => settle(error ? stderr || error.message : null),
    );
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
