import { RequestError } from "@ultrapaint/client-runtime/connection";
import type { UndoState } from "@ultrapaint/contracts/edit";
import type { Canvas, Page, PageList } from "@ultrapaint/contracts/pages";
import type { ProjectInfo } from "@ultrapaint/contracts/project";
import type { Settings } from "@ultrapaint/contracts/settings";
import { create } from "zustand";
import { keptAsTheyWere } from "../lib/kept-as-they-were.ts";
import { api } from "./connection.ts";
import { follow } from "./server-data.ts";
import { readUrl, writeSettingsSection } from "./url.ts";

interface ProjectStore {
  canvases: readonly Canvas[];
  error: string | null;
  info: ProjectInfo;
  load: () => Promise<void>;
  /** Why the project info couldn't be read before it ever was: what the settings say instead. */
  loadError: string | null;
  /** The project info and settings have been read once. */
  loaded: boolean;
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

export const useProject = create<ProjectStore>((set, get) => ({
  canvases: [],
  error: null,
  info: {
    configured: false,
    storage: { mode: "managed" },
  },
  load: async () => {
    try {
      await projectData.read();
      if (projectOpen()) {
        await Promise.all([pagesData.read(), historyData.read()]);
      }
    } catch (error) {
      reportError(error);
    }
  },
  loadError: null,
  loaded: false,
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

/** Whether a project is open: what the pages, the documents and the rest belong to. */
const projectOpen = () => useProject.getState().info.configured;

/** The project's info, with the settings in force: read first at every connection open. */
const projectData = follow({
  apply: (info) =>
    useProject.setState({
      info,
      loadError: null,
      loaded: true,
      settings: info.settings ?? null,
    }),
  atOpen: () => true,
  on: {
    project: (info) => {
      const before = useProject.getState().info;
      useProject.setState({ info, settings: info.settings ?? null });
      // A project opened by the server on its own (detected at start, a changed configuration
      // file) brings pages the editor has not read yet; the settings come with the info.
      if (
        info.configured &&
        (!before.configured ||
          before.repoPath !== info.repoPath ||
          before.setup !== info.setup)
      ) {
        useProject.getState().load();
      }
    },
  },
  // A read that fails before any has landed leaves nothing to show: the settings say why.
  read: () =>
    api()
      .request("project.info", undefined)
      .catch((error: unknown) => {
        if (!useProject.getState().loaded) {
          useProject.setState({
            loadError: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }),
});

const takePages = ({ canvases, pages }: PageList) =>
  useProject.setState((s) => ({
    canvases: keptAsTheyWere(s.canvases, canvases),
    pages: keptAsTheyWere(s.pages, pages),
  }));

/** The canvases and their pages; a snapshot on screen shows its own. */
const pagesData = follow({
  apply: takePages,
  atOpen: projectOpen,
  on: { pages: takePages },
  read: () => api().request("pages.list", undefined),
  snapshot: (view) => ({ canvases: view.canvases, pages: view.pages }),
  whole: ["pages"],
});

/** Where the undo history stands. */
const historyData = follow({
  apply: (undo) => useProject.setState({ undo }),
  atOpen: projectOpen,
  on: { "edit.state": (undo) => useProject.setState({ undo }) },
  read: () => api().request("edit.state", undefined),
});

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
