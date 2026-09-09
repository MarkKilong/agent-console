import { createServer, type IncomingMessage, type Server } from 'node:http';
import {
  PROTOCOL_VERSION,
  type Command,
  type DiffFile,
  type Response,
} from '@agent-console/contracts';
import { WebSocketServer, type WebSocket } from 'ws';
import { createAdapter } from './agent/create-adapter.js';
import type { Config } from './config.js';
import { listWorkspaceFiles, readWorkspaceFile } from './files.js';
import { collectDiff, diffTrees, snapshotTree } from './git/diff.js';
import { decodeCommand, encode, encodeEvent, encodeResponse } from './protocol.js';
import { ThreadRegistry } from './threads.js';
import { startTurn, type TurnDeps } from './turns.js';

export const RUNNER_VERSION = '0.1.0';

export type RunnerServer = {
  port: number;
  close(): Promise<void>;
};

export async function startServer(config: Config): Promise<RunnerServer> {
  const deps: TurnDeps = {
    registry: new ThreadRegistry(),
    adapter: createAdapter(config),
    cwd: config.cwd,
  };

  const http = createServer((request, response) => {
    if (request.method === 'GET' && (request.url ?? '').split('?')[0] === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, protocolVersion: PROTOCOL_VERSION }));
      return;
    }
    response.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server: http });
  wss.on('connection', (socket, request) => {
    if (!isAuthorized(request, config.token)) {
      socket.close(4401, 'Unauthorized');
      return;
    }
    handleConnection(socket, deps);
  });

  const port = await listen(http, config.port);
  return {
    port,
    close: async () => {
      deps.registry.stopActiveTurns();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve, reject) =>
        wss.close((error) => (error ? reject(error) : resolve())),
      );
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function handleConnection(socket: WebSocket, deps: TurnDeps): void {
  const subscriptions = new Map<string, () => void>();

  socket.send(
    encode({ kind: 'hello', protocolVersion: PROTOCOL_VERSION, runnerVersion: RUNNER_VERSION }),
  );

  socket.on('message', (data) => {
    const decoded = decodeCommand(data.toString());
    if (!decoded.ok) {
      socket.send(encodeResponse({ requestId: 'unknown', ok: false, error: decoded.error }));
      return;
    }
    void dispatch(decoded.command, socket, deps, subscriptions);
  });

  socket.on('close', () => {
    for (const unsubscribe of subscriptions.values()) unsubscribe();
    subscriptions.clear();
  });
}

async function dispatch(
  command: Command,
  socket: WebSocket,
  deps: TurnDeps,
  subscriptions: Map<string, () => void>,
): Promise<void> {
  const { registry } = deps;

  switch (command.type) {
    case 'subscribe': {
      subscriptions.get(command.threadId)?.();
      subscriptions.set(
        command.threadId,
        registry.subscribe(command.threadId, command.afterSeq ?? 0, (event) => {
          if (socket.readyState === socket.OPEN) socket.send(encodeEvent(event));
        }),
      );
      return;
    }

    case 'send_prompt':
      startTurn(deps, command.threadId, command.text);
      return;

    case 'answer_permission': {
      const turn = registry.activeTurn(command.threadId);
      if (!turn?.answerPermission(command.requestId, command.decision, command.message)) {
        registry.append(command.threadId, {
          type: 'error',
          message: `No pending permission request ${command.requestId}`,
          code: 'unknown_permission',
        });
      }
      return;
    }

    case 'stop_turn': {
      const turn = registry.activeTurn(command.threadId);
      if (!turn) {
        registry.append(command.threadId, {
          type: 'error',
          message: 'No turn is running on this thread',
          code: 'no_active_turn',
        });
        return;
      }
      turn.stop();
      return;
    }

    case 'list_files':
      await reply(socket, command.requestId, () => listWorkspaceFiles(deps.cwd, command.path));
      return;

    case 'read_file':
      await reply(socket, command.requestId, () => readWorkspaceFile(deps.cwd, command.path));
      return;

    case 'get_diff':
      await reply(socket, command.requestId, async () => ({
        files: await diffFor(deps, command.threadId),
      }));
      return;
  }
}

/**
 * With a threadId: everything that changed since that thread's latest turn started,
 * including edits made after the turn finished. Without one, or before the thread has
 * run a turn: the whole workspace against HEAD.
 */
async function diffFor(deps: TurnDeps, threadId: string | undefined): Promise<DiffFile[]> {
  const base = threadId ? deps.registry.baseTree(threadId) : undefined;
  if (!base) return collectDiff(deps.cwd);
  const now = await snapshotTree(deps.cwd);
  return now ? diffTrees(deps.cwd, base, now) : [];
}

async function reply(
  socket: WebSocket,
  requestId: string,
  produce: () => Promise<Extract<Response, { ok: true }>['data']>,
): Promise<void> {
  let response: Response;
  try {
    response = { requestId, ok: true, data: await produce() };
  } catch (error) {
    response = {
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (socket.readyState === socket.OPEN) socket.send(encodeResponse(response));
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ') && header.slice('Bearer '.length) === token) return true;

  const url = new URL(request.url ?? '/', 'http://localhost');
  return url.searchParams.get('token') === token;
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address) resolve(address.port);
      else reject(new Error('Server did not bind to a TCP port'));
    });
  });
}
