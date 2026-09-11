import { mkdir, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import {
  SourceError,
  type FolderEntry,
  type FolderListing,
  type InspectedFolder,
} from '@/lib/project-source';

/** `~` and `~/x` mean the home folder, as they do in every shell the user types paths into. */
export function expandHome(path: string): string {
  const trimmed = path.trim();
  if (trimmed === '~') return homedir();
  if (/^~[\\/]/.test(trimmed)) return join(homedir(), trimmed.slice(2));
  return trimmed;
}

/** The one folder clones live under; the user only ever picks subfolders of it. */
export function cloneRoot(): string {
  return join(homedir(), 'agent-console');
}

/** The root only exists once someone clones or browses, so every reader creates it. */
export async function ensureCloneRoot(root: string = cloneRoot()): Promise<string> {
  const full = resolve(root);
  await mkdir(full, { recursive: true });
  return full;
}

/**
 * Resolves a path the user typed or pasted to a folder that exists. The message names
 * what went wrong, since a typo and a file are both "not a project folder" to the user.
 */
export async function inspectFolder(path: string): Promise<InspectedFolder> {
  const expanded = expandHome(path);
  if (!expanded) throw new SourceError('Enter a folder path', 'not_found');
  const full = resolve(expanded);

  let info;
  try {
    info = await stat(full);
  } catch {
    throw new SourceError(`No folder at ${full}`, 'not_found');
  }
  if (!info.isDirectory()) throw new SourceError(`${full} is a file, not a folder`, 'not_a_folder');

  return { path: full, name: basename(full) || full, isGitRepo: await isDir(join(full, '.git')) };
}

/** One level of the folder browser; no path means the home folder. */
export async function listFolders(path?: string): Promise<FolderListing> {
  const full = path?.trim() ? resolve(expandHome(path)) : homedir();

  let names: string[];
  try {
    names = await readdir(full);
  } catch {
    throw new SourceError(`Cannot open ${full}`, 'not_found');
  }

  const entries = await Promise.all(
    names
      // Hidden folders are never projects; `.git` least of all.
      .filter((name) => !name.startsWith('.'))
      .map(async (name) =>
        (await isDir(join(full, name))) ? { name, path: join(full, name) } : null,
      ),
  );

  const parent = dirname(full);
  return {
    path: full,
    parent: parent === full ? null : parent,
    entries: entries
      .filter((entry): entry is FolderEntry => entry !== null)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    roots: await roots(),
  };
}

/** The same browser fenced to the clone root: nothing above it, and only it to jump to. */
export async function listCloneFolders(
  path?: string,
  root: string = cloneRoot(),
): Promise<FolderListing> {
  const base = await ensureCloneRoot(root);
  const full = path?.trim() ? resolve(expandHome(path)) : base;
  assertInside(base, full);

  const listing = await listFolders(full);
  return {
    ...listing,
    parent: samePath(full, base) ? null : listing.parent,
    roots: [{ name: basename(base), path: base }],
  };
}

/** Makes one subfolder of the clone root, so clones can be filed without leaving the dialog. */
export async function createFolder(
  parent: string,
  name: string,
  root: string = cloneRoot(),
): Promise<FolderEntry> {
  const base = await ensureCloneRoot(root);
  const full = parent.trim() ? resolve(expandHome(parent)) : base;
  assertInside(base, full);

  const folder = name.trim();
  if (!folder || folder === '.' || folder === '..' || /[\\/]/.test(folder)) {
    throw new SourceError(`${folder || 'That'} is not a folder name`, 'invalid_url');
  }

  const dest = join(full, folder);
  if (await isDir(dest)) throw new SourceError(`${dest} already exists`, 'exists');
  await mkdir(dest, { recursive: true });
  return { name: folder, path: dest };
}

export function assertInside(root: string, path: string): void {
  if (isInside(root, path)) return;
  throw new SourceError(`${path} is outside the clone folder ${root}`, 'outside_root');
}

/** True for the root itself and anything under it; `/a/bc` is not under `/a/b`. */
function isInside(root: string, path: string): boolean {
  return key(path).startsWith(key(root));
}

function samePath(a: string, b: string): boolean {
  return key(a) === key(b);
}

/** A trailing separator keeps a prefix from matching half a name; Windows ignores case. */
function key(path: string): string {
  const full = resolve(path) + sep;
  return process.platform === 'win32' ? full.toLowerCase() : full;
}

async function roots(): Promise<FolderEntry[]> {
  const home = { name: 'Home', path: homedir() };
  if (process.platform !== 'win32') return [home, { name: '/', path: '/' }];

  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const drives = await Promise.all(
    letters.map(async (letter) => ((await isDir(`${letter}:\\`)) ? `${letter}:\\` : null)),
  );
  return [
    home,
    ...drives.filter((d): d is string => d !== null).map((d) => ({ name: d, path: d })),
  ];
}

/** A stat that cannot throw: an unreadable entry is simply not a folder to browse into. */
async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
