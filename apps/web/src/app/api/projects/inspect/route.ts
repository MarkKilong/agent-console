import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SourceError } from '@/lib/project-source';
import { inspectFolder } from '@/server/folders';
import { sourceErrorResponse } from '@/server/source-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({ path: z.string().trim().min(1) });

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new SourceError('Enter a folder path', 'invalid_url');
    return NextResponse.json(await inspectFolder(parsed.data.path));
  } catch (error) {
    return sourceErrorResponse(error);
  }
}
