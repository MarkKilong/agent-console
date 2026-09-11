import type {
  Effort,
  EventBody,
  ModelInfo,
  PermissionDecision,
  PermissionMode,
} from '@agent-console/contracts';

export type PermissionRequest = {
  toolName: string;
  input: unknown;
  description?: string;
};

export type TurnCallbacks = {
  /** Normalized events for the thread log. The caller stamps seq/threadId/ts. */
  onEvent(body: EventBody): void;
  requestPermission(request: PermissionRequest): Promise<PermissionDecision>;
};

/** Per-turn overrides the client picks in the composer; absent means the runner's default. */
export type TurnOptions = {
  model?: string;
  effort?: Effort;
  permissionMode?: PermissionMode;
  /** Model asked to name the thread alongside the turn; the turn itself ignores it. */
  titleModel?: string;
};

export type StartTurnParams = TurnOptions & {
  threadId: string;
  prompt: string;
  cwd: string;
  resumeSessionId?: string;
};

export type TurnResult = {
  /** Cursor to pass back as `resumeSessionId` on the next turn. */
  sessionId?: string;
};

/**
 * A harness (Claude Code today, Codex later) normalized to our event stream.
 * Implementations emit everything except `turn_started`, `permission_*` and
 * `diff_ready`, which the turn runner owns.
 */
export interface AgentAdapter {
  startTurn(params: StartTurnParams, callbacks: TurnCallbacks): Promise<TurnResult>;
  stop(threadId: string): void;
  /** The models this harness offers; absent when it cannot say, and the server answers empty. */
  listModels?(): Promise<ModelInfo[]>;
  /** Names a thread after its first prompt; absent when the harness cannot run a one-shot. */
  title?(prompt: string, model: string): Promise<string>;
  /** Releases whatever the adapter holds (a subprocess, say) when the runner shuts down. */
  close?(): Promise<void> | void;
}
