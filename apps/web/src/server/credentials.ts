import type { EnvFile } from '@agent-console/contracts';
import {
  DAYTONA_CLAUDE_CONFIG_DIR,
  DAYTONA_DATA_DIR,
  DAYTONA_HOME,
} from '@agent-console/providers';

import { z } from 'zod';

export const PROVIDER_NAMES = ['claude', 'codex', 'github'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

/** What Settings renders for a connected provider with no sandbox to ask. Never a secret. */
export const CredentialInfoSchema = z.object({
  email: z.string().optional(),
  plan: z.string().optional(),
  /** `claude.ai`, `console`, `chatgpt`, … — whatever the CLI called it. */
  authMethod: z.string().optional(),
  /** Claude: a stored `ANTHROPIC_API_KEY` rather than a CLI login. */
  apiKey: z.boolean().optional(),
  login: z.string().optional(),
  scopes: z.array(z.string()).optional(),
});
export type CredentialInfo = z.infer<typeof CredentialInfoSchema>;

/** What one connected provider left behind: its credential files and what to show for it. */
export type ProviderSlot = {
  /** File contents keyed by their absolute path inside the sandbox. */
  files: Record<string, string>;
  info: CredentialInfo;
};

/** Everything this browser is signed in to, as the session cookie carries it. */
export type Session = {
  providers: Partial<Record<ProviderName, ProviderSlot>>;
  /**
   * The auth sandbox this browser already has, so a second sign-in reuses it instead of
   * spending another slice of the organisation's memory quota on a duplicate.
   */
  authEnvironmentId?: string;
};

/** The runner keeps the Anthropic key and the GitHub token in one file, hence `keys`. */
const RUNNER_CREDENTIALS = `${DAYTONA_DATA_DIR}/credentials.json`;

type BundleEntry = {
  path: string;
  mode: number;
  /** Only these top-level JSON keys belong to this provider; absent means the whole file. */
  keys?: readonly string[];
};

const BUNDLE: Record<ProviderName, readonly BundleEntry[]> = {
  claude: [
    { path: `${DAYTONA_CLAUDE_CONFIG_DIR}/.credentials.json`, mode: 0o600 },
    { path: RUNNER_CREDENTIALS, mode: 0o600, keys: ['anthropicApiKey'] },
  ],
  codex: [{ path: `${DAYTONA_HOME}/.codex/auth.json`, mode: 0o600 }],
  github: [
    {
      path: RUNNER_CREDENTIALS,
      mode: 0o600,
      keys: ['githubToken', 'githubLogin', 'githubScopes'],
    },
  ],
};

/** Where to look inside a sandbox for a provider's credentials. */
export function bundlePaths(provider: ProviderName): string[] {
  return BUNDLE[provider].map((entry) => entry.path);
}

/** Every path the session already holds, so a read-back asks for nothing it does not own. */
export function storedPaths(session: Session): string[] {
  const paths = new Set<string>();
  for (const slot of Object.values(session.providers)) {
    for (const path of Object.keys(slot.files)) paths.add(path);
  }
  return [...paths];
}

/**
 * Keeps only what this provider owns out of what a sandbox held: a whole file, or the
 * keys it writes into one it shares. A file that is not there is simply not captured.
 */
export function captureFiles(
  provider: ProviderName,
  found: Record<string, string>,
): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of BUNDLE[provider]) {
    const content = found[entry.path];
    if (content === undefined) continue;
    const owned = entry.keys ? pickKeys(content, entry.keys) : content;
    if (owned !== undefined) files[entry.path] = owned;
  }
  return files;
}

/** The session's credentials as files to write into the next sandbox, before its runner starts. */
export function sessionFiles(session: Session): EnvFile[] {
  const contents = new Map<string, string>();
  const modes = new Map<string, number>();
  for (const provider of PROVIDER_NAMES) {
    for (const entry of BUNDLE[provider]) {
      const content = session.providers[provider]?.files[entry.path];
      if (content === undefined) continue;
      const existing = contents.get(entry.path);
      // Two providers share the runner's credentials file, so merge rather than overwrite.
      contents.set(entry.path, existing === undefined ? content : mergeJson(existing, content));
      modes.set(entry.path, entry.mode);
    }
  }
  return [...contents].map(([path, content]) => ({ path, content, mode: modes.get(path) }));
}

/**
 * Folds credentials read back out of a sandbox into the session — Claude rotates the
 * refresh token inside its file every time it runs. Returns whether anything moved.
 */
export function refreshStored(session: Session, found: Record<string, string>): boolean {
  let changed = false;
  for (const provider of PROVIDER_NAMES) {
    const slot = session.providers[provider];
    if (!slot) continue;
    for (const [path, content] of Object.entries(captureFiles(provider, found))) {
      if (slot.files[path] === content) continue;
      slot.files[path] = content;
      changed = true;
    }
  }
  return changed;
}

/** What `GET /api/credentials` answers: which providers are connected, and nothing secret. */
export function summarise(session: Session): Partial<Record<ProviderName, CredentialInfo>> {
  const summary: Partial<Record<ProviderName, CredentialInfo>> = {};
  for (const provider of PROVIDER_NAMES) {
    const slot: ProviderSlot | undefined = session.providers[provider];
    if (slot) summary[provider] = slot.info;
  }
  return summary;
}

/** The credential routes answer this where the machine's own logins are what environments use. */
export function localOnly(): Response {
  return Response.json(
    { error: 'This deployment keeps provider sign-ins on the machine, not in the session' },
    { status: 404 },
  );
}

function pickKeys(content: string, keys: readonly string[]): string | undefined {
  const parsed = parseObject(content);
  if (!parsed) return undefined;
  const owned = Object.fromEntries(
    keys.filter((key) => parsed[key] !== undefined).map((key) => [key, parsed[key]]),
  );
  return Object.keys(owned).length > 0 ? JSON.stringify(owned) : undefined;
}

/** Both sides are one file's worth of JSON; anything that is not an object simply wins. */
function mergeJson(left: string, right: string): string {
  const a = parseObject(left);
  const b = parseObject(right);
  return a && b ? JSON.stringify({ ...a, ...b }) : right;
}

function parseObject(content: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
