import { gunzipSync, gzipSync } from 'node:zlib';
import type { Session } from '@/server/credentials';

/**
 * Browsers cap a cookie at 4 KB including its name and attributes, and the worst-case
 * bundle (Claude + Codex + GitHub) measures ~5.6 KB encoded, so it is split.
 */
const CHUNK_CHARS = 3800;

/**
 * gzip, then AES-256-GCM, then base64url, cut into cookie-sized pieces. gzip first
 * because the bundle is JSON wrapping JSON and the encoded size decides the piece count.
 */
export async function encodeSession(session: Session): Promise<string[]> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await sessionKey(),
    gzipSync(Buffer.from(JSON.stringify(session), 'utf8'), { level: 9 }),
  );
  const payload = Buffer.concat([iv, Buffer.from(sealed)]).toString('base64url');
  const chunks: string[] = [];
  for (let at = 0; at < payload.length; at += CHUNK_CHARS) {
    chunks.push(payload.slice(at, at + CHUNK_CHARS));
  }
  return chunks;
}

/** An empty session for anything that does not open: a rotated secret, a truncated cookie. */
export async function decodeSession(chunks: readonly string[]): Promise<Session> {
  const payload = chunks.join('');
  if (!payload) return { providers: {} };
  try {
    const bytes = Buffer.from(payload, 'base64url');
    const opened = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, 12) },
      await sessionKey(),
      bytes.subarray(12),
    );
    return JSON.parse(gunzipSync(Buffer.from(opened)).toString('utf8')) as Session;
  } catch {
    return { providers: {} };
  }
}

/** Fails loudly at the first request rather than silently handing out an unprotected cookie. */
function secret(): Uint8Array<ArrayBuffer> {
  const raw = process.env.SESSION_SECRET?.trim();
  if (!raw) {
    throw new Error(
      'SESSION_SECRET is required in sandbox mode: 32+ random bytes, base64 or hex ' +
        '(`openssl rand -base64 32`)',
    );
  }
  const bytes =
    /^[0-9a-f]+$/i.test(raw) && raw.length % 2 === 0
      ? Buffer.from(raw, 'hex')
      : Buffer.from(raw, 'base64');
  if (bytes.length < 32) {
    throw new Error('SESSION_SECRET must decode to at least 32 bytes of base64 or hex');
  }
  // Copied out of the Buffer pool: Web Crypto wants a view over a plain ArrayBuffer.
  return new Uint8Array(bytes.subarray(0, 32));
}

/** Named off importKey so it is the DOM CryptoKey in the app and Node's under the tests. */
type SessionKey = ReturnType<typeof crypto.subtle.importKey>;

let cachedKey: { secret: string; key: SessionKey } | undefined;

/** Keyed by the secret it was made from, so rotating it in a test takes effect. */
function sessionKey(): SessionKey {
  const raw = process.env.SESSION_SECRET?.trim() ?? '';
  if (cachedKey?.secret !== raw) {
    cachedKey = {
      secret: raw,
      key: crypto.subtle.importKey('raw', secret(), 'AES-GCM', false, ['encrypt', 'decrypt']),
    };
  }
  return cachedKey.key;
}
