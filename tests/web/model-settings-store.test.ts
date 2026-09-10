import { beforeEach, describe, expect, it } from 'vitest';
import { useModelSettings } from '../../apps/web/src/store/use-model-settings.js';

beforeEach(() => {
  useModelSettings.setState({ disabled: [], custom: [] });
});

describe('custom models', () => {
  it('names a model after its id when no display name is given', () => {
    useModelSettings.getState().addCustom('claude-opus-4-8');

    expect(useModelSettings.getState().custom).toEqual([
      { id: 'claude-opus-4-8', name: 'claude-opus-4-8' },
    ]);
  });

  it('keeps the display name it was given', () => {
    useModelSettings.getState().addCustom('claude-opus-4-8', 'Opus 4.8');

    expect(useModelSettings.getState().custom).toEqual([
      { id: 'claude-opus-4-8', name: 'Opus 4.8' },
    ]);
  });

  it('forgets a removed model was switched off', () => {
    useModelSettings.getState().addCustom('claude-opus-4-8', 'Opus 4.8');
    useModelSettings.getState().toggle('claude-opus-4-8');
    useModelSettings.getState().removeCustom('claude-opus-4-8');

    expect(useModelSettings.getState().custom).toEqual([]);
    expect(useModelSettings.getState().disabled).toEqual([]);
  });
});
