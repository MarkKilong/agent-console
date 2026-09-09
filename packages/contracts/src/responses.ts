import { z } from 'zod';
import { DiffFileSchema } from './events.js';

export const ListFilesDataSchema = z.object({
  path: z.string(),
  files: z.array(z.string()),
});
export type ListFilesData = z.infer<typeof ListFilesDataSchema>;

export const ReadFileDataSchema = z.object({
  path: z.string(),
  content: z.string(),
});
export type ReadFileData = z.infer<typeof ReadFileDataSchema>;

export const GetDiffDataSchema = z.object({
  files: z.array(DiffFileSchema),
});
export type GetDiffData = z.infer<typeof GetDiffDataSchema>;

/** One row of the thread list; the events themselves still arrive via `subscribe`. */
export const ThreadSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  agent: z.string(),
  updatedAt: z.number().int().nonnegative(),
});
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;

export const ListThreadsDataSchema = z.object({
  threads: z.array(ThreadSummarySchema),
});
export type ListThreadsData = z.infer<typeof ListThreadsDataSchema>;

/** What the runner knows about the Claude login inside its environment. */
export const AuthStatusDataSchema = z.object({
  loggedIn: z.boolean(),
  /** `claude.ai`, `console`, `none`, … — whatever the CLI reports. */
  authMethod: z.string(),
  email: z.string().optional(),
  orgName: z.string().optional(),
  subscriptionType: z.string().optional(),
  /** An `ANTHROPIC_API_KEY` is stored for this environment. */
  apiKey: z.boolean(),
  /** A login is waiting for its code. */
  loginPending: z.boolean(),
});
export type AuthStatusData = z.infer<typeof AuthStatusDataSchema>;

export const AuthLoginStartDataSchema = z.object({
  authUrl: z.string(),
});
export type AuthLoginStartData = z.infer<typeof AuthLoginStartDataSchema>;

/** Answer to the auth commands that only succeed or fail. */
export const OkDataSchema = z.object({ ok: z.literal(true) });
export type OkData = z.infer<typeof OkDataSchema>;

export const ResponseDataSchema = z.union([
  ListFilesDataSchema,
  ReadFileDataSchema,
  GetDiffDataSchema,
  ListThreadsDataSchema,
  AuthStatusDataSchema,
  AuthLoginStartDataSchema,
  OkDataSchema,
]);
export type ResponseData = z.infer<typeof ResponseDataSchema>;

export const ResponseSchema = z.union([
  z.object({ requestId: z.string().min(1), ok: z.literal(true), data: ResponseDataSchema }),
  z.object({ requestId: z.string().min(1), ok: z.literal(false), error: z.string() }),
]);
export type Response = z.infer<typeof ResponseSchema>;
