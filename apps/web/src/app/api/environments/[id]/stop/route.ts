import { NextResponse } from 'next/server';
import { sessionCredentials } from '@/lib/deployment';
import { refreshStored, storedPaths } from '@/server/credentials';
import { getCredentialFileProvider, getProvider } from '@/server/provider';
import { readSession, writeSession } from '@/server/session';

type Context = { params: Promise<{ id: string }> };

/**
 * Puts an environment down without losing it: a stopped sandbox keeps its files, costs no
 * running memory, and `resume` wakes it. This is what closing or switching projects calls.
 */
export async function POST(_request: Request, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    if (sessionCredentials) await refreshCredentials(id);
    const provider = await getProvider();
    await provider.stop(id);
    return NextResponse.json({ id, status: await provider.status(id) });
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 404 });
  }
}

/**
 * Reads Claude's credentials file back out before the runner goes away, since the CLI
 * rewrites it as it refreshes. Best effort: nothing here may keep the environment running.
 */
async function refreshCredentials(id: string): Promise<void> {
  try {
    const session = await readSession();
    const paths = storedPaths(session);
    if (paths.length === 0) return;
    const reader = await getCredentialFileProvider();
    if (refreshStored(session, await reader.readFiles(id, paths))) await writeSession(session);
  } catch {
    // An unreachable sandbox, a rotated secret: the session keeps what it already had.
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
