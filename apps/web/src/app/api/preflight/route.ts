import { NextResponse } from 'next/server';
import { preflight } from '@/server/preflight';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(preflight());
}
