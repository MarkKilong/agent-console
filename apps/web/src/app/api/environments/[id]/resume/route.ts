import { DAYTONA_WORKSPACE } from '@agent-console/providers';
import { NextResponse } from 'next/server';
import { PROVIDER_KIND } from '@/lib/deployment';
import { getProvider, writeSessionCredentials } from '@/server/provider';

type Context = { params: Promise<{ id: string }> };

/**
 * Reopens an environment that already holds this project's files. Only a sandbox survives
 * being stopped, so this is a sandbox-only route; a local runner dies with its process and
 * the client creates a new one instead.
 */
export async function POST(_request: Request, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  if (PROVIDER_KIND !== 'daytona') {
    return NextResponse.json(
      { error: 'This deployment cannot resume environments' },
      { status: 404 },
    );
  }

  try {
    const provider = await getProvider();
    // Gone means the client must create a new one; for a blank project that loses the files.
    if ((await provider.status(id)) === 'gone') {
      return NextResponse.json({ error: 'That environment no longer exists' }, { status: 404 });
    }
    // Wakes a stopped sandbox and relaunches the runner, or checks over a running one.
    await provider.start(id);
    // The sign-ins may have changed since this sandbox was made; a project without them is
    // worse than a failed resume, so this one is not best effort.
    await writeSessionCredentials(id);
    const endpoint = await provider.endpoint(id);
    return NextResponse.json({
      id,
      url: endpoint.url,
      token: endpoint.token,
      repoPath: DAYTONA_WORKSPACE,
    });
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 404 });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
