/**
 * Fills the editor's `Platform` (`apps/web/src/platform.ts`) as `window.ultrapaintPlatform`,
 * before the editor loads; the welcome page uses the same. What it holds is the shell bridge's
 * table (`@ultrapaint/contracts/shell-bridge`), as much of it as the main process shows the open
 * project (`bridge.ts`); everything goes to the main process, and nothing of Electron reaches the
 * page but these functions.
 */
import { contextBridge, ipcRenderer } from "electron";
import { type BridgeInfo, exposeBridge, INFO_CHANNEL } from "./bridge.ts";

const info = ipcRenderer.sendSync(INFO_CHANNEL) as BridgeInfo;

contextBridge.exposeInMainWorld(
  "ultrapaintPlatform",
  exposeBridge(ipcRenderer, info)
);
