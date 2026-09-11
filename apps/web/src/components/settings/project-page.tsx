'use client';

import { useEffect } from 'react';
import { mergeModels } from '@/lib/models';
import { useAuthStore } from '@/store/use-auth-store';
import { useModelSettings } from '@/store/use-model-settings';
import { effectiveTitleModel, useProjectSettings } from '@/store/use-project-settings';
import { ModelPicker } from '../choice-picker';

/** Settings that ride on every prompt rather than on the machine's Claude login. */
export function ProjectPage() {
  const models = useAuthStore((state) => state.models);
  const disabled = useModelSettings((state) => state.disabled);
  const custom = useModelSettings((state) => state.custom);
  const chosen = useProjectSettings((state) => state.titleModel);
  const setTitleModel = useProjectSettings((state) => state.setTitleModel);

  // A hard reload on this route has no shell to have opened the environment.
  useEffect(() => {
    void useAuthStore.getState().ensure();
    void useModelSettings.persist.rehydrate();
    void useProjectSettings.persist.rehydrate();
  }, []);

  const rows = mergeModels(models, custom);
  const titleModel = effectiveTitleModel(rows, disabled, chosen);

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="flex min-w-0 flex-col rounded-xl border border-line bg-panel">
        <div className="space-y-4 p-4 text-xs">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-fg">Thread naming</p>
            <p className="text-muted-foreground">
              Which model names a new thread, one short call per thread. The list is the one the
              composer picks from, so switching a model off in Providers takes it off both.
            </p>
            {rows.length === 0 ? (
              <p className="text-muted-foreground">No models reported. Connect Claude first.</p>
            ) : (
              <div className="flex items-center gap-2 pt-1">
                <ModelPicker
                  label="Thread naming model"
                  models={rows}
                  disabled={disabled}
                  value={titleModel}
                  onChange={setTitleModel}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
