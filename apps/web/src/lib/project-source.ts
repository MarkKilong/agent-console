/**
 * What the add-project routes answer with. Shared by the route handlers and the
 * dialog, so an error code means the same thing on both sides.
 */

export type FolderEntry = { name: string; path: string };

/** One level of the folder browser: where we are, how to go up, and what is below. */
export type FolderListing = {
  path: string;
  parent: string | null;
  entries: FolderEntry[];
  /** Places to jump to: the home folder, and each drive on Windows. */
  roots: FolderEntry[];
};

export type InspectedFolder = {
  path: string;
  name: string;
  isGitRepo: boolean;
};

export type ClonedRepository = {
  path: string;
  name: string;
};

/**
 * Why a clone or an inspect failed, beyond the sentence. `auth` and `not_found` are the
 * two the dialog explains at length, because git blurs them: GitHub says "not found" for
 * a private repository it was not shown a token for.
 */
export type SourceErrorCode =
  | 'not_found'
  | 'not_a_folder'
  | 'outside_root'
  | 'auth'
  | 'exists'
  | 'invalid_url'
  | 'network'
  | 'failed';

export type SourceErrorBody = { error: string; code: SourceErrorCode };

/** An error from one of the add-project routes, keeping the code the route sent. */
export class SourceError extends Error {
  constructor(
    message: string,
    readonly code: SourceErrorCode,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

/** `https://github.com/o/repo.git`, `git@host:o/repo.git`, `/srv/repo` → `repo`. */
export function repoNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/[\\/]+$/, '');
  const last =
    trimmed
      .split(/[\\/:]/)
      .filter(Boolean)
      .pop() ?? '';
  return last.replace(/\.git$/i, '');
}

export function folderNameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as Partial<SourceErrorBody> & T;
  if (!response.ok) {
    throw new SourceError(
      body.error ?? `Request failed (${response.status})`,
      body.code ?? 'failed',
    );
  }
  return body;
}

function post<T>(url: string, body: unknown): Promise<T> {
  return call<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function listFolders(path?: string): Promise<FolderListing> {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  return call<FolderListing>(`/api/folders${query}`);
}

/** The same browser, fenced to the clone root. */
export function listCloneFolders(path?: string): Promise<FolderListing> {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  return call<FolderListing>(`/api/projects/clone-folders${query}`);
}

export function createCloneFolder(parent: string, name: string): Promise<FolderEntry> {
  return post<FolderEntry>('/api/projects/clone-folders', { parent, name });
}

export function inspectFolder(path: string): Promise<InspectedFolder> {
  return post<InspectedFolder>('/api/projects/inspect', { path });
}

/** Where clones land unless the user picks somewhere else; only this machine knows. */
export async function defaultCloneParent(): Promise<string> {
  return (await call<{ parent: string }>('/api/projects/clone')).parent;
}

export function cloneRepository(input: {
  url: string;
  parent: string;
  name?: string;
}): Promise<ClonedRepository> {
  return post<ClonedRepository>('/api/projects/clone', input);
}
