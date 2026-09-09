import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { EventSchema, type Event } from '@agent-console/contracts';
import { z } from 'zod';

const MetaSchema = z.object({
  title: z.string(),
  agent: z.string(),
  sessionId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ThreadMeta = z.infer<typeof MetaSchema>;

export type StoredThread = {
  id: string;
  meta: ThreadMeta;
  events: Event[];
};

/** Where a ThreadRegistry keeps its log between runs. */
export interface ThreadStore {
  load(): StoredThread[];
  writeMeta(threadId: string, meta: ThreadMeta): void;
  appendEvent(threadId: string, event: Event): void;
}

/** Store for tests, and the default when a registry is built without one. */
export class MemoryThreadStore implements ThreadStore {
  private readonly threads = new Map<string, { meta?: ThreadMeta; events: Event[] }>();

  load(): StoredThread[] {
    return [...this.threads].map(([id, thread]) => ({
      id,
      meta: withTimes(thread.meta, thread.events),
      events: [...thread.events],
    }));
  }

  writeMeta(threadId: string, meta: ThreadMeta): void {
    this.thread(threadId).meta = { ...meta };
  }

  appendEvent(threadId: string, event: Event): void {
    this.thread(threadId).events.push(event);
  }

  private thread(threadId: string): { meta?: ThreadMeta; events: Event[] } {
    let thread = this.threads.get(threadId);
    if (!thread) {
      thread = { events: [] };
      this.threads.set(threadId, thread);
    }
    return thread;
  }
}

/**
 * One append-only JSON-lines file per thread: a `meta` header, then events.
 * A later header supersedes the earlier one, so nothing is ever rewritten.
 */
export class FileThreadStore implements ThreadStore {
  private created = false;

  constructor(private readonly dir: string) {}

  load(): StoredThread[] {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return [];
    }
    return names.filter((name) => name.endsWith('.jsonl')).map((name) => this.read(name));
  }

  writeMeta(threadId: string, meta: ThreadMeta): void {
    this.write(threadId, { kind: 'meta', ...meta });
  }

  appendEvent(threadId: string, event: Event): void {
    this.write(threadId, event);
  }

  private read(name: string): StoredThread {
    const events: Event[] = [];
    let meta: ThreadMeta | undefined;

    for (const line of readFileSync(join(this.dir, name), 'utf8').split('\n')) {
      // A crash can leave a half-written final line; skipping it costs one event.
      const json = parseJson(line);
      if (json === undefined) continue;

      const header = MetaSchema.safeParse(json);
      if (header.success) {
        meta = header.data;
        continue;
      }
      const event = EventSchema.safeParse(json);
      if (event.success) events.push(event.data);
    }

    return {
      id: decodeURIComponent(basename(name, '.jsonl')),
      meta: withTimes(meta, events),
      events,
    };
  }

  private write(threadId: string, line: object): void {
    try {
      if (!this.created) {
        mkdirSync(this.dir, { recursive: true });
        this.created = true;
      }
      const file = join(this.dir, `${encodeURIComponent(threadId)}.jsonl`);
      appendFileSync(file, `${JSON.stringify(line)}\n`);
    } catch (error) {
      // An unwritable log must not take the turn down with it.
      console.error(`Could not persist thread ${threadId}:`, error);
    }
  }
}

/** Event timestamps stand in when a header is missing or older than the log. */
function withTimes(meta: ThreadMeta | undefined, events: Event[]): ThreadMeta {
  const last = events.at(-1)?.ts ?? 0;
  return {
    title: '',
    agent: '',
    createdAt: events[0]?.ts ?? last,
    ...meta,
    updatedAt: Math.max(meta?.updatedAt ?? 0, last),
  };
}

function parseJson(line: string): unknown {
  if (!line.trim()) return undefined;
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
