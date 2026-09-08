import { NextResponse } from 'next/server';
import { getProvider } from '@/server/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const provider = await getProvider();
    return NextResponse.json({ id, status: await provider.status(id) });
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 404 });
  }
}

export async function DELETE(_request: Request, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const provider = await getProvider();
    await provider.destroy(id);
    return NextResponse.json({ id, status: 'gone' });
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 404 });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
