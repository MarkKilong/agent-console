import { PROTOCOL_VERSION, type Hello } from '@agent-console/contracts';
import { describe, expect, it } from 'vitest';
import {
  decodeCommand,
  encode,
  encodeEvent,
  encodeResponse,
} from '../../packages/runner/src/protocol.js';

describe('decodeCommand', () => {
  it('decodes a wrapped command', () => {
    const raw = JSON.stringify({
      kind: 'command',
      command: { type: 'send_prompt', threadId: 't1', text: 'hi' },
    });
    const result = decodeCommand(raw);
    expect(result).toEqual({
      ok: true,
      command: { type: 'send_prompt', threadId: 't1', text: 'hi' },
    });
  });

  it('rejects malformed JSON', () => {
    expect(decodeCommand('{')).toEqual({ ok: false, error: 'Message is not valid JSON' });
  });

  it('rejects a command with a bad payload', () => {
    const raw = JSON.stringify({
      kind: 'command',
      command: { type: 'read_file', requestId: 'r1' },
    });
    const result = decodeCommand(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('path');
  });

  it('rejects an unwrapped command', () => {
    expect(decodeCommand(JSON.stringify({ type: 'stop_turn', threadId: 't1' })).ok).toBe(false);
  });
});

describe('encode', () => {
  it('wraps events and responses in their message kind', () => {
    const event = { type: 'turn_started', seq: 1, threadId: 't1', ts: 5 } as const;
    expect(JSON.parse(encodeEvent(event))).toEqual({ kind: 'event', event });

    const response = { requestId: 'r1', ok: false, error: 'nope' } as const;
    expect(JSON.parse(encodeResponse(response))).toEqual({ kind: 'response', response });

    const hello: Hello = {
      kind: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      runnerVersion: '0.1.0',
      platform: 'linux',
      shells: [{ kind: 'bash', title: 'bash' }],
    };
    expect(JSON.parse(encode(hello))).toEqual(hello);
  });
});
