import { RequestError } from "@ultrapaint/client-runtime/connection";
import type { UndoState } from "@ultrapaint/contracts/edit";
import type { Canvas, Page } from "@ultrapaint/contracts/pages";
import type {
  HostStatus,
  LogLine,
  ProjectInfo,
} from "@ultrapaint/contracts/project";
import type { Settings } from "@ultrapaint/contracts/settings";
import { create } from "zustand";
import { platform } from "../platform.ts";
import { api } from "./connection.ts";
import { viewedSnapshot } from "./snapshot-view.ts";
import { readUrl, writeSettingsSection } from "./url.ts";

interface ProjectStore {
  canvases: readonly Canvas[];
  error: string | null;
  info: ProjectInfo;
  load: () => Promise<void>;
  /** The project info and settings have been read once. */
  loaded: boolean;
  logs: readonly LogLine[];
  openSaveConfig: (open: boolean) => void;
  /** Opens the settings on `section`, or where they were, or closes them. */
  openSettings: (open: boolean, section?: string) => void;
  pages: readonly Page[];
  /** The dialog that turns an unsaved session into a configuration file. */
  saveConfigOpen: boolean;
  setError: (error: string | null) => void;
  settings: Settings | null;
  /** Kept in the URL, so a reload returns to the settings only when they were open. */
  settingsOpen: boolean;
  settingsSection: string;
  undo: UndoState;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Where the preview is loaded from. The server names it by the address it reaches it at on
 * its own machine; a page opened from another machine reaches the same machine by the address
 * it was opened at, so that one is used instead. On this machine the server's is kept: it says
 * `127.0.0.1` where the page may say `localhost`, which can resolve elsewhere. A shell that
 * reaches the server through a forwarded port maps the preview's too (`Platform`).
 */
export const previewUrl = (host: HostStatus): string | null => {
  if (host.state !== "running" || !host.url) {
    return null;
  }
  const { mapPreviewUrl } = platform();
  if (LOOPBACK.has(window.location.hostname)) {
    return mapPreviewUrl ? mapPreviewUrl(host.url) : host.url;
  }
  const url = new URL(host.url);
  url.hostname = window.location.hostname;
  return url.origin;
};

export const useProject = create<ProjectStore>((set, get) => ({
  canvases: [],
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
      set({ info, loaded: true, settings });
      if (info.configured) {
        const [{ pages, canvases }, logs, undo] = await Promise.all([
          c.request("pages.list", undefined),
          c.request("logs.recent", undefined),
          c.request("edit.state", undefined),
        ]);
        set(
          viewedSnapshot() ? { logs, undo } : { canvases, logs, pages, undo }
        );
      }
    } catch (error) {
      get().setError((error as Error).message);
    }
  },
  loaded: false,
  logs: [],
  openSaveConfig: (saveConfigOpen) => set({ saveConfigOpen }),
  openSettings: (settingsOpen, section) => {
    const settingsSection = section ?? get().settingsSection;
    set({ settingsOpen, settingsSection });
    writeSettingsSection(settingsOpen ? settingsSection : null);
  },
  pages: [],
  saveConfigOpen: false,
  setError: (error) => set({ error }),
  settings: null,
  settingsOpen: readUrl().settings !== null,
  settingsSection: readUrl().settings || "repository",
  undo: { canRedo: false, canUndo: false },
}));

/** Wires server events into the store once the connection is open. */
export const bindProjectEvents = () => {
  const c = api();
  c.on("project", (info) => {
    const before = useProject.getState().info;
    useProject.setState({ info });
    // A project opened by the server on its own (detected at start, a changed configuration
    // file) brings settings and pages the editor has not read yet.
    if (
      info.configured &&
      (!before.configured ||
        before.repoPath !== info.repoPath ||
        before.setup !== info.setup)
    ) {
      useProject.getState().load();
    }
  });
  // A snapshot on screen keeps its own list; the files' is read again on going back to now.
  c.on("pages", ({ canvases, pages }) => {
    if (!viewedSnapshot()) {
      useProject.setState({ canvases, pages });
    }
  });
  c.on("log", (line) =>
    useProject.setState((s) => ({ logs: [...s.logs.slice(-499), line] }))
  );
  c.on("edit.state", (undo) => useProject.setState({ undo }));
};

const notConfiguredListeners = new Set<() => void>();

/** Called when a request fails because no project is open, instead of reporting it. */
export const onNotConfigured = (listener: () => void) => {
  notConfiguredListeners.add(listener);
  return () => notConfiguredListeners.delete(listener);
};

export const reportError = (error: unknown) => {
  if (
    error instanceof RequestError &&
    error.code === "not_configured" &&
    notConfiguredListeners.size > 0
  ) {
    for (const listener of notConfiguredListeners) {
      listener();
    }
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  useProject.getState().setError(message);
};
