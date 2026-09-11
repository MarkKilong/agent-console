import { beforeEach, describe, expect, it } from 'vitest';
import {
  migrateLayout,
  surfaceKey,
  useLayoutStore,
  type Surface,
} from '../../apps/web/src/store/use-layout-store.js';

const FILES: Surface = { kind: 'files' };
const DIFF: Surface = { kind: 'diff' };

const terminal = (id: string, title: string): Surface => ({
  kind: 'terminal',
  id,
  title,
  shell: 'default',
});

beforeEach(() => {
  useLayoutStore.setState({
    sidebarOpen: true,
    tabs: [DIFF],
    activeTab: DIFF,
    defaultShell: 'powershell',
  });
});

const state = () => useLayoutStore.getState();
const keys = () => state().tabs.map(surfaceKey);

describe('tabs', () => {
  it('adds a surface once and activates it', () => {
    state().openTab(FILES);
    state().openTab(DIFF);
    state().openTab({ kind: 'files' });

    expect(keys()).toEqual(['diff', 'files']);
    expect(state().activeTab).toEqual(FILES);
  });

  it('activates the neighbour when the active tab closes', () => {
    state().openTab(FILES);
    state().closeTab(FILES);

    expect(keys()).toEqual(['diff']);
    expect(state().activeTab).toEqual(DIFF);
  });

  it('leaves the active tab alone when another one closes', () => {
    state().openTab(FILES);
    state().closeTab(DIFF);

    expect(keys()).toEqual(['files']);
    expect(state().activeTab).toEqual(FILES);
  });

  it('hides the panel once the last tab closes', () => {
    state().closeTab(DIFF);

    expect(state().tabs).toEqual([]);
    expect(state().activeTab).toBeNull();
  });
});

describe('terminal tabs', () => {
  it('opens one tab per terminal', () => {
    state().openTab(terminal('a', 'PowerShell'));
    state().openTab(terminal('b', 'PowerShell 2'));

    expect(keys()).toEqual(['diff', 'terminal:a', 'terminal:b']);
    expect(state().activeTab).toMatchObject({ id: 'b' });
  });

  it('keeps the other terminal when one closes', () => {
    state().openTab(terminal('a', 'PowerShell'));
    state().openTab(terminal('b', 'PowerShell 2'));
    state().closeTab(terminal('b', 'PowerShell 2'));

    expect(keys()).toEqual(['diff', 'terminal:a']);
    expect(state().activeTab).toMatchObject({ id: 'a' });
  });

  it('retitles a terminal tab when its shell changes', () => {
    state().openTab(terminal('a', 'Terminal'));
    state().openTab(FILES);
    state().setTerminalShell('a', 'bash');

    expect(state().tabs).toEqual([
      DIFF,
      { kind: 'terminal', id: 'a', title: 'Git Bash', shell: 'bash' },
      FILES,
    ]);
    expect(state().activeTab).toEqual(FILES);
  });

  it('ignores a switch to the shell already running', () => {
    const before = state().tabs;
    state().openTab(terminal('a', 'Terminal'));
    state().setTerminalShell('a', 'default');

    expect(state().tabs).toEqual([...before, terminal('a', 'Terminal')]);
  });

  it('re-activates a terminal already open rather than duplicating it', () => {
    const first = terminal('a', 'PowerShell');
    state().openTab(first);
    state().openTab(DIFF);
    state().openTab(first);

    expect(keys()).toEqual(['diff', 'terminal:a']);
    expect(state().activeTab).toEqual(first);
  });
});

describe('default shell', () => {
  it('starts on PowerShell', () => {
    expect(useLayoutStore.getInitialState().defaultShell).toBe('powershell');
  });

  it('changing the default leaves every tab alone', () => {
    state().openTab(terminal('a', 'Terminal'));
    const before = state().tabs;
    state().setDefaultShell('bash');

    expect(state().defaultShell).toBe('bash');
    expect(state().tabs).toEqual(before);
  });

  it('switching a tab leaves the default alone', () => {
    state().openTab(terminal('a', 'Terminal'));
    state().setTerminalShell('a', 'cmd');

    expect(state().defaultShell).toBe('powershell');
  });
});

describe('toggleRight', () => {
  it('hides the panel but remembers its tabs', () => {
    state().openTab(FILES);
    state().toggleRight();

    expect(state().activeTab).toBeNull();
    expect(keys()).toEqual(['diff', 'files']);

    state().toggleRight();
    expect(state().activeTab).toEqual(DIFF);
  });

  it('re-opens on the diff when every tab was closed', () => {
    state().closeTab(DIFF);
    state().toggleRight();

    expect(keys()).toEqual(['diff']);
    expect(state().activeTab).toEqual(DIFF);
  });
});

describe('migrateLayout', () => {
  it('turns the old rightOpen flag into a diff tab', () => {
    expect(migrateLayout({ sidebarOpen: false, rightOpen: true }, 0)).toEqual({
      sidebarOpen: false,
      tabs: [DIFF],
      activeTab: DIFF,
    });
  });

  it('keeps a closed panel closed', () => {
    expect(migrateLayout({ sidebarOpen: true, rightOpen: false }, 0)).toEqual({
      sidebarOpen: true,
      tabs: [DIFF],
      activeTab: null,
    });
  });

  it('turns version 1 string surfaces into objects', () => {
    expect(
      migrateLayout({ sidebarOpen: true, tabs: ['diff', 'files'], activeTab: 'files' }, 1),
    ).toEqual({ sidebarOpen: true, tabs: [DIFF, FILES], activeTab: FILES });
  });

  it('passes the current shape through untouched', () => {
    const current = { sidebarOpen: true, tabs: [FILES], activeTab: FILES };

    expect(migrateLayout(current, 2)).toBe(current);
  });
});
