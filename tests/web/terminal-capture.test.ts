import { describe, expect, it } from 'vitest';
import { captureForChat, type CaptureSource } from '../../apps/web/src/lib/terminal-capture.js';

/** The slice of xterm the capture reads: rows of text plus whatever is selected. */
const fake = (rows: string[], selection = ''): CaptureSource => ({
  getSelection: () => selection,
  buffer: {
    active: {
      length: rows.length,
      getLine: (index) => {
        const row = rows[index];
        if (row === undefined) return undefined;
        return { translateToString: (trimRight) => (trimRight ? row.trimEnd() : row) };
      },
    },
  },
});

describe('captureForChat', () => {
  it('takes the selection over the scrollback', () => {
    const capture = captureForChat(fake(['npm test', 'boom'], '  boom\nbang  '));

    expect(capture).toEqual({ text: 'boom\nbang', kind: 'selection', lines: 2 });
  });

  it('takes the tail in order, without the blank rows below the cursor', () => {
    const capture = captureForChat(fake(['> tsc', "error TS2322: 'oops'", '   ', '', '']));

    expect(capture).toEqual({ text: "> tsc\nerror TS2322: 'oops'", kind: 'tail', lines: 2 });
  });

  it('keeps only the last maxLines rows', () => {
    const rows = ['one', 'two', 'three', 'four'];

    expect(captureForChat(fake(rows), { maxLines: 2 })).toEqual({
      text: 'three\nfour',
      kind: 'tail',
      lines: 2,
    });
  });

  it('stops before the byte cap rather than overshooting it', () => {
    // Four lines of 5 bytes each; joined, three of them are 17 bytes.
    const rows = ['aaaaa', 'bbbbb', 'ccccc', 'ddddd'];

    expect(captureForChat(fake(rows), { maxBytes: 17 })).toEqual({
      text: 'bbbbb\nccccc\nddddd',
      kind: 'tail',
      lines: 3,
    });
    expect(captureForChat(fake(rows), { maxBytes: 16 })).toEqual({
      text: 'ccccc\nddddd',
      kind: 'tail',
      lines: 2,
    });
  });

  it('measures the cap in UTF-8 bytes, not characters', () => {
    expect(captureForChat(fake(['él']), { maxBytes: 3 })).toEqual({
      text: 'él',
      kind: 'tail',
      lines: 1,
    });
    expect(captureForChat(fake(['él']), { maxBytes: 2 })).toEqual({
      text: '',
      kind: 'tail',
      lines: 0,
    });
  });

  it('returns nothing from an empty buffer', () => {
    expect(captureForChat(fake([]))).toEqual({ text: '', kind: 'tail', lines: 0 });
  });
});
