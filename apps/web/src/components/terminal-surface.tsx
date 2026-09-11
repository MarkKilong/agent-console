'use client';

import type { AvailableShell, TerminalShell } from '@agent-console/contracts';
import type { Terminal } from '@xterm/xterm';
import { ChevronDown } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { RunnerClient } from '@/lib/runner-client';
import { useConsoleStore } from '@/store/use-console-store';
import { SHELL_TITLES, useLayoutStore } from '@/store/use-layout-store';
import { PaneHeader, PICKER_TRIGGER_CLASS } from './ui';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import '@xterm/xterm/css/xterm.css';

/** Dim SGR around a line the shell did not print. */
const dim = (text: string) => `\r\n\x1b[2m[${text}]\x1b[0m\r\n`;

/** A 'default' request runs as the first shell the runner listed, so name that one. */
const resolved = (shell: TerminalShell, shells: AvailableShell[]): TerminalShell =>
  shell === 'default' ? (shells[0]?.kind ?? shell) : shell;

/**
 * One xterm bound to one pty in the runner. The tab strip keeps this mounted while
 * another surface is on top — unmounting would dispose the terminal and kill the shell.
 *
 * Picking another shell rewrites the tab in the layout store, and the new `shell` tears
 * the effect down and back up: the old pty is closed and the xterm replaced with a fresh one.
 */
export function TerminalSurface({
  client,
  tabId,
  shell,
  hidden,
}: {
  client: RunnerClient | null;
  tabId: string;
  shell: TerminalShell;
  hidden: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  // Set once the shell is gone, so keystrokes stop going nowhere.
  const dead = useRef(false);
  const status = useConsoleStore((state) => state.environment?.status);
  const setTerminalShell = useLayoutStore((state) => state.setTerminalShell);
  const shells = client?.shells ?? [];

  useEffect(() => {
    const node = host.current;
    if (!node || !client) return;

    let cancelled = false;
    let terminalId: string | undefined;
    let unsubscribe: (() => void) | undefined;
    let observer: ResizeObserver | undefined;

    // xterm touches `window` as it loads, so it may only be pulled in on the client.
    void (async () => {
      const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (cancelled) return;

      const styles = getComputedStyle(node);
      const read = (name: string, fallback: string) =>
        styles.getPropertyValue(name).trim() || fallback;
      const foreground = read('--color-fg', '#f5f5f5');

      const xterm = new XTerm({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: read('--font-mono', 'ui-monospace, Menlo, Consolas, monospace'),
        theme: { background: read('--color-panel', '#111111'), foreground, cursor: foreground },
      });
      term.current = xterm;
      dead.current = false;

      const fit = new FitAddon();
      xterm.loadAddon(fit);
      xterm.open(node);
      fitTo(node, fit);

      try {
        const opened = await client.openTerminal(shell, xterm.cols, xterm.rows);
        // The tab closed while the runner was answering: do not leak the pty.
        if (cancelled) {
          client.closeTerminal(opened.terminalId);
          return;
        }
        terminalId = opened.terminalId;
      } catch (cause) {
        dead.current = true;
        xterm.write(dim(cause instanceof Error ? cause.message : String(cause)));
        return;
      }

      unsubscribe = client.onTerminal(terminalId, (message) => {
        if (message.kind === 'terminal_output') {
          xterm.write(message.data);
          return;
        }
        dead.current = true;
        xterm.write(dim(`process exited with code ${message.exitCode}`));
      });

      xterm.onData((data) => {
        if (terminalId && !dead.current) client.terminalInput(terminalId, data);
      });

      observer = new ResizeObserver(() => {
        if (!fitTo(node, fit) || !terminalId || dead.current) return;
        client.terminalResize(terminalId, xterm.cols, xterm.rows);
      });
      observer.observe(node);
      xterm.focus();
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      unsubscribe?.();
      if (terminalId) client.closeTerminal(terminalId);
      term.current?.dispose();
      term.current = null;
    };
  }, [client, shell]);

  // A dropped socket takes the pty with it; reattaching is not a feature yet.
  useEffect(() => {
    if (status !== 'closed' || dead.current || !term.current) return;
    dead.current = true;
    term.current.write(dim('terminal closed — reconnecting starts a new shell'));
  }, [status]);

  return (
    <div hidden={hidden} className="flex h-full flex-col">
      <PaneHeader>
        {shells.length > 1 ? (
          <ShellMenu
            shells={shells}
            shell={shell}
            onSwitch={(next) => setTerminalShell(tabId, next)}
          />
        ) : (
          // One shell leaves nothing to pick between, and none leaves nothing to name.
          <span className="text-xs font-medium text-fg">
            {shells[0]?.title ?? SHELL_TITLES.default}
          </span>
        )}
      </PaneHeader>
      <div ref={host} className="min-h-0 w-full flex-1 overflow-hidden bg-panel p-1" />
    </div>
  );
}

/**
 * A Picker-shaped trigger over two independent sections: the top one switches this tab's
 * shell, the bottom one only decides what the next `+` → Terminal opens on.
 */
function ShellMenu({
  shells,
  shell,
  onSwitch,
}: {
  shells: AvailableShell[];
  shell: TerminalShell;
  onSwitch(shell: TerminalShell): void;
}) {
  const defaultShell = useLayoutStore((state) => state.defaultShell);
  const setDefaultShell = useLayoutStore((state) => state.setDefaultShell);
  const current = resolved(shell, shells);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label="Shell" className={PICKER_TRIGGER_CLASS}>
          {shells.find((option) => option.kind === current)?.title ?? SHELL_TITLES[current]}
          <ChevronDown className="size-3.5 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto">
        {shells.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.kind}
            checked={option.kind === current}
            onSelect={() => onSwitch(option.kind)}
            className="whitespace-nowrap"
          >
            {option.title}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="whitespace-nowrap">
            Default for new terminals
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              // A default that is no longer installed selects nothing rather than lying.
              value={shells.some((option) => option.kind === defaultShell) ? defaultShell : ''}
              onValueChange={(value) => setDefaultShell(value as TerminalShell)}
            >
              {shells.map((option) => (
                <DropdownMenuRadioItem
                  key={option.kind}
                  value={option.kind}
                  className="whitespace-nowrap"
                >
                  {option.title}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Fitting a display:none host measures zero and throws off the pty, so skip it. */
function fitTo(node: HTMLElement, fit: { fit(): void }): boolean {
  if (node.clientWidth === 0 || node.clientHeight === 0) return false;
  fit.fit();
  return true;
}
