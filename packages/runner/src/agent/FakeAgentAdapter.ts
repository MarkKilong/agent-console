import type { AgentAdapter, StartTurnParams, TurnCallbacks, TurnResult } from './AgentAdapter.js';

/**
 * Deterministic stand-in for the real SDK: exercises every event shape so the
 * protocol can be tested without a model. Selected with RUNNER_AGENT=fake.
 */
export class FakeAgentAdapter implements AgentAdapter {
  private readonly stopped = new Set<string>();

  async startTurn(params: StartTurnParams, callbacks: TurnCallbacks): Promise<TurnResult> {
    const { threadId, prompt } = params;
    this.stopped.delete(threadId);

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
  }
}
