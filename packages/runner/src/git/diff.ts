import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiffFile, DiffStatus } from '@agent-console/contracts';
import { git } from './exec.js';

/** The slice of one repository that git commands are confined to. */
export type Scope = {
  /** Where git runs: the repository root, or the workspace when the repository encloses it. */
  cwd: string;
  /** Pathspecs keeping git inside the workspace: `.` plus exclusions for nested repositories. */
  pathspec: string[];
};

/** Working tree vs HEAD (staged and unstaged), plus untracked files as additions. */
export async function collectDiff({ cwd, pathspec }: Scope): Promise<DiffFile[]> {
  const files: DiffFile[] = [];

  const hasHead = (await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])).code === 0;
  const tracked = await git(cwd, [
    'diff',
    '--no-color',
    '--relative',
    ...(hasHead ? ['HEAD'] : []),
    '--',
    ...pathspec,
  ]);
  files.push(...parseDiff(tracked.stdout));

  const untracked = (
    await git(cwd, ['ls-files', '--others', '--exclude-standard', '--', ...pathspec])
  ).stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const path of untracked) {
    // --no-index exits 1 when the files differ, which is the normal case here.
    const result = await git(cwd, ['diff', '--no-color', '--no-index', '--', '/dev/null', path]);
    for (const file of parseDiff(result.stdout)) {
      files.push({ ...file, path, status: 'added' });
    }
  }

  return files;
}

/**
 * Hashes the scoped working tree — untracked files included, .gitignore respected —
 * into a tree object, using a throwaway index so the repository's own index and
 * HEAD are untouched. The pathspec is what stops a workspace nested inside a larger
 * checkout from staging that whole checkout.
 */
export async function snapshotTree({ cwd, pathspec }: Scope): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-console-index-'));
  const env = { GIT_INDEX_FILE: join(dir, 'index') };
  try {
    const added = await git(cwd, ['add', '-A', '--', ...pathspec], env);
    if (added.code !== 0) throw new Error(`git add failed: ${added.stderr.trim()}`);
    const tree = await git(cwd, ['write-tree'], env);
    if (tree.code !== 0) throw new Error(`git write-tree failed: ${tree.stderr.trim()}`);
    return tree.stdout.trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The patch between two snapshots, with paths relative to the scope. Tree-to-tree
 * diffs read blobs that were already normalized on the way in, so `core.autocrlf`
 * cannot leak into them.
 */
export async function diffTrees(
  { cwd, pathspec }: Scope,
  before: string,
  after: string,
): Promise<DiffFile[]> {
  const result = await git(cwd, [
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--relative',
    '-M',
    before,
    after,
    '--',
    ...pathspec,
  ]);
  if (result.code !== 0) throw new Error(`git diff failed: ${result.stderr.trim()}`);
  return parseDiff(result.stdout);
}

export function parseDiff(output: string): DiffFile[] {
  return splitByFile(output).map((lines) => {
    const header = headerOf(lines);
    const status = statusOf(header);
    const oldPath = valueAfter(header, 'rename from ');
    return {
      path: pathOf(header, status),
      status,
      patch: isBinary(header) ? '' : lines.join('\n'),
      ...(oldPath ? { oldPath } : {}),
    };
  });
}

function splitByFile(output: string): string[][] {
  const chunks: string[][] = [];
  let current: string[] | undefined;
  for (const line of output.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = [line];
      chunks.push(current);
    } else if (current) {
      current.push(line);
    }
  }
  return chunks;
}

/** The extended header: everything before the first hunk. */
function headerOf(lines: string[]): string[] {
  const hunk = lines.findIndex((line) => line.startsWith('@@'));
  return hunk === -1 ? lines : lines.slice(0, hunk);
}

function valueAfter(header: string[], prefix: string): string | undefined {
  const line = header.find((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length).trim();
}

function statusOf(header: string[]): DiffStatus {
  for (const line of header) {
    if (line.startsWith('new file mode')) return 'added';
    if (line.startsWith('deleted file mode')) return 'deleted';
    if (line.startsWith('rename to ')) return 'renamed';
  }
  return 'modified';
}

function isBinary(header: string[]): boolean {
  return header.some(
    (line) => line.startsWith('Binary files ') || line.startsWith('GIT binary patch'),
  );
}

function pathOf(header: string[], status: DiffStatus): string {
  const renamed = valueAfter(header, 'rename to ');
  if (renamed) return renamed;

  const prefix = status === 'deleted' ? 'a/' : 'b/';
  const value = valueAfter(header, status === 'deleted' ? '--- ' : '+++ ');
  if (value) return value.startsWith(prefix) ? value.slice(prefix.length) : value;

  // Binary files carry no ---/+++ lines; fall back to the `diff --git a/x b/y`
  // header (ambiguous only for paths with spaces).
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(header[0] ?? '');
  return match ? (status === 'deleted' ? match[1]! : match[2]!) : 'unknown';
}
