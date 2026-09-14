import { NextResponse } from 'next/server';
import { sessionCredentials } from '@/lib/deployment';
import { localOnly, summarise, PROVIDER_NAMES, type ProviderName } from '@/server/credentials';
import { readSession, writeSession } from '@/server/session';

type Context = { params: Promise<{ provider: string }> };

/** Disconnects one provider: its files and its display info leave the session. */
export async function DELETE(_request: Request, context: Context): Promise<Response> {
  if (!sessionCredentials) return localOnly();
  const { provider } = await context.params;
  if (!isProvider(provider)) {
    return NextResponse.json(
      { error: `provider must be one of ${PROVIDER_NAMES.join(', ')}` },
      { status: 400 },
    );
  }

  const session = await readSession();
  delete session.providers[provider];
  await writeSession(session);
  return NextResponse.json(summarise(session));
}

function isProvider(value: string): value is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(value);
}
