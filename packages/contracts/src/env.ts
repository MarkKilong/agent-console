import { z } from 'zod';

export const EnvStatusSchema = z.enum(['creating', 'running', 'stopped', 'gone']);
export type EnvStatus = z.infer<typeof EnvStatusSchema>;

/** A file written into the environment before the runner starts, e.g. a credential. */
export const EnvFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  /** Octal permissions, e.g. `0o600`; the provider's default when absent. */
  mode: z.number().int().positive().optional(),
});
export type EnvFile = z.infer<typeof EnvFileSchema>;

/**
 * What an environment should contain. Never both repoPath and repoUrl; neither means an
 * empty workspace, which only providers that can make one accept.
 */
export const EnvSpecSchema = z
  .object({
    /** `auth` is the sign-in environment: no project of its own, and it lives minutes. */
    kind: z.literal('auth').optional(),
    /** What to call the environment where a human sees it, e.g. a sandbox label. */
    name: z.string().min(1).optional(),
    repoPath: z.string().min(1).optional(),
    repoUrl: z.url().optional(),
    branch: z.string().min(1).optional(),
    env: z.record(z.string(), z.string()).optional(),
    files: z.array(EnvFileSchema).optional(),
  })
  .refine((s) => !(s.repoPath && s.repoUrl), {
    message: 'Provide at most one of repoPath or repoUrl',
  });
export type EnvSpec = z.infer<typeof EnvSpecSchema>;

export const EnvHandleSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  status: EnvStatusSchema,
});
export type EnvHandle = z.infer<typeof EnvHandleSchema>;

export const EnvEndpointSchema = z.object({
  url: z.string().min(1),
  token: z.string().min(1),
});
export type EnvEndpoint = z.infer<typeof EnvEndpointSchema>;
