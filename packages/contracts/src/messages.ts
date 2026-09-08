import { z } from 'zod';
import { CommandSchema } from './commands.js';
import { EventSchema } from './events.js';
import { ResponseSchema } from './responses.js';

export const HelloSchema = z.object({
  kind: z.literal('hello'),
  protocolVersion: z.number().int().positive(),
  runnerVersion: z.string(),
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
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
