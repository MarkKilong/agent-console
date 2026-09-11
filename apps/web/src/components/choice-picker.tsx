'use client';

import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { labelOf, modelChoices, type Choice, type ModelRow } from '@/lib/models';
import { ClaudeMark } from './claude-mark';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

/** The composer's dropdown: a ghost button showing the current choice, and a menu of the rest. */
export function Picker<T extends string>({
  label,
  choices,
  value,
  onChange,
  icon,
  disabledReason,
}: {
  label: string;
  choices: Choice<T>[];
  value: T;
  onChange(id: T): void;
  /** Leading icon for a choice, shown on the trigger and in the menu. */
  icon?: (id: T) => ReactNode;
  /** Why there is nothing to pick; shown as a tooltip on the dead trigger. */
  disabledReason?: string;
}) {
  const trigger = (
    <Button variant="ghost" size="sm" aria-label={label} disabled={Boolean(disabledReason)}>
      {icon?.(value)}
      {labelOf(choices, value)}
      <ChevronDown className="opacity-70" />
    </Button>
  );

  if (disabledReason) {
    return (
      <Tooltip>
        {/* A disabled button swallows pointer events, so the trigger is the wrapper. */}
        <TooltipTrigger asChild>
          <span>{trigger}</span>
        </TooltipTrigger>
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto">
        {choices.map((choice) => (
          <DropdownMenuItem
            key={choice.id}
            onSelect={() => onChange(choice.id)}
            className="whitespace-nowrap"
          >
            {icon?.(choice.id)}
            {choice.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One model picker for the composer and for settings: the same rows, the same provider
 * mark, the same display names, so a model reads the same wherever it is chosen.
 */
export function ModelPicker({
  label,
  models,
  disabled,
  value,
  onChange,
}: {
  label: string;
  /** The whole list — the CLI's rows plus hand-added ones. */
  models: ModelRow[];
  /** Ids switched off in Providers. */
  disabled: string[];
  value: string;
  onChange(id: string): void;
}) {
  return (
    <Picker
      label={label}
      choices={modelChoices(models, disabled, value)}
      value={value}
      onChange={onChange}
      icon={() => <ClaudeMark />}
    />
  );
}
