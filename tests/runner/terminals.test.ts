import { rm } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  availableShells,
  resolveShell,
  TerminalManager,
} from '../../packages/runner/src/terminals.js';
import { isExecutable, resolveOnPath } from '../../packages/runner/src/which.js';
import { makeRepo } from './helpers.js';

/** cmd is the one Windows shell whose echo is predictable; bash everywhere else. */
const SHELL = process.platform === 'win32' ? 'cmd' : 'bash';

let repo: string;

beforeEach(async () => {
  repo = await makeRepo();
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('resolveShell', () => {
  it('answers every kind with a binary and a title', () => {
    for (const kind of ['powershell', 'bash', 'cmd', 'default'] as const) {
      const resolved = resolveShell(kind);
      expect(resolved.file).not.toBe('');
      expect(resolved.title).not.toBe('');
    }
  });

  it('resolves the platform default', () => {
    const resolved = resolveShell('default');
    if (process.platform === 'win32') {
      expect(resolved.kind).toBe('powershell');
      expect(resolved.title).toBe('PowerShell');
      expect(resolved.args).toEqual(['-NoLogo']);
    } else {
      expect(resolved.kind).toBe('default');
    }
  });

  it('only offers PowerShell and cmd on Windows', () => {
    if (process.platform === 'win32') {
      expect(resolveShell('cmd').kind).toBe('cmd');
      expect(resolveShell('bash').title).toBe('Git Bash');
    } else {
      expect(resolveShell('cmd').kind).toBe('default');
      expect(resolveShell('powershell').kind).toBe('default');
      expect(resolveShell('bash').kind).toBe('bash');
    }
  });
});

describe('availableShells', () => {
  it('lists the shells this machine actually has', () => {
    const kinds = availableShells().map((shell) => shell.kind);
    if (process.platform === 'win32') {
      expect(kinds).toContain('cmd');
    } else if (resolveOnPath(['bash'])) {
      expect(kinds).toEqual(['bash']);
    }
    // 'default' is a request kind, not something anyone installs.
    expect(kinds).not.toContain('default');
  });

  it('only lists kinds that resolve to a runnable binary with a title', () => {
    for (const { kind, title } of availableShells()) {
      const { file } = resolveShell(kind);
      expect(title).not.toBe('');
      expect(isAbsolute(file) ? isExecutable(file) : resolveOnPath([file])).toBeTruthy();
    }
  });
});

describe('TerminalManager', () => {
  it('runs a command in a real shell and exits when closed', async () => {
    const manager = new TerminalManager(repo);
    let output = '';
    let exitCode: number | undefined;
    let onExited = () => {};
    const exited = new Promise<void>((resolve) => {
      onExited = resolve;
    });

    const opened = manager.open(
      { shell: SHELL, cols: 80, rows: 24 },
      {
        onData: (_id, data) => {
          output += data;
        },
        onExit: (_id, code) => {
          exitCode = code;
          onExited();
        },
      },
    );
    expect(opened.terminalId).not.toBe('');
    expect(manager.count).toBe(1);

    manager.write(opened.terminalId, 'echo agent-console-ok\r');
    await waitFor(() => output.includes('agent-console-ok'));
    manager.close(opened.terminalId);

    await exited;
    expect(output).toContain('agent-console-ok');
    expect(exitCode).toBeTypeOf('number');
    expect(manager.count).toBe(0);
  }, 15_000);
});

async function waitFor(done: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for the shell');
}
