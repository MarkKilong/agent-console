/**
 * Pulling the piece of terminal the user just looked at out of xterm, for the composer.
 *
 * Typed against the shape it reads rather than against `Terminal`, so a test can hand it
 * a plain object instead of a live xterm.
 */
export type CaptureSource = {
  getSelection(): string;
  buffer: {
    active: {
      length: number;
      getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined;
    };
  };
};

export type Capture = {
  text: string;
  kind: 'selection' | 'tail';
  /** Lines in `text`; 0 when there was nothing to take. */
  lines: number;
};

/** What the user just looked at, without needing a shell integration mark to find it. */
const MAX_LINES = 40;
const MAX_BYTES = 4096;

const encoder = new TextEncoder();

/**
 * The selection if there is one, else the last non-empty lines of the scrollback —
 * the v1 heuristic for "the command that just failed".
 */
export function captureForChat(
  term: CaptureSource,
  opts?: { maxLines?: number; maxBytes?: number },
): Capture {
  const selection = term.getSelection().trim();
  if (selection) {
    return { text: selection, kind: 'selection', lines: selection.split('\n').length };
  }

  const maxLines = opts?.maxLines ?? MAX_LINES;
  const maxBytes = opts?.maxBytes ?? MAX_BYTES;
  const buffer = term.buffer.active;

  const picked: string[] = [];
  let bytes = 0;
  for (let index = buffer.length - 1; index >= 0 && picked.length < maxLines; index -= 1) {
    const line = buffer.getLine(index)?.translateToString(true) ?? '';
    // The rows below the cursor are blank, and so is the padding between outputs.
    if (!line.trim()) continue;
    const size = encoder.encode(line).length + (picked.length ? 1 : 0);
    if (bytes + size > maxBytes) break;
    bytes += size;
    picked.push(line);
  }

  picked.reverse();
  return { text: picked.join('\n'), kind: 'tail', lines: picked.length };
}
