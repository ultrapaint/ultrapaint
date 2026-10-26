/**
 * Fills the editor's `Platform` (`apps/web/src/platform.ts`) as `window.ultrapaintPlatform`,
 * before the editor loads; the welcome page uses the same. Everything goes to the main process;
 * nothing of Electron reaches the page but these functions.
 */
import { contextBridge, ipcRenderer } from "electron";
import {
  type AgentStatus,
  Channel,
  type ListedProject,
  type NewDesignOutcome,
  type NewDesignRequest,
  type NewDesignUpdate,
  type PickFolderOptions,
  type ShellNotice,
} from "./ipc.ts";

contextBridge.exposeInMainWorld("ultrapaintPlatform", {
  agents: {
    choosePath: (id: string): Promise<void> =>
      ipcRenderer.invoke(Channel.agentsChoosePath, id),
    clearPath: (id: string): Promise<void> =>
      ipcRenderer.invoke(Channel.agentsClearPath, id),
    download: (id: string): Promise<void> =>
      ipcRenderer.invoke(Channel.agentsDownload, id),
    list: (): Promise<readonly AgentStatus[]> =>
      ipcRenderer.invoke(Channel.agentsList),
    setApiKey: (id: string, key: string | null): Promise<void> =>
      ipcRenderer.invoke(Channel.agentsSetApiKey, id, key),
    signIn: (id: string): Promise<void> =>
      ipcRenderer.invoke(Channel.agentsSignIn, id),
  },
  newDesign: {
    /** The steps come as events while the request runs; the listener goes with it. */
    create: async (
      request: NewDesignRequest,
      onProgress: (update: NewDesignUpdate) => void
    ): Promise<NewDesignOutcome> => {
      const listener = (_event: unknown, update: NewDesignUpdate) =>
        onProgress(update);
      ipcRenderer.on(Channel.newDesignProgress, listener);
      try {
        return await ipcRenderer.invoke(Channel.newDesignCreate, request);
      } finally {
        ipcRenderer.off(Channel.newDesignProgress, listener);
      }
    },
    folderFor: (name: string): Promise<string> =>
      ipcRenderer.invoke(Channel.newDesignFolder, name),
    open: (folder: string, name: string): Promise<NewDesignOutcome> =>
      ipcRenderer.invoke(Channel.newDesignOpen, folder, name),
  },
  notices: (): Promise<readonly ShellNotice[]> =>
    ipcRenderer.invoke(Channel.notices),
  pickFolder: (options?: PickFolderOptions): Promise<string | null> =>
    ipcRenderer.invoke(Channel.pickFolder, options),
  projects: {
    add: (): Promise<void> => ipcRenderer.invoke(Channel.projectsAdd),
    current: (): Promise<string | null> =>
      ipcRenderer.invoke(Channel.projectsCurrent),
    list: (): Promise<readonly ListedProject[]> =>
      ipcRenderer.invoke(Channel.projectsList),
    open: (id: string): Promise<void> =>
      ipcRenderer.invoke(Channel.projectsOpen, id),
  },
});
