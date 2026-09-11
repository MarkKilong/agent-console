import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Everything the environment stores about who it is signed in as. */
export type Credentials = {
  anthropicApiKey?: string | undefined;
  githubToken?: string | undefined;
  githubLogin?: string | undefined;
  githubScopes?: string[] | undefined;
};

export function readCredentials(dataDir: string): Credentials {
  try {
    const parsed: unknown = JSON.parse(readFileSync(credentialsPath(dataDir), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Credentials) : {};
  } catch {
    return {};
  }
}

/**
 * Merges, because Claude and GitHub own different keys of the same file. JSON drops
 * undefined values, so a patch key set to undefined deletes it. The file is rewritten
 * rather than overwritten: `mode` only applies to a file being created.
 */
export function updateCredentials(dataDir: string, patch: Credentials): void {
  const merged = { ...readCredentials(dataDir), ...patch };
  mkdirSync(dataDir, { recursive: true });
  const path = credentialsPath(dataDir);
  rmSync(path, { force: true });
  writeFileSync(path, JSON.stringify(merged), { mode: 0o600 });
}

function credentialsPath(dataDir: string): string {
  return join(dataDir, 'credentials.json');
}
