import { describe, expect, it } from 'vitest';
import { toRepoRelative } from '../../apps/web/src/lib/repo-path.js';

describe('toRepoRelative', () => {
  it('relativises a windows path whatever the case or slash', () => {
    expect(toRepoRelative('C:\\repo\\src\\app.ts', 'C:\\repo')).toBe('src/app.ts');
    expect(toRepoRelative('c:/REPO/src/app.ts', 'C:\\repo')).toBe('src/app.ts');
    expect(toRepoRelative('C:\\repo\\src\\app.ts', 'C:/repo/')).toBe('src/app.ts');
  });

  it('understands the /c/repo form Git Bash reports', () => {
    expect(toRepoRelative('/c/repo/src/app.ts', 'C:\\repo')).toBe('src/app.ts');
    expect(toRepoRelative('C:\\repo\\src\\app.ts', '/c/repo')).toBe('src/app.ts');
  });

  it('relativises a posix path and keeps its case', () => {
    expect(toRepoRelative('/home/mark/repo/src/App.ts', '/home/mark/repo')).toBe('src/App.ts');
    expect(toRepoRelative('/home/mark/Repo/src/app.ts', '/home/mark/repo')).toBeNull();
  });

  it('refuses anything that is not inside the repository', () => {
    expect(toRepoRelative('/elsewhere/app.ts', '/home/mark/repo')).toBeNull();
    expect(toRepoRelative('/home/mark/repo', '/home/mark/repo')).toBeNull();
    expect(toRepoRelative('src/app.ts', '/home/mark/repo')).toBeNull();
    expect(toRepoRelative('/home/mark/repo/src/app.ts', undefined)).toBeNull();
  });
});
