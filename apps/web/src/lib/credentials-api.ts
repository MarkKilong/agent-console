import type {
  AuthStatusData,
  CodexAuthStatusData,
  GithubStatusData,
} from '@agent-console/contracts';

export type ProviderName = 'claude' | 'codex' | 'github';

/** What Settings shows for a connected provider. Mirrors the server's CredentialInfo. */
export type CredentialInfo = {
  email?: string;
  plan?: string;
  authMethod?: string;
  apiKey?: boolean;
  login?: string;
  scopes?: string[];
};

/** The credential routes' answer: who is connected. */
export type CredentialSummary = Partial<Record<ProviderName, CredentialInfo>>;

export function fetchCredentials(): Promise<CredentialSummary> {
  return send('/api/credentials', { method: 'GET' });
}

export function captureCredentials(
  environmentId: string,
  provider: ProviderName,
  info: CredentialInfo,
): Promise<CredentialSummary> {
  return send('/api/credentials/capture', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ environmentId, provider, info }),
  });
}

export function disconnectCredentials(provider: ProviderName): Promise<CredentialSummary> {
  return send(`/api/credentials/${provider}`, { method: 'DELETE' });
}

/**
 * Sandbox mode has no runner standing by once a sign-in is captured, so the session's own
 * record stands in for the status each card renders.
 */
export function claudeStatusOf(info: CredentialInfo | undefined): AuthStatusData {
  return {
    loggedIn: Boolean(info?.authMethod && info.authMethod !== 'none'),
    authMethod: info?.authMethod ?? 'none',
    email: info?.email,
    subscriptionType: info?.plan,
    apiKey: info?.apiKey ?? false,
    loginPending: false,
  };
}

export function codexStatusOf(info: CredentialInfo | undefined): CodexAuthStatusData {
  return {
    // The snapshot ships the CLI, so the card offers a sign-in whether or not one is stored.
    installed: true,
    loggedIn: Boolean(info),
    authMethod: codexMethod(info?.authMethod),
    loginPending: false,
  };
}

export function githubStatusOf(info: CredentialInfo | undefined): GithubStatusData {
  return { connected: Boolean(info), login: info?.login, scopes: info?.scopes };
}

function codexMethod(value: string | undefined): CodexAuthStatusData['authMethod'] {
  return value === 'chatgpt' || value === 'api_key' || value === 'access_token' ? value : 'none';
}

async function send(url: string, init: RequestInit): Promise<CredentialSummary> {
  const response = await fetch(url, init);
  const body = (await response.json()) as CredentialSummary | { error: string };
  if (!response.ok) {
    throw new Error('error' in body ? body.error : 'The credential store could not be reached');
  }
  return body as CredentialSummary;
}
