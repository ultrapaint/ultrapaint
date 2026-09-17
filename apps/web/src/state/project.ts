import type { LogLine, ProjectInfo, Screen, Settings, UndoState } from "@ultrapaint/contracts";
import { create } from "zustand";
import { api } from "./connection.ts";

interface ProjectStore {
  info: ProjectInfo;
  settings: Settings | null;
  screens: readonly Screen[];
  logs: readonly LogLine[];
  undo: UndoState;
  error: string | null;
  settingsOpen: boolean;
  setError: (error: string | null) => void;
  openSettings: (open: boolean) => void;
  load: () => Promise<void>;
}

export const useProject = create<ProjectStore>((set, get) => ({
  info: { configured: false, host: { state: "stopped" } },
  settings: null,
  screens: [],
  logs: [],
  undo: { canUndo: false, canRedo: false },
  error: null,
  settingsOpen: false,
  setError: (error) => set({ error }),
  openSettings: (settingsOpen) => set({ settingsOpen }),
  load: async () => {
    const c = api();
    try {
      const [info, settings] = await Promise.all([
        c.request("project.info", undefined),
        c.request("settings.get", undefined),
      ]);
      set({ info, settings, settingsOpen: !info.configured });
      if (info.configured) {
        const [{ screens }, logs, undo] = await Promise.all([
          c.request("screens.list", undefined),
          c.request("logs.recent", undefined),
          c.request("edit.state", undefined),
        ]);
        set({ screens, logs, undo });
      }
    } catch (error) {
      get().setError((error as Error).message);
    }
  },
}));

/** Wires server events into the store once the connection is open. */
export const bindProjectEvents = () => {
  const c = api();
  c.on("project", (info) => useProject.setState({ info }));
  c.on("screens", ({ screens }) => useProject.setState({ screens }));
  c.on("log", (line) => useProject.setState((s) => ({ logs: [...s.logs.slice(-499), line] })));
  c.on("edit.state", (undo) => useProject.setState({ undo }));
};

export const reportError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  useProject.getState().setError(message);
};
