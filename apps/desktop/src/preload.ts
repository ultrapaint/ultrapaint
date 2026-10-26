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
  type MappedUrl,
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

/** The preview's URLs as forwarded, kept: the editor asks on every change of its state. */
const forwarded = new Map<string, string>();

/**
 * The preview's URL through the port the app forwards for it, for a project on another machine.
 * The first time, the page waits while the port is forwarded; a URL the app could not forward
 * now (the connection is down) is asked again the next time.
 */
const mapPreviewUrl = (url: string): string => {
  const known = forwarded.get(url);
  if (known !== undefined) {
    return known;
  }
  const mapped = ipcRenderer.sendSync(Channel.previewUrl, url) as MappedUrl;
  if (mapped.forwarded) {
    forwarded.set(url, mapped.url);
  }
  return mapped.url;
};

/** What the app is doing for the open project, as it last said. */
let { status } = info;
const listeners = new Set<(next: ShellStatus | null) => void>();
ipcRenderer.on(Channel.shellStatus, (_event, next: ShellStatus | null) => {
  status = next;
  for (const listener of listeners) {
    listener(next);
  }
});

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
  ...(info.remote ? { mapPreviewUrl } : { agents }),
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
