import { mkdirSync } from 'node:fs';
import type { EnvSpec } from '@agent-console/contracts';
import type { EnvironmentProvider } from '@agent-console/providers';
import { dataRoot } from '@agent-console/runner/data-root';
import { NextResponse } from 'next/server';
import { sessionCredentials } from '@/lib/deployment';
import { sessionFiles } from '@/server/credentials';
import { getProvider, runnerEnv, sweepStaleAuthEnvironments } from '@/server/provider';
import { readSession, writeSession } from '@/server/session';

/**
 * The environment the Settings cards drive a sign-in through. In sandbox mode it is a
 * sandbox with no project, created on demand and reused across cards until the capture
 * deletes it; locally it is a runner at the shared data root, where the machine's own
 * logins live. One per session either way.
 */
export async function POST(): Promise<NextResponse> {
  const provider = await getProvider();
  const session = sessionCredentials ? await readSession() : undefined;

  try {
    if (session?.authEnvironmentId) {
      const id = session.authEnvironmentId;
      if (await stillServing(provider, id)) return await answer(provider, id);
      await provider.destroy(id).catch(() => {});
      session.authEnvironmentId = undefined;
    }
    await sweepStaleAuthEnvironments();

    const spec: EnvSpec = session
      ? { kind: 'auth', env: runnerEnv(), files: sessionFiles(session) }
      : { repoPath: localAuthPath(), env: runnerEnv() };
    const handle = await provider.create(spec);
    if (session) {
      session.authEnvironmentId = handle.id;
      await writeSession(session);
    }
    return await answer(provider, handle.id);
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 400 });
  }
}

/** Cancels a sign-in: the sandbox costs memory for as long as it lives. */
export async function DELETE(): Promise<NextResponse> {
  const session = sessionCredentials ? await readSession() : undefined;
  const id = session?.authEnvironmentId;
  if (!session || !id) return NextResponse.json({ status: 'gone' });

  session.authEnvironmentId = undefined;
  await writeSession(session);
  await (await getProvider()).destroy(id).catch(() => {});
  return NextResponse.json({ id, status: 'gone' });
}

/**
 * Whether the session's auth sandbox can be handed out again: still running, and its runner
 * still answers. Not `start`, which would launch a second runner on top of the live one.
 */
async function stillServing(provider: EnvironmentProvider, id: string): Promise<boolean> {
  try {
    if ((await provider.status(id)) !== 'running') return false;
    const { url } = await provider.endpoint(id);
    const health = await fetch(`${url.replace(/^ws/, 'http')}/healthz`, {
      signal: AbortSignal.timeout(5_000),
    });
    return health.ok;
  } catch {
    return false;
  }
}

async function answer(provider: EnvironmentProvider, id: string): Promise<NextResponse> {
  const endpoint = await provider.endpoint(id);
  return NextResponse.json({ id, url: endpoint.url, token: endpoint.token });
}

/** Locally the sign-in runner sits at the data root, which is where `claude auth` writes. */
function localAuthPath(): string {
  const root = dataRoot();
  mkdirSync(root, { recursive: true });
  return root;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
