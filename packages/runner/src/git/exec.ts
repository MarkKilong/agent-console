import { execFile } from 'node:child_process';

export type GitResult = { code: number; stdout: string; stderr: string };

/** Runs git without a shell and never rejects; callers decide what an exit code means. */
export function git(cwd: string, args: string[], env?: Record<string, string>): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === 'number'
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

/** The checked-out branch; undefined outside a repo, on a detached HEAD, or before the first commit. */
export async function currentBranch(cwd: string): Promise<string | undefined> {
  const result = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = result.stdout.trim();
  return result.code === 0 && branch && branch !== 'HEAD' ? branch : undefined;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  return result.code === 0 && result.stdout.trim() === 'true';
}
