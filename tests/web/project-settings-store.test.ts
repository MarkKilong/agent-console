import type { ModelInfo } from '@agent-console/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  effectiveTitleModel,
  useProjectSettings,
} from '../../apps/web/src/store/use-project-settings.js';

const MODELS: ModelInfo[] = [
  { id: 'claude-opus-5', name: 'Opus 5', description: 'Opus 5 · Thinks it over' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', description: 'Haiku 4.5 · Fastest' },
];

beforeEach(() => {
  useProjectSettings.setState({ titleModel: null });
});

describe('project settings', () => {
  it('keeps the chosen naming model', () => {
    expect(useProjectSettings.getState().titleModel).toBeNull();

    useProjectSettings.getState().setTitleModel('claude-opus-5');
    expect(useProjectSettings.getState().titleModel).toBe('claude-opus-5');
  });
});

describe('effectiveTitleModel', () => {
  it('names threads with a Haiku until a model is chosen by hand', () => {
    expect(effectiveTitleModel(MODELS, [], null)).toBe('claude-haiku-4-5-20251001');
    expect(effectiveTitleModel(MODELS, [], 'claude-opus-5')).toBe('claude-opus-5');
  });

  it('skips a model switched off in Providers', () => {
    expect(effectiveTitleModel(MODELS, ['claude-haiku-4-5-20251001'], null)).toBe('claude-opus-5');
  });

  it('is empty while no model is known, so nothing is sent', () => {
    expect(effectiveTitleModel([], [], null)).toBe('');
  });
});
