import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import type { AvailableShell, TerminalOpenData, TerminalShell } from '@agent-console/contracts';
import { spawn, type IPty } from 'node-pty';
import { isExecutable, resolveOnPath } from './which.js';

/** Git for Windows installs its bash here; `bash.exe` is rarely on PATH. */
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';

export type ResolvedShell = {
  /** What the request resolved to; off Windows every kind but `bash` is `default`. */
  kind: TerminalShell;
  file: string;
  args: string[];
  title: string;
};

/** The one place a shell kind becomes a binary. */
export function resolveShell(kind: TerminalShell): ResolvedShell {
  if (process.platform !== 'win32') {
    if (kind === 'bash') return { kind, file: 'bash', args: [], title: 'bash' };
    const file = process.env.SHELL?.trim() || '/bin/bash';
    return { kind: 'default', file, args: [], title: basename(file) };
  }

  switch (kind) {
    case 'bash': {
      const file = isExecutable(GIT_BASH) ? GIT_BASH : (resolveOnPath(['bash.exe']) ?? 'bash.exe');
      return { kind, file, args: [], title: 'Git Bash' };
    }
    case 'cmd':
      return { kind, file: 'cmd.exe', args: [], title: 'cmd' };
    default:
      return {
        // `default` on Windows *is* PowerShell, so say so: the tab reads "PowerShell".
        kind: 'powershell',
        file: resolveOnPath(['pwsh.exe']) ?? 'powershell.exe',
        args: ['-NoLogo'],
        title: 'PowerShell',
      };
  }
}

/** The kinds this platform could have installed; `default` is a request, never a listing. */
const CANDIDATE_SHELLS: TerminalShell[] =
  process.platform === 'win32' ? ['powershell', 'bash', 'cmd'] : ['bash'];

let installed: AvailableShell[] | undefined;

/**
 * The shells actually present, for the web to offer. Probed by path rather than by
 * spawning, and only once: nothing installs a shell while the runner is up.
 */
export function availableShells(): AvailableShell[] {
  installed ??= CANDIDATE_SHELLS.flatMap((kind) => {
    const { file, title } = resolveShell(kind);
    return exists(file) ? [{ kind, title }] : [];
  });
  return installed;
}

/** `resolveShell` falls back to a bare name when it found nothing, so re-check on PATH. */
function exists(file: string): boolean {
  return isAbsolute(file) ? isExecutable(file) : resolveOnPath([file]) !== undefined;
}

/** Where a terminal's bytes go; the server points these at the socket that opened it. */
export type TerminalEvents = {
  onData(terminalId: string, data: string): void;
  onExit(terminalId: string, exitCode: number): void;
};

export type OpenTerminal = { shell?: TerminalShell; cols: number; rows: number };

/** Every live pty in this runner. Terminals are per environment, never per thread. */
export class TerminalManager {
  private readonly terminals = new Map<string, IPty>();

  constructor(private readonly cwd: string) {}

  /** Live terminals; the server closes a socket's own on disconnect. */
  get count(): number {
    return this.terminals.size;
  }

  open(request: OpenTerminal, events: TerminalEvents): TerminalOpenData {
    const { kind, file, args, title } = resolveShell(request.shell ?? 'default');
    const terminal = spawn(file, args, {
      name: 'xterm-256color',
      cols: request.cols,
      rows: request.rows,
      cwd: this.cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    const terminalId = randomUUID();
    this.terminals.set(terminalId, terminal);
    terminal.onData((data) => events.onData(terminalId, data));
    terminal.onExit(({ exitCode }) => {
      this.terminals.delete(terminalId);
      events.onExit(terminalId, exitCode);
    });
    return { terminalId, shell: kind, title };
  }

  write(terminalId: string, data: string): void {
    this.terminals.get(terminalId)?.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.terminals.get(terminalId)?.resize(cols, rows);
  }

  /** Dropped from the map before the kill, so `count` never counts a dying shell. */
  close(terminalId: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;
    this.terminals.delete(terminalId);
    terminal.kill();
  }

  closeAll(): void {
    for (const terminalId of [...this.terminals.keys()]) this.close(terminalId);
  }
}
