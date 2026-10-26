/**
 * Fills the editor's `Platform` (`apps/web/src/platform.ts`) as `window.ultrapaintPlatform`,
 * before the editor loads. Everything goes to the main process; nothing of Electron reaches the
 * page but these functions.
 */
import { contextBridge, ipcRenderer } from "electron";
import { Channel, type PickFolderOptions } from "./ipc.ts";

contextBridge.exposeInMainWorld("ultrapaintPlatform", {
  pickFolder: (options?: PickFolderOptions): Promise<string | null> =>
    ipcRenderer.invoke(Channel.pickFolder, options),
});
