import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatCost,
  formatDuration,
  formatTokens,
} from '../../apps/web/src/lib/format.js';

describe('formatDuration', () => {
  it('gains precision on short runs and drops it on long ones', () => {
    expect(formatDuration(1234)).toBe('1.2s');
    expect(formatDuration(43_400)).toBe('43s');
    expect(formatDuration(125_000)).toBe('2m 05s');
    expect(formatDuration(-5)).toBe('0.0s');
  });
});

describe('formatClock', () => {
  it('counts a running turn on a clock face', () => {
    expect(formatClock(7_400)).toBe('0:07');
    expect(formatClock(223_000)).toBe('3:43');
  });
});

describe('formatTokens', () => {
  it('shortens counts past a thousand', () => {
    expect(formatTokens(812)).toBe('812');
    expect(formatTokens(12_400)).toBe('12.4k');
    expect(formatTokens(2_500_000)).toBe('2.5m');
  });
});

describe('formatCost', () => {
  it('says when a turn cost less than a cent', () => {
    expect(formatCost(0.0412)).toBe('$0.04');
    expect(formatCost(0.004)).toBe('<$0.01');
    expect(formatCost(0)).toBe('$0.00');
  });
});
