import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SourceError } from '@/lib/project-source';
import { createFolder, listCloneFolders } from '@/server/folders';
import { sourceErrorResponse } from '@/server/source-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  parent: z.string().trim().min(1),
  name: z.string().trim().min(1),
});

/** The folder browser fenced to the clone root; no path means the root itself. */
export async function GET(request: Request): Promise<NextResponse> {
  const path = new URL(request.url).searchParams.get('path') ?? undefined;
  try {
    return NextResponse.json(await listCloneFolders(path));
  } catch (error) {
    return sourceErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new SourceError('Enter a folder name', 'invalid_url');
    return NextResponse.json(await createFolder(parsed.data.parent, parsed.data.name));
  } catch (error) {
    return sourceErrorResponse(error);
  }
}
