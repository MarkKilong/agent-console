export type DiffLineKind = 'context' | 'add' | 'remove';

export type DiffLine = {
  kind: DiffLineKind;
  /** Line number on the original side; undefined for added lines. */
  oldNumber: number | undefined;
  /** Line number on the new side; undefined for removed lines. */
  newNumber: number | undefined;
  text: string;
};

export type DiffHunk = {
  header: string;
  lines: DiffLine[];
};

export type ParsedDiff = {
  hunks: DiffHunk[];
  added: number;
  removed: number;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Turns one file's unified patch into hunks with both-side line numbers.
 * Everything before the first `@@` (the `diff --git` and `---`/`+++` headers)
 * is dropped, and `\ No newline at end of file` markers are ignored.
 */
export function parseUnifiedDiff(patch: string): ParsedDiff {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | undefined;
  let oldNumber = 0;
  let newNumber = 0;
  let added = 0;
  let removed = 0;

  // A patch ending in a newline splits to a trailing "" that is not an empty
  // context line; keeping it renders a phantom row after the last hunk.
  const lines = patch.split('\n');
  if (lines.at(-1) === '') lines.pop();

  for (const line of lines) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      oldNumber = Number(header[1]);
      newNumber = Number(header[2]);
      current = { header: line, lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current || line.startsWith('\\')) continue;

    const marker = line[0];
    const text = line.slice(1);

    if (marker === '+') {
      current.lines.push({ kind: 'add', oldNumber: undefined, newNumber, text });
      newNumber += 1;
      added += 1;
    } else if (marker === '-') {
      current.lines.push({ kind: 'remove', oldNumber, newNumber: undefined, text });
      oldNumber += 1;
      removed += 1;
    } else if (marker === ' ' || line === '') {
      current.lines.push({ kind: 'context', oldNumber, newNumber, text });
      oldNumber += 1;
      newNumber += 1;
    }
  }

  return { hunks, added, removed };
}

export type DiffRow =
  | { kind: 'line'; line: DiffLine }
  | { kind: 'gap'; count: number };

/**
 * Collapses runs of unchanged lines longer than `context * 2 + 1` into a gap
 * marker, keeping `context` lines of padding on either side of every change.
 */
export function collapseContext(lines: DiffLine[], context = 3): DiffRow[] {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.kind === 'context') return;
    for (let i = index - context; i <= index + context; i += 1) {
      if (i >= 0 && i < lines.length) keep.add(i);
    }
  });

  const rows: DiffRow[] = [];
  let hidden = 0;
  lines.forEach((line, index) => {
    if (keep.has(index)) {
      if (hidden > 0) {
        rows.push({ kind: 'gap', count: hidden });
        hidden = 0;
      }
      rows.push({ kind: 'line', line });
    } else {
      hidden += 1;
    }
  });
  if (hidden > 0) rows.push({ kind: 'gap', count: hidden });

  return rows;
}
