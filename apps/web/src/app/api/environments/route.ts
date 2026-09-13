import { mkdirSync } from 'node:fs';
import { DAYTONA_WORKSPACE } from '@agent-console/providers';
import { dataRoot } from '@agent-console/runner/data-root';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { PROVIDER_KIND } from '@/lib/deployment';
import { getProvider, runnerEnv } from '@/server/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A sandbox has to be created, cloned into and health-checked before this answers.
export const maxDuration = 120;

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
  // A sandbox can only clone: no folder on this machine, and no auth environment yet (plan 25).
  if (PROVIDER_KIND === 'daytona' && !repoUrl) {
    return NextResponse.json(
      {
        error: repoPath
          ? 'This deployment opens repositories by URL; a folder on your machine cannot be reached from a sandbox'
          : 'Provider sign-in is not available on this deployment yet',
      },
      { status: 400 },
    );
  }

  const provider = await getProvider();
  try {
    const spec = repoUrl
      ? { repoUrl, branch, env: runnerEnv(agent) }
      : { repoPath: repoPath ?? authEnvironmentPath(), env: runnerEnv(agent) };
    const handle = await provider.create(spec);
    const endpoint = await provider.endpoint(handle.id);
    return NextResponse.json({
      id: handle.id,
      url: endpoint.url,
      token: endpoint.token,
      // Where the runner sees the repository, so the client can map tool paths to it.
      repoPath: repoUrl ? DAYTONA_WORKSPACE : spec.repoPath,
    });
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 400 });
  }
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
