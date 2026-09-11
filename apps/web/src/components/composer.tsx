'use client';

import type { PermissionMode } from '@agent-console/contracts';
import { Lock, LockOpen, Paperclip, PencilLine } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { ACCESS_MODES, EFFORTS, effortChoices, mergeModels, resolveModelId } from '@/lib/models';
import { useAuthStore } from '@/store/use-auth-store';
import { useComposerDraft } from '@/store/use-composer-draft';
import { useComposerSettings } from '@/store/use-composer-settings';
import { useModelSettings } from '@/store/use-model-settings';
import { ModelPicker, Picker } from './choice-picker';
import { Spinner } from './ui';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

type Props = {
  disabled: boolean;
  turnActive: boolean;
  /** Stop was asked for and the turn has not ended yet. */
  stopping: boolean;
  placeholder: string;
  onSend(text: string): void;
  onStop(): void;
};

export function Composer({ disabled, turnActive, stopping, placeholder, onSend, onStop }: Props) {
  const [text, setText] = useState('');
  const { model, effort, permissionMode, setModel, setEffort, setPermissionMode } =
    useComposerSettings();
  const models = useAuthStore((state) => state.models);
  const disabledModels = useModelSettings((state) => state.disabled);
  const customModels = useModelSettings((state) => state.custom);
  const textarea = useRef<HTMLTextAreaElement>(null);
  // Raised by an insert, read once the appended text is on screen: only then is there
  // an end for the caret to sit at.
  const caretToEnd = useRef(false);

  // Subscribed rather than selected: a hand-off from the terminal is an event, and
  // consuming it clears the store, which a selector would see as a second render.
  useEffect(
    () =>
      useComposerDraft.subscribe((state) => {
        if (state.insert === null) return;
        const pending = useComposerDraft.getState().consumeInsert();
        if (pending === null) return;
        setText((current) => (current.trim() ? `${current}\n\n${pending}` : pending));
        caretToEnd.current = true;
      }),
    [],
  );

  useEffect(() => {
    if (!caretToEnd.current) return;
    caretToEnd.current = false;
    const node = textarea.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, [text]);

  // The persisted id may name a row by its alias or by what that alias resolves to.
  const selectedModel = resolveModelId(models, model);
  // A hand-added model reports no levels, so effort stays on the CLI's list and defaults.
  const efforts = effortChoices(models, selectedModel);

  function send() {
    const prompt = text.trim();
    if (!prompt || disabled) return;
    onSend(prompt);
    setText('');
  }

  return (
    <div className="shrink-0">
      <div className="rounded-composer border border-line bg-panel">
        <textarea
          ref={textarea}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          rows={3}
          disabled={disabled}
          placeholder={placeholder}
          className={cn(
            'block max-h-50 min-h-17.5 w-full resize-none bg-transparent px-4 pt-3.5 leading-relaxed',
            'placeholder:text-muted-foreground/75 focus:outline-none disabled:opacity-50',
          )}
        />

        <div className="flex items-center justify-between gap-2 px-4 pb-3">
          <div className="flex min-w-0 items-center gap-1">
            <ModelPicker
              label="Model"
              models={mergeModels(models, customModels)}
              disabled={disabledModels}
              value={selectedModel}
              onChange={setModel}
            />
            <Picker
              label="Effort"
              choices={efforts?.length ? efforts : EFFORTS}
              value={effort}
              onChange={setEffort}
              disabledReason={efforts?.length === 0 ? 'This model has one effort level' : undefined}
            />
            <Picker
              label="Access"
              choices={ACCESS_MODES}
              value={permissionMode}
              onChange={setPermissionMode}
              icon={accessIcon}
            />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Tooltip>
              {/* A disabled button swallows pointer events, so the trigger is the wrapper. */}
              <TooltipTrigger asChild>
                <span>
                  <Button variant="ghost" size="icon-sm" disabled aria-label="Attach">
                    <Paperclip />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Coming soon</TooltipContent>
            </Tooltip>
            {turnActive ? <StopButton onClick={onStop} stopping={stopping} /> : null}
            <SendButton onClick={send} disabled={disabled || !text.trim()} />
          </div>
        </div>
      </div>
    </div>
  );
}

function accessIcon(mode: PermissionMode): ReactNode {
  if (mode === 'bypassPermissions') return <LockOpen />;
  if (mode === 'acceptEdits') return <PencilLine />;
  return <Lock />;
}

function SendButton({ onClick, disabled }: { onClick(): void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label="Send"
      className={cn(
        'flex size-8 items-center justify-center rounded-full bg-brand text-white transition-all duration-150',
        'hover:scale-105 hover:brightness-110',
        'disabled:pointer-events-none disabled:opacity-30',
      )}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path
          d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function StopButton({ onClick, stopping }: { onClick(): void; stopping: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={stopping}
      aria-label="Stop"
      className={cn(
        'flex size-8 items-center justify-center rounded-full bg-danger/90 text-white transition-all duration-150',
        'hover:scale-105 hover:bg-danger disabled:pointer-events-none disabled:opacity-60',
      )}
    >
      {stopping ? (
        <Spinner className="size-3.5" />
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}
