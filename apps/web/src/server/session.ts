import { cookies } from 'next/headers';
import type { Session } from '@/server/credentials';
import { decodeSession, encodeSession } from '@/server/session-codec';

const COOKIE_PREFIX = 'ac_session';
const MAX_AGE_S = 30 * 24 * 60 * 60;

export async function readSession(): Promise<Session> {
  const store = await cookies();
  const chunks = store
    .getAll()
    .filter((cookie) => cookie.name.startsWith(`${COOKIE_PREFIX}.`))
    .sort((a, b) => chunkIndex(a.name) - chunkIndex(b.name))
    .map((cookie) => cookie.value);
  return decodeSession(chunks);
}

export async function writeSession(session: Session): Promise<void> {
  const empty = Object.keys(session.providers).length === 0 && !session.authEnvironmentId;
  if (empty) return clearSession();

  const chunks = await encodeSession(session);
  const store = await cookies();
  chunks.forEach((value, index) => {
    store.set(`${COOKIE_PREFIX}.${index}`, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: MAX_AGE_S,
    });
  });
  // A shorter session leaves the tail of the previous one behind, which would decode to junk.
  for (const cookie of store.getAll()) {
    if (cookie.name.startsWith(`${COOKIE_PREFIX}.`) && chunkIndex(cookie.name) >= chunks.length) {
      store.delete(cookie.name);
    }
  }
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  for (const cookie of store.getAll()) {
    if (cookie.name.startsWith(`${COOKIE_PREFIX}.`)) store.delete(cookie.name);
  }
}

function chunkIndex(name: string): number {
  return Number(name.slice(COOKIE_PREFIX.length + 1)) || 0;
}
