import type { UndoState } from "@ultrapaint/contracts/edit";
import type { Page, Space } from "@ultrapaint/contracts/pages";
import type {
  HostStatus,
  LogLine,
  ProjectInfo,
} from "@ultrapaint/contracts/project";
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

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Where the preview is loaded from. The server names it by the address it reaches it at on
 * its own machine; a page opened from another machine reaches the same machine by the address
 * it was opened at, so that one is used instead. On this machine the server's is kept: it says
 * `127.0.0.1` where the page may say `localhost`, which can resolve elsewhere.
 */
export const previewUrl = (host: HostStatus): string | null => {
  if (host.state !== "running" || !host.url) {
    return null;
  }
  if (LOOPBACK.has(window.location.hostname)) {
    return host.url;
  }
  const url = new URL(host.url);
  url.hostname = window.location.hostname;
  return url.origin;
};

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
