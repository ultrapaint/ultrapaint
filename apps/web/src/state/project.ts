import type { UndoState } from "@ultrapaint/contracts/edit";
import type { Page, Space } from "@ultrapaint/contracts/pages";
import type { LogLine, ProjectInfo } from "@ultrapaint/contracts/project";
import type { Settings } from "@ultrapaint/contracts/settings";
import { create } from "zustand";
import { api } from "./connection.ts";

interface ProjectStore {
  error: string | null;
  info: ProjectInfo;
  load: () => Promise<void>;
  logs: readonly LogLine[];
  openSaveConfig: (open: boolean) => void;
  openSettings: (open: boolean) => void;
  pages: readonly Page[];
  /** The dialog that turns an unsaved session into a configuration file. */
  saveConfigOpen: boolean;
  setError: (error: string | null) => void;
  settings: Settings | null;
  settingsOpen: boolean;
  spaces: readonly Space[];
  undo: UndoState;
}

export const useProject = create<ProjectStore>((set, get) => ({
  error: null,
  info: {
    configured: false,
    host: { state: "stopped" },
    storage: { mode: "managed" },
  },
  load: async () => {
    const c = api();
    try {
      const [info, settings] = await Promise.all([
        c.request("project.info", undefined),
        c.request("settings.get", undefined),
      ]);
      set({ info, settings, settingsOpen: !info.configured });
      if (info.configured) {
        const [{ pages, spaces }, logs, undo] = await Promise.all([
          c.request("pages.list", undefined),
          c.request("logs.recent", undefined),
          c.request("edit.state", undefined),
        ]);
        set({ logs, pages, spaces, undo });
      }
    } catch (error) {
      get().setError((error as Error).message);
    }
  },
  logs: [],
  openSaveConfig: (saveConfigOpen) => set({ saveConfigOpen }),
  openSettings: (settingsOpen) => set({ settingsOpen }),
  pages: [],
  saveConfigOpen: false,
  setError: (error) => set({ error }),
  settings: null,
  settingsOpen: false,
  spaces: [],
  undo: { canRedo: false, canUndo: false },
}));

/** Wires server events into the store once the connection is open. */
export const bindProjectEvents = () => {
  const c = api();
  c.on("project", (info) => useProject.setState({ info }));
  c.on("pages", ({ pages, spaces }) => useProject.setState({ pages, spaces }));
  c.on("log", (line) =>
    useProject.setState((s) => ({ logs: [...s.logs.slice(-499), line] }))
  );
  c.on("edit.state", (undo) => useProject.setState({ undo }));
};

export const reportError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  useProject.getState().setError(message);
};
