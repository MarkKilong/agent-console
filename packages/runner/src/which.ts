import { accessSync, constants } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

/** First of `names` found on PATH, as an absolute path. */
export function resolveOnPath(names: string[]): string | undefined {
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = isAbsolute(dir) ? join(dir, name) : resolve(dir, name);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

export function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
