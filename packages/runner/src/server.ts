import { createServer, type IncomingMessage, type Server } from 'node:http';
import {
  PROTOCOL_VERSION,
  type AuthStatusData,
  type Command,
  type DiffFile,
  type Response,
} from '@agent-console/contracts';
import { WebSocketServer, type WebSocket } from 'ws';
import { createAdapter } from './agent/create-adapter.js';
import { ClaudeAuth } from './auth/claude-auth.js';
import type { Config } from './config.js';
import { listWorkspaceFiles, readWorkspaceFile } from './files.js';
import { collectDiff, diffTrees, snapshotTree } from './git/diff.js';
import { decodeCommand, encode, encodeEvent, encodeResponse } from './protocol.js';
import { FileThreadStore } from './thread-store.js';
import { ThreadRegistry } from './threads.js';
import { startTurn, type TurnDeps } from './turns.js';

export const RUNNER_VERSION = '0.1.0';

export type RunnerServer = {
  port: number;
  close(): Promise<void>;
};

/** Answer for environments with no Claude CLI to log in: nothing for the UI to offer. */
const AUTH_NOT_APPLICABLE: AuthStatusData = {
  loggedIn: true,
  authMethod: 'none',
  apiKey: false,
  loginPending: false,
};

type ServerDeps = TurnDeps & { auth: ClaudeAuth | undefined };

export async function startServer(
  config: Config,
  auth: ClaudeAuth | undefined = createClaudeAuth(config),
): Promise<RunnerServer> {
  const deps: ServerDeps = {
    registry: new ThreadRegistry(new FileThreadStore(config.threadsDir), config.agent),
    adapter: createAdapter(config, () => auth?.apiKey()),
    cwd: config.cwd,
    auth,
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
      deps.auth?.close();
      deps.registry.stopActiveTurns();
      // Shutdown runs through here, so no agent subprocess outlives the runner.
      await deps.adapter.close?.();
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

function handleConnection(socket: WebSocket, deps: ServerDeps): void {
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
  deps: ServerDeps,
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
      registry.notePrompt(command.threadId, command.text);
      startTurn(deps, command.threadId, command.text, {
        model: command.model,
        effort: command.effort,
        permissionMode: command.permissionMode,
      });
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

    case 'list_threads':
      await reply(socket, command.requestId, async () => ({ threads: registry.list() }));
      return;

    case 'list_models':
      // An adapter that cannot name its models leaves the client on its own defaults.
      await reply(socket, command.requestId, async () => ({
        models: (await deps.adapter.listModels?.()) ?? [],
      }));
      return;

    case 'auth_status':
      await reply(socket, command.requestId, async () =>
        deps.auth ? deps.auth.status() : AUTH_NOT_APPLICABLE,
      );
      return;

    case 'auth_login_start':
      await reply(socket, command.requestId, async () => ({
        authUrl: await requireAuth(deps).loginStart(),
      }));
      return;

    case 'auth_login_code':
      await reply(socket, command.requestId, async () => {
        await requireAuth(deps).loginCode(command.code);
        return { ok: true };
      });
      return;

    case 'auth_logout':
      await reply(socket, command.requestId, async () => {
        await requireAuth(deps).logout();
        return { ok: true };
      });
      return;

    case 'auth_set_api_key':
      await reply(socket, command.requestId, async () => {
        requireAuth(deps).setApiKey(command.key);
        return { ok: true };
      });
      return;

    case 'auth_clear_api_key':
      await reply(socket, command.requestId, async () => {
        requireAuth(deps).clearApiKey();
        return { ok: true };
      });
      return;
  }
}

function createClaudeAuth(config: Config): ClaudeAuth | undefined {
  if (!config.claudeBinary) return undefined;
  return new ClaudeAuth({
    binary: config.claudeBinary,
    configDir: config.claudeConfigDir,
    // Machine-level: one stored key serves every workspace.
    dataDir: config.dataRoot,
    env: process.env,
  });
}

function requireAuth(deps: ServerDeps): ClaudeAuth {
  if (!deps.auth) throw new Error('This environment has no Claude CLI to log in');
  return deps.auth;
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
