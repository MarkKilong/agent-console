import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceError } from '../../apps/web/src/lib/project-source.js';
import { classifyGitFailure, cloneRepository } from '../../apps/web/src/server/clone.js';

const GITHUB = 'https://github.com/owner/repo.git';

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'agent-console-clone-'));
  // The temp dir may sit inside someone's repository; the ceiling keeps git below it.
  vi.stubEnv('GIT_CEILING_DIRECTORIES', tmpdir());
  // An empty data root, so a clone never picks up this machine's real GitHub sign-in.
  vi.stubEnv('AGENT_CONSOLE_DATA_DIR', scratch);
});

afterEach(() => vi.unstubAllEnvs());

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', ...args], {
    cwd,
    stdio: 'pipe',
  });

async function initRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  await writeFile(join(dir, 'index.ts'), 'export const a = 1;\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'init']);
}

/** The rejection itself, so a test can read its code instead of only its message. */
async function failure(promise: Promise<unknown>): Promise<SourceError> {
  try {
    await promise;
  } catch (error) {
    return error as SourceError;
  }
  throw new Error('expected the call to fail');
}

describe('classifyGitFailure', () => {
  it('reads a refused clone as auth and points at the GitHub sign-in', () => {
    const result = classifyGitFailure(
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      { url: GITHUB, hadToken: false },
    );
    expect(result.code).toBe('auth');
    expect(result.message).toContain('Settings → Configuration');
  });

  it('tells another host to bring credentials git can read', () => {
    const result = classifyGitFailure('remote: Invalid username or password', {
      url: 'https://git.example.com/owner/repo.git',
      hadToken: false,
    });
    expect(result.code).toBe('auth');
    expect(result.message).toContain('credentials git can read');
  });

  it('warns that a GitHub "not found" without a token may just be private', () => {
    const result = classifyGitFailure(
      "remote: Repository not found.\nfatal: repository 'https://github.com/owner/repo.git/' not found",
      { url: GITHUB, hadToken: false },
    );
    expect(result.code).toBe('not_found');
    expect(result.message).toContain('the repository is private');
    expect(result.message).toContain('Settings → Configuration');
  });

  it('drops the private hint once a token was sent', () => {
    const result = classifyGitFailure('remote: Repository not found.', {
      url: GITHUB,
      hadToken: true,
    });
    expect(result).toEqual({
      code: 'not_found',
      message: `GitHub could not find ${GITHUB}, or your account has no access to it.`,
    });
  });

  it('separates an unreachable host from a missing repository', () => {
    const result = classifyGitFailure(
      "fatal: unable to access 'https://github.com/owner/repo.git/': Could not resolve host: github.com",
      { url: GITHUB, hadToken: false },
    );
    expect(result.code).toBe('network');
    expect(result.message).toContain('github.com');
  });

  it("falls back to git's last word", () => {
    const result = classifyGitFailure('Cloning into...\nfatal: destination path is not empty\n', {
      url: GITHUB,
      hadToken: false,
    });
    expect(result).toEqual({ code: 'failed', message: 'fatal: destination path is not empty' });
  });
});

describe('cloneRepository', () => {
  it('clones a repository into the parent folder, creating it', async () => {
    const source = join(scratch, 'source');
    await initRepo(source);
    const parent = join(scratch, 'projects');

    const cloned = await cloneRepository({ url: source, parent, root: scratch });
    expect(cloned).toEqual({ path: join(parent, 'source'), name: 'source' });
    // Line endings are whatever the machine's git checks out with.
    await expect(readFile(join(cloned.path, 'index.ts'), 'utf8')).resolves.toContain(
      'export const a = 1;',
    );
  });

  it('will not clone over a folder that is already there', async () => {
    const source = join(scratch, 'source');
    await initRepo(source);
    const parent = join(scratch, 'projects');
    await cloneRepository({ url: source, parent, root: scratch });

    const error = await failure(cloneRepository({ url: source, parent, root: scratch }));
    expect(error.code).toBe('exists');
    expect(error.message).toContain('already exists');
  });

  it('leaves no half-clone behind when the source is not a repository', async () => {
    const parent = join(scratch, 'projects');

    const error = await failure(
      cloneRepository({ url: join(scratch, 'missing'), parent, root: scratch }),
    );
    expect(error.code).not.toBe('exists');
    expect(existsSync(join(parent, 'missing'))).toBe(false);
  });

  it('refuses an argument pretending to be a URL', async () => {
    const error = await failure(cloneRepository({ url: '-x', parent: scratch, root: scratch }));
    expect(error.code).toBe('invalid_url');
  });

  it('refuses a name that would climb out of the parent folder', async () => {
    const error = await failure(
      cloneRepository({ url: GITHUB, parent: scratch, name: '../elsewhere', root: scratch }),
    );
    expect(error.code).toBe('invalid_url');
  });

  it('refuses a parent outside the clone root', async () => {
    const root = join(scratch, 'agent-console');

    const error = await failure(
      cloneRepository({ url: GITHUB, parent: join(scratch, 'elsewhere'), root }),
    );
    expect(error.code).toBe('outside_root');
  });

  it('creates the root on demand and clones into it when no parent is given', async () => {
    const source = join(scratch, 'source');
    await initRepo(source);
    const root = join(scratch, 'agent-console');

    const cloned = await cloneRepository({ url: source, root });
    expect(cloned.path).toBe(join(root, 'source'));
  });
});
