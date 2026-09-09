import { randomUUID } from 'node:crypto';
import type { PermissionDecision } from '@agent-console/contracts';
import type { AgentAdapter, PermissionRequest, TurnOptions } from './agent/agent-adapter.js';
import { diffTrees, snapshotTree } from './git/diff.js';
import { currentBranch } from './git/exec.js';
import type { ActiveTurn, ThreadRegistry } from './threads.js';

export type TurnDeps = {
  registry: ThreadRegistry;
  adapter: AgentAdapter;
  cwd: string;
};

/** Starts a turn, or logs an error event if one is already running on the thread. */
export function startTurn(
  deps: TurnDeps,
  threadId: string,
  prompt: string,
  options: TurnOptions = {},
): void {
  if (deps.registry.activeTurn(threadId)) {
    deps.registry.append(threadId, {
      type: 'error',
      message: 'A turn is already running on this thread',
      code: 'turn_active',
    });
    return;
  }

  // Logged here rather than on the command so a refused prompt leaves no trace.
  deps.registry.append(threadId, { type: 'user_message', text: prompt });
  const turn = new Turn(deps, threadId, options);
  deps.registry.setActiveTurn(threadId, turn);
  void turn.run(prompt);
}

class Turn implements ActiveTurn {
  private readonly pending = new Map<string, (decision: PermissionDecision) => void>();
  /** Working tree as it looked when the turn started; the diff is measured against it. */
  private baseTree: string | undefined;
  /** Set by stop(); a stop landing before the adapter starts must not be lost. */
  private stopped = false;
  /** The adapter only knows about the turn once startTurn has been called. */
  private adapterStarted = false;

  constructor(
    private readonly deps: TurnDeps,
    private readonly threadId: string,
    private readonly options: TurnOptions,
  ) {}

  async run(prompt: string): Promise<void> {
    const { registry, adapter, cwd } = this.deps;
    // One git call per turn: the card in the sidebar shows where the work happened.
    const branch = await currentBranch(cwd);
    if (branch) registry.setBranch(this.threadId, branch);
    registry.append(this.threadId, { type: 'turn_started', ...(branch ? { branch } : {}) });
    this.baseTree = await this.snapshot();
    registry.setBaseTree(this.threadId, this.baseTree);

    try {
      if (this.stopped) {
        registry.append(this.threadId, { type: 'turn_finished', stopReason: 'stopped' });
        return;
      }
      this.adapterStarted = true;
      const result = await adapter.startTurn(
        {
          ...this.options,
          threadId: this.threadId,
          prompt,
          cwd,
          resumeSessionId: registry.sessionId(this.threadId),
        },
        {
          onEvent: (body) => void registry.append(this.threadId, body),
          requestPermission: (request) => this.requestPermission(request),
        },
      );
      if (result.sessionId) {
        registry.setSessionId(this.threadId, result.sessionId);
      }
    } catch (error) {
      // Adapters reject when their in-flight request is aborted; a stop the user
      // asked for is not an error, whichever adapter it came from.
      if (this.stopped) {
        registry.append(this.threadId, { type: 'turn_finished', stopReason: 'stopped' });
      } else {
        registry.append(this.threadId, { type: 'error', message: describe(error) });
        registry.append(this.threadId, { type: 'turn_finished', stopReason: 'error' });
      }
    } finally {
      this.denyPending();
      await this.emitDiff();
      registry.setActiveTurn(this.threadId, undefined);
    }
  }

  answerPermission(requestId: string, decision: PermissionDecision): boolean {
    const resolve = this.pending.get(requestId);
    if (!resolve) return false;
    this.pending.delete(requestId);
    this.deps.registry.append(this.threadId, { type: 'permission_resolved', requestId, decision });
    resolve(decision);
    return true;
  }

  stop(): void {
    this.stopped = true;
    if (this.adapterStarted) this.deps.adapter.stop(this.threadId);
    this.denyPending();
  }

  private requestPermission(request: PermissionRequest): Promise<PermissionDecision> {
    const requestId = randomUUID();
    return new Promise((resolve) => {
      this.pending.set(requestId, resolve);
      this.deps.registry.append(this.threadId, {
        type: 'permission_requested',
        requestId,
        toolName: request.toolName,
        input: request.input,
        description: request.description,
      });
    });
  }

  private denyPending(): void {
    for (const requestId of [...this.pending.keys()]) {
      this.answerPermission(requestId, 'deny');
    }
  }

  private async emitDiff(): Promise<void> {
    const before = this.baseTree;
    const after = before ? await this.snapshot() : undefined;
    try {
      const files = before && after ? await diffTrees(this.deps.cwd, before, after) : [];
      this.deps.registry.append(this.threadId, { type: 'diff_ready', files });
    } catch (error) {
      this.deps.registry.append(this.threadId, {
        type: 'error',
        message: `Failed to compute diff: ${describe(error)}`,
        code: 'diff_failed',
      });
    }
  }

  /** Undefined outside a git repository, or if git could not hash the tree. */
  private async snapshot(): Promise<string | undefined> {
    try {
      return await snapshotTree(this.deps.cwd);
    } catch (error) {
      this.deps.registry.append(this.threadId, {
        type: 'error',
        message: `Failed to snapshot the working tree: ${describe(error)}`,
        code: 'diff_failed',
      });
      return undefined;
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
