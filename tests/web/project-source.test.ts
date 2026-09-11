import { describe, expect, it } from 'vitest';
import { folderNameOf, repoNameFromUrl } from '../../apps/web/src/lib/project-source.js';

describe('repoNameFromUrl', () => {
  it('names an https clone with or without the .git suffix', () => {
    expect(repoNameFromUrl('https://github.com/owner/repo.git')).toBe('repo');
    expect(repoNameFromUrl('https://github.com/owner/repo')).toBe('repo');
  });

  it('reads scp-like syntax the same way', () => {
    expect(repoNameFromUrl('git@github.com:owner/repo.git')).toBe('repo');
  });

  it('ignores a trailing slash and surrounding space', () => {
    expect(repoNameFromUrl('  https://github.com/owner/repo/  ')).toBe('repo');
  });

  it('names a local path, backslashes and all', () => {
    expect(repoNameFromUrl('C:\\code\\my-app')).toBe('my-app');
    expect(repoNameFromUrl('/srv/code/my-app.git')).toBe('my-app');
  });
});

describe('folderNameOf', () => {
  it('takes the last segment whichever separator was typed', () => {
    expect(folderNameOf('C:\\code\\my-app')).toBe('my-app');
    expect(folderNameOf('/srv/apps/web/')).toBe('web');
  });

  it('keeps a bare name as it is', () => {
    expect(folderNameOf('my-app')).toBe('my-app');
  });
});
