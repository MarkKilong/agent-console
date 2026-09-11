import type { Commit } from '@agent-console/contracts';
import type { ChatItem, Turn } from '@/store/thread-state';

export type UserItem = Extract<ChatItem, { kind: 'user' }>;
export type AssistantItem = Extract<ChatItem, { kind: 'assistant' }>;
export type ToolItem = Extract<ChatItem, { kind: 'tool' }>;
export type SummaryItem = Extract<ChatItem, { kind: 'summary' }>;
export type ErrorItem = Extract<ChatItem, { kind: 'error' }>;

/** One prompt and everything the agent did in reply to it. */
export type TurnGroup = {
  /** Absent for items logged before the first `turn_started`, i.e. threads from an older build. */
  turn: Turn | undefined;
  prompt: UserItem | undefined;
  /** What goes inside the work fold: tool calls and any intermediate assistant text. */
  work: ChatItem[];
  answer: AssistantItem | undefined;
  summary: SummaryItem | undefined;
  errors: ErrorItem[];
};

/**
 * Splits the flat item list on prompts and pairs each group with its turn.
 * The answer is the turn's last assistant message, unless a tool ran after it —
 * then it is still part of the work.
 */
export function groupTurns(items: ChatItem[], turns: Turn[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  let current: TurnGroup | undefined;
  let turnIndex = 0;

  for (const item of items) {
    if (item.kind === 'user' || !current) {
      const prompt = item.kind === 'user' ? item : undefined;
      // Prompts and turns are logged in lockstep, so the nth prompt owns the nth turn.
      current = {
        turn: prompt ? turns[turnIndex++] : undefined,
        prompt,
        work: [],
        answer: undefined,
        summary: undefined,
        errors: [],
      };
      groups.push(current);
      if (prompt) continue;
    }

    if (item.kind === 'summary') current.summary = item;
    else if (item.kind === 'error') current.errors.push(item);
    else current.work.push(item);
  }

  return groups.map(pullAnswer);
}

function pullAnswer(group: TurnGroup): TurnGroup {
  const lastTool = lastIndexOf(group.work, 'tool');
  const lastAssistant = lastIndexOf(group.work, 'assistant');
  if (lastAssistant < 0 || lastAssistant < lastTool) return group;

  const answer = group.work[lastAssistant] as AssistantItem;
  return { ...group, answer, work: group.work.filter((_, index) => index !== lastAssistant) };
}

function lastIndexOf(items: ChatItem[], kind: ChatItem['kind']): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i]?.kind === kind) return i;
  }
  return -1;
}

export type ToolNode = { item: ToolItem; children: ToolNode[] };
export type WorkRow = { kind: 'tool'; node: ToolNode } | { kind: 'item'; item: ChatItem };

/** A sub-agent's calls hang off the `Task` row that spawned them; order is otherwise kept. */
export function nestTools(work: ChatItem[]): WorkRow[] {
  const rows: WorkRow[] = [];
  const nodes = new Map<string, ToolNode>();

  for (const item of work) {
    if (item.kind !== 'tool') {
      rows.push({ kind: 'item', item });
      continue;
    }
    const node: ToolNode = { item, children: [] };
    nodes.set(item.id, node);
    // A parent outside this turn cannot be nested under, so the child stays top level.
    const parent = item.parentToolCallId ? nodes.get(item.parentToolCallId) : undefined;
    if (parent) parent.children.push(node);
    else rows.push({ kind: 'tool', node });
  }

  return rows;
}

export function countTools(rows: WorkRow[]): number {
  return countNodes(rows.flatMap((row) => (row.kind === 'tool' ? [row.node] : [])));
}

/** Tool rows including everything nested beneath them, which is what the fold header counts. */
export function countNodes(nodes: ToolNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
}

export type CommitSplit = {
  made: Commit[];
  pulled: Commit[];
  /** Every pulled-in commit, including those the runner's cap left out of `pulled`. */
  pulledTotal: number;
  pulledHidden: number;
};

/** The total counts every commit, so taking off the made rows — which always show — leaves the pulled ones. */
export function splitCommits(summary: Pick<SummaryItem, 'commits' | 'commitsTotal'>): CommitSplit {
  const made = summary.commits.filter((commit) => commit.made);
  const pulled = summary.commits.filter((commit) => !commit.made);
  const pulledTotal = summary.commitsTotal - made.length;
  return { made, pulled, pulledTotal, pulledHidden: pulledTotal - pulled.length };
}
