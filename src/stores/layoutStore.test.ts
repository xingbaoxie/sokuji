import { describe, it, expect, beforeEach } from 'vitest';
import { useLayoutStore, SHOW_SETTINGS_SESSION_KEY, WORKSPACE_SESSION_KEY, readShowSettingsFromSession } from './layoutStore';

beforeEach(() => {
  sessionStorage.clear();
  useLayoutStore.setState({ showSettings: false });
  useLayoutStore.setState({ workspace: 'live' });
});

describe('layoutStore.workspace', () => {
  it('persists the active workspace for a reload in the same window', () => {
    useLayoutStore.getState().setWorkspace('recording');
    expect(useLayoutStore.getState().workspace).toBe('recording');
    expect(sessionStorage.getItem(WORKSPACE_SESSION_KEY)).toBe('recording');
  });
});

describe('layoutStore', () => {
  it('persists showSettings to sessionStorage the way MainLayout did', () => {
    useLayoutStore.getState().setShowSettings(true);
    expect(useLayoutStore.getState().showSettings).toBe(true);
    expect(sessionStorage.getItem(SHOW_SETTINGS_SESSION_KEY)).toBe('true');
    useLayoutStore.getState().setShowSettings(false);
    expect(sessionStorage.getItem(SHOW_SETTINGS_SESSION_KEY)).toBe('false');
  });

  it('initialises from sessionStorage', () => {
    sessionStorage.setItem(SHOW_SETTINGS_SESSION_KEY, 'true');
    expect(readShowSettingsFromSession()).toBe(true);
    sessionStorage.removeItem(SHOW_SETTINGS_SESSION_KEY);
    expect(readShowSettingsFromSession()).toBe(false);
  });
});

describe('layoutStore.setupWizardOpen', () => {
  it('is an ephemeral flag — not persisted', () => {
    useLayoutStore.getState().setSetupWizardOpen(true);
    expect(useLayoutStore.getState().setupWizardOpen).toBe(true);
    expect(sessionStorage.length).toBe(0);
    useLayoutStore.getState().setSetupWizardOpen(false);
    expect(useLayoutStore.getState().setupWizardOpen).toBe(false);
  });
});
