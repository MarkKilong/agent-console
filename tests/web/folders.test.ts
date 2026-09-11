import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceError } from '../../apps/web/src/lib/project-source.js';
import {
  createFolder,
  expandHome,
  inspectFolder,
  listCloneFolders,
  listFolders,
} from '../../apps/web/src/server/folders.js';

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'agent-console-folders-'));
  // The temp dir may sit inside someone's repository; the ceiling keeps git below it.
  vi.stubEnv('GIT_CEILING_DIRECTORIES', tmpdir());
});

afterEach(() => vi.unstubAllEnvs());

/** The rejection itself, so a test can read its code instead of only its message. */
async function failure(promise: Promise<unknown>): Promise<SourceError> {
  try {
    await promise;
  } catch (error) {
    return error as SourceError;
  }
  throw new Error('expected the call to fail');
}

describe('inspectFolder', () => {
  it('resolves the path and reports a folder that is not a repository', async () => {
    await mkdir(join(scratch, 'app'));
    await expect(inspectFolder(`${scratch}/app/`)).resolves.toEqual({
      path: join(scratch, 'app'),
      name: 'app',
      isGitRepo: false,
    });
  });

  it('sees the repository once git init has run', async () => {
    const dir = join(scratch, 'repo');
    await mkdir(dir);
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe' });

    const folder = await inspectFolder(dir);
    expect(folder.isGitRepo).toBe(true);
  });

  it('refuses a file', async () => {
    const file = join(scratch, 'notes.txt');
    await writeFile(file, 'hi');

    const error = await failure(inspectFolder(file));
    expect(error.code).toBe('not_a_folder');
    expect(error.message).toContain(file);
  });

  it('names the path it could not find', async () => {
    const missing = join(scratch, 'nope');

    const error = await failure(inspectFolder(missing));
    expect(error.code).toBe('not_found');
    expect(error.message).toBe(`No folder at ${missing}`);
  });
});

describe('expandHome', () => {
  it('reads ~ the way a shell would', () => {
    expect(expandHome('~')).toBe(homedir());
    expect(expandHome('~/code')).toBe(join(homedir(), 'code'));
  });

  it('leaves any other path alone, minus the space around it', () => {
    expect(expandHome('  /srv/app  ')).toBe('/srv/app');
  });
});

describe('listFolders', () => {
  it('lists the visible subfolders in order, with somewhere to go from here', async () => {
    await mkdir(join(scratch, 'beta'));
    await mkdir(join(scratch, 'alpha'));
    await mkdir(join(scratch, '.x'));
    await writeFile(join(scratch, 'readme.md'), '');

    const listing = await listFolders(scratch);
    expect(listing.entries).toEqual([
      { name: 'alpha', path: join(scratch, 'alpha') },
      { name: 'beta', path: join(scratch, 'beta') },
    ]);
    expect(listing.path).toBe(resolve(scratch));
    expect(listing.parent).not.toBeNull();
    expect(listing.roots.length).toBeGreaterThan(0);
  });

  it('reports a folder it cannot open', async () => {
    const error = await failure(listFolders(join(scratch, 'nope')));
    expect(error.code).toBe('not_found');
  });
});

describe('listCloneFolders', () => {
  /** A root that does not exist yet, the way it looks before the first clone. */
  const root = () => join(scratch, 'agent-console');

  it('creates the root on demand and offers nowhere above it', async () => {
    const listing = await listCloneFolders(undefined, root());

    expect(listing.path).toBe(resolve(root()));
    expect(listing.parent).toBeNull();
    expect(listing.roots).toEqual([{ name: 'agent-console', path: resolve(root()) }]);
    expect(existsSync(root())).toBe(true);
  });

  it('goes up only as far as the root', async () => {
    await mkdir(join(root(), 'work'), { recursive: true });

    const listing = await listCloneFolders(join(root(), 'work'), root());
    expect(listing.parent).toBe(resolve(root()));
    expect(listing.roots).toHaveLength(1);
  });

  it('refuses a path outside the root', async () => {
    const error = await failure(listCloneFolders(join(scratch, 'elsewhere'), root()));
    expect(error.code).toBe('outside_root');
  });

  it('refuses a path that climbs out with ..', async () => {
    const error = await failure(listCloneFolders(join(root(), '..', 'elsewhere'), root()));
    expect(error.code).toBe('outside_root');
  });

  it('does not take a sibling that starts with the root name for a child', async () => {
    const error = await failure(listCloneFolders(`${root()}-old`, root()));
    expect(error.code).toBe('outside_root');
  });
});

describe('createFolder', () => {
  const root = () => join(scratch, 'agent-console');

  it('makes the folder and hands it back', async () => {
    const entry = await createFolder(root(), 'work', root());

    expect(entry).toEqual({ name: 'work', path: join(resolve(root()), 'work') });
    expect(existsSync(entry.path)).toBe(true);
  });

  it('reports a folder that is already there', async () => {
    await createFolder(root(), 'work', root());

    const error = await failure(createFolder(root(), 'work', root()));
    expect(error.code).toBe('exists');
  });

  it.each(['..', '.', 'a/b', 'a\\b', '  '])('refuses %j as a name', async (name) => {
    const error = await failure(createFolder(root(), name, root()));
    expect(error.code).toBe('invalid_url');
  });

  it('refuses a parent outside the root', async () => {
    const error = await failure(createFolder(join(scratch, 'elsewhere'), 'work', root()));
    expect(error.code).toBe('outside_root');
  });
});
