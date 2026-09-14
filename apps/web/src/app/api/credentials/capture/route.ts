import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sessionCredentials } from '@/lib/deployment';
import {
  bundlePaths,
  captureFiles,
  CredentialInfoSchema,
  localOnly,
  summarise,
  PROVIDER_NAMES,
} from '@/server/credentials';
import { getFileReadingProvider, getProvider } from '@/server/provider';
import { readSession, writeSession } from '@/server/session';

const BodySchema = z.object({
  environmentId: z.string().trim().min(1),
  provider: z.enum(PROVIDER_NAMES),
  info: CredentialInfoSchema.optional(),
});

/**
 * Lifts a sign-in out of the auth sandbox and into the session, then deletes the sandbox.
 * The credential itself never reaches the browser: it goes sandbox → cookie → next sandbox.
 */
export async function POST(request: Request): Promise<Response> {
  if (!sessionCredentials) return localOnly();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Send environmentId and provider (${PROVIDER_NAMES.join(', ')})` },
      { status: 400 },
    );
  }
  const { environmentId, provider, info } = parsed.data;

  try {
    const reader = await getFileReadingProvider();
    const found = await reader.readFiles(environmentId, bundlePaths(provider));
    const files = captureFiles(provider, found);
    if (Object.keys(files).length === 0) {
      return NextResponse.json(
        { error: `No ${provider} credentials were written in that environment` },
        { status: 400 },
      );
    }

    const session = await readSession();
    session.providers[provider] = { files, info: info ?? {} };
    // The sandbox is about to go, so the session must stop offering it to the next sign-in.
    if (session.authEnvironmentId === environmentId) session.authEnvironmentId = undefined;
    await writeSession(session);

    // The sandbox existed only for the sign-in; a failure to delete must not lose the capture.
    await (await getProvider()).destroy(environmentId).catch(() => {});
    return NextResponse.json(summarise(session));
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 400 });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
