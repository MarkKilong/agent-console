import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ServerMessageSchema,
  type Command,
  type Event,
  type Response,
} from '@agent-console/contracts';
import { WebSocket } from 'ws';
import { ClaudeAuth, type SpawnCli } from '../../packages/runner/src/auth/claude-auth.js';
import { GitHubAuth } from '../../packages/runner/src/auth/github-auth.js';
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
    claudeConfigDir: undefined,
    dataRoot: `${cwd}-data`,
    dataDir: `${cwd}-data`,
    // Sibling of the temp repo, so thread logs never show up in its diff.
    threadsDir: `${cwd}-threads`,
  };
}

const FAKE_CLAUDE = fileURLToPath(new URL('fixtures/fake-claude-auth.mjs', import.meta.url));

/** The fixture is a script, so what ClaudeAuth calls a binary runs through Node. */
const spawnFakeClaude: SpawnCli = (binary, args, options) =>
  spawn(process.execPath, [binary, ...args], options);

/** `ClaudeAuth` driving the fixture CLI, with both its directories under `root`. */
export function fakeClaudeAuth(root: string, onSpawn?: (args: string[]) => void): ClaudeAuth {
  return new ClaudeAuth({
    binary: FAKE_CLAUDE,
    configDir: join(root, 'claude'),
    dataDir: join(root, 'data'),
    // Set so the nested-claude guard has something to strip.
    env: { ...process.env, CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
    spawn: (binary, args, options) => {
      onSpawn?.(args);
      return spawnFakeClaude(binary, args, options);
    },
  });
}

/** `GitHubAuth` whose device flow never completes, so the commands can be driven. */
export function fakeGithubAuth(root: string): GitHubAuth {
  return new GitHubAuth({
    dataDir: join(root, 'data'),
    fetch: async (input) =>
      String(input).endsWith('/login/device/code')
        ? Response.json({
            device_code: 'dev-1',
            user_code: 'ABCD-1234',
            verification_uri: 'https://github.com/login/device',
            expires_in: 900,
            interval: 1,
          })
        : Response.json({ error: 'authorization_pending' }),
  });
}

export type TestClient = {
  events: Event[];
  responses: Response[];
  /** Pty bytes per terminal id; terminals never reach the thread event log. */
  output: Map<string, string>;
  send(command: Command): void;
  waitForEvent(match: (event: Event) => boolean): Promise<Event>;
  waitForResponse(requestId: string): Promise<Response>;
  waitForOutput(terminalId: string, needle: string): Promise<string>;
  close(): void;
};

export function connect(port: number, token: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`);
    const events: Event[] = [];
    const responses: Response[] = [];
    const output = new Map<string, string>();
    const waiters = new Set<() => void>();

    socket.on('message', (data) => {
      const message = ServerMessageSchema.parse(JSON.parse(data.toString()));
      if (message.kind === 'event') events.push(message.event);
      if (message.kind === 'response') responses.push(message.response);
      if (message.kind === 'terminal_output') {
        output.set(message.terminalId, (output.get(message.terminalId) ?? '') + message.data);
      }
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
        output,
        send: (command) => socket.send(JSON.stringify({ kind: 'command', command })),
        waitForEvent: (match) => settled(() => events.find(match)),
        waitForResponse: (requestId) =>
          settled(() => responses.find((response) => response.requestId === requestId)),
        waitForOutput: (terminalId, needle) =>
          settled(() => {
            const text = output.get(terminalId);
            return text?.includes(needle) ? text : undefined;
          }),
        close: () => socket.close(),
      }),
    );
  });
}
