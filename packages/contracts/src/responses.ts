import { z } from 'zod';
import { EffortSchema, TerminalShellSchema } from './commands.js';
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
  /** The workspace branch when the thread last started a turn. */
  branch: z.string().optional(),
  updatedAt: z.number().int().nonnegative(),
});
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;

export const ListThreadsDataSchema = z.object({
  threads: z.array(ThreadSummarySchema),
});
export type ListThreadsData = z.infer<typeof ListThreadsDataSchema>;

/** One model the agent CLI reports as available; the catalogue is never hard-coded. */
export const ModelInfoSchema = z.object({
  /** What `send_prompt` sends as `model`: an alias like `sonnet` or an explicit id. */
  id: z.string(),
  /** The wire id the alias resolves to, so a persisted explicit id can match its row. */
  resolvedId: z.string().optional(),
  name: z.string(),
  description: z.string(),
  /** Absent when the model reports no effort levels at all. */
  effortLevels: z.array(EffortSchema).optional(),
  fastMode: z.boolean().optional(),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

export const ListModelsDataSchema = z.object({
  models: z.array(ModelInfoSchema),
});
export type ListModelsData = z.infer<typeof ListModelsDataSchema>;

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
  /** What `claude --version` reports, when it could be read. */
  version: z.string().optional(),
});
export type AuthStatusData = z.infer<typeof AuthStatusDataSchema>;

export const AuthLoginStartDataSchema = z.object({
  authUrl: z.string(),
});
export type AuthLoginStartData = z.infer<typeof AuthLoginStartDataSchema>;

/** The stored GitHub sign-in, answered from disk: no call to GitHub is made. */
export const GithubStatusDataSchema = z.object({
  connected: z.boolean(),
  login: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  /** A device-flow login waiting for the user to approve it on github.com. */
  pending: z.object({ userCode: z.string(), verificationUri: z.string() }).optional(),
  /** Why the last login ended without a token; cleared when the next one starts. */
  error: z.string().optional(),
});
export type GithubStatusData = z.infer<typeof GithubStatusDataSchema>;

export const GithubLoginStartDataSchema = z.object({
  userCode: z.string(),
  verificationUri: z.string(),
  expiresIn: z.number().int().nonnegative(),
});
export type GithubLoginStartData = z.infer<typeof GithubLoginStartDataSchema>;

/** What the runner knows about the Codex CLI login inside its environment. */
export const CodexAuthStatusDataSchema = z.object({
  /** A Codex binary resolved in this environment; false leaves nothing to offer. */
  installed: z.boolean(),
  loggedIn: z.boolean(),
  authMethod: z.enum(['chatgpt', 'api_key', 'access_token', 'none']),
  /** A device login is waiting for the user to approve it. */
  loginPending: z.boolean(),
  pending: z.object({ userCode: z.string(), verificationUrl: z.string() }).optional(),
  /** What `codex --version` reports, when it could be read. */
  version: z.string().optional(),
  /** Why the last login ended without a session; cleared when the next one starts. */
  error: z.string().optional(),
});
export type CodexAuthStatusData = z.infer<typeof CodexAuthStatusDataSchema>;

export const CodexLoginStartDataSchema = z.object({
  userCode: z.string(),
  verificationUrl: z.string(),
});
export type CodexLoginStartData = z.infer<typeof CodexLoginStartDataSchema>;

export const TerminalOpenDataSchema = z.object({
  terminalId: z.string(),
  /** What the requested kind resolved to; `powershell` becomes `default` off Windows. */
  shell: TerminalShellSchema,
  title: z.string(),
});
export type TerminalOpenData = z.infer<typeof TerminalOpenDataSchema>;

/** Answer to the auth commands that only succeed or fail. */
export const OkDataSchema = z.object({ ok: z.literal(true) });
export type OkData = z.infer<typeof OkDataSchema>;

export const ResponseDataSchema = z.union([
  ListFilesDataSchema,
  ReadFileDataSchema,
  GetDiffDataSchema,
  ListThreadsDataSchema,
  ListModelsDataSchema,
  AuthStatusDataSchema,
  AuthLoginStartDataSchema,
  GithubStatusDataSchema,
  GithubLoginStartDataSchema,
  CodexAuthStatusDataSchema,
  CodexLoginStartDataSchema,
  TerminalOpenDataSchema,
  OkDataSchema,
]);
export type ResponseData = z.infer<typeof ResponseDataSchema>;

export const ResponseSchema = z.union([
  z.object({ requestId: z.string().min(1), ok: z.literal(true), data: ResponseDataSchema }),
  z.object({ requestId: z.string().min(1), ok: z.literal(false), error: z.string() }),
]);
export type Response = z.infer<typeof ResponseSchema>;
