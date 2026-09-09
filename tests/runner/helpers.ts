import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ServerMessageSchema,
  type Command,
  type Event,
  type Response,
} from '@agent-console/contracts';
import { WebSocket } from 'ws';
import type { Config } from '../../packages/runner/src/config.js';

export async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agent-console-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  await writeFile(join(root, 'untracked.txt'), 'hello\n');
  return root;
}

export function testConfig(cwd: string, token = 'test-token'): Config {
  return {
    port: 0,
    token,
    cwd,
    agent: 'fake',
    claudeBinary: undefined,
    codexBinary: undefined,
    codexModel: undefined,
    permissionMode: 'default',
  };
}

export type TestClient = {
  events: Event[];
  responses: Response[];
  send(command: Command): void;
  waitForEvent(match: (event: Event) => boolean): Promise<Event>;
  waitForResponse(requestId: string): Promise<Response>;
  close(): void;
};

export function connect(port: number, token: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`);
    const events: Event[] = [];
    const responses: Response[] = [];
    const waiters = new Set<() => void>();

    socket.on('message', (data) => {
      const message = ServerMessageSchema.parse(JSON.parse(data.toString()));
      if (message.kind === 'event') events.push(message.event);
      if (message.kind === 'response') responses.push(message.response);
      for (const notify of [...waiters]) notify();
    });
    socket.on('error', reject);

    const settled = async <T>(find: () => T | undefined): Promise<T> => {
      for (;;) {
        const found = find();
        if (found !== undefined) return found;
        await new Promise<void>((next) => {
          const notify = () => {
            waiters.delete(notify);
            next();
          };
          waiters.add(notify);
        });
      }
    };

    socket.once('open', () =>
      resolve({
        events,
        responses,
        send: (command) => socket.send(JSON.stringify({ kind: 'command', command })),
        waitForEvent: (match) => settled(() => events.find(match)),
        waitForResponse: (requestId) =>
          settled(() => responses.find((response) => response.requestId === requestId)),
        close: () => socket.close(),
      }),
    );
  });
}
