import { beforeEach, describe, expect, it } from 'vitest';
import { migrateLayout, useLayoutStore } from '../../apps/web/src/store/use-layout-store.js';

beforeEach(() => {
  useLayoutStore.setState({ sidebarOpen: true, tabs: ['diff'], activeTab: 'diff' });
});

const state = () => useLayoutStore.getState();

describe('tabs', () => {
  it('adds a surface once and activates it', () => {
    state().openTab('files');
    state().openTab('diff');
    state().openTab('files');

    expect(state().tabs).toEqual(['diff', 'files']);
    expect(state().activeTab).toBe('files');
  });

  it('activates the neighbour when the active tab closes', () => {
    state().openTab('files');
    state().closeTab('files');

    expect(state().tabs).toEqual(['diff']);
    expect(state().activeTab).toBe('diff');
  });

  it('leaves the active tab alone when another one closes', () => {
    state().openTab('files');
    state().closeTab('diff');

    expect(state().tabs).toEqual(['files']);
    expect(state().activeTab).toBe('files');
  });

  it('hides the panel once the last tab closes', () => {
    state().closeTab('diff');

    expect(state().tabs).toEqual([]);
    expect(state().activeTab).toBeNull();
  });
});

describe('toggleRight', () => {
  it('hides the panel but remembers its tabs', () => {
    state().openTab('files');
    state().toggleRight();

    expect(state().activeTab).toBeNull();
    expect(state().tabs).toEqual(['diff', 'files']);

    state().toggleRight();
    expect(state().activeTab).toBe('diff');
  });

  it('re-opens on the diff when every tab was closed', () => {
    state().closeTab('diff');
    state().toggleRight();

    expect(state().tabs).toEqual(['diff']);
    expect(state().activeTab).toBe('diff');
  });
});

describe('migrateLayout', () => {
  it('turns the old rightOpen flag into a diff tab', () => {
    expect(migrateLayout({ sidebarOpen: false, rightOpen: true }, 0)).toEqual({
      sidebarOpen: false,
      tabs: ['diff'],
      activeTab: 'diff',
    });
  });

  it('keeps a closed panel closed', () => {
    expect(migrateLayout({ sidebarOpen: true, rightOpen: false }, 0)).toEqual({
      sidebarOpen: true,
      tabs: ['diff'],
      activeTab: null,
    });
  });

  it('passes the current shape through untouched', () => {
    const current = { sidebarOpen: true, tabs: ['files'], activeTab: 'files' };

    expect(migrateLayout(current, 1)).toBe(current);
  });
});
