// Scripted stand-in for `codex app-server`: speaks enough of the JSON-RPC
// protocol to drive one turn, so the adapter can be tested without the CLI.
// Knobs: FAKE_CODEX_UNAUTHENTICATED=1, FAKE_CODEX_UNKNOWN_THREAD=1, and a prompt
// containing "hang" runs a turn that only ends when it is interrupted.
import { createInterface } from 'node:readline';

const unauthenticated = process.env.FAKE_CODEX_UNAUTHENTICATED === '1';
const unknownThread = process.env.FAKE_CODEX_UNKNOWN_THREAD === '1';

let counter = 0;
let nextId = 1000;
/** Server request id -> resolve, for approvals we are waiting on. */
const approvals = new Map();
/** Codex thread id -> how to end its hanging turn. */
const hanging = new Map();

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, message) => send({ jsonrpc: '2.0', id, error: { code: -32000, message } });
const notify = (method, params) => send({ jsonrpc: '2.0', method, params });

createInterface({ input: process.stdin }).on('line', (line) => {
  const text = line.trim();
  if (text) handle(JSON.parse(text));
});

function handle(message) {
  if (message.method === undefined) {
    const resolve = approvals.get(message.id);
    if (resolve) {
      approvals.delete(message.id);
      resolve(message.result?.decision ?? 'decline');
    }
    return;
  }

  const params = message.params ?? {};
  switch (message.method) {
    case 'initialize':
      return reply(message.id, { userAgent: 'fake-codex/0.0.0' });
    case 'initialized':
      return;
    case 'account/read':
      return reply(
        message.id,
        unauthenticated
          ? { requiresOpenaiAuth: true }
          : { account: { id: 'acct-1' }, requiresOpenaiAuth: true },
      );
    case 'thread/start':
      return reply(message.id, {
        thread: { id: `codex-thread-${++counter}` },
        cwd: params.cwd,
        model: params.model ?? 'gpt-5-codex',
      });
    case 'thread/resume':
      if (unknownThread) return fail(message.id, 'thread not found');
      return reply(message.id, {
        thread: { id: params.threadId },
        cwd: params.cwd,
        model: 'gpt-5-codex',
      });
    case 'turn/start': {
      const turnId = `turn-${++counter}`;
      reply(message.id, { turn: { id: turnId } });
      notify('turn/started', { threadId: params.threadId, turn: { id: turnId } });
      void runTurn(params.threadId, turnId, params.input.map((part) => part.text).join(''));
      return;
    }
    case 'turn/interrupt': {
      reply(message.id, {});
      const end = hanging.get(params.threadId);
      if (end) {
        hanging.delete(params.threadId);
        end();
      }
      return;
    }
    default:
      return fail(message.id, `unknown method ${message.method}`);
  }
}

async function runTurn(threadId, turnId, prompt) {
  const messageId = `item-message-${turnId}`;
  notify('item/agentMessage/delta', {
    threadId,
    turnId,
    itemId: messageId,
    delta: 'Hello from fake codex',
  });
  notify('item/completed', {
    threadId,
    turnId,
    item: { id: messageId, type: 'agentMessage', text: 'Hello from fake codex' },
  });

  // A sub-agent shares the socket; the adapter must ignore its notifications.
  notify('item/agentMessage/delta', {
    threadId: `${threadId}-sub-agent`,
    turnId,
    itemId: 'item-sub-agent',
    delta: 'Hello from a sub-agent',
  });

  if (prompt.includes('hang')) {
    hanging.set(threadId, () => finish(threadId, turnId, 'interrupted'));
    return;
  }

  const commandId = `item-command-${turnId}`;
  const command = { id: commandId, type: 'commandExecution', command: 'echo hi', cwd: '/repo' };
  notify('item/started', { threadId, turnId, item: command });
  notify('item/commandExecution/outputDelta', {
    threadId,
    turnId,
    itemId: commandId,
    chunk: 'hi\n',
  });

  const decision = await new Promise((resolve) => {
    const id = nextId++;
    approvals.set(id, resolve);
    send({
      jsonrpc: '2.0',
      id,
      method: 'item/commandExecution/requestApproval',
      params: { threadId, turnId, itemId: commandId, ...command, reason: 'Run echo hi' },
    });
  });

  notify('item/completed', {
    threadId,
    turnId,
    item:
      decision === 'accept'
        ? { ...command, status: 'completed', exitCode: 0 }
        : { ...command, status: 'declined' },
  });
  finish(threadId, turnId, 'completed');
}

function finish(threadId, turnId, status) {
  notify('thread/tokenUsage/updated', {
    threadId,
    turnId,
    tokenUsage: {
      last: { inputTokens: 11, outputTokens: 22 },
      total: { inputTokens: 11, outputTokens: 22 },
      modelContextWindow: 200000,
    },
  });
  notify('turn/completed', { threadId, turn: { id: turnId, status } });
}
