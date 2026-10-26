/**
 * Fills the editor's `Platform` (`apps/web/src/platform.ts`) as `window.ultrapaintPlatform`,
 * before the editor loads; the welcome page uses the same. Everything goes to the main process;
 * nothing of Electron reaches the page but these functions.
 */
import { contextBridge, ipcRenderer } from "electron";
import { Channel, type ListedProject, type PickFolderOptions } from "./ipc.ts";

contextBridge.exposeInMainWorld("ultrapaintPlatform", {
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
