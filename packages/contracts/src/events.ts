import { z } from 'zod';
import { PermissionDecisionSchema } from './commands.js';

export const DiffStatusSchema = z.enum(['added', 'modified', 'deleted', 'renamed']);
export type DiffStatus = z.infer<typeof DiffStatusSchema>;

export const DiffFileSchema = z.object({
  path: z.string(),
  status: DiffStatusSchema,
  /** Empty for a binary file, which has a status but no reviewable patch. */
  patch: z.string(),
  /** The previous path, on a renamed file. */
  oldPath: z.string().optional(),
});
export type DiffFile = z.infer<typeof DiffFileSchema>;

/** A commit HEAD moved over during a turn. */
export const CommitSchema = z.object({
  /** Which repository, as its path under the workspace; '' for the one enclosing it. */
  repo: z.string(),
  sha: z.string(),
  subject: z.string(),
  /**
   * False for a commit a pull, merge or branch switch brought in rather than the turn making
   * it. Defaults so thread logs written before this field existed still parse: back then
   * every listed commit was the turn's own.
   */
  made: z.boolean().default(true),
});
export type Commit = z.infer<typeof CommitSchema>;

export const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
});
export type Usage = z.infer<typeof UsageSchema>;

/** Fields every event carries; `seq` is monotonic per thread starting at 1. */
const envelope = {
  seq: z.number().int().positive(),
  threadId: z.string().min(1),
  ts: z.number().int().nonnegative(),
};

export const EventSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('user_message'), text: z.string() }),
  z.object({ ...envelope, type: z.literal('turn_started'), branch: z.string().optional() }),
  /** The thread was renamed, by a model or by the runner; the sidebar follows it. */
  z.object({ ...envelope, type: z.literal('thread_titled'), title: z.string() }),
  z.object({ ...envelope, type: z.literal('thinking_delta'), text: z.string() }),
  z.object({ ...envelope, type: z.literal('thinking_finished') }),
  z.object({ ...envelope, type: z.literal('assistant_delta'), text: z.string() }),
  z.object({ ...envelope, type: z.literal('assistant_message'), text: z.string() }),
  z.object({
    ...envelope,
    type: z.literal('tool_call_started'),
    toolCallId: z.string(),
    name: z.string(),
    input: z.unknown(),
    /** Set when a sub-agent made the call; the id of the tool call that spawned it. */
    parentToolCallId: z.string().optional(),
  }),
  z.object({
    ...envelope,
    type: z.literal('tool_call_finished'),
    toolCallId: z.string(),
    output: z.string().optional(),
    /** The runner dropped the middle of an oversized output to keep the thread log small. */
    outputTruncated: z.boolean().optional(),
    isError: z.boolean(),
    parentToolCallId: z.string().optional(),
  }),
  z.object({
    ...envelope,
    type: z.literal('permission_requested'),
    requestId: z.string(),
    toolName: z.string(),
    input: z.unknown(),
    description: z.string().optional(),
  }),
  z.object({
    ...envelope,
    type: z.literal('permission_resolved'),
    requestId: z.string(),
    decision: PermissionDecisionSchema,
  }),
  z.object({
    ...envelope,
    type: z.literal('diff_ready'),
    files: z.array(DiffFileSchema),
    /** Commits made during the turn; they change history, not files, so `files` misses them. */
    commits: z.array(CommitSchema).optional(),
    /** How many commits there were before the cap; more than `commits.length` means it was cut. */
    commitsTotal: z.number().int().nonnegative().optional(),
  }),
  z.object({
    ...envelope,
    type: z.literal('turn_finished'),
    stopReason: z.string(),
    usage: UsageSchema.optional(),
  }),
  z.object({
    ...envelope,
    type: z.literal('error'),
    message: z.string(),
    code: z.string().optional(),
  }),
]);
export type Event = z.infer<typeof EventSchema>;
export type EventType = Event['type'];

/** An event before the thread log stamps it with seq/threadId/ts. */
export type EventBody = {
  [K in EventType]: Omit<Extract<Event, { type: K }>, 'seq' | 'threadId' | 'ts'>;
}[EventType];
