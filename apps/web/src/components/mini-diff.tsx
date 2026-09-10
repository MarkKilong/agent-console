import { cn } from '@/lib/cn';

const MAX_LINES = 12;

/** `old_string` → `new_string` as two coloured blocks; shared by tool rows and permission cards. */
export function MiniDiff({ before, after }: { before: string; after: string }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-black/20 py-1 font-mono text-[11px] leading-[1.6]">
      <Side text={before} kind="remove" />
      <Side text={after} kind="add" />
    </div>
  );
}

function Side({ text, kind }: { text: string; kind: 'add' | 'remove' }) {
  if (!text) return null;
  const lines = text.split('\n');
  const shown = lines.slice(0, MAX_LINES);

  return (
    <>
      {shown.map((line, index) => (
        <div
          key={index}
          className={cn(
            'px-2 whitespace-pre',
            kind === 'add' ? 'bg-success/12 text-success' : 'bg-danger/12 text-danger',
          )}
        >
          {kind === 'add' ? '+' : '−'} {line}
        </div>
      ))}
      {lines.length > shown.length ? (
        <div className="px-2 text-muted-foreground">… {lines.length - shown.length} more lines</div>
      ) : null}
    </>
  );
}
