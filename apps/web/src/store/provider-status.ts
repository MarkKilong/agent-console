import { fetchCredentials } from '@/lib/credentials-api';
import { sessionCredentials } from '@/lib/deployment';
import { useAuthStore } from './use-auth-store';
import { useCodexAuthStore } from './use-codex-auth-store';
import { useGithubStore } from './use-github-store';

/**
 * Makes the three provider cards know where they stand. Locally that means opening the
 * auth environment and asking its runner; in sandbox mode the session already knows, and
 * a sandbox is created only when a sign-in actually starts.
 */
export async function loadProviderStatus(): Promise<void> {
  if (!sessionCredentials) return useAuthStore.getState().ensure();
  const summary = await fetchCredentials();
  useAuthStore.getState().seed(summary);
  useCodexAuthStore.getState().seed(summary);
  useGithubStore.getState().seed(summary);
}

/**
 * Gives the auth sandbox back. It costs a slice of the organisation's memory quota for as
 * long as it lives, so a cancelled sign-in closes it. Locally the runner is the machine's own.
 */
export async function closeAuthEnvironment(): Promise<void> {
  if (!sessionCredentials) return;
  const { environment, capturing } = useAuthStore.getState();
  // A capture is reading the credential out of that sandbox; it deletes it when it is done.
  if (!environment || capturing) return;
  useAuthStore.getState().reset();
  useCodexAuthStore.getState().stop();
  useGithubStore.getState().stop();
  await fetch(`/api/environments/${environment.id}`, { method: 'DELETE' }).catch(() => {});
}
