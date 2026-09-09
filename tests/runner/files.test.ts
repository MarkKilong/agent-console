import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  resolveInside,
} from '../../packages/runner/src/files.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agent-console-files-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
  await writeFile(join(root, 'README.md'), '# hi\n');
});

afterEach(() => {
  root = '';
});

describe('resolveInside', () => {
  it('accepts paths inside the workspace', () => {
    expect(resolveInside(root, 'src/a.ts')).toBe(join(root, 'src', 'a.ts'));
  });

  it.each(['../secret.txt', 'src/../../secret.txt', '/etc/passwd'])('rejects %s', (path) => {
    expect(() => resolveInside(root, path)).toThrow(/escapes the workspace/);
  });
});

describe('readWorkspaceFile', () => {
  it('reads a file relative to the workspace', async () => {
    await expect(readWorkspaceFile(root, 'src/a.ts')).resolves.toEqual({
      path: 'src/a.ts',
      content: 'export const a = 1;\n',
    });
  });

  it('refuses to read outside the workspace', async () => {
    await expect(readWorkspaceFile(root, '../../etc/hosts')).rejects.toThrow(
      /escapes the workspace/,
    );
  });

  it('refuses to read a directory', async () => {
    await expect(readWorkspaceFile(root, 'src')).rejects.toThrow(/Not a file/);
  });
});

describe('listWorkspaceFiles', () => {
  it('walks the tree when the workspace is not a git repo', async () => {
    const result = await listWorkspaceFiles(root);
    expect(result.path).toBe('.');
    expect(result.files).toEqual(['README.md', 'src/a.ts']);
  });

  it('refuses to list outside the workspace', async () => {
    await expect(listWorkspaceFiles(root, '..')).rejects.toThrow(/escapes the workspace/);
  });
});
