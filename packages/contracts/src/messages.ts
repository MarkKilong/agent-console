import { z } from 'zod';
import { CommandSchema, TerminalShellSchema } from './commands.js';
import { EventSchema } from './events.js';
import { ResponseSchema } from './responses.js';

/** The values `process.platform` can take, so the web can offer the right shells. */
export const PlatformSchema = z.enum([
  'aix',
  'android',
  'cygwin',
  'darwin',
  'freebsd',
  'haiku',
  'linux',
  'netbsd',
  'openbsd',
  'sunos',
  'win32',
]);
export type Platform = z.infer<typeof PlatformSchema>;

/** A shell the runner found installed. `default` is a request kind, so never listed. */
export const AvailableShellSchema = z.object({
  kind: TerminalShellSchema,
  title: z.string(),
});
export type AvailableShell = z.infer<typeof AvailableShellSchema>;

export const HelloSchema = z.object({
  kind: z.literal('hello'),
  protocolVersion: z.number().int().positive(),
  runnerVersion: z.string(),
  platform: PlatformSchema,
  shells: z.array(AvailableShellSchema),
});
export type Hello = z.infer<typeof HelloSchema>;

export const ClientMessageSchema = z.object({
  kind: z.literal('command'),
  command: CommandSchema,
});
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerMessageSchema = z.discriminatedUnion('kind', [
  HelloSchema,
  z.object({ kind: z.literal('event'), event: EventSchema }),
  z.object({ kind: z.literal('response'), response: ResponseSchema }),
  // Terminals are per environment and ephemeral, so their traffic stays out of the
  // thread event log and rides its own message kinds instead.
  z.object({
    kind: z.literal('terminal_output'),
    terminalId: z.string().min(1),
    data: z.string(),
  }),
  z.object({
    kind: z.literal('terminal_exit'),
    terminalId: z.string().min(1),
    exitCode: z.number().int(),
  }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
