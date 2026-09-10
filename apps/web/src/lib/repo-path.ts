/**
 * Tool inputs carry absolute paths, but every surface here speaks repo-relative posix.
 * Returns null when the path is outside the repository, so the caller can fall back.
 */
export function toRepoRelative(path: string, repoPath: string | undefined): string | null {
  if (!path || !repoPath) return null;

  const file = normalize(path);
  const root = normalize(repoPath).replace(/\/+$/, '');
  if (!root) return null;

  // Windows paths differ only by case, so compare them that way.
  const windows = /^[a-z]:\//i.test(root);
  const left = windows ? file.toLowerCase() : file;
  const right = windows ? root.toLowerCase() : root;

  return left.startsWith(`${right}/`) ? file.slice(root.length + 1) : null;
}

/** Backslashes to slashes, and Git Bash's `/c/repo` back to the `c:/repo` the runner reports. */
function normalize(path: string): string {
  const slashed = path.replace(/\\/g, '/');
  const drive = /^\/([a-z])\//i.exec(slashed);
  return drive ? `${drive[1]}:/${slashed.slice(3)}` : slashed;
}
