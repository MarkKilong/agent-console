import { z } from 'zod';

export const PermissionDecisionSchema = z.enum(['allow', 'deny']);
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;

/** `claudeai` is the subscription login, `console` the Console/API-billing one. */
export const AuthLoginModeSchema = z.enum(['claudeai', 'console']);
export type AuthLoginMode = z.infer<typeof AuthLoginModeSchema>;

const threadId = z.string().min(1);
const requestId = z.string().min(1);

export const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('send_prompt'), threadId, text: z.string().min(1) }),
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
  z.object({
    type: z.literal('subscribe'),
    threadId,
    afterSeq: z.number().int().nonnegative().optional(),
  }),
  z.object({ type: z.literal('auth_status'), requestId }),
  z.object({ type: z.literal('auth_login_start'), requestId, mode: AuthLoginModeSchema }),
  z.object({ type: z.literal('auth_login_code'), requestId, code: z.string().min(1) }),
  z.object({ type: z.literal('auth_logout'), requestId }),
  z.object({ type: z.literal('auth_set_api_key'), requestId, key: z.string().min(1) }),
  z.object({ type: z.literal('auth_clear_api_key'), requestId }),
]);
export type Command = z.infer<typeof CommandSchema>;
export type CommandType = Command['type'];
