import { create } from 'zustand';

/**
 * A one-shot hand-off into the chat composer, used by the terminal's "Ask about this".
 * Not persisted: it lives only between the click and the composer picking it up.
 */
type ComposerDraftStore = {
  insert: string | null;
  requestInsert(text: string): void;
  /** Returns the pending text and clears it, so a second reader gets nothing. */
  consumeInsert(): string | null;
};

export const useComposerDraft = create<ComposerDraftStore>((set, get) => ({
  insert: null,
  requestInsert: (text) => set({ insert: text }),
  consumeInsert: () => {
    const pending = get().insert;
    if (pending !== null) set({ insert: null });
    return pending;
  },
}));
