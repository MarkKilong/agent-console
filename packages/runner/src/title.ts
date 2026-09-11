/** Ceiling on a thread title, wherever it came from. */
export const MAX_TITLE = 60;

/** The header "Ask about this" puts above the terminal output it hands the composer. */
const TERMINAL_HEADER = /^From the .* terminal \(.*\):$/;

/**
 * The part of a prompt worth naming a thread after. A prompt that opens with a pasted
 * terminal block is named after the user's own line below it, not after the header.
 */
export function promptBody(prompt: string): string {
  const lines = prompt.split('\n');
  if (!TERMINAL_HEADER.test(lines[0]?.trim() ?? '')) return prompt;

  const opening = lines.findIndex((line, index) => index > 0 && line.trim().startsWith('```'));
  if (opening === -1) return prompt;
  const closing = lines.findIndex(
    (line, index) => index > opening && line.trim().startsWith('```'),
  );
  if (closing === -1) return prompt;

  return lines.slice(closing + 1).find((line) => line.trim()) ?? prompt;
}

/** The fallback title: the prompt itself, on one line and capped. */
export function titleFromPrompt(prompt: string): string {
  return capTitle(promptBody(prompt));
}

/** A model writes its own title; the quotes it may wrap it in are ours to drop. */
export function tidyModelTitle(title: string): string {
  return capTitle(title.trim().replace(/^["'“”]+|["'“”]+$/g, ''));
}

export function capTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE);
}
