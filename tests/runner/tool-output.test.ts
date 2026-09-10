import { describe, expect, it } from 'vitest';
import {
  capToolOutput,
  TOOL_OUTPUT_LIMIT,
} from '../../packages/runner/src/agent/claude-agent-adapter.js';

describe('capToolOutput', () => {
  it('leaves an output that fits alone', () => {
    expect(capToolOutput('hello')).toEqual({ output: 'hello', truncated: false });
    expect(capToolOutput(undefined)).toEqual({ output: undefined, truncated: false });

    const exact = 'x'.repeat(TOOL_OUTPUT_LIMIT);
    expect(capToolOutput(exact)).toEqual({ output: exact, truncated: false });
  });

  it('keeps the head and the tail of an oversized output', () => {
    const text = `${'a'.repeat(100 * 1024)}${'z'.repeat(20 * 1024)}`;
    const { output, truncated } = capToolOutput(text);

    expect(truncated).toBe(true);
    expect(output?.startsWith('a'.repeat(48 * 1024))).toBe(true);
    expect(output?.endsWith('z'.repeat(16 * 1024))).toBe(true);
    expect(output).toContain('… [truncated 56 KB] …');
    expect(output!.length).toBeLessThan(TOOL_OUTPUT_LIMIT + 64);
  });
});
