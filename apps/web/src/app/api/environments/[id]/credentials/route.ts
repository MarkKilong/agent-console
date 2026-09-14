import { NextResponse } from 'next/server';
import { sessionCredentials } from '@/lib/deployment';
import { localOnly } from '@/server/credentials';
import { writeSessionCredentials } from '@/server/provider';

type Context = { params: Promise<{ id: string }> };

/**
 * Puts the session's sign-ins into a project that is already open. Create and resume do the
 * same, so this covers the one gap they leave: a sign-in landing while a project is running.
 */
export async function POST(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!sessionCredentials) return localOnly();

  try {
    await writeSessionCredentials(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 404 });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
