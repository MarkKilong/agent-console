import type { ChildProcess } from 'node:child_process';

/** Thrown by a server-request handler to choose the JSON-RPC error code. */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export type NotificationHandler = (method: string, params: unknown) => void;
export type ServerRequestHandler = (method: string, params: unknown) => Promise<unknown>;

type Pending = { resolve(value: unknown): void; reject(error: Error): void };

type Incoming = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

/** Newline-delimited JSON-RPC 2.0 over a child process's stdio. */
export class JsonRpcClient {
  private nextId = 1;
  private buffer = '';
  private dead: Error | undefined;
  private readonly pending = new Map<number, Pending>();
  private onNotify: NotificationHandler = () => {};
  private onRequest: ServerRequestHandler = async (method) => {
    throw new RpcError(-32601, `Unsupported request: ${method}`);
  };

  constructor(private readonly child: ChildProcess) {
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.consume(chunk));
    child.once('error', (error) => this.fail(error));
    child.once('exit', (code, signal) =>
      this.fail(new Error(`codex app-server exited (code=${code}, signal=${signal})`)),
    );
  }

  onNotification(handler: NotificationHandler): void {
    this.onNotify = handler;
  }

  onServerRequest(handler: ServerRequestHandler): void {
    this.onRequest = handler;
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.dead) return Promise.reject(this.dead);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  close(): void {
    this.child.kill();
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    for (let end = this.buffer.indexOf('\n'); end >= 0; end = this.buffer.indexOf('\n')) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (line) this.handle(line);
    }
  }

  private handle(line: string): void {
    let message: Incoming;
    try {
      message = JSON.parse(line) as Incoming;
    } catch {
      return; // anything the server prints that is not a message is log noise
    }

    if (message.method !== undefined) {
      if (message.id === undefined) this.onNotify(message.method, message.params);
      else void this.answer(message.id, message.method, message.params);
      return;
    }

    const pending = message.id === undefined ? undefined : this.pending.get(message.id);
    if (!pending || message.id === undefined) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message ?? 'JSON-RPC error'));
    else pending.resolve(message.result);
  }

  private async answer(id: number, method: string, params: unknown): Promise<void> {
    try {
      const result = await this.onRequest(method, params);
      this.write({ jsonrpc: '2.0', id, result: result ?? null });
    } catch (error) {
      const code = error instanceof RpcError ? error.code : -32603;
      const message = error instanceof Error ? error.message : String(error);
      this.write({ jsonrpc: '2.0', id, error: { code, message } });
    }
  }

  private fail(error: Error): void {
    this.dead ??= error;
    for (const [id, pending] of [...this.pending]) {
      this.pending.delete(id);
      pending.reject(this.dead);
    }
  }

  private write(message: unknown): void {
    this.child.stdin?.write(`${JSON.stringify(message)}\n`);
  }
}
