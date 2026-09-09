'use client';

import type { PermissionMode } from '@agent-console/contracts';
import { ChevronDown, Lock, LockOpen, Paperclip, PencilLine } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { ACCESS_MODES, EFFORTS, MODELS, labelOf, type Choice } from '@/lib/models';
import { useComposerSettings } from '@/store/use-composer-settings';
import { ClaudeMark } from './claude-mark';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

type Props = {
  disabled: boolean;
  turnActive: boolean;
  placeholder: string;
  onSend(text: string): void;
  onStop(): void;
};

export function Composer({ disabled, turnActive, placeholder, onSend, onStop }: Props) {
  const [text, setText] = useState('');
  const { model, effort, permissionMode, setModel, setEffort, setPermissionMode } =
    useComposerSettings();

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
            <Picker
              label="Model"
              choices={MODELS}
              value={model}
              onChange={setModel}
              icon={() => <ClaudeMark />}
            />
            <Picker label="Effort" choices={EFFORTS} value={effort} onChange={setEffort} />
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
            {turnActive ? <StopButton onClick={onStop} /> : null}
            <SendButton onClick={send} disabled={disabled || !text.trim()} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Picker<T extends string>({
  label,
  choices,
  value,
  onChange,
  icon,
}: {
  label: string;
  choices: Choice<T>[];
  value: T;
  onChange(id: T): void;
  /** Leading icon for a choice, shown on the trigger and in the menu. */
  icon?: (id: T) => ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label}>
          {icon?.(value)}
          {labelOf(choices, value)}
          <ChevronDown className="opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {choices.map((choice) => (
          <DropdownMenuItem key={choice.id} onSelect={() => onChange(choice.id)}>
            {icon?.(choice.id)}
            {choice.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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

function StopButton({ onClick }: { onClick(): void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Stop"
      className="flex size-8 items-center justify-center rounded-full bg-danger/90 text-white transition-all duration-150 hover:scale-105 hover:bg-danger"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" />
      </svg>
    </button>
  );
}
