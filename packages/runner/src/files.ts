import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { ListFilesData, ReadFileData } from '@agent-console/contracts';
import { git, isGitRepo } from './git/exec.js';

/** Refuse anything that escapes the runner's working directory. */
export function resolveInside(root: string, path: string): string {
  const resolved = resolve(root, path);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new Error(`Path escapes the workspace: ${path}`);
  }
  return resolved;
}

const MAX_READ_BYTES = 1024 * 1024;

export async function readWorkspaceFile(root: string, path: string): Promise<ReadFileData> {
  const absolute = resolveInside(root, path);
  const info = await stat(absolute);
  if (!info.isFile()) {
    throw new Error(`Not a file: ${path}`);
  }
  if (info.size > MAX_READ_BYTES) {
    throw new Error(`File is larger than ${MAX_READ_BYTES} bytes: ${path}`);
  }
  return {
    path: toPosix(relative(root, absolute)) || path,
    content: await readFile(absolute, 'utf8'),
  };
}

export async function listWorkspaceFiles(root: string, path = '.'): Promise<ListFilesData> {
  const absolute = resolveInside(root, path);
  const prefix = toPosix(relative(root, absolute));

  const files = (await isGitRepo(root))
    ? await listTrackedAndUntracked(root, absolute)
    : (await walk(absolute)).map((file) => toPosix(relative(root, file)));

  return { path: prefix || '.', files: files.sort() };
}

async function listTrackedAndUntracked(root: string, absolute: string): Promise<string[]> {
  const result = await git(root, [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    absolute,
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || 'git ls-files failed');
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const SKIP = new Set(['.git', 'node_modules']);

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(child)));
    } else if (entry.isFile()) {
      files.push(child);
    }
  }
  return files;
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}
