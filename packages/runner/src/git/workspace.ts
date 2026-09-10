import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { DiffFile } from '@agent-console/contracts';
import { collectDiff, diffTrees, snapshotTree, type Scope } from './diff.js';
import { currentBranch, isGitRepo } from './exec.js';

/** A repository that overlaps the workspace. */
export type Repo = Scope & {
  /** Where the repository sits under the workspace (posix); '' when it encloses the workspace. */
  prefix: string;
};

/** One tree id per repository prefix, all taken at the same moment. */
export type Snapshot = Record<string, string>;

const MAX_DEPTH = 3;
const SKIP = new Set(['node_modules']);

/**
 * The repositories that overlap the workspace: the one enclosing it, if any, plus
 * those nested below it. Nothing is declared — a folder holding several projects, a
 * project sitting inside a larger checkout, and a plain repository all work by looking
 * around. A nested repository owns its subtree; the enclosing one covers the rest.
 */
export async function discoverRepos(workspace: string): Promise<Repo[]> {
  const nested = (await findNested(workspace, workspace, 0)).sort((a, b) =>
    a.prefix.localeCompare(b.prefix),
  );
  if (!(await isGitRepo(workspace))) return nested;
  const enclosing: Repo = {
    cwd: workspace,
    prefix: '',
    pathspec: ['.', ...nested.map((repo) => `:(exclude)${repo.prefix}`)],
  };
  return [enclosing, ...nested];
}

async function findNested(dir: string, workspace: string, depth: number): Promise<Repo[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  // A worktree checkout has a `.git` file rather than a directory, so any entry counts.
  if (depth > 0 && entries.some((entry) => entry.name === '.git')) {
    return [{ cwd: dir, prefix: toPosix(relative(workspace, dir)), pathspec: ['.'] }];
  }
  if (depth === MAX_DEPTH) return [];

  const repos: Repo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP.has(entry.name) || entry.name === '.git') continue;
    repos.push(...(await findNested(join(dir, entry.name), workspace, depth + 1)));
  }
  return repos;
}

export async function snapshotWorkspace(repos: Repo[]): Promise<Snapshot> {
  const snapshot: Snapshot = {};
  for (const repo of repos) snapshot[repo.prefix] = await snapshotTree(repo);
  return snapshot;
}

/** What changed between two snapshots; a repository missing from either is skipped. */
export async function diffWorkspace(
  repos: Repo[],
  before: Snapshot,
  after: Snapshot,
): Promise<DiffFile[]> {
  const files: DiffFile[] = [];
  for (const repo of repos) {
    const [from, to] = [before[repo.prefix], after[repo.prefix]];
    if (from && to) files.push(...prefixed(repo, await diffTrees(repo, from, to)));
  }
  return files;
}

/** Every repository's working tree against its HEAD. */
export async function collectWorkspaceDiff(repos: Repo[]): Promise<DiffFile[]> {
  const files: DiffFile[] = [];
  for (const repo of repos) files.push(...prefixed(repo, await collectDiff(repo)));
  return files;
}

/** The branch a turn is labelled with: the enclosing repository's, or the only nested one's. */
export async function workspaceBranch(repos: Repo[]): Promise<string | undefined> {
  const repo =
    repos.find((candidate) => candidate.prefix === '') ??
    (repos.length === 1 ? repos[0] : undefined);
  return repo ? currentBranch(repo.cwd) : undefined;
}

function prefixed(repo: Repo, files: DiffFile[]): DiffFile[] {
  if (!repo.prefix) return files;
  return files.map((file) => ({
    ...file,
    path: `${repo.prefix}/${file.path}`,
    ...(file.oldPath ? { oldPath: `${repo.prefix}/${file.oldPath}` } : {}),
  }));
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}
