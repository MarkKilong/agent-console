'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';

type Props = {
  disabled: boolean;
  turnActive: boolean;
  onSend(text: string): void;
  onStop(): void;
};

export function Composer({ disabled, turnActive, onSend, onStop }: Props) {
  const [text, setText] = useState('');

  function send() {
    const prompt = text.trim();
    if (!prompt || disabled) return;
    onSend(prompt);
    setText('');
  }

  return (
    <div className="shrink-0 px-4 pb-4">
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
          placeholder="Ask for changes, send follow-ups, or attach images"
          className={cn(
            'block max-h-50 min-h-17.5 w-full resize-none bg-transparent px-4 pt-3.5 leading-relaxed',
            'placeholder:text-muted/75 focus:outline-none disabled:opacity-50',
          )}
        />

        <div className="flex items-center justify-between gap-2 px-4 pb-3">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted">
            Claude
            <ChevronDown className="size-3.5 shrink-0 opacity-70" />
          </span>

          <div className="flex shrink-0 items-center gap-2">
            {turnActive ? <StopButton onClick={onStop} /> : null}
            <SendButton onClick={send} disabled={disabled || !text.trim()} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SendButton({ onClick, disabled }: { onClick(): void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label="Send"
      className={cn(
        'flex size-8 items-center justify-center rounded-full bg-accent text-white transition-all duration-150',
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
