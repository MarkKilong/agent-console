import type { Event } from '@agent-console/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ThreadRegistry } from '../../packages/runner/src/threads.js';

describe('ThreadRegistry', () => {
  it('stamps seq, threadId and ts on appended events', () => {
    const registry = new ThreadRegistry();
    const first = registry.append('t1', { type: 'turn_started' });
    const second = registry.append('t1', { type: 'assistant_delta', text: 'hi' });

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(second.threadId).toBe('t1');
    expect(typeof second.ts).toBe('number');
  });

  it('numbers each thread independently', () => {
    const registry = new ThreadRegistry();
    registry.append('t1', { type: 'turn_started' });
    expect(registry.append('t2', { type: 'turn_started' }).seq).toBe(1);
  });

  it('replays events after a cursor, then live-tails', () => {
    const registry = new ThreadRegistry();
    registry.append('t1', { type: 'turn_started' });
    registry.append('t1', { type: 'assistant_delta', text: 'a' });
    registry.append('t1', { type: 'assistant_delta', text: 'b' });

    const seen: Event[] = [];
    const unsubscribe = registry.subscribe('t1', 1, (event) => seen.push(event));
    expect(seen.map((event) => event.seq)).toEqual([2, 3]);

    registry.append('t1', { type: 'turn_finished', stopReason: 'end_turn' });
    expect(seen.map((event) => event.seq)).toEqual([2, 3, 4]);

    unsubscribe();
    registry.append('t1', { type: 'turn_started' });
    expect(seen).toHaveLength(3);
  });

  it('tracks the active turn and resume cursor', () => {
    const registry = new ThreadRegistry();
    expect(registry.activeTurn('t1')).toBeUndefined();

    const turn = { answerPermission: vi.fn(() => true), stop: vi.fn() };
    registry.setActiveTurn('t1', turn);
    expect(registry.activeTurn('t1')).toBe(turn);

    registry.setActiveTurn('t1', undefined);
    expect(registry.activeTurn('t1')).toBeUndefined();

    registry.setSessionId('t1', 'session-1');
    expect(registry.sessionId('t1')).toBe('session-1');
  });

  it('stops every running turn, so shutdown leaves no agent behind', () => {
    const registry = new ThreadRegistry();
    const first = { answerPermission: vi.fn(() => true), stop: vi.fn() };
    const second = { answerPermission: vi.fn(() => true), stop: vi.fn() };
    registry.setActiveTurn('t1', first);
    registry.setActiveTurn('t2', second);
    registry.setActiveTurn('t3', undefined);

    registry.stopActiveTurns();

    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
  });

  it('returns only events after the requested seq', () => {
    const registry = new ThreadRegistry();
    registry.append('t1', { type: 'turn_started' });
    registry.append('t1', { type: 'turn_finished', stopReason: 'end_turn' });
    expect(registry.eventsAfter('t1', 1).map((event) => event.type)).toEqual(['turn_finished']);
    expect(registry.eventsAfter('t1').map((event) => event.type)).toHaveLength(2);
  });
});
