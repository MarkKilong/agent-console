import { describe, expect, it } from 'vitest';
import { collapseContext, parseUnifiedDiff } from '../../apps/web/src/lib/parseUnifiedDiff.js';

const PATCH = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1234567..89abcde 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,5 +1,6 @@',
  ' import { z } from "zod";',
  ' ',
  '-const port = 3000;',
  '+const port = 4310;',
  '+const host = "127.0.0.1";',
  ' ',
  ' export { port };',
  '\\ No newline at end of file',
].join('\n');

describe('parseUnifiedDiff', () => {
  it('reads hunks with line numbers from both sides', () => {
    const { hunks, added, removed } = parseUnifiedDiff(PATCH);

    expect(added).toBe(2);
    expect(removed).toBe(1);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.header).toBe('@@ -1,5 +1,6 @@');

    expect(hunks[0]!.lines.map((line) => [line.kind, line.oldNumber, line.newNumber])).toEqual([
      ['context', 1, 1],
      ['context', 2, 2],
      ['remove', 3, undefined],
      ['add', undefined, 3],
      ['add', undefined, 4],
      ['context', 4, 5],
      ['context', 5, 6],
    ]);
  });

  it('strips the leading marker from the line text', () => {
    const lines = parseUnifiedDiff(PATCH).hunks[0]!.lines;
    expect(lines[2]!.text).toBe('const port = 3000;');
    expect(lines[3]!.text).toBe('const port = 4310;');
  });

  it('ignores everything before the first hunk header', () => {
    expect(parseUnifiedDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n').hunks).toEqual([]);
  });

  it('ignores the trailing newline instead of emitting a phantom line', () => {
    const patch = ['@@ -0,0 +1,5 @@', ...Array.from({ length: 5 }, (_, i) => `+line ${i + 1}`), ''].join(
      '\n',
    );
    const { hunks, added } = parseUnifiedDiff(patch);

    expect(added).toBe(5);
    expect(hunks[0]!.lines).toHaveLength(5);
    expect(hunks[0]!.lines.every((line) => line.kind === 'add')).toBe(true);
  });

  it('keeps empty context lines inside a hunk', () => {
    const patch = ['@@ -1,3 +1,3 @@', ' a', '', '-b', '+c', ''].join('\n');
    const lines = parseUnifiedDiff(patch).hunks[0]!.lines;

    expect(lines.map((line) => [line.kind, line.oldNumber, line.newNumber])).toEqual([
      ['context', 1, 1],
      ['context', 2, 2],
      ['remove', 3, undefined],
      ['add', undefined, 3],
    ]);
  });

  it('handles a patch with several hunks', () => {
    const patch = ['@@ -1,1 +1,1 @@', '-a', '+b', '@@ -10,1 +10,1 @@', '-c', '+d'].join('\n');
    const { hunks, added, removed } = parseUnifiedDiff(patch);

    expect(hunks).toHaveLength(2);
    expect(hunks[1]!.lines[0]!.oldNumber).toBe(10);
    expect([added, removed]).toEqual([2, 2]);
  });
});

describe('collapseContext', () => {
  it('folds long runs of unchanged lines into a gap', () => {
    const patch = [
      '@@ -1,12 +1,12 @@',
      ...Array.from({ length: 10 }, (_, i) => ` line ${i + 1}`),
      '-old',
      '+new',
    ].join('\n');

    const rows = collapseContext(parseUnifiedDiff(patch).hunks[0]!.lines, 3);
    const gaps = rows.filter((row) => row.kind === 'gap');

    expect(gaps).toEqual([{ kind: 'gap', count: 7 }]);
    expect(rows.filter((row) => row.kind === 'line')).toHaveLength(5);
  });

  it('keeps short hunks intact', () => {
    const patch = ['@@ -1,3 +1,3 @@', ' a', '-b', '+c', ' d'].join('\n');
    const rows = collapseContext(parseUnifiedDiff(patch).hunks[0]!.lines, 3);
    expect(rows.every((row) => row.kind === 'line')).toBe(true);
  });
});
