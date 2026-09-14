import type { EnvSpec } from '@agent-console/contracts';
import { DAYTONA_WORKSPACE } from '@agent-console/providers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { PROVIDER_KIND, sessionCredentials } from '@/lib/deployment';
import { sessionFiles } from '@/server/credentials';
import { getProvider, runnerEnv } from '@/server/provider';
import { readSession } from '@/server/session';

const BodySchema = z.object({
  repoPath: z.string().trim().min(1).optional(),
  repoUrl: z.string().trim().min(1).optional(),
  branch: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
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

  const { repoPath, repoUrl, branch, name, agent } = parsed.data;
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
  if (sandbox ? !repoUrl && !name : !repoPath) {
    return NextResponse.json(
      { error: sandbox ? 'Provide repoUrl or name' : 'Provide repoPath' },
      { status: 400 },
    );
  }

  try {
    // The session's sign-ins go in at create, so the runner and the CLIs find them on boot.
    const files = sessionCredentials ? sessionFiles(await readSession()) : undefined;
    const spec: EnvSpec = sandbox
      ? { repoUrl, branch, name, env: runnerEnv(agent), files }
      : { repoPath, env: runnerEnv(agent) };
    const provider = await getProvider();
    const handle = await provider.create(spec);
    const endpoint = await provider.endpoint(handle.id);
    return NextResponse.json({
      id: handle.id,
      url: endpoint.url,
      token: endpoint.token,
      // Where the runner sees the repository, so the client can map tool paths to it.
      repoPath: sandbox ? DAYTONA_WORKSPACE : repoPath,
    });
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 400 });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
