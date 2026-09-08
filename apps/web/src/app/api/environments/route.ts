import { NextResponse } from 'next/server';
import { getProvider, runnerEnv } from '@/server/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  let repoPath: unknown;
  try {
    ({ repoPath } = (await request.json()) as { repoPath?: unknown });
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  if (typeof repoPath !== 'string' || !repoPath.trim()) {
    return NextResponse.json({ error: 'repoPath is required' }, { status: 400 });
  }

  const provider = await getProvider();
  try {
    const handle = await provider.create({ repoPath: repoPath.trim(), env: runnerEnv() });
    const endpoint = await provider.endpoint(handle.id);
    return NextResponse.json({ id: handle.id, url: endpoint.url, token: endpoint.token });
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 400 });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
