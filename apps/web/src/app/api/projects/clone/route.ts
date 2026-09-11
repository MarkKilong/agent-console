import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SourceError } from '@/lib/project-source';
import { cloneRepository } from '@/server/clone';
import { ensureCloneRoot } from '@/server/folders';
import { sourceErrorResponse } from '@/server/source-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  url: z.string().trim().min(1),
  parent: z.string().trim().min(1).optional(),
  name: z.string().trim().optional(),
});

/** Where the dialog prefills "Clone into" before the user has picked a folder. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ parent: await ensureCloneRoot() });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new SourceError('Enter a repository URL', 'invalid_url');
    return NextResponse.json(await cloneRepository(parsed.data));
  } catch (error) {
    return sourceErrorResponse(error);
  }
}
