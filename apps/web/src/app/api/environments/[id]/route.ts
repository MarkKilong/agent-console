import { NextResponse } from 'next/server';
import { sessionCredentials } from '@/lib/deployment';
import { refreshStored, storedPaths } from '@/server/credentials';
import { getFileReadingProvider, getProvider } from '@/server/provider';
import { readSession, writeSession } from '@/server/session';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const provider = await getProvider();
    return NextResponse.json({ id, status: await provider.status(id) });
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 404 });
  }
}

export async function DELETE(_request: Request, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    if (sessionCredentials) await releaseFromSession(id);
    const provider = await getProvider();
    await provider.destroy(id);
    return NextResponse.json({ id, status: 'gone' });
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 404 });
  }
}

/**
 * Lets go of the environment: the session stops pointing at it as its auth sandbox, and
 * Claude's credentials file — which the CLI rewrites as it refreshes — is read back first.
 * The read-back is best effort; nothing here may block the delete.
 */
async function releaseFromSession(id: string): Promise<void> {
  const session = await readSession();
  let changed = session.authEnvironmentId === id;
  if (changed) session.authEnvironmentId = undefined;
  try {
    const paths = storedPaths(session);
    const reader = paths.length > 0 ? await getFileReadingProvider() : undefined;
    if (reader && refreshStored(session, await reader.readFiles(id, paths))) changed = true;
  } catch {
    // A stopped sandbox, a rotated secret: the session keeps what it already had.
  }
  if (changed) await writeSession(session);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
