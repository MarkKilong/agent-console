import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectWorkspaceDiff,
  diffWorkspace,
  discoverRepos,
  snapshotWorkspace,
  workspaceBranch,
} from '../../packages/runner/src/git/workspace.js';

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', ...args], {
    cwd,
    stdio: 'pipe',
  });

/** A repository on `main` with one committed file. */
async function initRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  await writeFile(join(dir, 'index.ts'), 'export const a = 1;\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'init']);
}

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'agent-console-workspace-'));
  // The temp dir may itself sit inside someone's repository (a versioned home
  // directory); the ceiling keeps git's search below it.
  vi.stubEnv('GIT_CEILING_DIRECTORIES', tmpdir());
});

afterEach(() => vi.unstubAllEnvs());

describe('discoverRepos', () => {
  it('sees a repository rooted at the workspace as enclosing it', async () => {
    await initRepo(scratch);
    const repos = await discoverRepos(scratch);
    expect(repos).toEqual([{ cwd: scratch, prefix: '', pathspec: ['.'] }]);
    await expect(workspaceBranch(repos)).resolves.toBe('main');
  });

  it('finds each project in a folder of repositories without being told', async () => {
    await initRepo(join(scratch, 'project_b'));
    await initRepo(join(scratch, 'project_a'));
    await mkdir(join(scratch, 'notes'));
    // A dependency's own checkout is never a project.
    await initRepo(join(scratch, 'project_a', 'node_modules', 'dep'));

    const repos = await discoverRepos(scratch);
    expect(repos.map((repo) => repo.prefix)).toEqual(['project_a', 'project_b']);
    expect(repos[0]).toEqual({
      cwd: join(scratch, 'project_a'),
      prefix: 'project_a',
      pathspec: ['.'],
    });
    // Several repositories, none enclosing: no single branch to label the turn with.
    await expect(workspaceBranch(repos)).resolves.toBeUndefined();
  });

  it('scopes a workspace nested inside a larger checkout to itself', async () => {
    await initRepo(scratch);
    const workspace = join(scratch, 'apps', 'demo');
    await mkdir(workspace, { recursive: true });

    const repos = await discoverRepos(workspace);
    expect(repos).toEqual([{ cwd: workspace, prefix: '', pathspec: ['.'] }]);
    await expect(workspaceBranch(repos)).resolves.toBe('main');
  });

  it('excludes nested repositories from the enclosing one', async () => {
    await initRepo(scratch);
    await initRepo(join(scratch, 'vendor', 'lib'));

    const repos = await discoverRepos(scratch);
    expect(repos.map((repo) => repo.prefix)).toEqual(['', 'vendor/lib']);
    expect(repos[0]?.pathspec).toEqual(['.', ':(exclude)vendor/lib']);
  });

  it('finds nothing in a plain folder', async () => {
    await writeFile(join(scratch, 'notes.md'), 'no git here\n');
    await expect(discoverRepos(scratch)).resolves.toEqual([]);
    await expect(snapshotWorkspace([])).resolves.toEqual({});
  });
});

describe('snapshotWorkspace and diffWorkspace', () => {
  it('reports changes across several projects, each under its own prefix', async () => {
    await initRepo(join(scratch, 'project_a'));
    await initRepo(join(scratch, 'project_b'));
    const repos = await discoverRepos(scratch);
    const before = await snapshotWorkspace(repos);

    await writeFile(join(scratch, 'project_a', 'index.ts'), 'export const a = 2;\n');
    await writeFile(join(scratch, 'project_b', 'new.ts'), 'export const b = 1;\n');
    await writeFile(join(scratch, 'notes.md'), 'outside every repository\n');

    const after = await snapshotWorkspace(repos);
    const files = await diffWorkspace(repos, before, after);
    expect(files.map((file) => [file.path, file.status])).toEqual([
      ['project_a/index.ts', 'modified'],
      ['project_b/new.ts', 'added'],
    ]);
  });

  it('never stages the rest of a larger checkout around a nested workspace', async () => {
    await initRepo(scratch);
    const workspace = join(scratch, 'apps', 'demo');
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, 'app.ts'), 'v1\n');
    const repos = await discoverRepos(workspace);
    const before = await snapshotWorkspace(repos);

    await writeFile(join(workspace, 'app.ts'), 'v2\n');
    // An edit elsewhere in the checkout is not this workspace's business.
    await writeFile(join(scratch, 'index.ts'), 'export const a = 99;\n');

    const after = await snapshotWorkspace(repos);
    const files = await diffWorkspace(repos, before, after);
    expect(files.map((file) => [file.path, file.status])).toEqual([['app.ts', 'modified']]);
    expect(files[0]?.patch).toContain('+++ b/app.ts');
  });

  it('keeps a nested repository out of the enclosing diff', async () => {
    await initRepo(scratch);
    await initRepo(join(scratch, 'vendor', 'lib'));
    const repos = await discoverRepos(scratch);
    const before = await snapshotWorkspace(repos);

    await writeFile(join(scratch, 'vendor', 'lib', 'index.ts'), 'changed\n');
    git(join(scratch, 'vendor', 'lib'), ['commit', '-qam', 'bump']);

    const after = await snapshotWorkspace(repos);
    const files = await diffWorkspace(repos, before, after);
    // Once, under the nested repository — not again as a gitlink in the enclosing one.
    expect(files.map((file) => [file.path, file.status])).toEqual([
      ['vendor/lib/index.ts', 'modified'],
    ]);
  });

  it('skips a repository the base snapshot did not include', async () => {
    await initRepo(join(scratch, 'project_a'));
    const before = await snapshotWorkspace(await discoverRepos(scratch));

    // The agent created a repository during the turn.
    await initRepo(join(scratch, 'project_b'));
    const repos = await discoverRepos(scratch);

    const after = await snapshotWorkspace(repos);
    await expect(diffWorkspace(repos, before, after)).resolves.toEqual([]);
  });
});

describe('collectWorkspaceDiff', () => {
  it('prefixes each project’s working-tree changes against HEAD', async () => {
    await initRepo(join(scratch, 'project_a'));
    await initRepo(join(scratch, 'project_b'));
    await writeFile(join(scratch, 'project_a', 'index.ts'), 'export const a = 2;\n');
    await writeFile(join(scratch, 'project_b', 'untracked.ts'), 'new\n');

    const files = await collectWorkspaceDiff(await discoverRepos(scratch));
    expect(files.map((file) => [file.path, file.status])).toEqual([
      ['project_a/index.ts', 'modified'],
      ['project_b/untracked.ts', 'added'],
    ]);
  });
});
