import { NextResponse } from 'next/server';
import { sessionCredentials } from '@/lib/deployment';
import { localOnly, summarise } from '@/server/credentials';
import { clearSession, readSession } from '@/server/session';

export async function GET(): Promise<Response> {
  if (!sessionCredentials) return localOnly();
  return NextResponse.json(summarise(await readSession()));
}

/** Sign out of everything: the cookie is the only place anything was kept. */
export async function DELETE(): Promise<Response> {
  if (!sessionCredentials) return localOnly();
  await clearSession();
  return NextResponse.json({});
}
