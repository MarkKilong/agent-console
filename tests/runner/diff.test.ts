import { execFileSync } from 'node:child_process';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffTrees, parseDiff, snapshotTree } from '../../packages/runner/src/git/diff.js';

const FIXTURE = [
  'diff --git a/src/added.ts b/src/added.ts',
  'new file mode 100644',
  'index 0000000..1234567',
  '--- /dev/null',
  '+++ b/src/added.ts',
  '@@ -0,0 +1,2 @@',
  '+export const a = 1;',
  '+',
  'diff --git a/src/changed.ts b/src/changed.ts',
  'index 1111111..2222222 100644',
  '--- a/src/changed.ts',
  '+++ b/src/changed.ts',
  '@@ -1,3 +1,3 @@',
  ' const keep = 1;',
  '-const old = 2;',
  '+const next = 2;',
  'diff --git a/src/gone.ts b/src/gone.ts',
  'deleted file mode 100644',
  'index 3333333..0000000',
  '--- a/src/gone.ts',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-export const gone = true;',
  'diff --git a/src/old-name.ts b/src/new-name.ts',
  'similarity index 100%',
  'rename from src/old-name.ts',
  'rename to src/new-name.ts',
  '',
].join('\n');

describe('parseDiff', () => {
  it('splits the patch per file and classifies each status', () => {
    const files = parseDiff(FIXTURE);
    expect(files.map((file) => [file.path, file.status])).toEqual([
      ['src/added.ts', 'added'],
      ['src/changed.ts', 'modified'],
      ['src/gone.ts', 'deleted'],
      ['src/new-name.ts', 'renamed'],
    ]);
  });

  it('keeps each file patch intact', () => {
    const [added, changed] = parseDiff(FIXTURE);
    expect(added?.patch).toContain('+export const a = 1;');
    expect(added?.patch).not.toContain('changed.ts');
    expect(changed?.patch.startsWith('diff --git a/src/changed.ts')).toBe(true);
  });

  it('returns nothing for an empty diff', () => {
    expect(parseDiff('')).toEqual([]);
  });
});

const BINARY = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);

/** A repository with one commit, plus an uncommitted file from "before the turn". */
async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agent-console-diff-'));
  const run = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });

  run(['init', '-q']);
  // The Windows default: it must not make every line of a diff look changed.
  run(['config', 'core.autocrlf', 'true']);
  await writeFile(join(root, 'keep.txt'), 'one\r\ntwo\r\nthree\r\n');
  await writeFile(join(root, 'gone.txt'), 'delete me\n');
  await writeFile(join(root, 'old-name.txt'), 'moved unchanged\n');
  await writeFile(join(root, 'logo.bin'), BINARY);
  run(['add', '-A']);
  run(['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-qm', 'init']);

  await writeFile(join(root, 'earlier.txt'), 'left over from an earlier turn\n');
  return root;
}

describe('snapshotTree and diffTrees', () => {
  it('reports only what changed between two snapshots', async () => {
    const root = await makeRepo();
    const before = await snapshotTree(root);

    await writeFile(join(root, 'keep.txt'), 'one\r\ntwo changed\r\nthree\r\n');
    await writeFile(join(root, 'new.txt'), 'no trailing newline');
    await rm(join(root, 'gone.txt'));
    await rename(join(root, 'old-name.txt'), join(root, 'new-name.txt'));
    await writeFile(join(root, 'logo.bin'), Buffer.concat([BINARY, BINARY]));

    const after = await snapshotTree(root);
    const files = await diffTrees(root, before!, after!);

    // earlier.txt existed before the snapshot, so it is not part of this diff.
    expect(files.map((file) => [file.path, file.status])).toEqual([
      ['gone.txt', 'deleted'],
      ['keep.txt', 'modified'],
      ['logo.bin', 'modified'],
      ['new-name.txt', 'renamed'],
      ['new.txt', 'added'],
    ]);

    const keep = files.find((file) => file.path === 'keep.txt');
    expect(keep?.patch).toContain('-two');
    expect(keep?.patch).toContain('+two changed');
    // CRLF only: one line changed, so exactly one pair of markers.
    expect(keep?.patch.split('\n').filter((line) => /^[-+][^-+]/.test(line))).toHaveLength(2);

    expect(files.find((file) => file.path === 'new-name.txt')?.oldPath).toBe('old-name.txt');
    expect(files.find((file) => file.path === 'new.txt')?.patch).toContain(
      '\\ No newline at end of file',
    );
    // A binary file gets a status but no reviewable patch.
    expect(files.find((file) => file.path === 'logo.bin')?.patch).toBe('');
  });

  it('sees an unchanged tree as no diff at all', async () => {
    const root = await makeRepo();
    const before = await snapshotTree(root);
    const after = await snapshotTree(root);

    expect(after).toBe(before);
    await expect(diffTrees(root, before!, after!)).resolves.toEqual([]);
  });

  it('leaves the index and HEAD alone', async () => {
    const root = await makeRepo();
    const status = () => execFileSync('git', ['status', '--porcelain'], { cwd: root }).toString();
    const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString();
    const before = { status: status(), head: head() };

    await snapshotTree(root);

    expect(status()).toBe(before.status);
    expect(head()).toBe(before.head);
    expect(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root }).toString()).toBe(
      '',
    );
  });

  it('returns nothing outside a git repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-console-plain-'));
    await expect(snapshotTree(root)).resolves.toBeUndefined();
  });
});
