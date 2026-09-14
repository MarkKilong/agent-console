import { mkdirSync } from 'node:fs';
import type { EnvSpec } from '@agent-console/contracts';
import type { EnvironmentProvider } from '@agent-console/providers';
import { DAYTONA_WORKSPACE } from '@agent-console/providers';
import { dataRoot } from '@agent-console/runner/data-root';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { PROVIDER_KIND, sessionCredentials } from '@/lib/deployment';
import { sessionFiles } from '@/server/credentials';
import { getProvider, runnerEnv, sweepStaleAuthEnvironments } from '@/server/provider';
import { readSession, writeSession } from '@/server/session';

const BodySchema = z.object({
  repoPath: z.string().trim().min(1).optional(),
  repoUrl: z.string().trim().min(1).optional(),
  branch: z.string().trim().min(1).optional(),
  agent: z.enum(['claude', 'codex']).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    const invalidAgent = parsed.error.issues.some((issue) => issue.path[0] === 'agent');
    return NextResponse.json(
      { error: invalidAgent ? 'agent must be claude or codex' : 'repoPath must be a folder path' },
      { status: 400 },
    );
  }

  const { repoPath, repoUrl, branch, agent } = parsed.data;
  const sandbox = PROVIDER_KIND === 'daytona';
  if (sandbox && repoPath) {
    return NextResponse.json(
      {
        error:
          'This deployment opens repositories by URL; a folder on your machine cannot be reached from a sandbox',
      },
      { status: 400 },
    );
  }

  const provider = await getProvider();
  const session = sessionCredentials ? await readSession() : undefined;
  // No repository in sandbox mode is the auth environment: one per session, reused.
  const authEnvironment = sandbox && !repoUrl;

  try {
    if (authEnvironment && session?.authEnvironmentId) {
      const id = session.authEnvironmentId;
      if (await stillServing(provider, id)) return await answer(provider, id);
      await provider.destroy(id).catch(() => {});
      session.authEnvironmentId = undefined;
    }
    if (sandbox) await sweepStaleAuthEnvironments();

    // The session's sign-ins go in at create, so the runner and the CLIs find them on boot.
    const files = session ? sessionFiles(session) : undefined;
    const spec: EnvSpec = repoUrl
      ? { repoUrl, branch, env: runnerEnv(agent), files }
      : sandbox
        ? { env: runnerEnv(agent), files }
        : { repoPath: repoPath ?? authEnvironmentPath(), env: runnerEnv(agent) };
    const handle = await provider.create(spec);
    if (authEnvironment && session) {
      session.authEnvironmentId = handle.id;
      await writeSession(session);
    }
    return await answer(provider, handle.id, spec.repoPath);
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 400 });
  }
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

async function answer(
  provider: EnvironmentProvider,
  id: string,
  repoPath?: string,
): Promise<NextResponse> {
  const endpoint = await provider.endpoint(id);
  return NextResponse.json({
    id,
    url: endpoint.url,
    token: endpoint.token,
    // Where the runner sees the repository, so the client can map tool paths to it.
    repoPath: PROVIDER_KIND === 'daytona' ? DAYTONA_WORKSPACE : repoPath,
  });
}

/**
 * No repoPath means the auth environment: a runner at the shared data root, which only
 * ever answers the `auth_*` commands. The provider reuses it across visits.
 */
function authEnvironmentPath(): string {
  const root = dataRoot();
  mkdirSync(root, { recursive: true });
  return root;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
