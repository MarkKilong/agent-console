import { describe, expect, it } from 'vitest';
import {
  ClientMessageSchema,
  CommandSchema,
  EnvSpecSchema,
  EventSchema,
  PROTOCOL_VERSION,
  ResponseSchema,
  ServerMessageSchema,
} from '../../packages/contracts/src/index.js';

describe('commands', () => {
  it('round-trips send_prompt', () => {
    const command = { type: 'send_prompt', threadId: 't1', text: 'hello' };
    expect(CommandSchema.parse(command)).toEqual(command);
  });

  it('rejects an unknown command type', () => {
    expect(CommandSchema.safeParse({ type: 'nope', threadId: 't1' }).success).toBe(false);
  });

  it('rejects answer_permission with an invalid decision', () => {
    const result = CommandSchema.safeParse({
      type: 'answer_permission',
      threadId: 't1',
      requestId: 'r1',
      decision: 'maybe',
    });
    expect(result.success).toBe(false);
  });
});

describe('events', () => {
  it('round-trips turn_finished with usage', () => {
    const event = {
      type: 'turn_finished',
      seq: 7,
      threadId: 't1',
      ts: 1700000000000,
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 20 },
    };
    expect(EventSchema.parse(event)).toEqual(event);
  });

  it('rejects an event without seq', () => {
    const result = EventSchema.safeParse({ type: 'turn_started', threadId: 't1', ts: 0 });
    expect(result.success).toBe(false);
  });
});

describe('responses', () => {
  it('round-trips an ok get_diff response', () => {
    const response = {
      requestId: 'r1',
      ok: true,
      data: { files: [{ path: 'a.ts', status: 'modified', patch: '@@' }] },
    };
    expect(ResponseSchema.parse(response)).toEqual(response);
  });

  it('round-trips an error response', () => {
    const response = { requestId: 'r1', ok: false, error: 'boom' };
    expect(ResponseSchema.parse(response)).toEqual(response);
  });
});

describe('wire messages', () => {
  it('parses a hello', () => {
    const hello = { kind: 'hello', protocolVersion: PROTOCOL_VERSION, runnerVersion: '0.1.0' };
    expect(ServerMessageSchema.parse(hello)).toEqual(hello);
  });

  it('rejects a command sent as a server message', () => {
    const message = { kind: 'command', command: { type: 'stop_turn', threadId: 't1' } };
    expect(ServerMessageSchema.safeParse(message).success).toBe(false);
    expect(ClientMessageSchema.parse(message)).toEqual(message);
  });
});

describe('env spec', () => {
  it('accepts a local repo path', () => {
    expect(EnvSpecSchema.parse({ repoPath: '/repo' })).toEqual({ repoPath: '/repo' });
  });

  it('rejects both repoPath and repoUrl', () => {
    const result = EnvSpecSchema.safeParse({
      repoPath: '/repo',
      repoUrl: 'https://example.com/r.git',
    });
    expect(result.success).toBe(false);
  });
});
