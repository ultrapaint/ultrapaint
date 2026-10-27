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
  type RemoteProjectRequest,
  type ShellInfo,
  type ShellNotice,
  type ShellStatus,
} from "./ipc.ts";

const info = ipcRenderer.sendSync(Channel.shellInfo) as ShellInfo;

// The page's thread runs: silent, the main process ends the script holding it (`main.ts`).
setInterval(() => ipcRenderer.send(Channel.beat), 250);

/** What the app is doing for the open project, as it last said. */
let { status } = info;
const listeners = new Set<(next: ShellStatus | null) => void>();
ipcRenderer.on(Channel.shellStatus, (_event, next: ShellStatus | null) => {
  status = next;
  for (const listener of listeners) {
    listener(next);
  }
});

/** The window's buttons over the page, on a Mac; full screen hides them. */
const fullScreenListeners = new Set<(fullScreen: boolean) => void>();
let fullScreen = info.windowControls?.fullScreen ?? false;
ipcRenderer.on(Channel.fullScreen, (_event, next: boolean) => {
  fullScreen = next;
  for (const listener of fullScreenListeners) {
    listener(next);
  }
});
const windowControls = info.windowControls
  ? {
      fullScreen: () => fullScreen,
      inset: info.windowControls.inset,
      subscribe: (listener: (next: boolean) => void) => {
        fullScreenListeners.add(listener);
        return () => {
          fullScreenListeners.delete(listener);
        };
      },
    }
  : undefined;

const agents = {
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
};

contextBridge.exposeInMainWorld("ultrapaintPlatform", {
  // This machine's agents are no matter to a server on another one, which has its own.
  ...(info.remote ? {} : { agents }),
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
    open: (
      folder: string,
      name: string,
      template: NewDesignRequest["template"]
    ): Promise<NewDesignOutcome> =>
      ipcRenderer.invoke(Channel.newDesignOpen, folder, name, template),
  },
  notices: (): Promise<readonly ShellNotice[]> =>
    ipcRenderer.invoke(Channel.notices),
  pickFolder: (options?: PickFolderOptions): Promise<string | null> =>
    ipcRenderer.invoke(Channel.pickFolder, options),
  projects: {
    add: (): Promise<void> => ipcRenderer.invoke(Channel.projectsAdd),
    addRemote: (
      request: RemoteProjectRequest
    ): Promise<{ readonly problem?: string }> =>
      ipcRenderer.invoke(Channel.projectsAddRemote, request),
    current: (): Promise<string | null> =>
      ipcRenderer.invoke(Channel.projectsCurrent),
    list: (): Promise<readonly ListedProject[]> =>
      ipcRenderer.invoke(Channel.projectsList),
    open: (id: string): Promise<void> =>
      ipcRenderer.invoke(Channel.projectsOpen, id),
    sshHosts: (): Promise<readonly string[]> =>
      ipcRenderer.invoke(Channel.sshHosts),
  },
  ...(windowControls ? { windowControls } : {}),
  shellStatus: {
    current: (): ShellStatus | null => status,
    subscribe: (listener: (next: ShellStatus | null) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  },
});
