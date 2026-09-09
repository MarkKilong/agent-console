import {
  ServerMessageSchema,
  type Command,
  type Event,
  type ResponseData,
} from '@agent-console/contracts';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

/** The commands the runner answers with a `response` message. */
export type RequestCommand =
  | { type: 'list_files'; path?: string }
  | { type: 'read_file'; path: string }
  | { type: 'get_diff'; threadId?: string }
  | { type: 'list_threads' };

export type RunnerClientOptions = {
  url: string;
  token: string;
  onEvent(event: Event): void;
  onStatus(status: ConnectionStatus): void;
};

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];
const REQUEST_TIMEOUT_MS = 30_000;

type Pending = { resolve(data: ResponseData): void; reject(error: Error): void };

/**
 * One WebSocket to one runner. Reconnects with backoff and re-subscribes every
 * thread from the last seq it saw, so the runner replays only what was missed.
 */
export class RunnerClient {
  private socket: WebSocket | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private disposed = false;
  private readonly pending = new Map<string, Pending>();
  private readonly cursors = new Map<string, number>();

  constructor(private readonly options: RunnerClientOptions) {}

  connect(): void {
    if (this.disposed || this.socket) return;

    this.options.onStatus('connecting');
    const socket = new WebSocket(socketUrl(this.options.url, this.options.token));
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.options.onStatus('open');
      for (const [threadId, afterSeq] of this.cursors) {
        this.send({ type: 'subscribe', threadId, afterSeq });
      }
    };
    socket.onmessage = (message) => this.handleMessage(message.data);
    socket.onclose = () => {
      this.socket = undefined;
      this.failPending(new Error('Connection closed'));
      if (this.disposed) return;
      this.options.onStatus('closed');
      this.scheduleReconnect();
    };
    // onclose always follows onerror, so reconnecting is handled in one place.
    socket.onerror = () => socket.close();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.reconnectTimer);
    this.failPending(new Error('Client disposed'));
    this.socket?.close();
    this.socket = undefined;
  }

  /** Subscribes now and on every future reconnect. */
  subscribe(threadId: string): void {
    const afterSeq = this.cursors.get(threadId) ?? 0;
    this.cursors.set(threadId, afterSeq);
    if (this.isOpen()) this.send({ type: 'subscribe', threadId, afterSeq });
  }

  send(command: Command): void {
    if (!this.isOpen()) throw new Error('Not connected to the runner');
    this.socket?.send(JSON.stringify({ kind: 'command', command }));
  }

  request(command: RequestCommand): Promise<ResponseData> {
    const requestId = randomId();
    return new Promise<ResponseData>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Request ${command.type} timed out`));
      }, REQUEST_TIMEOUT_MS);

      const settle = () => {
        clearTimeout(timer);
        this.pending.delete(requestId);
      };
      this.pending.set(requestId, {
        resolve: (data) => {
          settle();
          resolve(data);
        },
        reject: (error) => {
          settle();
          reject(error);
        },
      });

      try {
        this.send({ ...command, requestId } as Command);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }

    const parsed = ServerMessageSchema.safeParse(json);
    if (!parsed.success) {
      console.warn('Discarding malformed runner message', parsed.error.issues);
      return;
    }
    const message = parsed.data;

    if (message.kind === 'event') {
      this.cursors.set(message.event.threadId, message.event.seq);
      this.options.onEvent(message.event);
      return;
    }
    if (message.kind === 'response') {
      const pending = this.pending.get(message.response.requestId);
      if (!pending) return;
      if (message.response.ok) pending.resolve(message.response.data);
      else pending.reject(new Error(message.response.error));
    }
  }

  private isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private failPending(error: Error): void {
    for (const pending of [...this.pending.values()]) pending.reject(error);
    this.pending.clear();
  }

  private scheduleReconnect(): void {
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 8000;
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}

function socketUrl(url: string, token: string): string {
  return `${url.replace(/\/+$/, '')}/?token=${encodeURIComponent(token)}`;
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Math.random().toString(36).slice(2)}`;
}
