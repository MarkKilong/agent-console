'use client';

import type { PermissionDecision } from '@agent-console/contracts';
import { Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { RunnerClient } from '@/lib/runner-client';
import { useComposerSettings } from '@/store/use-composer-settings';
import { useConsoleStore, useThread } from '@/store/use-console-store';
import { useActiveProject } from '@/store/use-projects-store';
import { Composer } from './composer';
import { MessageList } from './message-list';
import { Button } from './ui/button';

type Props = {
  client: RunnerClient | null;
  threadId: string | null;
  onShowFiles(turnIndex: number): void;
  onAddProject(): void;
};

export function ChatPane({ client, threadId, onShowFiles, onAddProject }: Props) {
  const project = useActiveProject();
  const notePrompt = useConsoleStore((state) => state.notePrompt);
  const thread = useThread(threadId);
  const [error, setError] = useState<string | null>(null);

  const connected = Boolean(client && threadId);

  function guard(action: () => void) {
    try {
      setError(null);
      action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function send(text: string) {
    if (!client || !threadId) return;
    const { model, effort, permissionMode } = useComposerSettings.getState();
    guard(() => {
      client.send({ type: 'send_prompt', threadId, text, model, effort, permissionMode });
      notePrompt(threadId, text);
    });
  }

  function answer(requestId: string, decision: PermissionDecision) {
    if (!client || !threadId) return;
    guard(() => client.send({ type: 'answer_permission', threadId, requestId, decision }));
  }

  const composer = (
    <Composer
      disabled={!connected}
      turnActive={thread.turnActive}
      placeholder={
        project
          ? 'Ask for changes, send follow-ups, or attach images'
          : 'Choose a project above to start a thread'
      }
      onSend={send}
      onStop={() => client && threadId && guard(() => client.send({ type: 'stop_turn', threadId }))}
    />
  );
  const errorLine = error ? <div className="text-xs text-danger">{error}</div> : null;

  // Before the first message the prompt box sits in the middle of the pane; after it, at the foot.
  if (!project || thread.items.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-4">
        {project ? (
          <h2 className="text-xl font-medium">What should we build in {project.name}?</h2>
        ) : (
          <NoProject onAddProject={onAddProject} />
        )}
        {errorLine}
        <div className="w-full max-w-3xl">{composer}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageList
        items={thread.items}
        permissions={thread.permissions}
        connected={connected}
        onAnswer={answer}
        onShowFiles={onShowFiles}
      />
      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        {errorLine}
        {composer}
      </div>
    </div>
  );
}

function NoProject({ onAddProject }: { onAddProject(): void }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <Sparkles className="size-8 text-muted-foreground/50" />
      <p className="text-lg font-medium">Add a project to start</p>
      <Button onClick={onAddProject}>
        <Plus />
        Add project
      </Button>
    </div>
  );
}
