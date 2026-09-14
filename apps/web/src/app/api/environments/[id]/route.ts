import { NextResponse } from 'next/server';
import { getProvider } from '@/server/provider';

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

/** Throws the environment away for good — removing a project, or ending a local session. */
export async function DELETE(_request: Request, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    await (await getProvider()).destroy(id);
    return NextResponse.json({ id, status: 'gone' });
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 404 });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
