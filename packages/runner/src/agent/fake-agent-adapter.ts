import type { AgentAdapter, StartTurnParams, TurnCallbacks, TurnResult } from './agent-adapter.js';

/**
 * Deterministic stand-in for the real SDK: exercises every event shape so the
 * protocol can be tested without a model. Selected with RUNNER_AGENT=fake.
 */
export class FakeAgentAdapter implements AgentAdapter {
  private readonly stopped = new Set<string>();
  /** Releases a `hang-turn` prompt when stop() lands. */
  private readonly hanging = new Map<string, () => void>();

  async startTurn(params: StartTurnParams, callbacks: TurnCallbacks): Promise<TurnResult> {
    const { threadId, prompt } = params;
    this.stopped.delete(threadId);

    // Keyword hook so tests can drive the failure path (an auth error, say).
    if (prompt.includes('fail-turn')) throw new Error('fake adapter failure');

    // Keyword hook for the stop path: run until stop(), then reject the way an aborted query does.
    if (prompt.includes('hang-turn')) {
      callbacks.onEvent({ type: 'assistant_delta', text: 'Working. ' });
      await new Promise<void>((resolve) => this.hanging.set(threadId, resolve));
      throw new Error('Operation aborted');
    }

    callbacks.onEvent({
      type: 'thinking_delta',
      text:
        'The request needs a file written, so a Write call is the smallest step that satisfies it. ' +
        'I will confirm the path first, then delegate the read-back to a sub-agent.',
    });
    callbacks.onEvent({ type: 'thinking_finished' });
    callbacks.onEvent({ type: 'assistant_delta', text: 'Working on: ' });
    callbacks.onEvent({ type: 'assistant_delta', text: prompt });

    const toolCallId = `fake-tool-${threadId}`;
    callbacks.onEvent({
      type: 'tool_call_started',
      toolCallId,
      name: 'Write',
      input: { file_path: 'fake.txt', content: prompt },
    });

    const decision = await callbacks.requestPermission({
      toolName: 'Write',
      input: { file_path: 'fake.txt' },
      description: 'Write fake.txt',
    });

    callbacks.onEvent({
      type: 'tool_call_finished',
      toolCallId,
      output: decision === 'allow' ? 'wrote fake.txt' : 'denied by user',
      isError: decision === 'deny',
    });

    if (this.stopped.has(threadId)) {
      callbacks.onEvent({ type: 'turn_finished', stopReason: 'stopped' });
      return {};
    }

    // A sub-agent call, so the nesting tag has a fixture to be tested against.
    const taskCallId = `fake-task-${threadId}`;
    callbacks.onEvent({
      type: 'tool_call_started',
      toolCallId: taskCallId,
      name: 'Task',
      input: { prompt },
    });
    callbacks.onEvent({
      type: 'tool_call_started',
      toolCallId: `${taskCallId}-child`,
      name: 'Read',
      input: { file_path: 'fake.txt' },
      parentToolCallId: taskCallId,
    });
    callbacks.onEvent({
      type: 'tool_call_finished',
      toolCallId: `${taskCallId}-child`,
      output: prompt,
      isError: false,
      parentToolCallId: taskCallId,
    });
    callbacks.onEvent({
      type: 'tool_call_finished',
      toolCallId: taskCallId,
      output: 'sub-agent finished',
      isError: false,
    });

    callbacks.onEvent({ type: 'assistant_message', text: `Done: ${prompt}` });
    callbacks.onEvent({
      type: 'turn_finished',
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    return { sessionId: `fake-session-${threadId}` };
  }

  stop(threadId: string): void {
    this.stopped.add(threadId);
    this.hanging.get(threadId)?.();
    this.hanging.delete(threadId);
  }
}
