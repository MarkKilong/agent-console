import { describe, expect, it } from 'vitest';
import {
  buildTree,
  filterTree,
  folderPaths,
  type FileNode,
} from '../../apps/web/src/lib/file-tree.js';

const PATHS = [
  'README.md',
  'apps/web/src/components/composer.tsx',
  'apps/web/package.json',
  'Apps.md',
  'packages/runner/src/server.ts',
];

function names(nodes: FileNode[]): string[] {
  return nodes.map((node) => node.name);
}

describe('buildTree', () => {
  it('nests paths and puts folders before files, case-insensitively', () => {
    const tree = buildTree(PATHS);

    expect(names(tree)).toEqual(['apps', 'packages', 'Apps.md', 'README.md']);
    const apps = tree[0];
    expect(apps?.kind).toBe('folder');
    if (apps?.kind !== 'folder') return;
    const web = apps.children[0];
    expect(web?.kind === 'folder' && names(web.children)).toEqual(['src', 'package.json']);
  });

  it('keeps the full repo-relative path on every file', () => {
    const tree = buildTree(['a/b/c.ts']);
    const a = tree[0];
    const b = a?.kind === 'folder' ? a.children[0] : undefined;
    const c = b?.kind === 'folder' ? b.children[0] : undefined;

    expect(c).toEqual({ kind: 'file', name: 'c.ts', path: 'a/b/c.ts' });
  });
});

describe('filterTree', () => {
  it('keeps matching files and the folders that lead to them', () => {
    const kept = filterTree(buildTree(PATHS), 'composer');

    expect(folderPaths(kept)).toEqual([
      'apps',
      'apps/web',
      'apps/web/src',
      'apps/web/src/components',
    ]);
    expect(names(kept)).toEqual(['apps']);
  });

  it('matches on the whole path, so a folder name narrows to its files', () => {
    const kept = filterTree(buildTree(PATHS), 'runner');

    expect(folderPaths(kept)).toEqual(['packages', 'packages/runner', 'packages/runner/src']);
  });

  it('drops everything when nothing matches, and passes the tree through when empty', () => {
    const tree = buildTree(PATHS);

    expect(filterTree(tree, 'nothing-here')).toEqual([]);
    expect(filterTree(tree, '  ')).toBe(tree);
  });
});
