'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import type { AssistantItem } from '@/lib/turn-groups';
import { Markdown } from './markdown';

/** An answer, or a line of prose the agent dropped mid-turn; the reasoning sits above it. */
export function AssistantMessage({ item }: { item: AssistantItem }) {
  return (
    <div className="w-full min-w-0 space-y-1.5">
      {item.thinking ? (
        <ThinkingBlock text={item.thinking} live={item.streaming && item.text === ''} />
      ) : null}
      {item.text ? (
        <div>
          <Markdown>{item.text}</Markdown>
          {item.streaming ? (
            <span className="ml-0.5 animate-pulse text-muted-foreground">▍</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Collapsed by default, but self-opens while the reasoning is all there is to show. */
function ThinkingBlock({ text, live }: { text: string; live: boolean }) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? live;

  return (
    <div>
      <button
        onClick={() => setOverride(!open)}
        className="flex min-h-6 cursor-pointer items-center gap-1 rounded-md px-0.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-white/5"
      >
        <span className={cn(live && 'animate-pulse')}>Thinking</span>
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </button>

      {open ? (
        <div className="mt-1 rounded-lg border border-line bg-raised px-2.5 py-2 text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {text}
        </div>
      ) : null}
    </div>
  );
}
