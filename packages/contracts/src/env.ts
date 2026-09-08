import { z } from 'zod';

export const EnvStatusSchema = z.enum(['creating', 'running', 'stopped', 'gone']);
export type EnvStatus = z.infer<typeof EnvStatusSchema>;

/** What an environment should contain. Exactly one of repoPath / repoUrl. */
export const EnvSpecSchema = z
  .object({
    repoPath: z.string().min(1).optional(),
    repoUrl: z.url().optional(),
    branch: z.string().min(1).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .refine((s) => Boolean(s.repoPath) !== Boolean(s.repoUrl), {
    message: 'Provide exactly one of repoPath or repoUrl',
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
