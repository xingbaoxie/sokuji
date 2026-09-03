// src/stores/layoutStore.ts
//
// The settings panel's open/closed state, lifted out of MainLayout so that a
// surface which is not MainLayout — the tour (spec §2.1) — can open the panel
// through the same state the title-bar button uses, instead of synthetically
// clicking that button. Persistence stays where it was: sessionStorage, so a
// reload within the same window keeps the panel as the user left it.
import { create } from 'zustand';

export const SHOW_SETTINGS_SESSION_KEY = 'panelState.showSettings';
export const WORKSPACE_SESSION_KEY = 'panelState.workspace';

export type Workspace = 'live' | 'recording';

/** Reads the persisted panel state directly from sessionStorage. Exported so
 *  the store's initial value and callers that need a fresh read (tests) share
 *  one implementation. */
export function readShowSettingsFromSession(): boolean {
  try {
    return sessionStorage.getItem(SHOW_SETTINGS_SESSION_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeSession(value: boolean): void {
  try {
    sessionStorage.setItem(SHOW_SETTINGS_SESSION_KEY, value ? 'true' : 'false');
  } catch {
    /* sessionStorage unavailable — state still lives in the store */
  }
}

function readWorkspaceFromSession(): Workspace {
  try {
    return sessionStorage.getItem(WORKSPACE_SESSION_KEY) === 'recording' ? 'recording' : 'live';
  } catch {
    return 'live';
  }
}

export interface LayoutStore {
  showSettings: boolean;
  setShowSettings: (value: boolean) => void;
  workspace: Workspace;
  setWorkspace: (workspace: Workspace) => void;
  /** Ephemeral: Help's "Run setup again" raises it; MainLayout mounts the
   *  wizard as an overlay while it is true. Never persisted. */
  setupWizardOpen: boolean;
  setSetupWizardOpen: (value: boolean) => void;
}

export const useLayoutStore = create<LayoutStore>()((set) => ({
  showSettings: readShowSettingsFromSession(),
  setShowSettings: (value) => {
    writeSession(value);
    set({ showSettings: value });
  },
  workspace: readWorkspaceFromSession(),
  setWorkspace: (workspace) => {
    try { sessionStorage.setItem(WORKSPACE_SESSION_KEY, workspace); } catch { /* state still updates */ }
    set({ workspace });
  },
  setupWizardOpen: false,
  setSetupWizardOpen: (value) => set({ setupWizardOpen: value }),
}));

export const useShowSettings = () => useLayoutStore((s) => s.showSettings);
export const useSetShowSettings = () => useLayoutStore((s) => s.setShowSettings);
export const useWorkspace = () => useLayoutStore((s) => s.workspace);
export const useSetWorkspace = () => useLayoutStore((s) => s.setWorkspace);
export const useSetupWizardOpen = () => useLayoutStore((s) => s.setupWizardOpen);
export const useSetSetupWizardOpen = () => useLayoutStore((s) => s.setSetupWizardOpen);
