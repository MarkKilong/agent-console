import type { ModelInfo } from '@agent-console/contracts';
import { describe, expect, it } from 'vitest';
import {
  effortChoices,
  mergeModels,
  modelChoices,
  resolveModelId,
} from '../../apps/web/src/lib/models.js';

const MODELS: ModelInfo[] = [
  {
    id: 'sonnet',
    resolvedId: 'claude-sonnet-5',
    name: 'Sonnet 5',
    description: 'Sonnet 5 · Efficient for routine tasks',
    effortLevels: ['low', 'medium', 'high'],
  },
  { id: 'haiku', name: 'Haiku 4.5', description: 'Haiku 4.5 · Fastest' },
];

describe('modelChoices', () => {
  it('offers the models that are still enabled', () => {
    expect(modelChoices(MODELS, ['haiku'], 'sonnet')).toEqual([
      { id: 'sonnet', label: 'Sonnet 5' },
    ]);
  });

  it('falls back to the built-in list until the CLI answers', () => {
    const choices = modelChoices([], [], 'claude-opus-5');
    expect(choices.length).toBeGreaterThan(1);
    expect(choices).toContainEqual({ id: 'claude-opus-5', label: 'Opus 5' });
  });

  it('keeps showing a selection that was disabled', () => {
    expect(modelChoices(MODELS, ['haiku'], 'haiku')).toEqual([
      { id: 'haiku', label: 'Haiku 4.5' },
      { id: 'sonnet', label: 'Sonnet 5' },
    ]);
  });

  it('keeps showing a selection the CLI never reported', () => {
    expect(modelChoices(MODELS, [], 'claude-opus-4')[0]).toEqual({
      id: 'claude-opus-4',
      label: 'claude-opus-4',
    });
  });
});

describe('mergeModels', () => {
  it('appends hand-added models after the CLI rows', () => {
    expect(mergeModels(MODELS, [{ id: 'claude-opus-4-8', name: 'Opus 4.8' }])).toEqual([
      ...MODELS,
      { id: 'claude-opus-4-8', name: 'Opus 4.8', description: 'Custom model', custom: true },
    ]);
  });

  it('leaves an id the CLI already reports to its own row', () => {
    expect(mergeModels(MODELS, [{ id: 'haiku', name: 'Mine' }])).toEqual(MODELS);
  });

  it('offers a custom model in the picker until it is switched off', () => {
    const rows = mergeModels(MODELS, [{ id: 'claude-opus-4-8', name: 'Opus 4.8' }]);
    const row = { id: 'claude-opus-4-8', label: 'Opus 4.8' };
    expect(modelChoices(rows, [], 'sonnet')).toContainEqual(row);
    expect(modelChoices(rows, ['claude-opus-4-8'], 'sonnet')).not.toContainEqual(row);
  });
});

describe('resolveModelId', () => {
  it('matches a persisted id against what an alias resolves to', () => {
    expect(resolveModelId(MODELS, 'claude-sonnet-5')).toBe('sonnet');
  });

  it('leaves an id the CLI never reported alone', () => {
    expect(resolveModelId([], 'claude-sonnet-5')).toBe('claude-sonnet-5');
  });
});

describe('effortChoices', () => {
  it('offers exactly the levels the model reports', () => {
    expect(effortChoices(MODELS, 'sonnet')).toEqual([
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
    ]);
  });

  it('is empty for a model with a single level', () => {
    expect(effortChoices(MODELS, 'haiku')).toEqual([]);
  });

  it('is unknown while the list has not loaded', () => {
    expect(effortChoices([], 'sonnet')).toBeUndefined();
  });
});
