import type { Effort, ModelInfo, PermissionMode } from '@agent-console/contracts';

export type Choice<T extends string> = { id: T; label: string };

/** Stand-in until the CLI answers, so the picker never shows a bare model id. */
const FALLBACK_MODELS: Choice<string>[] = [
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];

// The protocol also allows 'xhigh'; these four are what the picker offers until a
// model reports its own levels.
export const EFFORTS: Choice<Effort>[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'max', label: 'Max' },
];

const EFFORT_LABELS: Record<Effort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

export const ACCESS_MODES: Choice<PermissionMode>[] = [
  { id: 'default', label: 'Ask' },
  { id: 'acceptEdits', label: 'Auto-edit' },
  { id: 'bypassPermissions', label: 'Full access' },
];

export function labelOf<T extends string>(choices: Choice<T>[], id: T): string {
  return choices.find((choice) => choice.id === id)?.label ?? id;
}

/**
 * The row a persisted selection names: it may be the alias the row is keyed by
 * (`sonnet`) or the id that alias resolves to (`claude-sonnet-5`).
 */
export function resolveModelId(models: ModelInfo[], selected: string): string {
  const model = models.find(
    (candidate) => candidate.id === selected || candidate.resolvedId === selected,
  );
  return model?.id ?? selected;
}

/** A model the user typed in because the CLI never reported it. */
export type CustomModel = { id: string; name: string };

/** A row of the model list, flagged when it is the user's own rather than the CLI's. */
export type ModelRow = ModelInfo & { custom?: boolean };

/**
 * The one list the settings page and the picker work from: the CLI's rows first, then
 * the hand-added ones. An id the CLI already reports keeps its own row.
 */
export function mergeModels(models: ModelInfo[], custom: CustomModel[]): ModelRow[] {
  const rows: ModelRow[] = [...models];
  for (const model of custom) {
    if (rows.some((row) => row.id === model.id)) continue;
    rows.push({ id: model.id, name: model.name, description: 'Custom model', custom: true });
  }
  return rows;
}

/**
 * The picker's rows: every model the user left enabled, plus the current selection
 * when it is disabled or unknown, so nobody is switched to another model silently.
 */
export function modelChoices(
  models: ModelInfo[],
  disabled: string[],
  selected: string,
): Choice<string>[] {
  const choices =
    models.length === 0
      ? FALLBACK_MODELS
      : models
          .filter((model) => !disabled.includes(model.id))
          .map((model) => ({ id: model.id, label: model.name }));

  if (choices.some((choice) => choice.id === selected)) return choices;
  const known = models.find((model) => model.id === selected);
  return [{ id: selected, label: known?.name ?? selected }, ...choices];
}

/**
 * The effort levels the selected model reports: `undefined` while it is unknown, so
 * the picker keeps its defaults; empty when the model has a single level.
 */
export function effortChoices(models: ModelInfo[], selected: string): Choice<Effort>[] | undefined {
  const model = models.find((candidate) => candidate.id === selected);
  if (!model) return undefined;
  return (model.effortLevels ?? []).map((effort) => ({ id: effort, label: EFFORT_LABELS[effort] }));
}
