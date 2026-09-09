import type { Effort, PermissionMode } from '@agent-console/contracts';

export type Choice<T extends string> = { id: T; label: string };

export const MODELS: Choice<string>[] = [
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];

// The protocol also allows 'xhigh'; the picker offers the four levels the UI shows.
export const EFFORTS: Choice<Effort>[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'max', label: 'Max' },
];

export const ACCESS_MODES: Choice<PermissionMode>[] = [
  { id: 'default', label: 'Ask' },
  { id: 'acceptEdits', label: 'Auto-edit' },
  { id: 'bypassPermissions', label: 'Full access' },
];

export function labelOf<T extends string>(choices: Choice<T>[], id: T): string {
  return choices.find((choice) => choice.id === id)?.label ?? id;
}
