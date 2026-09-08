/** Turns a tool call into a short past-tense phrase, e.g. "Wrote LICENSE". */
export function toolLabel(name: string, input: unknown): string {
  const fields = (input ?? {}) as Record<string, unknown>;
  const path = string(fields.file_path ?? fields.path ?? fields.notebook_path);

  switch (name) {
    case 'Write':
      return path ? `Wrote ${basename(path)}` : 'Wrote a file';
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return path ? `Edited ${basename(path)}` : 'Edited a file';
    case 'Read':
      return path ? `Read ${basename(path)}` : 'Read a file';
    case 'Bash':
      return `Ran ${string(fields.command) ?? 'a command'}`;
    case 'Glob':
    case 'Grep':
      return `Searched ${string(fields.pattern) ?? 'the workspace'}`;
    case 'WebFetch':
      return `Fetched ${string(fields.url) ?? 'a page'}`;
    default:
      return path ? `${name} ${basename(path)}` : name;
  }
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
