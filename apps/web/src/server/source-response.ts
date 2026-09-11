import { NextResponse } from 'next/server';
import { SourceError, type SourceErrorCode } from '@/lib/project-source';

const STATUS: Record<SourceErrorCode, number> = {
  invalid_url: 400,
  exists: 400,
  not_a_folder: 400,
  outside_root: 400,
  not_found: 404,
  auth: 403,
  network: 502,
  failed: 500,
};

/** One failure shape for every add-project route, so the dialog can switch on `code`. */
export function sourceErrorResponse(error: unknown): NextResponse {
  if (error instanceof SourceError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: STATUS[error.code] },
    );
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error), code: 'failed' },
    { status: 500 },
  );
}
