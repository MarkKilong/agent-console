import type { GithubLoginStartData, GithubStatusData } from '@agent-console/contracts';
import { readCredentials, updateCredentials } from './credentials.js';

/** Public id of the agent-console OAuth App; device flow has no client secret. */
export const GITHUB_CLIENT_ID = 'Ov23liNlg1a7AWxo4YB4';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/** `repo` for private clones, `workflow` so a push touching `.github/` is accepted, `read:org`
 * because `gh auth status` calls it required. */
const SCOPES = 'repo workflow read:org';

export type GitHubAuthOptions = {
  /** Where `credentials.json` lives; machine-level, shared by every runner. */
  dataDir: string;
  fetch?: typeof globalThis.fetch;
  /** Injected by tests, so `slow_down`'s extra five seconds cost nothing. */
  sleep?: (ms: number) => Promise<void>;
};

type PendingLogin = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalMs: number;
  cancelled: boolean;
};

/**
 * GitHub's OAuth device flow, spoken directly over `fetch`: no `gh` and no client
 * secret. `loginStart` returns as soon as GitHub has issued the code to show, then
 * polls in the background until the user approves, denies, or lets it expire.
 */
export class GitHubAuth {
  private readonly fetch: typeof globalThis.fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private pending: PendingLogin | undefined;
  /** Why the last login ended without a token; the next status carries it once. */
  private lastError: string | undefined;

  constructor(private readonly options: GitHubAuthOptions) {
    this.fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Offline-safe: the login and scopes were captured at sign-in, so nothing is called. */
  status(): GithubStatusData {
    const stored = readCredentials(this.options.dataDir);
    const pending = this.pending;
    return {
      connected: Boolean(stored.githubToken),
      login: stored.githubLogin,
      scopes: stored.githubScopes,
      pending: pending
        ? { userCode: pending.userCode, verificationUri: pending.verificationUri }
        : undefined,
      error: this.lastError,
    };
  }

  async loginStart(): Promise<GithubLoginStartData> {
    this.cancel();
    const body = await this.post(DEVICE_CODE_URL, {
      client_id: GITHUB_CLIENT_ID,
      scope: SCOPES,
    });

    const deviceCode = text(body.device_code);
    const userCode = text(body.user_code);
    const verificationUri = text(body.verification_uri);
    if (!deviceCode || !userCode || !verificationUri) {
      throw new Error(failure(body, 'GitHub did not return a device code'));
    }

    const login: PendingLogin = {
      deviceCode,
      userCode,
      verificationUri,
      intervalMs: (number(body.interval) ?? 5) * 1000,
      cancelled: false,
    };
    this.pending = login;
    void this.poll(login);
    return { userCode, verificationUri, expiresIn: number(body.expires_in) ?? 0 };
  }

  cancel(): void {
    if (this.pending) this.pending.cancelled = true;
    this.pending = undefined;
    this.lastError = undefined;
  }

  logout(): void {
    this.cancel();
    updateCredentials(this.options.dataDir, {
      githubToken: undefined,
      githubLogin: undefined,
      githubScopes: undefined,
    });
  }

  /** Read per call: a sign-in must reach the next turn without a restart. */
  token(): string | undefined {
    return readCredentials(this.options.dataDir).githubToken || undefined;
  }

  close(): void {
    this.cancel();
  }

  private async poll(login: PendingLogin): Promise<void> {
    let intervalMs = login.intervalMs;
    for (;;) {
      await this.sleep(intervalMs);
      if (login.cancelled) return;

      let body: Record<string, unknown>;
      try {
        body = await this.post(ACCESS_TOKEN_URL, {
          client_id: GITHUB_CLIENT_ID,
          device_code: login.deviceCode,
          grant_type: DEVICE_GRANT,
        });
      } catch (error) {
        this.finish(login, messageOf(error));
        return;
      }
      if (login.cancelled) return;

      const error = text(body.error);
      if (error === 'authorization_pending') continue;
      if (error === 'slow_down') {
        // GitHub's own advice: back off by five seconds on top of the interval it names.
        intervalMs = ((number(body.interval) ?? intervalMs / 1000) + 5) * 1000;
        continue;
      }
      if (error) {
        this.finish(login, failure(body, `GitHub refused the login: ${error}`));
        return;
      }

      const token = text(body.access_token);
      if (!token) {
        this.finish(login, failure(body, 'GitHub did not return an access token'));
        return;
      }
      try {
        updateCredentials(this.options.dataDir, {
          githubToken: token,
          githubLogin: await this.accountLogin(token),
          githubScopes: text(body.scope)?.split(',').filter(Boolean),
        });
        this.finish(login, undefined);
      } catch (cause) {
        this.finish(login, messageOf(cause));
      }
      return;
    }
  }

  private async accountLogin(token: string): Promise<string | undefined> {
    const response = await this.fetch(USER_URL, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`GitHub rejected the new token (${response.status})`);
    const body: unknown = await response.json();
    return text((body as Record<string, unknown>).login);
  }

  private async post(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await this.fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      // Hand-rolled rather than URLSearchParams, which would spell a space `+`.
      body: Object.entries(form)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&'),
    });
    const body: unknown = await response.json().catch(() => undefined);
    const record =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : undefined;
    // A 400 carries the reason, e.g. "Device Flow must be explicitly enabled for this App".
    if (!response.ok) {
      throw new Error(failure(record ?? {}, `GitHub answered ${response.status} for ${url}`));
    }
    if (!record) throw new Error(`GitHub sent no JSON for ${url}`);
    return record;
  }

  /** A login that has since been cancelled or replaced must not clear the new one. */
  private finish(login: PendingLogin, error: string | undefined): void {
    if (this.pending !== login) return;
    this.pending = undefined;
    this.lastError = error;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** GitHub's `error_description` is the sentence worth showing; the code alone is not. */
function failure(body: Record<string, unknown>, fallback: string): string {
  return text(body.error_description) ?? fallback;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
