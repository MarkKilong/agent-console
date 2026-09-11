import { z } from 'zod';

export const PermissionDecisionSchema = z.enum(['allow', 'deny']);
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;

/** Reasoning effort, as the Claude Agent SDK names its levels. */
export const EffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type Effort = z.infer<typeof EffortSchema>;

export const PermissionModeSchema = z.enum(['default', 'acceptEdits', 'bypassPermissions']);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

/** Which shell a terminal asks for; the runner resolves it to a binary per platform. */
export const TerminalShellSchema = z.enum(['powershell', 'bash', 'cmd', 'default']);
export type TerminalShell = z.infer<typeof TerminalShellSchema>;

const threadId = z.string().min(1);
const requestId = z.string().min(1);
const terminalId = z.string().min(1);
const cols = z.number().int().positive();
const rows = z.number().int().positive();

export const CommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('send_prompt'),
    threadId,
    text: z.string().min(1),
    model: z.string().optional(),
    effort: EffortSchema.optional(),
    permissionMode: PermissionModeSchema.optional(),
    /** Model asked to name the thread; absent leaves the title on the first prompt. */
    titleModel: z.string().optional(),
  }),
  z.object({
    type: z.literal('answer_permission'),
    threadId,
    requestId,
    decision: PermissionDecisionSchema,
    message: z.string().optional(),
  }),
  z.object({ type: z.literal('stop_turn'), threadId }),
  z.object({ type: z.literal('list_files'), requestId, path: z.string().optional() }),
  z.object({ type: z.literal('read_file'), requestId, path: z.string().min(1) }),
  z.object({ type: z.literal('get_diff'), requestId, threadId: threadId.optional() }),
  z.object({ type: z.literal('list_threads'), requestId }),
  z.object({ type: z.literal('list_models'), requestId }),
  z.object({
    type: z.literal('subscribe'),
    threadId,
    afterSeq: z.number().int().nonnegative().optional(),
  }),
  z.object({ type: z.literal('auth_status'), requestId }),
  z.object({ type: z.literal('auth_login_start'), requestId }),
  z.object({ type: z.literal('auth_login_code'), requestId, code: z.string().min(1) }),
  z.object({ type: z.literal('auth_logout'), requestId }),
  z.object({ type: z.literal('auth_set_api_key'), requestId, key: z.string().min(1) }),
  z.object({ type: z.literal('auth_clear_api_key'), requestId }),
  z.object({ type: z.literal('github_status'), requestId }),
  z.object({ type: z.literal('github_login_start'), requestId }),
  z.object({ type: z.literal('github_login_cancel'), requestId }),
  z.object({ type: z.literal('github_logout'), requestId }),
  z.object({ type: z.literal('codex_auth_status'), requestId }),
  z.object({ type: z.literal('codex_login_start'), requestId }),
  z.object({ type: z.literal('codex_login_cancel'), requestId }),
  z.object({ type: z.literal('codex_logout'), requestId }),
  z.object({ type: z.literal('codex_set_api_key'), requestId, key: z.string().min(1) }),
  z.object({
    type: z.literal('terminal_open'),
    requestId,
    shell: TerminalShellSchema.optional(),
    cols,
    rows,
  }),
  // The three below are fire-and-forget: a keystroke must not wait for a round trip.
  z.object({ type: z.literal('terminal_input'), terminalId, data: z.string() }),
  z.object({ type: z.literal('terminal_resize'), terminalId, cols, rows }),
  z.object({ type: z.literal('terminal_close'), terminalId }),
]);
export type Command = z.infer<typeof CommandSchema>;
export type CommandType = Command['type'];
