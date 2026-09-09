import { cn } from '@/lib/cn';

/** Claude's sunburst mark in Anthropic orange; sized like a lucide icon. */
export function ClaudeMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="#d97757"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden
      className={cn('size-4 shrink-0', className)}
    >
      <path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5M5.3 5.3l3.5 3.5M15.2 15.2l3.5 3.5M5.3 18.7l3.5-3.5M15.2 8.8l3.5-3.5" />
    </svg>
  );
}
