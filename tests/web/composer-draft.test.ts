import { beforeEach, describe, expect, it } from 'vitest';
import { useComposerDraft } from '../../apps/web/src/store/use-composer-draft.js';

const state = () => useComposerDraft.getState();

beforeEach(() => {
  useComposerDraft.setState({ insert: null });
});

describe('composer draft', () => {
  it('hands the requested text over once', () => {
    state().requestInsert('```text\nboom\n```');

    expect(state().insert).toBe('```text\nboom\n```');
    expect(state().consumeInsert()).toBe('```text\nboom\n```');
    expect(state().insert).toBeNull();
    expect(state().consumeInsert()).toBeNull();
  });

  it('keeps only the latest request', () => {
    state().requestInsert('first');
    state().requestInsert('second');

    expect(state().consumeInsert()).toBe('second');
  });
});
