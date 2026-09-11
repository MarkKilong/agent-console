import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataRoot } from '@agent-console/runner/data-root';

/** Reads the token out of the same environment, so it never lands in a config file. */
const CREDENTIAL_HELPER = '!f() { echo username=x-access-token; echo password=$GITHUB_TOKEN; }; f';
const HELPER_KEY = 'credential.https://github.com.helper';

/**
 * The GitHub sign-in made under Settings, which the runner stores in the shared
 * `credentials.json`. Read per call: a sign-in must work for the next clone.
 */
export function githubToken(): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dataRoot(), 'credentials.json'), 'utf8'));
    const token = (parsed as { githubToken?: unknown } | null)?.githubToken;
    return typeof token === 'string' && token ? token : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Same shape the runner gives its agent and terminals. With no token the prompt is still
 * off: a private clone should fail in a second with a message, not hang on a password
 * dialog nobody can see.
 */
export function gitEnv(token: string | undefined): Record<string, string> {
  if (!token) return { GIT_TERMINAL_PROMPT: '0' };
  return {
    GITHUB_TOKEN: token,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '2',
    // The empty first entry resets whatever helper the machine configured for
    // github.com, so a credential manager cannot answer before ours does.
    GIT_CONFIG_KEY_0: HELPER_KEY,
    GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: HELPER_KEY,
    GIT_CONFIG_VALUE_1: CREDENTIAL_HELPER,
  };
}
