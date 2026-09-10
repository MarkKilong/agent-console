import { mkdirSync } from 'node:fs';
import { dataRoot } from '@agent-console/runner/data-root';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getProvider, runnerEnv } from '@/server/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  repoPath: z.string().trim().min(1).optional(),
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

  const provider = await getProvider();
  try {
    const handle = await provider.create({
      repoPath: parsed.data.repoPath ?? authEnvironmentPath(),
      env: runnerEnv(parsed.data.agent),
    });
    const endpoint = await provider.endpoint(handle.id);
    return NextResponse.json({ id: handle.id, url: endpoint.url, token: endpoint.token });
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
