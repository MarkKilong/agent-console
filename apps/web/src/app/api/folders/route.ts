import { NextResponse } from 'next/server';
import { listFolders } from '@/server/folders';
import { sourceErrorResponse } from '@/server/source-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const path = new URL(request.url).searchParams.get('path') ?? undefined;
  try {
    return NextResponse.json(await listFolders(path));
  } catch (error) {
    return sourceErrorResponse(error);
  }
}
