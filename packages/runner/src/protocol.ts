import {
  ClientMessageSchema,
  type Command,
  type Event,
  type Response,
  type ServerMessage,
} from '@agent-console/contracts';

export type DecodeResult = { ok: true; command: Command } | { ok: false; error: string };

export function decodeCommand(raw: string): DecodeResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Message is not valid JSON' };
  }

  const parsed = ClientMessageSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map(formatIssue).join('; ') };
  }
  return { ok: true, command: parsed.data.command };
}

export function encode(message: ServerMessage): string {
  return JSON.stringify(message);
}

export function encodeEvent(event: Event): string {
  return encode({ kind: 'event', event });
}

export function encodeResponse(response: Response): string {
  return encode({ kind: 'response', response });
}

function formatIssue(issue: { path: PropertyKey[]; message: string }): string {
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}
